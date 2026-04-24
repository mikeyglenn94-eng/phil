import React, { useEffect, useRef } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useChat } from "@/contexts/chat-context";
import type { AnalyticsData } from "@/pages/dashboard-tab";

// ── Context builder ───────────────────────────────────────────────

export function buildAiContext(
  analytics: AnalyticsData,
  thisWeekData: AnalyticsData["byWeek"][0] | undefined,
  lastWeekData: AnalyticsData["byWeek"][0] | undefined,
  oneRMLines?: string[],
): string {
  const { fitnessScore, adherence, strengthMetrics, runMetrics, byWeek } = analytics;
  const lines: string[] = [];

  lines.push(`Fitness Score: ${fitnessScore.current}`);
  if (fitnessScore.change !== null) lines.push(`Score vs last week: ${fitnessScore.change > 0 ? "+" : ""}${fitnessScore.change}`);
  if (fitnessScore.monthlyChange !== null) lines.push(`Score vs last month: ${fitnessScore.monthlyChange > 0 ? "+" : ""}${fitnessScore.monthlyChange}`);
  lines.push(`Score explanation: ${fitnessScore.explanation}`);

  lines.push(`Sessions this week: ${adherence.thisWeek.completed} completed / ${adherence.thisWeek.planned > 0 ? adherence.thisWeek.planned + " planned" : "no formal plan"}`);
  lines.push(`Adherence streak: ${adherence.streak} week${adherence.streak !== 1 ? "s" : ""}`);
  lines.push(`Both lifting and running this week: ${adherence.bothModalities ? "yes" : "no"}`);

  const run5k = runMetrics.estimated5K;
  if (run5k.current) {
    lines.push(`5K: ${run5k.current}${run5k.previous ? ` (was ${run5k.previous})` : " (baseline, no prior comparison)"}`);
  } else {
    lines.push("5K: not enough qualifying running data yet");
  }

  const { squat, bench, deadlift } = strengthMetrics;
  if (squat.current !== null) {
    lines.push(`Squat: ${squat.current}kg${squat.previous !== null ? ` (was ${squat.previous}kg)` : " (first benchmark)"}`);
  } else {
    lines.push("Squat: no data yet");
  }
  if (bench.current !== null) {
    lines.push(`Bench: ${bench.current}kg${bench.previous !== null ? ` (was ${bench.previous}kg)` : " (first benchmark)"}`);
  } else {
    lines.push("Bench: no data yet");
  }
  if (deadlift.current !== null) {
    lines.push(`Deadlift: ${deadlift.current}kg${deadlift.previous !== null ? ` (was ${deadlift.previous}kg)` : " (first benchmark)"}`);
  } else {
    lines.push("Deadlift: no data yet");
  }

  if (thisWeekData) {
    if (thisWeekData.totalDistance > 0) lines.push(`Distance run this week: ${thisWeekData.totalDistance.toFixed(1)}km`);
    if (thisWeekData.totalVolume > 0) lines.push(`Volume lifted this week: ${Math.round(thisWeekData.totalVolume)}kg`);
  } else {
    lines.push("No sessions logged yet this week");
  }
  if (lastWeekData) {
    if (lastWeekData.totalDistance > 0) lines.push(`Distance run last week: ${lastWeekData.totalDistance.toFixed(1)}km`);
    if (lastWeekData.totalVolume > 0) lines.push(`Volume lifted last week: ${Math.round(lastWeekData.totalVolume)}kg`);
  }

  const totalSessions = byWeek.reduce((s, w) => s + w.sessionCount, 0);
  lines.push(`Total sessions logged across all time: ${totalSessions}`);
  if (totalSessions < 5) lines.push("Data is limited — this is an early-stage user with few logged sessions.");

  if (oneRMLines && oneRMLines.length > 0) {
    lines.push(`Current 1RMs: ${oneRMLines.join(", ")}`);
  }

  return lines.join("\n");
}

// ── Suggested prompts ─────────────────────────────────────────────

