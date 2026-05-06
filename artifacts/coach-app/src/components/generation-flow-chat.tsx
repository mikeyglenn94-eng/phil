/**
 * Generation Flow Chat
 *
 * Drives the lib/generation-flow state machine from the UI. One component,
 * two render modes:
 *
 *   - **Wizard mode** (default for embed): a single-question screen with
 *     back / cancel / step indicator. Replaces the host chat surface while
 *     a flow is active. No transcript, no per-turn onMessage emission —
 *     only onComplete + onCancel fire to the host.
 *
 *   - **Standalone mode** (dev playground / debug): the legacy transcript-
 *     plus-chip-row layout with a free-text input. Used for visual debugging
 *     of the slot machine. Emits per-turn onMessage so callers can mirror
 *     into a parent bubble stream.
 *
 * Server actions (POST /api/generation-flow):
 *   - {action:"start"}                     → first slot's question + options + stepInfo.
 *   - {action:"advance", state, userMessage} → next slot's question + options + stepInfo.
 *   - {action:"preview", state}             → programme-flow week-1 preview.
 *   - {action:"generate", state}            → terminal generation.
 *   - {action:"swap_options", state}        → modification-flow swap-card sets.
 *   - {action:"record_swap", ...}           → record a single swap decision.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Loader2, ArrowRight, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";

// ── Types matching the server-side FlowState shape ────────────────────────

type FlowType = "programme" | "session" | "modification" | "progression";

interface SlotOption {
  value: string;
  label: string;
  /** "Coming soon" — chip renders but is non-interactive. */
  disabled?: boolean;
}

interface OptionsBlock {
  kind: "single_select" | "multi_select" | "free_text" | "bool";
  options: SlotOption[];
  allowOther: boolean;
}

interface FlowMessage {
  role: "user" | "assistant";
  content: string;
}

interface StepInfo {
  currentStepNumber: number;
  totalSteps: number;
}

// Loose shape — full structure lives in lib/generation-flow.
interface FlowState {
  type: FlowType;
  slots: Record<string, unknown>;
  currentSlot: string | null;
  history: FlowMessage[];
  context: unknown;
  previewGenerated?: boolean;
  preview?: unknown;
  lastParseFailure?: string | null;
}

interface SwapOption {
  name: string;
  reason: string;
  recommended: boolean;
}

interface SwapChoiceSet {
  exerciseName: string;
  affectedRefs: { exerciseId: string; sessionId: string }[];
  options: SwapOption[];
}

type GenerateResult =
  | { kind: "programme"; data: unknown }
  | { kind: "session"; data: unknown }
  | { kind: "modification"; data: unknown }
  | { kind: "progression"; data: unknown };

interface GenerationFlowChatProps {
  type: FlowType;
  context: Record<string, unknown>;
  onPreview?: (preview: unknown) => void;
  onComplete?: (result: GenerateResult) => void;
  /** Optional: called whenever state advances. Lets the host show a side panel. */
  onStateChange?: (state: FlowState) => void;
  /** When true, render in wizard mode (single question per screen, replaces
   *  the host's chat surface). When false / unset, render in standalone
   *  transcript mode for the dev playground. */
  embedded?: boolean;
  /** Standalone-mode-only: emit each new flow history turn so callers can
   *  mirror into their own bubble stream. Wizard mode does NOT emit per-turn
   *  messages — only onComplete fires to the host. */
  onMessage?: (message: FlowMessage) => void;
  /** Wizard-mode: called when the user taps the X button or types a hard
   *  cancel keyword in a free-text field. Host should clear flow state. */
  onCancel?: () => void;
}

export interface GenerationFlowChatHandle {
  send: (userMessage: string) => Promise<void>;
}

const CANCEL_RE = /^(cancel|never\s?mind|nevermind|stop|forget it|abort|nope|drop it)\b/i;

export const GenerationFlowChat = forwardRef<
  GenerationFlowChatHandle,
  GenerationFlowChatProps
