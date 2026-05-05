/**
 * Hybrid Streak card.
 *
 * Big-number streak count, this-week status with two checkmarks, and a
 * Phil-voice line that varies by streak state.
 *
 * Phil voice: gruff, direct, dry. No em dashes. Full subject-verb contractions.
 */

import { Flame, Check, X } from "lucide-react";
import type { AnalyticsData } from "@/pages/dashboard-tab";

interface HybridStreakCardProps {
  streak: NonNullable<AnalyticsData["hybridStreak"]>;
}

export function HybridStreakCard({ streak }: HybridStreakCardProps) {
  const { count, thisWeek } = streak;
  const message = pickMessage(count, thisWeek);

  return (
    <div className="bg-gradient-to-br from-orange-50 via-rose-50 to-orange-50 border border-orange-200 rounded-2xl px-4 py-4 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-orange-700 flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5" />
          Hybrid Streak
        </h2>
      </header>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums leading-none text-foreground">{count}</span>
        <span className="text-sm text-muted-foreground">
          {count === 1 ? "week" : "weeks"}
        </span>
      </div>

      <p className="text-xs text-muted-foreground leading-snug">
        of logging both lifting and an endurance session.
      </p>

      <div className="flex items-center gap-3 text-xs pt-1 border-t border-orange-200/50">
        <span className="text-muted-foreground">This week</span>
        <ThisWeekTick label="Lift" ticked={thisWeek.hasLift} />
        <ThisWeekTick label="Endurance" ticked={thisWeek.hasEndurance} />
      </div>

      <p className="text-xs font-medium text-foreground/85 leading-snug">{message}</p>
    </div>
  );
}

function ThisWeekTick({ label, ticked }: { label: string; ticked: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${ticked ? "text-emerald-700" : "text-muted-foreground/70"}`}
    >
      {ticked ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
      <span className="font-semibold">{label}</span>
    </span>
  );
}

// ── Copy variants ──────────────────────────────────────────────────────────

function pickMessage(
  count: number,
  thisWeek: { hasLift: boolean; hasEndurance: boolean },
): string {
  // This-week incomplete copy takes precedence — gives a concrete next action.
  const haveLift = thisWeek.hasLift;
  const haveEnd = thisWeek.hasEndurance;
  if (count > 0 && (!haveLift || !haveEnd)) {
    if (!haveLift && !haveEnd) return "Get a lift and an endurance session in this week.";
    if (!haveLift) return "Get the lift in this week.";
    if (!haveEnd) return "Get the endurance session in this week.";
  }

  if (count === 0) {
    return "Log a lift and a run this week to start a streak.";
  }
  if (count <= 3) {
    return "Early days. Keep going.";
  }
  if (count <= 7) {
    return "Solid streak. Don't break it.";
  }
  if (count <= 15) {
    return `${count} weeks of doing both. Most people pick one.`;
  }
  return "This is what hybrid actually looks like.";
}
