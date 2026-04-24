import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/chat-context";
import { useClientContext } from "@/contexts/client-context";
import { QuickReplyChips, type QuickReply } from "@/components/chat/quick-reply-chips";
import { buildAiContext, getSuggestedPrompts } from "@/components/coaching-sheet";
import type { AnalyticsData } from "@/pages/dashboard-tab";

// ── Constants ─────────────────────────────────────────────────────

/**
 * Reserved space for the future bottom-nav bar. The bar itself isn't shipped yet,
 * so the composer floats this far above the bottom edge today; once the bar lands
 * the visual lockup will be exactly correct without further changes here.
 *
 * Matches the planned spec of 64px bar height + safe-area-inset-bottom.
 */
const NAV_HEIGHT = 64;

// ── Custom hook: keep composer above the on-screen keyboard ───────

/**
 * Returns the bottom offset (in px) the composer should use right now.
 *  - No keyboard open  → NAV_HEIGHT (sits above the bottom nav).
 *  - Keyboard open     → keyboard height (covers the nav, which is hidden anyway).
 *
 * Implemented via window.visualViewport because viewport-relative units
 * (vh, dvh) lag behind the keyboard animation on iOS Safari.
 */
function useKeyboardAwareBottomOffset(): number {
  const [offset, setOffset] = useState<number>(NAV_HEIGHT);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      // Older browsers — keep the static nav offset.
      setOffset(NAV_HEIGHT);
      return;
    }

    const update = () => {
      // Distance from the bottom of the layout viewport down to the bottom of
      // the visual viewport. 0 when no keyboard, >0 when keyboard is up.
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setOffset(keyboardHeight > 0 ? keyboardHeight : NAV_HEIGHT);
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return offset;
}

// ── Page ──────────────────────────────────────────────────────────

export default function ChatPage() {
  const { client } = useClientContext();
  const clientId = client?.id;

  const { messages, loading, ask, chipStateByMsg, setChipState } = useChat();

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listEndRef = useRef<HTMLDivElement>(null);
  const bottomOffset = useKeyboardAwareBottomOffset();

  // Pull analytics so the chat has live dashboard context to ground answers in.
  const { data: analytics } = useQuery<AnalyticsData>({
    queryKey: ["client-analytics", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/analytics`);
      if (!res.ok) throw new Error("analytics fetch failed");
      return res.json();
    },
    enabled: !!clientId,
  });

  // Derive this/last week buckets the same way the dashboard does — small helper inline
  // so we don't pull the dashboard's heavier date utilities for one calculation.
  const { thisWeekData, lastWeekData } = useMemo(() => {
    if (!analytics?.byWeek?.length) return { thisWeekData: undefined, lastWeekData: undefined };
    // byWeek is ordered oldest → newest in the dashboard; the last entry is the current week.
    const len = analytics.byWeek.length;
    return {
      thisWeekData: analytics.byWeek[len - 1],
      lastWeekData: len >= 2 ? analytics.byWeek[len - 2] : undefined,
    };
  }, [analytics]);

  const aiContext = useMemo(
    () => (analytics ? buildAiContext(analytics, thisWeekData, lastWeekData) : ""),
    [analytics, thisWeekData, lastWeekData],
  );

  const suggestedPrompts = useMemo(
    () => (analytics ? getSuggestedPrompts(analytics, thisWeekData) : []),
    [analytics, thisWeekData],
  );

  // Auto-scroll to the bottom on new messages or while loading shows.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(question: string) {
    if (!clientId || !aiContext) return; // analytics still loading — disable input below.
    const text = question.trim();
    if (!text) return;
    setInput("");
    await ask({ question: text, context: aiContext, clientId });
    // Refocus so the keyboard stays open on mobile after a chip tap.
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  // The latest assistant message; chips above the composer only render for THIS turn.
  const latestAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  const latestAssistantChipState = latestAssistant
    ? chipStateByMsg[latestAssistant.id]
    : undefined;

  const showSuggestedPrompts = messages.length === 0 && suggestedPrompts.length > 0;

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 bg-background border-b shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/phil.png"
              alt="Phil"
              className="w-9 h-9 rounded-full object-cover shrink-0"
            />
            <span className="font-semibold text-[15px] truncate">Phil</span>
          </div>
          <button
            type="button"
            aria-label="Chat options"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── Message list ────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        // Reserve enough bottom padding so the last message is never hidden
        // behind the floating composer + chip row.
        style={{ paddingBottom: bottomOffset + 96 }}
      >
        {showSuggestedPrompts && (
          <div className="space-y-3 mb-4">
            <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">
              Suggested questions
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedPrompts.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void send(p)}
                  className="text-[13px] px-3 py-2 rounded-xl border bg-card hover:bg-muted/60 transition-colors text-left leading-snug"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          {messages.map(m =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="bg-primary text-primary-foreground text-[14px] px-3.5 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] leading-relaxed">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex justify-start gap-2">
                <img
                  src="/phil.png"
                  alt="Phil"
                  className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
                />
                <div className="bg-muted/60 text-[14px] px-3.5 py-2.5 rounded-2xl rounded-tl-sm leading-relaxed whitespace-pre-line max-w-[85%]">
                  {m.content}
                </div>
              </div>
            ),
          )}

          {loading && (
            <div className="flex justify-start gap-2">
              <img
                src="/phil.png"
                alt="Phil"
                className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5"
              />
              <div className="flex gap-1 px-3.5 py-3 rounded-2xl rounded-tl-sm bg-muted">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          <div ref={listEndRef} />
        </div>
      </div>

      {/* ── Composer (sticky above keyboard / nav) ──────────────── */}
      <div
        className="fixed left-0 right-0 z-20 bg-background border-t"
        style={{
          bottom: bottomOffset,
          paddingBottom: bottomOffset === NAV_HEIGHT ? "env(safe-area-inset-bottom)" : 0,
          transition: "bottom 120ms ease-out",
        }}
      >
        {/* Wave-1 chip row — shown when the latest assistant turn carries quickReplies. */}
        {latestAssistant?.quickReplies && latestAssistant.quickReplies.length > 0 && (
          <div className="px-3 pt-2">
            <QuickReplyChips
              replies={latestAssistant.quickReplies}
              selectedValue={latestAssistantChipState?.selectedValue ?? null}
              promoted={latestAssistantChipState?.promoted}
              onSelect={(value: string) => {
                if (!latestAssistant) return;
                setChipState(latestAssistant.id, { selectedValue: value });
                void send(value);
              }}
              onTypeInstead={() => {
                if (!latestAssistant) return;
                setChipState(latestAssistant.id, { promoted: true });
                inputRef.current?.focus();
              }}
            />
          </div>
        )}

        <div className="px-4 py-3 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") void send(input);
            }}
            placeholder={analytics ? "Ask Phil…" : "Loading your data…"}
            disabled={loading || !analytics}
            className="flex-1 text-[14px] bg-muted/50 border rounded-xl px-3.5 py-2.5 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60 disabled:opacity-50"
          />
          <Button
            size="sm"
            onClick={() => void send(input)}
            disabled={!input.trim() || loading || !analytics}
            className="rounded-xl h-10 w-10 p-0 shrink-0"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Re-export so the QuickReply type can be imported alongside the page if helpful.
export type { QuickReply };
