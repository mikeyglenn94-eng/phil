import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { QuickReply } from "@/components/chat/quick-reply-chips";

// Storage key — sessionStorage so the thread survives tab navigation, page
// refresh, or returning to the chat from a deep-linked sheet, but does not
// leak across browser sessions or different signed-in users on the same device.
const STORAGE_KEY = "mg.chatThread.v1";

interface PersistedShape {
  messages: ChatMessage[];
  chipStateByMsg: Record<string, ChipState>;
}

function loadPersisted(): PersistedShape | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(value: PersistedShape) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota or privacy mode — silently ignore. The thread still works in-memory.
  }
}

// ── Types ─────────────────────────────────────────────────────────

/** Bubble kinds rendered in the /chat thread. "text" is the default; "feedback-prompt"
 *  shows a Wave-1 chip strip + a voice-note icon for post-session reactions. */
export type ChatBubbleKind = "text" | "feedback-prompt";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Bubble variant. Omitted ⇒ "text". Backwards compatible with persisted threads. */
  kind?: ChatBubbleKind;
  /** Free-form payload travelling with non-text bubbles (e.g. session/programme ids). */
  payload?: { sessionId?: string; clientId?: number; programmeId?: number };
  /** Optional chips offered by Phil. Rendered as a row above the composer when this is the latest assistant turn. */
  quickReplies?: QuickReply[];
  /** ms epoch — lets us order/diff stably without depending on array index. */
  ts: number;
}

/** Per-message UI lock state for the chip row. Mirrors what the in-tab Phil chat tracks. */
export interface ChipState {
  /** Chip the user picked. Once set, the row is locked. */
  selectedValue?: string;
  /** True when the user dismissed the chips by typing instead. */
  promoted?: boolean;
}

interface AskParams {
  question: string;
  /** Dashboard context string — caller builds it from analytics. */
  context: string;
  clientId: number;
}

/** Pre-built bubble shape used by injectBubbles — the caller picks ids/timestamps if it cares. */
export interface InjectableBubble {
  id?: string;
  role?: "user" | "assistant";
  content: string;
  kind?: ChatBubbleKind;
  payload?: ChatMessage["payload"];
  quickReplies?: QuickReply[];
}

interface ChatContextValue {
  messages: ChatMessage[];
  loading: boolean;
  ask: (params: AskParams) => Promise<void>;
  clear: () => void;
  /** Chip lock state, keyed by message id. */
  chipStateByMsg: Record<string, ChipState>;
  setChipState: (msgId: string, partial: Partial<ChipState>) => void;
  /** Push pre-built bubbles into the thread (used by the workout-logger Finish flow). */
  injectBubbles: (bubbles: InjectableBubble[]) => void;
  /** Persist a feedback chip pick for a feedback-prompt bubble. */
  submitFeedback: (msgId: string, rating: "smashed" | "clean" | "grim") => Promise<void>;
  /**
   * Transient one-shot draft used by launcher surfaces (e.g. AskPhilDock) to
   * pre-fill the /chat composer. Not persisted to sessionStorage on purpose:
   * a stale draft replayed after refresh would surprise the user. The /chat
   * page reads this on mount and immediately calls setDraft("") to consume it.
   */
  draft: string;
  setDraft: (value: string) => void;
}

// ── Context ───────────────────────────────────────────────────────

const ChatCtx = createContext<ChatContextValue | null>(null);