export function getSuggestedPrompts(
  analytics: AnalyticsData,
  thisWeekData: AnalyticsData["byWeek"][0] | undefined,
): string[] {
  const { fitnessScore, adherence, strengthMetrics, runMetrics, byWeek } = analytics;
  const totalSessions = byWeek.reduce((s, w) => s + w.sessionCount, 0);
  const noSessions = !thisWeekData || thisWeekData.sessionCount === 0;
  const prompts: string[] = [];

  if (fitnessScore.change !== null && fitnessScore.change < 0) {
    prompts.push("Why did my Fitness Score drop?");
  } else if (fitnessScore.change !== null && fitnessScore.change > 0) {
    prompts.push("Why did my Fitness Score improve?");
  } else {
    prompts.push("Why did my Fitness Score change?");
  }

  if (totalSessions < 4) {
    prompts.push("What should I log first?");
    prompts.push("How do I get my Fitness Score moving?");
    return prompts.slice(0, 5);
  }

  const { completed, planned } = adherence.thisWeek;
  if (planned > 0 && completed < planned) {
    prompts.push("Am I being consistent enough?");
  }

  if (noSessions) {
    prompts.push("What should I focus on this week?");
  } else if (!adherence.bothModalities) {
    prompts.push("Should I add a run this week?");
  }

  if (!runMetrics.estimated5K.current) {
    prompts.push("How is my 5K calculated?");
  } else {
    prompts.push("How do I improve my 5K time?");
  }

  const lifts: [string, typeof strengthMetrics.squat][] = [
    ["squat", strengthMetrics.squat],
    ["bench", strengthMetrics.bench],
    ["deadlift", strengthMetrics.deadlift],
  ];
  for (const [name, lift] of lifts) {
    if (lift.current !== null && lift.previous !== null && lift.current <= lift.previous) {
      prompts.push(`Why is my ${name} not improving?`);
      break;
    }
  }

  if (adherence.streak === 0) {
    prompts.push("What is holding back my progress?");
  }

  prompts.push("What should next week look like?");

  return [...new Set(prompts)].slice(0, 5);
}

// ── Follow-up prompts after an answer ────────────────────────────

function getFollowUps(): string[] {
  return [
    "What should I prioritise?",
    "How do I fix that?",
    "What should next week look like?",
  ];
}

// ── Props ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  analytics: AnalyticsData;
  thisWeekData: AnalyticsData["byWeek"][0] | undefined;
  lastWeekData: AnalyticsData["byWeek"][0] | undefined;
  clientId: number;
  oneRMLines?: string[];
}

// ── Sheet (deep-link surface) ─────────────────────────────────────
//
// This is no longer the primary chat surface — that lives at /chat. The Sheet
// is preserved for in-context deep links (e.g. "Talk to Phil about this session"
// from the dashboard). Both surfaces share the same ChatContext so the thread
// stays continuous: open the sheet, ask a question, switch to /chat → same thread.

export default function CoachingSheet({ open, onOpenChange, analytics, thisWeekData, lastWeekData, clientId, oneRMLines }: Props) {
  const { messages, loading, ask, clear } = useChat();

  const [input, setInput] = React.useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestedPrompts = getSuggestedPrompts(analytics, thisWeekData);
  const aiContext = buildAiContext(analytics, thisWeekData, lastWeekData, oneRMLines);

  // Sheet UX: show the static prompt chips when the thread is empty, otherwise
  // show the latest exchange. The thread itself is NOT cleared on close any
  // more — it persists in the ChatContext so users can resume on /chat.
  const phase: "prompts" | "answer" = messages.length === 0 ? "prompts" : "answer";

  useEffect(() => {
    if (phase === "answer") {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [messages.length, phase]);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || loading) return;
    setInput("");
    await ask({ question: text, context: aiContext, clientId });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
  const lastUserMsg      = [...messages].reverse().find(m => m.role === "user");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] flex flex-col rounded-t-2xl p-0 overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <SheetTitle className="text-base font-semibold">AI Coaching</SheetTitle>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Prompt chips — shown at start and after each answer */}
          {phase === "prompts" && (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-widest">
                Suggested questions
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestedPrompts.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => void send(prompt)}
                    className="text-[13px] px-3 py-2 rounded-xl border bg-card hover:bg-muted/60 transition-colors text-left leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          {phase === "answer" && (
            <div className="space-y-4">
              {/* Last question */}
              {lastUserMsg && (
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground text-[13px] px-3.5 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] leading-relaxed">
                    {lastUserMsg.content}
                  </div>
                </div>
              )}

              {/* Loading */}
              {loading && (
                <div className="flex gap-2 items-center">
                  <div className="flex gap-1 px-3.5 py-3 rounded-2xl rounded-tl-sm bg-muted">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}

              {/* Answer */}
              {!loading && lastAssistantMsg && (
                <div className="space-y-3">
                  <div className="bg-muted/60 text-[13px] px-4 py-3.5 rounded-2xl rounded-tl-sm leading-relaxed whitespace-pre-line max-w-[95%]">
                    {lastAssistantMsg.content}
                  </div>

                  {/* Follow-up chips */}
                  <div className="space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Follow-up</p>
                    <div className="flex flex-wrap gap-2">
                      {getFollowUps().map(f => (
                        <button
                          key={f}
                          onClick={() => void send(f)}
                          className="text-[12px] px-3 py-1.5 rounded-xl border bg-card hover:bg-muted/60 transition-colors"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input row */}
        <div className="shrink-0 px-4 pb-6 pt-3 border-t bg-background">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void send(input)}
              placeholder="Ask your own question…"
              disabled={loading}
              className="flex-1 text-[13px] bg-muted/50 border rounded-xl px-3.5 py-2.5 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
            <Button
              size="sm"
              onClick={() => void send(input)}
              disabled={!input.trim() || loading}
              className="rounded-xl h-10 w-10 p-0 shrink-0"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          {phase === "answer" && (
            <button
              onClick={clear}
              className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full text-center"
            >
              Start a new question
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
