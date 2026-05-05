/**
 * Generation Flow Chat
 *
 * Drives the lib/generation-flow state machine from the UI.
 * One component handles all three flow types: programme, session, modification.
 *
 * Flow:
 *   1. mount → POST /generation-flow {action:"start"}
 *   2. each user reply → POST {action:"advance"} → render next question + options
 *   3. when previewReady (programme only) → POST {action:"preview"} → render preview
 *   4. when complete → POST {action:"generate"} → render result, fire onComplete
 *   5. modification swap_choices step → POST {action:"swap_options"} → render
 *      one card per affected exercise; each tap → POST {action:"record_swap"}.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/auth-context";

// ── Types matching the server-side FlowState shape ────────────────────────

type FlowType = "programme" | "session" | "modification";

interface SlotOption {
  value: string;
  label: string;
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
  | { kind: "modification"; data: unknown };

interface GenerationFlowChatProps {
  type: FlowType;
  context: Record<string, unknown>;
  onPreview?: (preview: unknown) => void;
  onComplete?: (result: GenerateResult) => void;
  /** Optional: called whenever state advances. Lets the host show a side panel. */
  onStateChange?: (state: FlowState) => void;
}

export function GenerationFlowChat({
  type,
  context,
  onPreview,
  onComplete,
  onStateChange,
}: GenerationFlowChatProps) {
  const { token } = useAuth();
  const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [state, setState] = useState<FlowState | null>(null);
  const [options, setOptions] = useState<OptionsBlock | null>(null);
  const [textInput, setTextInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [swapSets, setSwapSets] = useState<SwapChoiceSet[] | null>(null);
  const [activeSwapIndex, setActiveSwapIndex] = useState(0);
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

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

  function commitState(next: FlowState) {
    setState(next);
    onStateChange?.(next);
  }

  // ── Start ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError("");
    callFlow({ action: "start", type, context })
      .then((data) => {
        commitState(data.state as FlowState);
        setOptions((data.options as OptionsBlock | null) ?? null);
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

    setError("");
    setBusy(true);

    // Optimistic user bubble.
    const userBubble: FlowMessage = { role: "user", content: trimmed };
    commitState({ ...state, history: [...state.history, userBubble] });

    try {
      const data = await callFlow({ action: "advance", state, userMessage: trimmed });
      const next = data.state as FlowState;
      commitState(next);
      setOptions((data.options as OptionsBlock | null) ?? null);
      setTextInput("");

      if (data.previewReady === true && type === "programme") {
        await runPreview(next);
        return;
      }
      if (data.complete === true) {
        // Modification flow finishes via record_swap loop, but other flows
        // can finalise here.
        if (type !== "modification") await runGenerate(next);
        return;
      }
      // Modification flow: when currentSlot becomes swap_choices, fetch options.
      if (type === "modification" && next.currentSlot === "swap_choices") {
        await loadSwapOptions(next);
      }
    } catch (e) {
      setError(asErrorMessage(e));
    } finally {
      setBusy(false);
    }
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
      } else {
        // All decisions recorded → move to the confirm slot.
        // The next `send("yes")` from the user fires generate.
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

  // ── UI ─────────────────────────────────────────────────────────────────

  const showSwapUI =
    type === "modification" &&
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
          onPick={(decision, replacement) => recordSwap(activeSwap.exerciseName, decision, replacement)}
        />
      ) : null}

      {!done && !busy && !showSwapUI && options ? (
        <OptionsRow
          options={options}
          onPick={(value) => send(value)}
        />
      ) : null}

      {!done && !busy && !showSwapUI ? (
        <FreeTextInput
          value={textInput}
          onChange={setTextInput}
          onSend={() => send(textInput)}
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
  onPick,
}: {
  options: OptionsBlock;
  onPick: (value: string) => void;
}) {
  if (options.kind === "free_text") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.label)}
          className="text-xs px-3 py-1.5 rounded-full border bg-muted/30 hover:bg-muted/60 transition-colors"
        >
          {o.label}
        </button>
      ))}
      {options.allowOther ? (
        <span className="text-xs text-muted-foreground self-center">or type your own below</span>
      ) : null}
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
          Send
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

function asErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