>(function GenerationFlowChat({
  type,
  context,
  onPreview,
  onComplete,
  onStateChange,
  embedded,
  onMessage,
  onCancel,
}, ref) {
  const { token } = useAuth();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [state, setState] = useState<FlowState | null>(null);
  const [options, setOptions] = useState<OptionsBlock | null>(null);
  const [stepInfo, setStepInfo] = useState<StepInfo | null>(null);
  const [textInput, setTextInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [swapSets, setSwapSets] = useState<SwapChoiceSet[] | null>(null);
  const [activeSwapIndex, setActiveSwapIndex] = useState(0);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  // Wizard-mode cache: per-slot snapshot of (question, options, stepInfo) so
  // the back button can revert to a previous slot's UI without re-fetching.
  // Keyed by slot name. Filled as the wizard advances.
  interface SlotPanel {
    question: string;
    options: OptionsBlock | null;
    stepInfo: StepInfo | null;
  }
  const [slotPanels, setSlotPanels] = useState<Record<string, SlotPanel>>({});

  // ── Server call ────────────────────────────────────────────────────────

  async function callFlow(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${BASE}/api/generation-flow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text || "request failed"}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  /** Tracks how many messages from history we've already emitted via onMessage.
   *  Lets us emit only the *new* turns each time the state updates. Standalone
   *  mode only — wizard mode skips emission entirely. */
  const emittedCountRef = useRef(0);

  function commitState(next: FlowState, opts?: { nextOptions: OptionsBlock | null; nextStepInfo: StepInfo | null; nextAssistantMessage: string | null }) {
    setState(next);
    onStateChange?.(next);

    // Wizard mode caches per-slot snapshots so the back button can revert.
    if (embedded && next.currentSlot && opts) {
      // The latest assistant message is the question for the new currentSlot.
      const question = opts.nextAssistantMessage ?? lastAssistantContent(next.history);
      setSlotPanels((prev) => ({
        ...prev,
        [next.currentSlot!]: {
          question,
          options: opts.nextOptions,
          stepInfo: opts.nextStepInfo,
        },
      }));
    }

    // Standalone mode mirrors each new turn into the host's bubble stream.
    if (!embedded && onMessage) {
      const history = next.history ?? [];
      while (emittedCountRef.current < history.length) {
        const m = history[emittedCountRef.current];
        if (m) onMessage(m);
        emittedCountRef.current += 1;
      }
    }
  }

  // ── Imperative handle — lets a host pipe user input into the flow ──────
  useImperativeHandle(ref, () => ({
    send: async (userMessage: string) => {
      await send(userMessage);
    },
  }), [state, busy, type]);

  // ── Start ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError("");
    callFlow({ action: "start", type, context })
      .then((data) => {
        const next = data.state as FlowState;
        const nextOptions = (data.options as OptionsBlock | null) ?? null;
        const nextStepInfo = (data.stepInfo as StepInfo | null) ?? null;
        const nextMessage = (data.assistantMessage as string | null) ?? null;
        commitState(next, { nextOptions, nextStepInfo, nextAssistantMessage: nextMessage });
        setOptions(nextOptions);
        setStepInfo(nextStepInfo);
      })
      .catch((e) => setError(asErrorMessage(e)))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Advance ────────────────────────────────────────────────────────────

  async function send(userMessage: string) {
    if (!state || busy) return;
    const trimmed = userMessage.trim();
    if (!trimmed) return;

    // Wizard-mode hard cancel — typed into a free-text field counts.
    if (embedded && onCancel && CANCEL_RE.test(trimmed)) {
      onCancel();
      return;
    }

    setError("");
    setBusy(true);

    // Optimistic user bubble — only mirrored in standalone mode.
    const userBubble: FlowMessage = { role: "user", content: trimmed };
    const optimistic: FlowState = { ...state, history: [...state.history, userBubble] };
    commitState(optimistic);

    try {
      const data = await callFlow({ action: "advance", state, userMessage: trimmed });
      const next = data.state as FlowState;
      const nextOptions = (data.options as OptionsBlock | null) ?? null;
      const nextStepInfo = (data.stepInfo as StepInfo | null) ?? null;
      const nextMessage = (data.assistantMessage as string | null) ?? null;
      commitState(next, { nextOptions, nextStepInfo, nextAssistantMessage: nextMessage });
      setOptions(nextOptions);
      setStepInfo(nextStepInfo);
      setTextInput("");

      if (data.previewReady === true && type === "programme") {
        await runPreview(next);
        return;
      }
      if (data.complete === true) {
        if (type !== "modification") await runGenerate(next);
        return;
      }
      if (type === "modification" && next.currentSlot === "swap_choices") {
        await loadSwapOptions(next);
      }
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Wizard back navigation ─────────────────────────────────────────────

  /** Slot names that have been visited (in order), based on state.slots
   *  having a non-null value. The current slot is the latest unfilled one. */
  const visitedSlotNames = useMemo(() => {
    if (!state) return [];
    return Object.entries(state.slots)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k]) => k);
  }, [state]);

  /** True if there is a slot earlier than the current one we can step back to. */
  const canGoBack = useMemo(() => {
    if (!state || !state.currentSlot) return false;
    // We can step back if at least one slot has been answered before the current one.
    return visitedSlotNames.length > 0;
  }, [state, visitedSlotNames]);

  function goBack() {
    if (!state || !canGoBack) return;
    // The most recently answered slot — we revert to that one.
    const prevSlotName = visitedSlotNames[visitedSlotNames.length - 1];
    if (!prevSlotName) return;
    const cached = slotPanels[prevSlotName];
    if (!cached) return;
    setState({ ...state, currentSlot: prevSlotName });
    setOptions(cached.options);
    setStepInfo(cached.stepInfo);
    setError("");
  }

  // ── Preview (programme only) ───────────────────────────────────────────

  async function runPreview(s: FlowState) {
    setBusy(true);
    try {
      const data = await callFlow({ action: "preview", state: s });
      const next = data.state as FlowState;
      commitState(next);
      const preview = data.preview as unknown;
      onPreview?.(preview);
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Modification: swap options ─────────────────────────────────────────

  async function loadSwapOptions(s: FlowState) {
    setBusy(true);
    try {
      const data = await callFlow({ action: "swap_options", state: s });
      const sets = data.swapChoiceSets as SwapChoiceSet[];
      setSwapSets(sets);
      setActiveSwapIndex(0);
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function recordSwap(exerciseName: string, decisionKind: "keep" | "remove" | "swap", replacementName?: string) {
    if (!state) return;
    setBusy(true);
    try {
      const decision =
        decisionKind === "swap" && replacementName
          ? { kind: "swap" as const, replacementName }
          : decisionKind === "remove"
            ? { kind: "remove" as const }
            : { kind: "keep" as const };

      const data = await callFlow({ action: "record_swap", state, exerciseName, decision });
      const next = data.state as FlowState;
      commitState(next);

      const total = swapSets?.length ?? 0;
      if (activeSwapIndex + 1 < total) {
        setActiveSwapIndex(activeSwapIndex + 1);
      }
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Generate (final) ───────────────────────────────────────────────────

  async function runGenerate(s: FlowState) {
    setBusy(true);
    try {
      const data = await callFlow({ action: "generate", state: s });
      const result: GenerateResult = {
        kind: type as GenerateResult["kind"],
        data: data.result,
      };
      setDone(true);
      onComplete?.(result);
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Render: dispatch by mode ───────────────────────────────────────────

  if (embedded) {
    return (
      <WizardView
        state={state}
        options={options}
        stepInfo={stepInfo}
        busy={busy}
        error={error}
        textInput={textInput}
        setTextInput={setTextInput}
        swapSets={swapSets}
        activeSwapIndex={activeSwapIndex}
        canGoBack={canGoBack}
        onBack={goBack}
        onCancel={onCancel}
        onPick={(value) => send(value)}
        onSubmitText={() => send(textInput)}
        onPickSwap={(decision, replacement) => {
          const set = swapSets?.[activeSwapIndex];
          if (!set) return;
          void recordSwap(set.exerciseName, decision, replacement);
        }}
        done={done}
      />
    );
  }

  // Standalone mode (dev playground) — keep the existing transcript layout.
  return (
    <StandaloneView
      state={state}
      options={options}
      busy={busy}
      error={error}
      textInput={textInput}
      setTextInput={setTextInput}
      swapSets={swapSets}
      activeSwapIndex={activeSwapIndex}
      done={done}
      onPick={(value) => send(value)}
      onSubmitText={() => send(textInput)}
      onPickSwap={(decision, replacement) => {
        const set = swapSets?.[activeSwapIndex];
        if (!set) return;
        void recordSwap(set.exerciseName, decision, replacement);
      }}
    />
  );
});

// ── Wizard view ───────────────────────────────────────────────────────────

interface WizardViewProps {
  state: FlowState | null;
  options: OptionsBlock | null;
  stepInfo: StepInfo | null;
  busy: boolean;
  error: string;
  textInput: string;
  setTextInput: (v: string) => void;
  swapSets: SwapChoiceSet[] | null;
  activeSwapIndex: number;
  canGoBack: boolean;
  onBack: () => void;
  onCancel?: () => void;
  onPick: (value: string) => void;
  onSubmitText: () => void;
  onPickSwap: (decision: "keep" | "remove" | "swap", replacement?: string) => void;
  done: boolean;
}

function WizardView({
  state,
  options,
  stepInfo,
  busy,
  error,
  textInput,
  setTextInput,
  swapSets,
  activeSwapIndex,
  canGoBack,
  onBack,
  onCancel,
  onPick,
  onSubmitText,
  onPickSwap,
  done,
}: WizardViewProps) {
  const showSwapUI =
    state?.type === "modification" &&
    state?.currentSlot === "swap_choices" &&
    swapSets &&
    swapSets.length > 0 &&
    !done;
  const activeSwap = showSwapUI ? swapSets![activeSwapIndex] : null;

  const question = state?.currentSlot ? lastAssistantContent(state.history) : "";

  // The previously-saved value (if user is revisiting via Back).
  const previousValue = state?.currentSlot ? state.slots[state.currentSlot] : undefined;
  const previousValueString =
    typeof previousValue === "string"
      ? previousValue
      : previousValue && typeof previousValue === "object" && "value" in (previousValue as Record<string, unknown>)
        ? String((previousValue as { value: unknown }).value)
        : null;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — back / step indicator / cancel */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack || busy}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
          {stepInfo
            ? stepInfo.currentStepNumber > stepInfo.totalSteps
              ? "Wrapping up"
              : `Step ${stepInfo.currentStepNumber} of ${stepInfo.totalSteps}`
            : ""}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {error ? (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
            {error}
          </div>
        ) : null}

        {busy && !state ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Working...
          </div>
        ) : null}

        {!busy && question ? (
          <h2 className="text-base font-semibold leading-snug">{question}</h2>
        ) : null}

        {!busy && showSwapUI && activeSwap ? (
          <SwapCard
            set={activeSwap}
            index={activeSwapIndex}
            total={swapSets!.length}
            onPick={onPickSwap}
          />
        ) : null}

        {!busy && !showSwapUI && options && options.kind !== "free_text" && options.kind !== "bool" ? (
          <OptionsRow
            options={options}
            selectedValue={previousValueString}
            onPick={onPick}
          />
        ) : null}

        {!busy && !showSwapUI && options?.kind === "bool" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onPick("yes")}
              className="text-xs px-4 py-2 rounded-full border bg-muted/30 hover:bg-muted/60 transition-colors"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => onPick("no")}
              className="text-xs px-4 py-2 rounded-full border bg-muted/30 hover:bg-muted/60 transition-colors"
            >
              No
            </button>
          </div>
        ) : null}

        {!busy && !showSwapUI && (options?.kind === "free_text" || options?.allowOther) ? (
          <FreeTextInput
            value={textInput}
            onChange={setTextInput}
            onSend={onSubmitText}
            placeholder={
              options?.kind === "free_text"
                ? "Type your answer"
                : "Or type your own answer"
            }
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Standalone view (dev playground) — legacy transcript layout ───────────

interface StandaloneViewProps {
  state: FlowState | null;
  options: OptionsBlock | null;
  busy: boolean;
  error: string;
  textInput: string;
  setTextInput: (v: string) => void;
  swapSets: SwapChoiceSet[] | null;
  activeSwapIndex: number;
  done: boolean;
  onPick: (value: string) => void;
  onSubmitText: () => void;
  onPickSwap: (decision: "keep" | "remove" | "swap", replacement?: string) => void;
}

function StandaloneView({
  state,
  options,
  busy,
  error,
  textInput,
  setTextInput,
  swapSets,
  activeSwapIndex,
  done,
  onPick,
  onSubmitText,
  onPickSwap,
}: StandaloneViewProps) {
  const showSwapUI =
    state?.type === "modification" &&
    state?.currentSlot === "swap_choices" &&
    swapSets &&
    swapSets.length > 0 &&
    !done;
  const activeSwap = showSwapUI ? swapSets![activeSwapIndex] : null;

  return (
    <div className="flex flex-col gap-3 max-w-2xl mx-auto p-4">
      <ChatTranscript history={state?.history ?? []} />

      {error ? (
        <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
          {error}
        </div>
      ) : null}

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Working...
        </div>
      ) : null}

      {!done && !busy && showSwapUI && activeSwap ? (
        <SwapCard
          set={activeSwap}
          index={activeSwapIndex}
          total={swapSets!.length}
          onPick={onPickSwap}
        />
      ) : null}

      {!done && !busy && !showSwapUI && options ? (
        <OptionsRow options={options} onPick={onPick} />
      ) : null}

      {!done && !busy && !showSwapUI ? (
        <FreeTextInput
          value={textInput}
          onChange={setTextInput}
          onSend={onSubmitText}
          placeholder={
            options?.kind === "free_text"
              ? "Type your answer"
              : options?.allowOther
                ? "Or type your own answer"
                : "Type a reply"
          }
        />
      ) : null}

      {done ? (
        <div className="text-sm text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-3 py-2">
          Done. Check the next pane for the result.
        </div>
      ) : null}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function ChatTranscript({ history }: { history: FlowMessage[] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {history.map((m, i) => (
        <div
          key={i}
          className={`rounded-2xl px-3 py-2 text-sm ${
            m.role === "user"
              ? "self-end bg-primary text-primary-foreground max-w-[80%]"
              : "self-start bg-muted text-foreground max-w-[80%]"
          }`}
        >
          {m.content}
        </div>
      ))}
    </div>
  );
}

function OptionsRow({
  options,
  selectedValue,
  onPick,
}: {
  options: OptionsBlock;
  selectedValue?: string | null;
  onPick: (value: string) => void;
}) {
  if (options.kind === "free_text") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.options.map((o) => {
        const isSelected = !!selectedValue && (selectedValue === o.value || selectedValue === o.label);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => { if (!o.disabled) onPick(o.label); }}
            disabled={o.disabled}
            aria-disabled={o.disabled}
            title={o.disabled ? "Coming soon" : undefined}
            className={
              o.disabled
                ? "text-xs px-3 py-1.5 rounded-full border bg-muted/30 text-muted-foreground/60 cursor-not-allowed opacity-60"
                : isSelected
                  ? "text-xs px-3 py-1.5 rounded-full border bg-primary text-primary-foreground border-primary"
                  : "text-xs px-3 py-1.5 rounded-full border bg-muted/30 hover:bg-muted/60 transition-colors"
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FreeTextInput({
  value,
  onChange,
  onSend,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        className="min-h-[60px] text-sm bg-muted/30 border-transparent hover:border-input focus:bg-background rounded-xl"
      />
      <div className="flex justify-end">
        <Button onClick={onSend} disabled={!value.trim()} size="sm" className="gap-1.5">
          <ArrowRight className="w-3.5 h-3.5" />
          Continue
        </Button>
      </div>
    </div>
  );
}

function SwapCard({
  set,
  index,
  total,
  onPick,
}: {
  set: SwapChoiceSet;
  index: number;
  total: number;
  onPick: (decision: "keep" | "remove" | "swap", replacement?: string) => void;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{set.exerciseName}</h3>
        <span className="text-xs text-muted-foreground">
          {index + 1} of {total}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {set.options.map((o) => (
          <button
            key={o.name}
            type="button"
            onClick={() => onPick("swap", o.name)}
            className={`text-left text-sm rounded-xl border px-3 py-2 transition-colors ${
              o.recommended
                ? "border-primary/60 bg-primary/5 hover:bg-primary/10"
                : "border-border bg-background hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{o.name}</span>
              {o.recommended ? (
                <span className="text-[10px] uppercase tracking-wide text-primary">Phil's pick</span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{o.reason}</p>
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={() => onPick("keep")}>
          Keep as-is
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onPick("remove")}>
          Remove
        </Button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function lastAssistantContent(history: FlowMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === "assistant") return m.content;
  }
  return "";
}

function asErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