function newId(): string {
  // Short, collision-resistant enough for a single chat thread per session.
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  // Hydrate from sessionStorage on first mount so the thread survives page
  // refresh, deep-link entry, and any kind of navigation back to the chat.
  // Lazy initialiser ensures we read storage exactly once.
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadPersisted()?.messages ?? []);
  const [loading, setLoading] = useState(false);
  const [chipStateByMsg, setChipStateByMsg] = useState<Record<string, ChipState>>(
    () => loadPersisted()?.chipStateByMsg ?? {},
  );
  // Transient draft pre-fill from launcher surfaces. In-memory only.
  const [draft, setDraft] = useState<string>("");

  // Persist whenever the durable parts of state change. Loading is intentionally
  // NOT persisted — a stale "loading" flag from a previous session would freeze
  // the input on reload.
  useEffect(() => {
    savePersisted({ messages, chipStateByMsg });
  }, [messages, chipStateByMsg]);

  const ask = useCallback(async ({ question, context, clientId }: AskParams) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    // Snapshot the last 2 turns to send as history (matches the existing endpoint's
    // expectation — it only consumes `slice(-2)` server-side anyway, so we keep
    // the payload small).
    const history = messages.slice(-2).map(m => ({ role: m.role, content: m.content }));

    const userMsg: ChatMessage = { id: newId(), role: "user", content: trimmed, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(`/api/clients/${clientId}/coaching`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, context, history }),
      });
      const data = await res.json().catch(() => ({}));
      const answer: string = (data?.answer as string) ?? "Something went wrong. Please try again.";
      // The current /coaching endpoint does not emit quickReplies, but the renderer
      // is ready for them — when the prompt is extended later, this just lights up.
      const quickReplies: QuickReply[] | undefined = Array.isArray(data?.quickReplies)
        ? (data.quickReplies as QuickReply[])
        : undefined;
      const replyMsg: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: answer,
        quickReplies,
        ts: Date.now(),
      };
      setMessages(prev => [...prev, replyMsg]);
    } catch {
      setMessages(prev => [...prev, {
        id: newId(),
        role: "assistant",
        content: "Could not reach the coaching service. Check your connection.",
        ts: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  const clear = useCallback(() => {
    setMessages([]);
    setChipStateByMsg({});
    // The persist effect will write the cleared state, but do it eagerly too
    // so a same-tick reload sees the empty thread.
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  const setChipState = useCallback((msgId: string, partial: Partial<ChipState>) => {
    setChipStateByMsg(prev => ({ ...prev, [msgId]: { ...prev[msgId], ...partial } }));
  }, []);

  const injectBubbles = useCallback((bubbles: InjectableBubble[]) => {
    if (!bubbles?.length) return;
    const now = Date.now();
    const built: ChatMessage[] = bubbles.map((b, i) => ({
      id: b.id ?? newId(),
      role: b.role ?? "assistant",
      content: b.content,
      kind: b.kind,
      payload: b.payload,
      quickReplies: b.quickReplies,
      // Tiny offsets so timestamps strictly increase even within the same tick.
      ts: now + i,
    }));
    setMessages(prev => [...prev, ...built]);
  }, []);

  const submitFeedback = useCallback(async (msgId: string, rating: "smashed" | "clean" | "grim") => {
    // Lock the chip immediately so the UI feels instant; rollback only if write fails badly.
    setChipStateByMsg(prev => ({ ...prev, [msgId]: { ...prev[msgId], selectedValue: rating } }));
    const target = messages.find(m => m.id === msgId);
    const clientId = target?.payload?.clientId;
    const sessionId = target?.payload?.sessionId;
    const programmeId = target?.payload?.programmeId;
    if (!clientId || !sessionId) return;
    try {
      await fetch(`/api/clients/${clientId}/session-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, programmeId, rating }),
      });
    } catch (err) {
      // Non-fatal: we keep the chip locked because the user already expressed their pick.
      // A retry surface can be added later if we see meaningful drop-off in writes.
      console.warn("[chat] submitFeedback failed:", err);
    }
  }, [messages]);

  const value = useMemo<ChatContextValue>(() => ({
    messages,
    loading,
    ask,
    clear,
    chipStateByMsg,
    setChipState,
    injectBubbles,
    submitFeedback,
    draft,
    setDraft,
  }), [messages, loading, ask, clear, chipStateByMsg, setChipState, injectBubbles, submitFeedback, draft]);

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error("useChat must be used within <ChatProvider>");
  return ctx;
}
