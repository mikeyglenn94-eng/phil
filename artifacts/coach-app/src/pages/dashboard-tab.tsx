import React, { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3, Trophy, CheckSquare, TrendingUp, Footprints,
  Timer, Dumbbell, SlidersHorizontal, ChevronDown, ChevronRight, Sparkles,
  Share2, Download, Check, Loader2, UtensilsCrossed, Target, Plus, Trash2, Eye, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import CoachingSheet from "@/components/coaching-sheet";
import { BestEffortsFeed } from "@/components/dashboard/best-efforts-feed";
import { HybridStreakCard } from "@/components/dashboard/hybrid-streak-card";

// ── Types ─────────────────────────────────────────────────────────

interface ExSet { weight: number | null; reps: number | null }
interface ExData { name: string; sets: ExSet[] }

export interface AnalyticsData {
  sessions: {
    sessionId: string; date: string; name: string; source: string | null;
    totalVolume: number; totalReps: number; totalDistance: number;
    weightedPaceSeconds: number; avgPace: string | null; intervalCount: number;
    exerciseBreakdown: ExData[];
  }[];
  byWeek: {
    weekStart: string; totalVolume: number; totalReps: number; totalDistance: number;
    weightedPaceSeconds: number; sessionCount: number; strengthSessions: number;
    runSessions: number; plannedCount: number; completedCount: number; avgPace: string | null;
  }[];
  byMonth: {
    month: string; totalVolume: number; totalReps: number; totalDistance: number;
    weightedPaceSeconds: number; sessionCount: number; strengthSessions: number;
    runSessions: number; avgPace: string | null;
  }[];
  fitnessScore: {
    current: number; previousWeek: number | null; change: number | null;
    monthlyChange: number | null; explanation: string;
  };
  weeklyWin: string;
  adherence: {
    thisWeek: { completed: number; planned: number };
    streak: number; bothModalities: boolean; status: string;
  };
  strengthMetrics: {
    squat:    { current: number | null; previous: number | null };
    bench:    { current: number | null; previous: number | null };
    deadlift: { current: number | null; previous: number | null };
  };
  runMetrics: {
    estimated5K: { current: string | null; previous: string | null };
  };
  baselines?: {
    benchKg: number | null; squatKg: number | null; deadliftKg: number | null;
    fiveKSeconds: number | null; tenKSeconds: number | null;
    halfMarathonSeconds: number | null; marathonSeconds: number | null;
    setManually: boolean;
  } | null;
  allTimeStrength?: { squat: number | null; bench: number | null; deadlift: number | null } | null;
  allTimeEst5K?: string | null;
  estHalfMaraCurr?: string | null;
  allTimeEstHalfMara?: string | null;
  /** Date of the last session at ≥ 85% of the all-time PB per main lift. */
  lastHeavyDates?: {
    squat: string | null;
    bench: string | null;
    deadlift: string | null;
  };
  /** Hybrid streak — consecutive completed weeks with both lift + endurance logged. */
  hybridStreak?: {
    count: number;
    thisWeek: { hasLift: boolean; hasEndurance: boolean };
    longest: number;
  };
  /** Cross-sport records — biggest combined week, biggest single day, longest streak. */
  hybridHighlights?: {
    biggestCombinedWeek: { weekStart: string; totalVolume: number; totalDistance: number } | null;
    biggestSingleDay: { date: string; totalVolume: number; totalDistance: number } | null;
    longestHybridStreak: number;
  };
  /** Top 5 best efforts for the dashboard widget. Full list lives at /clients/:id/best-efforts. */
  topBestEfforts?: BestEffortPayload[];
}

export type BestEffortPayload =
  | {
      kind: "lift";
      lift: string;
      display: string;
      recordType: string;
      kg: number;
      reps: number;
      date: string;
      sessionId: string | null;
    }
  | {
      kind: "endurance";
      distance: string;
      display: string;
      seconds: number;
      paceSecondsPerKm: number;
      date: string;
      sessionId: string;
      estimated: boolean;
    }
  | {
      kind: "longest";
      sport: "run" | "cycle" | "swim";
      display: string;
      km: number;
      date: string;
      sessionId: string;
    };

// ── Preferences ───────────────────────────────────────────────────

interface DashboardPrefs {
  showFitnessExplanation:   boolean;
  showWeeklyWin:            boolean;
  showConsistency:          boolean;
  showNutritionCard:        boolean;
  includeNutritionInScore:  boolean;
  showEstimated5K:          boolean;
  showHalfMarathonCard:     boolean;
  showMarathonCard:         boolean;
  showSquatE1RM:            boolean;
  showBenchE1RM:            boolean;
  showDeadliftE1RM:         boolean;
  showDistanceRun:          boolean;
  showVolumeLifted:         boolean;
}

const DEFAULT_PREFS: DashboardPrefs = {
  showFitnessExplanation:   true,
  showWeeklyWin:            true,
  showConsistency:          true,
  showNutritionCard:        false,
  includeNutritionInScore:  false,
  showEstimated5K:          true,
  showHalfMarathonCard:     false,
  showMarathonCard:         false,
  showSquatE1RM:            true,
  showBenchE1RM:            true,
  showDeadliftE1RM:         true,
  showDistanceRun:          true,
  showVolumeLifted:         true,
};

function loadPrefs(clientId: number): DashboardPrefs {
  try {
    const raw = localStorage.getItem(`dashboard-prefs-${clientId}`);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(clientId: number, prefs: DashboardPrefs): void {
  try {
    localStorage.setItem(`dashboard-prefs-${clientId}`, JSON.stringify(prefs));
  } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────

function fmtVol(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}kg`;
}

function fmtDist(d: number): string {
  if (d <= 0) return "—";
  return d >= 1 ? `${d.toFixed(1)} km` : `${Math.round(d * 1000)} m`;
}

function paceToSeconds(pace: string): number | null {
  const m = pace.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ── Delta helpers ─────────────────────────────────────────────────

type DeltaKind = "higher-better" | "lower-better";

function DeltaBadge({
  current, previous, kind, suffix = "", formatter,
}: {
  current: number | null; previous: number | null; kind: DeltaKind;
  suffix?: string; formatter?: (n: number) => string;
}) {
  if (current === null || previous === null) return null;
  const diff = current - previous;
  if (diff === 0) return (
    <span className="text-[11px] text-muted-foreground">No change</span>
  );
  const positive = kind === "higher-better" ? diff > 0 : diff < 0;
  const label = formatter
    ? `${diff > 0 ? "+" : ""}${formatter(Math.abs(diff))}`
    : `${diff > 0 ? "+" : ""}${Math.round(diff)}${suffix}`;
  return (
    <span className={`text-[11px] font-semibold ${positive ? "text-emerald-600" : "text-red-500"}`}>
      {label}
    </span>
  );
}

function TimeDeltaBadge({ current, previous }: { current: string | null; previous: string | null }) {
  if (!current || !previous) return null;
  const cs = paceToSeconds(current), ps = paceToSeconds(previous);
  if (!cs || !ps || cs === ps) return (
    <span className="text-[11px] text-muted-foreground">No change</span>
  );
  const diff = cs - ps; // negative = faster = better
  const positive = diff < 0;
  const abs = Math.abs(diff);
  const label = `${diff < 0 ? "−" : "+"}${abs}s`;
  return (
    <span className={`text-[11px] font-semibold ${positive ? "text-emerald-600" : "text-red-500"}`}>
      {label}
    </span>
  );
}

// ── Copy / state helpers ──────────────────────────────────────────

/** True when no sessions have been logged in the current ISO week. */
function noSessionsThisWeek(thisWeekData: { sessionCount?: number; completedCount?: number } | undefined): boolean {
  if (!thisWeekData) return true;
  const count = (thisWeekData.sessionCount ?? 0) + (thisWeekData.completedCount ?? 0);
  return count === 0;
}

/**
 * Returns a state message for the Fitness Score card when nothing has been
 * logged yet this week so the reader understands the score is carried over.
 */
function getFitnessScoreStateMessage(noSessions: boolean): string | null {
  return noSessions ? "Score reflects recent training — no sessions logged yet this week" : null;
}

/**
 * Summary line shown in the collapsed "Why it moved" bar.
 * Uses neutral language when there is no current-week activity.
 */
function getWhyItMovedSummary(noSessions: boolean, explanation: string): string {
  return noSessions
    ? "No new sessions yet — score reflects your recent training"
    : explanation;
}

/**
 * Override Weekly Win copy when there are no current-week sessions so it
 * feels forward-looking rather than stale.
 */
function getWeeklyWinDisplay(weeklyWin: string, noSessions: boolean): string {
  if (!noSessions) return weeklyWin;
  // Only override low-signal fallbacks — genuine achievements are kept.
  const lower = weeklyWin.toLowerCase();
  if (
    lower.includes("baseline maintained") ||
    lower.includes("no sessions") ||
    lower === ""
  ) {
    return "New week, ready to build";
  }
  return weeklyWin;
}

interface ConsistencyContent {
  primaryValue: string;   // e.g. "0 / 4" or "3"
  suffix: string;         // e.g. "sessions"
  sub: string;
  showBar: boolean;
}

/**
 * Returns display values for the Consistency card.
 * Handles plan vs no-plan, and every progression state within a week.
 */
function getConsistencyContent(
  adherence: AnalyticsData["adherence"],
  lastWeekSessionCount: number,
): ConsistencyContent {
  const { completed, planned } = adherence.thisWeek;
  const hasPlan = planned > 0;

  if (hasPlan) {
    const remaining = planned - completed;
    let sub: string;
    if (completed === 0) {
      sub = "Week just getting started";
    } else if (completed >= planned) {
      sub = "All sessions complete";
    } else {
      sub = `${remaining} session${remaining !== 1 ? "s" : ""} remaining`;
    }
    return { primaryValue: `${completed} / ${planned}`, suffix: "sessions", sub, showBar: true };
  }

  // No formal plan
  if (completed === 0) {
    const sub = lastWeekSessionCount > 0
      ? `Last week: ${lastWeekSessionCount} session${lastWeekSessionCount !== 1 ? "s" : ""}`
      : "Start your first session this week";
    return { primaryValue: `${completed}`, suffix: "sessions this week", sub, showBar: false };
  }

  const sub = lastWeekSessionCount > 0
    ? `Last week: ${lastWeekSessionCount} session${lastWeekSessionCount !== 1 ? "s" : ""}`
    : "";
  return { primaryValue: `${completed}`, suffix: "sessions this week", sub, showBar: false };
}

/** Per-lift empty state copy. */
function getLiftEmptyState(lift: "squat" | "bench" | "deadlift"): string {
  if (lift === "squat")    return "Log your first squat";
  if (lift === "bench")    return "Log your first bench";
  return "Log your first deadlift";
}

/** Sub-label for the first benchmark (replaces generic "first record"). */
const FIRST_BENCHMARK_LABEL = "Baseline set";

// ── Score driver logic ────────────────────────────────────────────

type Polarity = "positive" | "neutral" | "negative";

interface ScoreDriver {
  label: string;
  polarity: Polarity;
  polarityLabel: string;
  lines: string[];
}

function computeScoreDrivers(analytics: AnalyticsData, thisWeekData: AnalyticsData["byWeek"][number] | undefined): ScoreDriver[] {
  const { adherence, strengthMetrics, runMetrics } = analytics;
  const drivers: ScoreDriver[] = [];

  // ── Consistency ──────────────────────────────────────────────────
  const { completed, planned } = adherence.thisWeek;
  const ratio = planned > 0 ? completed / planned : null;
  let cPolarity: Polarity;
  let cLabel: string;
  const cLines: string[] = [];

  if (ratio === null) {
    cPolarity = completed > 0 ? "neutral" : "negative";
    cLabel = cPolarity === "neutral" ? "some activity" : "no sessions yet";
    cLines.push(completed > 0 ? `${completed} session${completed !== 1 ? "s" : ""} logged (no formal plan)` : "No sessions logged this week");
  } else if (ratio >= 1) {
    cPolarity = "positive";
    cLabel = "positive";
    cLines.push(`Completed ${completed} of ${planned} planned session${planned !== 1 ? "s" : ""}`);
    if (adherence.streak >= 2) cLines.push(`${adherence.streak}-week adherence streak`);
    if (adherence.bothModalities) cLines.push("Both lifting and running completed");
  } else if (ratio >= 0.5) {
    cPolarity = "neutral";
    cLabel = "partial";
    cLines.push(`Completed ${completed} of ${planned} planned session${planned !== 1 ? "s" : ""}`);
    const missed = planned - completed;
    cLines.push(`${missed} session${missed !== 1 ? "s" : ""} remaining this week`);
  } else {
    cPolarity = "negative";
    cLabel = "negative";
    cLines.push(`Completed ${completed} of ${planned} planned session${planned !== 1 ? "s" : ""}`);
    const missed = planned - completed;
    cLines.push(`${missed} session${missed !== 1 ? "s" : ""} missed — biggest drag on score`);
  }
  drivers.push({ label: "Consistency", polarity: cPolarity, polarityLabel: cLabel, lines: cLines });

  // ── Running ──────────────────────────────────────────────────────
  const { estimated5K } = runMetrics;
  let rPolarity: Polarity;
  let rLabel: string;
  const rLines: string[] = [];

  if (!estimated5K.current) {
    rPolarity = "neutral";
    rLabel = "no data";
    rLines.push("Not enough steady running data yet");
    rLines.push("Needs a continuous run of 3km+ to estimate");
  } else if (!estimated5K.previous) {
    rPolarity = "neutral";
    rLabel = "first estimate";
    rLines.push(`5K: ${estimated5K.current}`);
    rLines.push("No previous estimate to compare yet");
  } else {
    const cs = paceToSeconds(estimated5K.current);
    const ps = paceToSeconds(estimated5K.previous);
    if (cs && ps) {
      const diff = ps - cs; // positive = faster
      if (diff > 10) {
        rPolarity = "positive";
        rLabel = "positive";
        rLines.push(`5K improved by ${diff}s`);
        rLines.push(`${estimated5K.previous} → ${estimated5K.current}`);
      } else if (diff < -10) {
        rPolarity = "negative";
        rLabel = "negative";
        rLines.push(`5K slower by ${Math.abs(diff)}s`);
        rLines.push(`${estimated5K.previous} → ${estimated5K.current}`);
      } else {
        rPolarity = "neutral";
        rLabel = "stable";
        rLines.push(`5K unchanged at ~${estimated5K.current}`);
      }
    } else {
      rPolarity = "neutral";
      rLabel = "no data";
      rLines.push("Not enough steady running data yet");
    }
  }
  drivers.push({ label: "Running", polarity: rPolarity, polarityLabel: rLabel, lines: rLines });

  // ── Strength ─────────────────────────────────────────────────────
  const lifts: [string, number | null, number | null][] = [
    ["Squat",    strengthMetrics.squat.current,    strengthMetrics.squat.previous],
    ["Bench",    strengthMetrics.bench.current,    strengthMetrics.bench.previous],
    ["Deadlift", strengthMetrics.deadlift.current, strengthMetrics.deadlift.previous],
  ];
  const gains: string[]     = [];
  const losses: string[]    = [];
  const firstLogs: string[] = [];

  for (const [name, curr, prev] of lifts) {
    if (curr === null) continue;
    if (prev === null) { firstLogs.push(`${name}: ${curr}kg (first record)`); continue; }
    if (curr > prev)   { gains.push(`${name} up ${curr - prev}kg to ${curr}kg`); continue; }
    if (curr < prev)   { losses.push(`${name} down ${prev - curr}kg to ${curr}kg`); }
  }

  let sPolarity: Polarity;
  let sLabel: string;
  const sLines: string[] = [];

  if (gains.length > 0) {
    sPolarity = "positive";
    sLabel = "positive";
    sLines.push(...gains);
    if (losses.length > 0) sLines.push(...losses);
  } else if (losses.length > 0) {
    sPolarity = "negative";
    sLabel = "negative";
    sLines.push(...losses);
  } else if (firstLogs.length > 0) {
    sPolarity = "neutral";
    sLabel = "first records";
    sLines.push(...firstLogs);
  } else if (lifts.every(([, c]) => c === null)) {
    sPolarity = "neutral";
    sLabel = "no data";
    sLines.push("No strength data logged yet");
  } else {
    sPolarity = "neutral";
    sLabel = "stable";
    sLines.push("No major change in estimated 1RMs this period");
  }
  drivers.push({ label: "Strength", polarity: sPolarity, polarityLabel: sLabel, lines: sLines });

  // ── Balance ──────────────────────────────────────────────────────
  const hasLift = (thisWeekData?.strengthSessions ?? 0) > 0;
  const hasRun  = (thisWeekData?.runSessions ?? 0) > 0;
  let bPolarity: Polarity;
  let bLabel: string;
  const bLines: string[] = [];

  if (hasLift && hasRun) {
    bPolarity = "positive";
    bLabel = "positive";
    bLines.push("Both lifting and running logged this week");
    bLines.push("Balanced training contributes to a stronger score");
  } else if (hasLift) {
    bPolarity = "neutral";
    bLabel = "lift only";
    bLines.push("Only lifting logged this week");
    bLines.push("Adding a run session would boost balance score");
  } else if (hasRun) {
    bPolarity = "neutral";
    bLabel = "run only";
    bLines.push("Only running logged this week");
    bLines.push("Adding a lift session would boost balance score");
  } else {
    bPolarity = "negative";
    bLabel = "negative";
    bLines.push("No training logged this week");
  }
  drivers.push({ label: "Balance", polarity: bPolarity, polarityLabel: bLabel, lines: bLines });

  return drivers;
}

// ── Driver row ────────────────────────────────────────────────────

function DriverRow({ driver }: { driver: ScoreDriver }) {
  const color =
    driver.polarity === "positive" ? "text-emerald-600" :
    driver.polarity === "negative" ? "text-red-500" :
    "text-muted-foreground";

  const arrow =
    driver.polarity === "positive" ? "↑" :
    driver.polarity === "negative" ? "↓" : "→";

  return (
    <div className="flex gap-3 items-start">
      <span className={`text-sm font-bold mt-0.5 w-4 text-center shrink-0 ${color}`}>{arrow}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold">{driver.label}</span>
          <span className={`text-[10px] font-medium uppercase tracking-wide ${color}`}>
            {driver.polarityLabel}
          </span>
        </div>
        {driver.lines.map((line, i) => (
          <p key={i} className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{line}</p>
        ))}
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────

function StatCard({
  title, value, unavailable, sub, delta, icon, className = "",
}: {
  title: string; value: React.ReactNode; unavailable?: boolean; sub?: React.ReactNode;
  delta?: React.ReactNode; icon: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card border rounded-2xl px-4 py-3.5 flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground/50">{icon}</span>
      </div>
      <span className={`text-2xl font-bold leading-tight ${unavailable ? "text-muted-foreground text-base font-normal" : ""}`}>
        {value}
      </span>
      {(delta || sub) && (
        <div className="flex items-center gap-1.5 flex-wrap min-h-[1rem]">
          {delta}
          {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
        </div>
      )}
    </div>
  );
}

// ── Perf card (all-time PB + current estimate) ───────────────────
//
// Threshold rule:
// - current ≥ 0.85 × all-time PB → show current est, no emoji
// - current < 0.85 × all-time PB → swap "Current est. Xkg 😟" for
//   "Last heavy: {date} - log to update" (date supplied by the caller)
// - current > all-time PB        → "↑ PB" indicator (the only emoji-equivalent)
// Sad face is gone entirely.

function PerfCard({
  title, icon, allTimePB, currentEst, lastHeavyDate, higherIsBetter = true, className = "",
}: {
  title: string; icon: React.ReactNode;
  allTimePB: string | null; currentEst: string | null;
  /** ISO date of the last session at ≥ 85 % of PB. Used when current has dropped below threshold. */
  lastHeavyDate?: string | null;
  higherIsBetter?: boolean; className?: string;
}) {
  const hasBoth = allTimePB !== null && currentEst !== null;
  type Comparison = "better" | "above_threshold" | "below_threshold";
  let comparison: Comparison = "above_threshold";
  if (hasBoth) {
    if (higherIsBetter) {
      const currN = parseFloat(currentEst!);
      const pbN   = parseFloat(allTimePB!);
      if (!isNaN(currN) && !isNaN(pbN) && pbN > 0) {
        if (currN > pbN) comparison = "better";
        else if (currN >= pbN * 0.85) comparison = "above_threshold";
        else comparison = "below_threshold";
      }
    } else {
      // Lower-is-better (pace times). Threshold: current ≤ 1.15 × pb time = within 15 % slower.
      const currS = paceToSeconds(currentEst!);
      const pbS   = paceToSeconds(allTimePB!);
      if (currS !== null && pbS !== null && pbS > 0) {
        if (currS < pbS) comparison = "better";
        else if (currS <= pbS * 1.15) comparison = "above_threshold";
        else comparison = "below_threshold";
      }
    }
  }
  const isBelowThreshold = comparison === "below_threshold";
  const showLastHeavyLine = isBelowThreshold && lastHeavyDate;
  return (
    <div className={`bg-card border rounded-2xl px-4 py-3.5 flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{title}</span>
        <span className="text-muted-foreground/50">{icon}</span>
      </div>
      {allTimePB !== null && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">All-time PB</span>
          <span className="text-sm font-semibold tabular-nums">{allTimePB}</span>
        </div>
      )}
      {showLastHeavyLine ? (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Last heavy</span>
          <span className="text-[11px] text-muted-foreground/80">
            {formatLastHeavy(lastHeavyDate!)}
          </span>
        </div>
      ) : currentEst !== null && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">Current est.</span>
          <span className={`text-sm font-semibold tabular-nums ${comparison === "better" ? "text-emerald-600" : ""}`}>
            {currentEst}{comparison === "better" ? " ↑ PB" : ""}
          </span>
        </div>
      )}
      {allTimePB === null && currentEst === null && (
        <span className="text-sm text-muted-foreground font-normal">No data yet</span>
      )}
    </div>
  );
}

function formatLastHeavy(isoDate: string): string {
  try {
    const d = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return "log to update";
    const today = new Date();
    const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
    if (days < 0) return "log to update";
    if (days < 7) return `${days === 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`} · log to update`;
    if (days < 28) return `${Math.floor(days / 7)}w ago · log to update`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago · log to update`;
    return `${Math.floor(days / 365)}y ago · log to update`;
  } catch {
    return "log to update";
  }
}

// ── Pref row ─────────────────────────────────────────────────────

function PrefRow({
  label, checked, onToggle, disabled = false,
}: { label: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2.5 border-b last:border-0 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onToggle} disabled={disabled} />
    </div>
  );
}

// ── Nutrition scoring ─────────────────────────────────────────────

interface RawNutritionEntry { date: string; calories?: number | null; protein?: string | null }

function computeNutritionStats(
  logs: RawNutritionEntry[],
  calorieTarget: number | null,
  mode: "calories" | "protein_only" = "calories",
  proteinTarget: number | null = null,
): { nutritionPercent: number; loggedDays: number; closeDays: number; hitDays: number } {
  const today = new Date();
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const byDate = new Map<string, RawNutritionEntry[]>();
  for (const e of logs) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push(e);
  }

  let totalScore = 0;
  let loggedDays = 0;
  let closeDays = 0; // calories mode: days within ±200 kcal
  let hitDays = 0;   // protein_only mode: days protein target met

  for (const day of days) {
    const dayEntries = byDate.get(day);
    const logged = dayEntries && dayEntries.length > 0;
    if (!logged) continue;

    loggedDays++;
    let accuracyScore = 1.0;

    if (mode === "protein_only") {
      if (proteinTarget && proteinTarget > 0) {
        const dayPro = dayEntries!.reduce((sum, e) => sum + parseFloat(e.protein ?? "0"), 0);
        const rem = proteinTarget - dayPro;
        if (rem <= 0) {
          accuracyScore = 1.0; hitDays++;
        } else if (rem <= 20) {
          accuracyScore = 0.8;
        } else {
          accuracyScore = 0.4;
        }
      }
      // No target → logging_score only (accuracyScore stays 1.0)
    } else {
      // Calories mode
      if (calorieTarget) {
        const totalCals = dayEntries!.reduce((sum, e) => sum + (e.calories ?? 0), 0);
        const diff = Math.abs(totalCals - calorieTarget);
        if      (diff <= 100) { accuracyScore = 1.0; closeDays++; }
        else if (diff <= 200) { accuracyScore = 0.8; closeDays++; }
        else if (diff <= 300) { accuracyScore = 0.6; }
        else                  { accuracyScore = 0.3; }
      }
    }

    totalScore += accuracyScore;
  }

  const weekly = totalScore / 7;
  return { nutritionPercent: Math.round(weekly * 100), loggedDays, closeDays, hitDays };
}

// ── 1RM tracker types & helpers ───────────────────────────────────

interface OneRMEntry { id: number; weightKg: number; loggedAt: string; source: string }
interface ClientLiftWithRM {
  id: number;
  exerciseName: string;
  isDefault: boolean;
  isHidden: boolean;
  currentWeightKg: number | null;
  loggedAt: string | null;
  source: string | null;
  history: OneRMEntry[];
}

const LIFT_TO_METRIC: Record<string, string> = {
  "Back Squat":   "squat_e1rm",
  "Bench Press":  "bench_e1rm",
  "Deadlift":     "deadlift_e1rm",
};

const PCT_LEVELS = [60, 70, 75, 80, 85, 90];
function roundHalf(n: number) { return Math.round(n * 2) / 2; }

// ── Main component ────────────────────────────────────────────────

interface ClientGoal {
  id: number;
  clientId: number;
  description: string;
  targetDate: string | null;
  priority: "primary" | "secondary" | "equal";
  parsedTargets: ParsedTarget[] | null;
  createdAt: string;
}

interface ParsedTarget {
  metric: "bench_e1rm" | "squat_e1rm" | "deadlift_e1rm" | "5k" | "10k" | "half_marathon" | "marathon" | "bodyweight" | "sessions_per_week";
  target: number;
  unit: string;
  direction?: "lose" | "gain" | "reach";
}

interface GoalFormEntry {
  description: string;
  targetDate: string;
  priority: "primary" | "secondary" | "equal";
}

interface Props {
  analytics: AnalyticsData | undefined;
  isLoading: boolean;
  clientId: number;
  calorieTarget?: number | null;
  proteinTarget?: number | null;
  nutritionMode?: "calories" | "protein_only";
  hasSessionData?: boolean;
  onOpenCustomise?: () => void;
}

// ── Share helpers ─────────────────────────────────────────────────

const SHARE_STAT_OPTIONS = [
  { key: "fitnessScore", label: "Fitness Score" },
  { key: "squat",        label: "Squat" },
  { key: "bench",        label: "Bench" },
  { key: "deadlift",     label: "Deadlift" },
  { key: "est5K",        label: "5K" },
  { key: "distance",     label: "Distance" },
  { key: "pace",         label: "Pace" },
] as const;

type ShareStatKey = typeof SHARE_STAT_OPTIONS[number]["key"];

const BASELINE_METRICS: Array<{ key: string; label: string; isTime: boolean; placeholder: string; step?: string }> = [
  { key: "bench",        label: "Bench Press",   isTime: false, placeholder: "e.g. 80",       step: "0.5" },
  { key: "squat",        label: "Squat",         isTime: false, placeholder: "e.g. 100",      step: "0.5" },
  { key: "deadlift",     label: "Deadlift",      isTime: false, placeholder: "e.g. 120",      step: "0.5" },
  { key: "fiveK",        label: "5K",            isTime: true,  placeholder: "e.g. 25:30" },
  { key: "tenK",         label: "10K",           isTime: true,  placeholder: "e.g. 53:00" },
  { key: "halfMarathon", label: "Half Marathon", isTime: true,  placeholder: "e.g. 1:55:30" },
  { key: "marathon",     label: "Marathon",      isTime: true,  placeholder: "e.g. 3:45:00" },
];

function parsePaceStr(pace: string): number | null {
  const m = pace.match(/^(\d+):(\d{2})$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
}
function secsToMmss(secs: number): string {
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function secsToHmmss(secs: number): string {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.round(secs % 60);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
// Accepts: "25:30", "1:55:30", "115:30", "1h45m", "1h45m30s"
function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  const hms = s.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) return parseInt(hms[1]) * 3600 + parseInt(hms[2]) * 60 + parseInt(hms[3]);
  const ms = s.match(/^(\d+):(\d{2})$/);
  if (ms) return parseInt(ms[1]) * 60 + parseInt(ms[2]);
  const verbal = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (verbal && (verbal[1] || verbal[2] || verbal[3])) {
    return (parseInt(verbal[1] || "0")) * 3600 + (parseInt(verbal[2] || "0")) * 60 + (parseInt(verbal[3] || "0"));
  }
  return null;
}

type StatDisplay = { label: string; sublabel?: string; primary: string; delta: string | null };

function buildDashboardStat(
  key: ShareStatKey,
  analytics: AnalyticsData,
  thisWeekData: AnalyticsData["byWeek"][number] | undefined,
  lastWeekData: AnalyticsData["byWeek"][number] | undefined,
): StatDisplay | null {
  if (key === "fitnessScore") {
    const curr = analytics.fitnessScore.current;
    const ch   = analytics.fitnessScore.change;
    const delta = ch != null && ch !== 0 ? (ch > 0 ? `+${ch} pts` : `${ch} pts`) : null;
    return { label: "FITNESS SCORE", primary: String(Math.round(curr)), delta };
  }
  if (key === "squat" || key === "bench" || key === "deadlift") {
    const d = analytics.strengthMetrics[key];
    if (d.current == null) return null;
    const diff = d.previous != null ? +(d.current - d.previous).toFixed(1) : null;
    const delta = diff != null && Math.abs(diff) >= 0.5
      ? (diff > 0 ? `+${diff}kg` : `${diff}kg`) : null;
    const sublabelMap: Record<string, string> = { squat: "Squat", bench: "Bench Press", deadlift: "Deadlift" };
    return { label: "ESTIMATED 1RM", sublabel: sublabelMap[key], primary: `${d.current}kg`, delta };
  }
  if (key === "est5K") {
    const curr = analytics.runMetrics.estimated5K.current;
    const prev = analytics.runMetrics.estimated5K.previous;
    if (!curr) return null;
    let delta: string | null = null;
    if (prev) {
      const cs = parsePaceStr(curr.replace(/[^0-9:]/g,"").trim());
      const ps = parsePaceStr(prev.replace(/[^0-9:]/g,"").trim());
      if (cs != null && ps != null && cs !== ps) {
        const d = Math.round(cs - ps);
        delta = d < 0 ? `-${secsToMmss(Math.abs(d))}` : `+${secsToMmss(d)}`;
      }
    }
    return { label: "EST. 5K", primary: curr, delta };
  }
  if (key === "distance") {
    const curr = thisWeekData?.totalDistance ?? 0;
    if (curr <= 0) return null;
    const prev = lastWeekData?.totalDistance ?? 0;
    const diff = +(curr - prev).toFixed(1);
    const delta = prev > 0 && diff !== 0 ? (diff > 0 ? `+${diff}km` : `${diff}km`) : null;
    return { label: "DISTANCE", primary: `${curr.toFixed(1)}km`, delta };
  }
  if (key === "pace") {
    const currPace = thisWeekData?.avgPace;
    if (!currPace) return null;
    const prevPace = lastWeekData?.avgPace;
    let delta: string | null = null;
    if (prevPace) {
      const cs = parsePaceStr(currPace), ps = parsePaceStr(prevPace);
      if (cs != null && ps != null && cs !== ps) {
        const d = Math.round(cs - ps);
        delta = d < 0 ? `-${secsToMmss(Math.abs(d))}` : `+${secsToMmss(d)}`;
      }
    }
    return { label: "AVG PACE", primary: `${currPace}/km`, delta };
  }
  return null;
}

// ── Progress card canvas generation ──────────────────────────────

async function generateProgressCard(
  analytics: AnalyticsData,
  thisWeekData: AnalyticsData["byWeek"][number] | undefined,
  lastWeekData: AnalyticsData["byWeek"][number] | undefined,
  activeStats: ShareStatKey[],
): Promise<File | null> {
  await document.fonts.ready;
  const W = 1080, H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Fully transparent — no background at all
  ctx.clearRect(0, 0, W, H);

  const cx    = 96;           // left edge
  const right = W - 96;      // right edge

  // ── Shadow helpers ────────────────────────────────────────────────
  const applyTextShadow = () => {
    ctx.shadowColor    = "rgba(0,0,0,0.50)";
    ctx.shadowBlur     = 10;
    ctx.shadowOffsetX  = 0;
    ctx.shadowOffsetY  = 2;
  };
  const clearShadow = () => {
    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };

  // ── Resolve stats ─────────────────────────────────────────────────
  const resolved = activeStats
    .map(k => buildDashboardStat(k, analytics, thisWeekData, lastWeekData))
    .filter((s): s is StatDisplay => s !== null);

  // Start position — sit in the lower half so the photo/background shows above
  let cy = Math.round(H * 0.46);

  // ── Date line ─────────────────────────────────────────────────────
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
  applyTextShadow();
  ctx.fillStyle  = "rgba(255,255,255,0.55)";
  ctx.font       = "500 30px 'Inter', system-ui, sans-serif";
  ctx.textAlign  = "right";
  ctx.fillText(`WEEK OF ${dateStr}`, right, cy);
  ctx.textAlign  = "left";
  clearShadow();
  cy += 24;

  // ── Main heading ──────────────────────────────────────────────────
  applyTextShadow();
  ctx.fillStyle = "#ffffff";
  ctx.font      = "900 96px 'Inter', system-ui, sans-serif";
  ctx.fillText("YOUR PROGRESS", cx, cy + 96 * 1.15);
  clearShadow();
  cy += Math.round(96 * 1.15) + 28;

  // ── Thin divider ──────────────────────────────────────────────────
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(right, cy);
  ctx.stroke();
  cy += 48;

  // ── Draw a single metric block ────────────────────────────────────
  // Returns new cy after drawing.
  function drawBlock(s: StatDisplay, valueFs: number): number {
    // 1. Block label (e.g. "FITNESS SCORE", "ESTIMATED 1RM")
    applyTextShadow();
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.font      = "600 30px 'Inter', system-ui, sans-serif";
    ctx.fillText(s.label, cx, cy + 30);
    clearShadow();
    cy += 30 + 6;

    // 2. Sub-label (e.g. "Squat", "Bench Press") — only for e1RM blocks
    if (s.sublabel) {
      applyTextShadow();
      ctx.fillStyle = "rgba(255,255,255,0.74)";
      ctx.font      = "500 38px 'Inter', system-ui, sans-serif";
      ctx.fillText(s.sublabel, cx, cy + 38);
      clearShadow();
      cy += 38 + 4;
    }

    // 3. Value — large, bold, full white
    applyTextShadow();
    ctx.font      = `900 ${valueFs}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s.primary, cx, cy + Math.round(valueFs * 1.0));
    clearShadow();
    cy += Math.round(valueFs * 1.0) + 6;

    // 4. Delta — below the value, green or red, not inline
    if (s.delta) {
      const pos = s.delta.startsWith("+");
      applyTextShadow();
      ctx.font      = "600 38px 'Inter', system-ui, sans-serif";
      ctx.fillStyle = pos ? "rgba(134,239,172,0.94)" : "rgba(248,113,113,0.94)";
      ctx.fillText(s.delta, cx, cy + 38);
      clearShadow();
      cy += 38;
    }

    // Block gap
    cy += 32;
    return cy;
  }

  // ── Empty state ───────────────────────────────────────────────────
  if (resolved.length === 0) {
    applyTextShadow();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.font      = "400 44px 'Inter', system-ui, sans-serif";
    ctx.fillText("Select stats to show on this card", cx, cy);
    clearShadow();
  } else {
    // Hero stat (first, typically Fitness Score) gets largest font
    const [hero, ...rest] = resolved;
    drawBlock(hero, 172);

    // Supporting stats — slightly smaller
    for (const s of rest) {
      drawBlock(s, 116);
    }
  }

  return new Promise(resolve => {
    canvas.toBlob(blob => {
      if (!blob) { resolve(null); return; }
      resolve(new File([blob], "axis-progress.png", { type: "image/png" }));
    }, "image/png");
  });
}

// ── Main component ────────────────────────────────────────────────

export default function DashboardTab({ analytics, isLoading, clientId, calorieTarget, proteinTarget, nutritionMode = "calories", hasSessionData = true, onOpenCustomise }: Props) {
  const queryClient = useQueryClient();
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => loadPrefs(clientId));
  const [editOpen, setEditOpen] = useState(false);
  const [nutritionLogs, setNutritionLogs] = useState<RawNutritionEntry[]>([]);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [coachingOpen, setCoachingOpen] = useState(false);

  // Share state
  const [showShare, setShowShare] = useState(false);
  const [shareStats, setShareStats] = useState<ShareStatKey[]>([]);
  const [shareMaxReached, setShareMaxReached] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaved, setShareSaved] = useState(false);

  useEffect(() => { savePrefs(clientId, prefs); }, [prefs, clientId]);

  // ── Training goals state ───────────────────────────────────────
  const [goals, setGoals] = useState<ClientGoal[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(true);
  const [newGoalDesc, setNewGoalDesc] = useState("");
  const [newGoalDate, setNewGoalDate] = useState("");
  const [newGoalPriority, setNewGoalPriority] = useState<"primary" | "secondary" | "equal">("equal");
  const [savingNewGoal, setSavingNewGoal] = useState(false);
  const [deletingGoalId, setDeletingGoalId] = useState<number | null>(null);
  const [goalError, setGoalError] = useState("");

  useEffect(() => {
    setGoalsLoading(true);
    fetch(`/api/clients/${clientId}/training-goals`)
      .then(r => r.ok ? r.json() : [])
      .then((data: ClientGoal[]) => { setGoals(data || []); setGoalsLoading(false); })
      .catch(() => { setGoalsLoading(false); });
  }, [clientId]);

  async function handleAddGoal() {
    if (!newGoalDesc.trim()) { setGoalError("Please describe your goal."); return; }
    setSavingNewGoal(true);
    setGoalError("");
    try {
      const r = await fetch(`/api/clients/${clientId}/training-goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: newGoalDesc.trim(), targetDate: newGoalDate || undefined, priority: newGoalPriority }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        setGoalError((e as any).error ?? "Failed to save goal.");
      } else {
        const goal: ClientGoal = await r.json();
        setGoals(g => [...g, goal]);
        setNewGoalDesc(""); setNewGoalDate(""); setNewGoalPriority("equal");
      }
    } catch { setGoalError("Failed to save goal."); }
    setSavingNewGoal(false);
  }

  async function handleDeleteGoal(id: number) {
    setDeletingGoalId(id);
    await fetch(`/api/clients/${clientId}/training-goals/${id}`, { method: "DELETE" }).catch(() => {});
    setGoals(g => g.filter(x => x.id !== id));
    setDeletingGoalId(null);
  }

  // ── PBs (manual baselines) state ──────────────────────────────
  const [expandedPBKey, setExpandedPBKey] = useState<string | null>(null);
  const [pbInputs, setPbInputs] = useState<Record<string, string>>({});
  const [pbInputSaving, setPbInputSaving] = useState<Record<string, boolean>>({});

  async function handleLogBaseline(key: string) {
    const val = pbInputs[key];
    if (!val?.trim()) return;
    setPbInputSaving(p => ({ ...p, [key]: true }));
    const bl = analytics?.baselines;
    const body: {
      benchKg: number | null; squatKg: number | null; deadliftKg: number | null;
      fiveKSeconds: number | null; tenKSeconds: number | null;
      halfMarathonSeconds: number | null; marathonSeconds: number | null;
    } = {
      benchKg:             bl?.benchKg             ?? null,
      squatKg:             bl?.squatKg             ?? null,
      deadliftKg:          bl?.deadliftKg          ?? null,
      fiveKSeconds:        bl?.fiveKSeconds         ?? null,
      tenKSeconds:         bl?.tenKSeconds          ?? null,
      halfMarathonSeconds: bl?.halfMarathonSeconds  ?? null,
      marathonSeconds:     bl?.marathonSeconds      ?? null,
    };
    if (key === "bench")        body.benchKg             = parseFloat(val) || null;
    if (key === "squat")        body.squatKg             = parseFloat(val) || null;
    if (key === "deadlift")     body.deadliftKg          = parseFloat(val) || null;
    if (key === "fiveK")        body.fiveKSeconds        = parseTimeInput(val);
    if (key === "tenK")         body.tenKSeconds         = parseTimeInput(val);
    if (key === "halfMarathon") body.halfMarathonSeconds = parseTimeInput(val);
    if (key === "marathon")     body.marathonSeconds     = parseTimeInput(val);
    const res = await fetch(`/api/clients/${clientId}/baselines`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (res?.ok) {
      await queryClient.invalidateQueries({ queryKey: ["client-analytics", clientId] });
    }
    setPbInputs(p => ({ ...p, [key]: "" }));
    setPbInputSaving(p => ({ ...p, [key]: false }));
  }

  // ── 1RM Tracker state & handlers ──────────────────────────────
  const [clientLifts, setClientLifts] = useState<ClientLiftWithRM[]>([]);
  const [expandedLiftId, setExpandedLiftId] = useState<number | null>(null);
  const [liftLogInputs, setLiftLogInputs] = useState<Record<number, string>>({});
  const [liftLogSaving, setLiftLogSaving] = useState<Record<number, boolean>>({});
  const [addLiftOpen, setAddLiftOpen] = useState(false);
  const [newLiftName, setNewLiftName] = useState("");
  const [addLiftSaving, setAddLiftSaving] = useState(false);

  async function fetchLifts() {
    const data = await fetch(`/api/clients/${clientId}/lifts`).then(r => r.json()).catch(() => ({ lifts: [] }));
    setClientLifts(data.lifts ?? []);
  }

  useEffect(() => { void fetchLifts(); }, [clientId]);

  async function handleLogOneRM(liftId: number, exerciseName: string) {
    const kg = parseFloat(liftLogInputs[liftId] ?? "");
    if (!kg || kg <= 0) return;
    setLiftLogSaving(p => ({ ...p, [liftId]: true }));
    await fetch(`/api/clients/${clientId}/one-rms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseName, weightKg: kg, source: "manual" }),
    }).catch(() => {});
    await fetchLifts();
    setLiftLogInputs(p => ({ ...p, [liftId]: "" }));
    setLiftLogSaving(p => ({ ...p, [liftId]: false }));
  }

  async function handleToggleLiftHidden(liftId: number) {
    await fetch(`/api/clients/${clientId}/lifts/${liftId}/toggle-hidden`, { method: "PATCH" }).catch(() => {});
    await fetchLifts();
  }

  async function handleAddLift() {
    if (!newLiftName.trim()) return;
    setAddLiftSaving(true);
    await fetch(`/api/clients/${clientId}/lifts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseName: newLiftName.trim() }),
    }).catch(() => {});
    await fetchLifts();
    setNewLiftName("");
    setAddLiftOpen(false);
    setAddLiftSaving(false);
  }

  function getGoalTarget(exerciseName: string, goalList: ClientGoal[]): number | null {
    const metric = LIFT_TO_METRIC[exerciseName];
    if (!metric) return null;
    for (const goal of goalList) {
      for (const t of goal.parsedTargets ?? []) {
        if (t.metric === metric && t.target > 0) return t.target;
      }
    }
    return null;
  }

  const oneRMLines = clientLifts
    .filter(l => !l.isHidden && l.currentWeightKg !== null)
    .map(l => `${l.exerciseName}: ${l.currentWeightKg}kg`);

  // Fetch nutrition logs for last 7 days when card is enabled
  useEffect(() => {
    if (!prefs.showNutritionCard) return;
    let cancelled = false;
    fetch(`/api/clients/${clientId}/nutrition`)
      .then(r => r.ok ? r.json() : [])
      .then((data: RawNutritionEntry[]) => { if (!cancelled) setNutritionLogs(data || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId, prefs.showNutritionCard]);

  // Live share preview — regenerate on stat toggle
  useEffect(() => {
    if (!showShare) return;
    let cancelled = false;
    setShareLoading(true);

    const compute = () => {
      const today = new Date();
      const dow = today.getDay();
      const diffToMon = dow === 0 ? -6 : 1 - dow;
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() + diffToMon);
      const thisWkStr = thisMonday.toISOString().slice(0, 10);
      const lastWkDate = new Date(thisMonday);
      lastWkDate.setDate(lastWkDate.getDate() - 7);
      const lastWkStr = lastWkDate.toISOString().slice(0, 10);
      return {
        twd: analytics.byWeek.find(w => w.weekStart === thisWkStr),
        lwd: analytics.byWeek.find(w => w.weekStart === lastWkStr),
      };
    };

    const timer = setTimeout(async () => {
      const { twd, lwd } = compute();
      const file = await generateProgressCard(analytics, twd, lwd, shareStats);
      if (cancelled) return;
      if (file) {
        setShareFile(file);
        setShareImageUrl(prev => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(file);
        });
      }
      setShareLoading(false);
    }, 180);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [showShare, shareStats, analytics]);

  const toggle = (k: keyof DashboardPrefs) => setPrefs(p => {
    const next = { ...p, [k]: !p[k] };
    // Hiding nutrition card must also disable it from the score
    if (k === "showNutritionCard" && !next.showNutritionCard) {
      next.includeNutritionInScore = false;
    }
    return next;
  });

  // ── Share handlers ─────────────────────────────────────────────
  function openShareModal() {
    // Smart defaults: fitness score + best available strength or run stat
    const defaults: ShareStatKey[] = ["fitnessScore"];
    const extras: ShareStatKey[] = ["squat", "bench", "deadlift", "est5K", "distance", "pace"];
    for (const k of extras) {
      const ok = buildDashboardStat(k, analytics,
        analytics.byWeek.find(w => {
          const today = new Date();
          const dow = today.getDay();
          const d = new Date(today);
          d.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
          return w.weekStart === d.toISOString().slice(0, 10);
        }),
        undefined,
      );
      if (ok) { defaults.push(k); break; }
    }
    setShareStats(defaults);
    setShareMaxReached(false);
    setShareSaved(false);
    setShareImageUrl(null);
    setShareFile(null);
    setShowShare(true);
  }

  function closeShareModal() {
    setShowShare(false);
    setShareImageUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
  }

  function toggleShareStat(key: ShareStatKey) {
    setShareStats(prev => {
      if (prev.includes(key)) {
        setShareMaxReached(false);
        return prev.filter(k => k !== key);
      }
      if (prev.length >= 4) { setShareMaxReached(true); return prev; }
      setShareMaxReached(false);
      return [...prev, key];
    });
  }

  async function handleSaveImage() {
    if (!shareFile) return;
    // On mobile, use the native share sheet — user can tap "Save Image" to camera roll
    if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      try {
        await navigator.share({ files: [shareFile], title: "MG Coaching Progress" });
        setShareSaved(true);
        setTimeout(() => setShareSaved(false), 3000);
        return;
      } catch {
        // User cancelled or share failed — fall through to download
      }
    }
    // Desktop fallback
    const url = URL.createObjectURL(shareFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = "axis-progress.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setShareSaved(true);
    setTimeout(() => setShareSaved(false), 3000);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!analytics || analytics.sessions.length === 0) {
    return (
      <div className="px-4 pt-4 pb-8 space-y-4 opacity-60 pointer-events-none select-none">
        {/* Onboarding nudge */}
        <div className="rounded-xl border bg-primary/5 border-primary/20 px-4 py-3 pointer-events-auto">
          <p className="text-sm font-semibold text-primary">No programme yet.</p>
          <p className="text-xs text-muted-foreground mt-0.5">Head to Training and let Phil build one for you.</p>
        </div>

        {/* Skeleton: Fitness Score */}
        <div className="rounded-2xl border bg-card p-4 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>

        {/* Skeleton: This Week */}
        <div className="rounded-2xl border bg-card p-4 space-y-2">
          <Skeleton className="h-3 w-20 mb-3" />
          <div className="grid grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* Skeleton: Goals */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-14" />
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl border bg-card px-3 py-3 space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </div>

        {/* Skeleton: Performance cards */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-3 space-y-2">
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { fitnessScore, weeklyWin, adherence, strengthMetrics, runMetrics, byWeek, byMonth } = analytics;

  // Week / month data for secondary metrics
  const today = new Date();
  const thisMonthStr = today.toISOString().slice(0, 7);
  const lastMonthDate = new Date(today);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonthStr = lastMonthDate.toISOString().slice(0, 7);

  // Monday of this week
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + diffToMon);
  const thisWkStr = thisMonday.toISOString().slice(0, 10);
  const lastWkDate = new Date(thisMonday);
  lastWkDate.setDate(lastWkDate.getDate() - 7);
  const lastWkStr = lastWkDate.toISOString().slice(0, 10);

  const thisWeekData  = byWeek.find(w => w.weekStart === thisWkStr);
  const lastWeekData  = byWeek.find(w => w.weekStart === lastWkStr);
  const thisMonthData = byMonth.find(m => m.month === thisMonthStr);
  const lastMonthData = byMonth.find(m => m.month === lastMonthStr);

  // "By this point last week" — sessions from last week up to the same day of the week as today
  const daysFromMon = dow === 0 ? 6 : dow - 1; // 0=Mon, 6=Sun
  const lastWeekSameDayStr = new Date(lastWkDate.getTime() + daysFromMon * 86400000).toISOString().slice(0, 10);
  const lastWeekByNow = (analytics.sessions ?? [])
    .filter(s => s.date >= lastWkStr && s.date <= lastWeekSameDayStr)
    .reduce((acc, s) => ({ distance: acc.distance + s.totalDistance, volume: acc.volume + s.totalVolume }), { distance: 0, volume: 0 });

  // Nutrition scoring
  const nutritionStats = computeNutritionStats(nutritionLogs, calorieTarget ?? null, nutritionMode, proteinTarget ?? null);
  const hasNutritionData = nutritionLogs.length > 0;

  // Blended fitness score (70% training / 30% nutrition if opted in)
  const displayedFitnessScore = (prefs.includeNutritionInScore && hasNutritionData)
    ? Math.round(fitnessScore.current * 0.70 + nutritionStats.nutritionPercent * 0.30)
    : fitnessScore.current;

  // Score change display
  const scoreChange = fitnessScore.change;
  const scorePositive = scoreChange !== null && scoreChange > 0;
  const scoreNeutral  = scoreChange === null || scoreChange === 0;

  const adherenceRatio = adherence.thisWeek.planned > 0
    ? adherence.thisWeek.completed / adherence.thisWeek.planned
    : null;

  const scoreDrivers = computeScoreDrivers(analytics, thisWeekData);

  const noSessions         = noSessionsThisWeek(thisWeekData);
  const fitnessStateMsg    = getFitnessScoreStateMessage(noSessions);
  const whyMovedSummary    = getWhyItMovedSummary(noSessions, fitnessScore.explanation);
  const weeklyWinText      = getWeeklyWinDisplay(weeklyWin, noSessions);
  const consistencyContent = getConsistencyContent(adherence, lastWeekData?.sessionCount ?? 0);

  if (!hasSessionData) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-5 pb-24 flex flex-col items-center justify-center min-h-[300px] text-center space-y-3">
        <p className="text-base text-muted-foreground leading-relaxed">
          Your dashboard will come alive once you start training.<br />
          Head to Training to build your first programme.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 pb-24 space-y-5">

      {/* ── 1. Fitness Score ──────────────────────────────────── */}
      <div className="bg-card border rounded-2xl px-5 py-5">
        <div className="flex items-start justify-between mb-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Fitness Score</span>
          <BarChart3 className="w-4 h-4 text-muted-foreground/40" />
        </div>

        <div className="flex items-end gap-3 mt-1">
          <span className="text-5xl font-black tabular-nums leading-none">{displayedFitnessScore}</span>
          <div className="mb-1 space-y-0.5">
            {scoreChange !== null && (
              <div className={`text-sm font-semibold ${scorePositive ? "text-emerald-600" : scoreNeutral ? "text-muted-foreground" : "text-red-500"}`}>
                {scoreChange > 0 ? `+${scoreChange}` : scoreChange === 0 ? "No change" : `${scoreChange}`} vs last week
              </div>
            )}
            {fitnessScore.monthlyChange !== null && (
              <div className="text-[11px] text-muted-foreground">
                {fitnessScore.monthlyChange > 0 ? `+${fitnessScore.monthlyChange}` : `${fitnessScore.monthlyChange}`} vs last month
              </div>
            )}
          </div>
        </div>

        {fitnessStateMsg && (
          <p className="mt-3 text-[11px] text-muted-foreground border-t pt-3">
            {fitnessStateMsg}
          </p>
        )}
        {!fitnessStateMsg && prefs.showFitnessExplanation && (
          <p className="mt-3 text-[12px] text-muted-foreground italic border-t pt-3">
            {fitnessScore.explanation}
          </p>
        )}
      </div>

      {/* ── Goal Progress ────────────────────────────────────── */}
      {(() => {
        if (goalsLoading || goals.length === 0) return null;

        const bl = analytics?.baselines;

        type ProgressItem = {
          key: string; icon: string; label: string; targetStr: string; targetDate: string | null;
        } & (
          | { hasData: true; pct: number; noProgress: boolean; currentLabel: string; subLabel: string; weeksEst: number | null; tight: boolean }
          | { hasData: false; nudge: string }
        );

        const items: ProgressItem[] = [];

        for (const goal of goals) {
          if (!goal.parsedTargets) continue;
          for (const t of goal.parsedTargets) {
            const targetNum = Number(t.target);
            const targetDate = goal.targetDate;
            const weeksToTarget = targetDate ? Math.floor((new Date(targetDate).getTime() - Date.now()) / 604800000) : null;

            // ── Strength goals ──────────────────────────────────────────
            if (t.metric === "bench_e1rm" || t.metric === "squat_e1rm" || t.metric === "deadlift_e1rm") {
              const smKey = t.metric === "bench_e1rm" ? "bench" : t.metric === "squat_e1rm" ? "squat" : "deadlift" as const;
              const sm = analytics?.strengthMetrics[smKey];
              const loggedCurr = sm?.current ?? null;
              const loggedPrev = sm?.previous ?? null;
              const manualCurr = t.metric === "bench_e1rm" ? (bl?.benchKg ?? null)
                : t.metric === "squat_e1rm" ? (bl?.squatKg ?? null) : (bl?.deadliftKg ?? null);
              const curr = loggedCurr ?? manualCurr;
              const liftLabels = { bench_e1rm: "Bench Press", squat_e1rm: "Squat", deadlift_e1rm: "Deadlift" };
              const liftShort  = { bench_e1rm: "bench", squat_e1rm: "squat", deadlift_e1rm: "deadlift" };
              const label = liftLabels[t.metric];

              if (curr === null) {
                items.push({ key: `${t.metric}_${goal.id}`, icon: "🏋️", label, targetStr: `${targetNum}kg`, targetDate, hasData: false, nudge: `Add your current ${label.toLowerCase()} PB in Edit Dashboard` });
                continue;
              }

              const higherIsBetter = true;
              const pct = Math.min(100, Math.round(higherIsBetter ? (curr / targetNum) * 100 : (targetNum / curr) * 100));
              const weeklyGain = loggedCurr !== null && loggedPrev !== null ? (loggedCurr - loggedPrev) / 4 : null;
              const weeksEst = weeklyGain && weeklyGain > 0 ? Math.ceil((targetNum - curr) / weeklyGain) : null;
              const tight = weeksToTarget !== null && weeksEst !== null ? weeksEst > weeksToTarget : false;

              let subLabel: string;
              if (loggedCurr !== null && loggedPrev !== null) {
                const delta = Math.round(loggedCurr - loggedPrev);
                if (delta > 0)      subLabel = `Up ${delta}kg in the last 4 weeks`;
                else if (delta < 0) subLabel = `Down ${Math.abs(delta)}kg in the last 4 weeks`;
                else                subLabel = "Holding steady. Keep logging to track gains.";
              } else if (loggedCurr !== null) {
                subLabel = `Log more ${liftShort[t.metric]} sessions to estimate rate.`;
              } else {
                subLabel = `Based on your PB. Log ${liftShort[t.metric]} sessions to track progress.`;
              }

              items.push({ key: `${t.metric}_${goal.id}`, icon: "🏋️", label, targetStr: `${targetNum}kg`, targetDate, hasData: true, pct, noProgress: false, currentLabel: `${curr}kg`, subLabel, weeksEst, tight });
            }

            // ── Run goals ────────────────────────────────────────────────
            if (t.metric === "5k" || t.metric === "10k" || t.metric === "half_marathon" || t.metric === "marathon") {
              const mLabels = { "5k": "5K", "10k": "10K", "half_marathon": "Half Marathon", "marathon": "Marathon" };
              const label = mLabels[t.metric];
              const targetSecs = targetNum * 60;
              const tLabel = t.metric === "marathon" ? secsToHmmss(targetSecs) : secsToMmss(targetSecs);

              let currSecs: number | null = null;
              let hasLogged = false;
              let loggedPrevSecs: number | null = null;

              if (t.metric === "5k") {
                const loggedStr = analytics?.runMetrics.estimated5K.current ?? null;
                const prevStr   = analytics?.runMetrics.estimated5K.previous ?? null;
                if (loggedStr) { const s = paceToSeconds(loggedStr); if (s) { currSecs = s; hasLogged = true; } }
                if (prevStr) { const s = paceToSeconds(prevStr); if (s) loggedPrevSecs = s; }
                if (currSecs === null && bl?.fiveKSeconds) currSecs = bl.fiveKSeconds;
              } else if (t.metric === "10k") {
                if (bl?.tenKSeconds) currSecs = bl.tenKSeconds;
              } else if (t.metric === "half_marathon") {
                if (bl?.halfMarathonSeconds) currSecs = bl.halfMarathonSeconds;
              } else if (t.metric === "marathon") {
                if (bl?.marathonSeconds) currSecs = bl.marathonSeconds;
              }

              if (currSecs === null) {
                items.push({ key: `${t.metric}_${goal.id}`, icon: "🏃", label, targetStr: tLabel, targetDate, hasData: false, nudge: `Add your current ${label} time in Edit Dashboard` });
                continue;
              }

              const baselineSecs = (t.metric === "5k" && bl?.fiveKSeconds) ? bl.fiveKSeconds
                : (t.metric === "10k" && bl?.tenKSeconds) ? bl.tenKSeconds
                : (t.metric === "half_marathon" && bl?.halfMarathonSeconds) ? bl.halfMarathonSeconds
                : (t.metric === "marathon" && bl?.marathonSeconds) ? bl.marathonSeconds
                : (loggedPrevSecs ?? currSecs);

              const higherIsBetter = false;
              const pct = Math.min(100, Math.round(higherIsBetter ? (currSecs / targetSecs) * 100 : (targetSecs / currSecs) * 100));
              const noProgress = pct === 0 && currSecs > targetSecs;

              const cLabel = t.metric === "marathon" ? secsToHmmss(currSecs) : secsToMmss(currSecs);

              let subLabel: string;
              if (hasLogged && loggedPrevSecs !== null) {
                const diffSecs = loggedPrevSecs - currSecs;
                if (diffSecs > 60) {
                  const minsDown = Math.floor(diffSecs / 60);
                  subLabel = `Est. current: ${cLabel}. Down ${minsDown} min${minsDown !== 1 ? "s" : ""} in the last 4 weeks.`;
                } else if (diffSecs > 5) {
                  subLabel = `Est. current: ${cLabel}. Down ${diffSecs}s in the last 4 weeks.`;
                } else {
                  subLabel = `Est. current: ${cLabel}. Log more runs to track progress.`;
                }
              } else if (hasLogged) {
                subLabel = `Est. current: ${cLabel}. Log more runs to estimate pace.`;
              } else {
                subLabel = "Based on your PB. Log runs of 3km+ to track progress.";
              }

              items.push({ key: `${t.metric}_${goal.id}`, icon: "🏃", label, targetStr: tLabel, targetDate, hasData: true, pct, noProgress, currentLabel: hasLogged ? `est. ${cLabel}` : cLabel, subLabel, weeksEst: null, tight: false });
            }
          }
        }

        if (items.length === 0) return null;

        return (
          <div className="bg-card border rounded-2xl px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Goal Progress</span>
              <Target className="w-4 h-4 text-muted-foreground/40" />
            </div>
            <div className="space-y-4">
              {items.map(item => (
                <div key={item.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">{item.icon} {item.label} → {item.targetStr}</span>
                    {item.hasData && (
                      <span className="text-[11px] text-muted-foreground font-medium">
                        {item.noProgress ? "Starting point set" : `${item.pct}%`}
                      </span>
                    )}
                  </div>
                  {item.hasData ? (
                    <>
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs text-muted-foreground w-16 shrink-0">{item.currentLabel}</span>
                        {!item.noProgress && (
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${item.pct}%` }} />
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {item.subLabel}
                        {item.weeksEst !== null && (
                          <>
                            {" "}At current rate: ~{item.weeksEst} weeks.
                            {item.targetDate && (
                              <span className={item.tight ? " text-amber-500" : ""}>
                                {" "}[{new Date(item.targetDate + "T00:00:00").toLocaleString("default", { month: "short", year: "numeric" })} target{item.tight ? " tight" : ""}]
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {item.nudge}.{" "}
                      <button className="text-primary hover:underline underline-offset-2" onClick={() => setEditOpen(true)}>
                        Open Edit Dashboard
                      </button>
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Goal nudge (no goals set) ─────────────────────────── */}
      {!goalsLoading && goals.length === 0 && (
        <button
          onClick={() => setEditOpen(true)}
          className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
        >
          <Target className="w-4 h-4 text-primary shrink-0" />
          <span className="text-[13px] text-foreground/80 font-medium flex-1">Tell Phil what you're working toward and he'll track your progress</span>
          <span className="text-[11px] text-primary/70 font-semibold">Set goal →</span>
        </button>
      )}

      {/* ── Why it moved ─────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card overflow-hidden -mt-2">
        <button
          onClick={() => setDrilldownOpen(d => !d)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-[11px] text-muted-foreground font-medium">Why it moved</span>
            <span className="text-[11px] text-muted-foreground/70 truncate hidden sm:block">
              — {whyMovedSummary}
            </span>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${drilldownOpen ? "rotate-180" : ""}`}
          />
        </button>

        {drilldownOpen && (
          <div className="px-4 pb-4 pt-1 space-y-4 border-t">
            <p className="text-[11px] text-muted-foreground pt-2 italic">{whyMovedSummary}</p>
            {scoreDrivers.map(driver => (
              <DriverRow key={driver.label} driver={driver} />
            ))}
          </div>
        )}
      </div>

      {/* ── AI Coaching entry point ──────────────────────────── */}
      <button
        onClick={() => setCoachingOpen(true)}
        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border bg-card hover:bg-muted/40 transition-colors text-left -mt-2"
      >
        <Sparkles className="w-4 h-4 text-primary shrink-0" />
        <span className="text-[13px] text-muted-foreground font-medium flex-1">Ask about your training</span>
        <span className="text-[11px] text-muted-foreground/50">→</span>
      </button>

      {/* ── Share progress card ───────────────────────────────── */}
      <button
        onClick={openShareModal}
        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-2xl border bg-card hover:bg-muted/40 transition-colors text-left -mt-2"
      >
        <Share2 className="w-4 h-4 text-primary shrink-0" />
        <span className="text-[13px] text-muted-foreground font-medium flex-1">Share your progress</span>
        <span className="text-[11px] text-muted-foreground/50">→</span>
      </button>

      {/* ── 2. Weekly Win ────────────────────────────────────── */}
      {prefs.showWeeklyWin && (
        <div className="bg-card border rounded-2xl px-5 py-4 flex items-start gap-3">
          <Trophy className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Weekly Win</p>
            <p className="text-sm font-semibold leading-snug">{weeklyWinText}</p>
          </div>
        </div>
      )}

      {/* ── 3. Consistency / Adherence ───────────────────────── */}
      {prefs.showConsistency && (
        <div className="bg-card border rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Consistency</span>
            <CheckSquare className="w-4 h-4 text-muted-foreground/40" />
          </div>

          <div className="flex items-end gap-2">
            <span className="text-3xl font-black tabular-nums leading-none">
              {consistencyContent.primaryValue}
            </span>
            <span className="mb-0.5 text-sm text-muted-foreground">{consistencyContent.suffix}</span>
          </div>

          {consistencyContent.showBar && adherenceRatio !== null && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${adherenceRatio >= 1 ? "bg-emerald-500" : adherenceRatio >= 0.75 ? "bg-emerald-400" : adherenceRatio >= 0.5 ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${Math.min(adherenceRatio * 100, 100)}%` }}
              />
            </div>
          )}

          {consistencyContent.sub && (
            <p className="mt-2 text-[11px] text-muted-foreground">{consistencyContent.sub}</p>
          )}

          {adherence.streak >= 2 && (
            <p className="mt-1 text-[11px] font-semibold text-emerald-600">
              {adherence.streak}-week streak
            </p>
          )}
        </div>
      )}

      {/* ── 3b. Nutrition card ───────────────────────────────── */}
      {prefs.showNutritionCard && (
        <div className="bg-card border rounded-2xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Nutrition</span>
            <UtensilsCrossed className="w-4 h-4 text-muted-foreground/40" />
          </div>

          {!hasNutritionData ? (
            <p className="text-sm text-muted-foreground">Start logging meals to track consistency</p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-black tabular-nums leading-none">{nutritionStats.nutritionPercent}%</span>
                <span className="mb-0.5 text-sm text-muted-foreground">on track</span>
              </div>

              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    nutritionStats.nutritionPercent >= 80 ? "bg-emerald-500"
                    : nutritionStats.nutritionPercent >= 60 ? "bg-amber-400"
                    : "bg-red-400"
                  }`}
                  style={{ width: `${nutritionStats.nutritionPercent}%` }}
                />
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">{nutritionStats.loggedDays} / 7 days logged</p>
              {nutritionMode === "protein_only"
                ? nutritionStats.hitDays > 0 && (
                    <p className="text-[11px] text-muted-foreground">{nutritionStats.hitDays} days hit protein target</p>
                  )
                : nutritionStats.closeDays > 0 && (calorieTarget ?? 0) > 0 && (
                    <p className="text-[11px] text-muted-foreground">{nutritionStats.closeDays} days close to target</p>
                  )
              }
            </>
          )}
        </div>
      )}

      {/* ── 3.5 Hybrid streak ────────────────────────────────── */}
      {analytics.hybridStreak && (
        <HybridStreakCard streak={analytics.hybridStreak} />
      )}

      {/* ── 3.6 Best Efforts feed ────────────────────────────── */}
      <BestEffortsFeed
        topBestEfforts={analytics.topBestEfforts}
        hybridHighlights={analytics.hybridHighlights}
      />

      {/* ── 4. Core performance cards ────────────────────────── */}
      {(prefs.showEstimated5K || prefs.showHalfMarathonCard || prefs.showMarathonCard || prefs.showSquatE1RM || prefs.showBenchE1RM || prefs.showDeadliftE1RM) && (
        <section>
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-2.5">Performance</h2>
          <div className="grid grid-cols-2 gap-3">

            {prefs.showEstimated5K && (() => {
              const allTimePB = analytics.baselines?.fiveKSeconds != null
                ? secsToMmss(analytics.baselines.fiveKSeconds)
                : null;
              return (
                <PerfCard
                  title="5K"
                  icon={<Footprints className="w-4 h-4" />}
                  allTimePB={allTimePB}
                  currentEst={runMetrics.estimated5K.current}
                  higherIsBetter={false}
                />
              );
            })()}

            {prefs.showHalfMarathonCard && (() => {
              const allTimeHalfMaraPB = analytics.baselines?.halfMarathonSeconds != null
                ? secsToMmss(analytics.baselines.halfMarathonSeconds)
                : null;
              return (
                <PerfCard
                  title="Half Marathon"
                  icon={<Footprints className="w-4 h-4" />}
                  allTimePB={allTimeHalfMaraPB}
                  currentEst={analytics.estHalfMaraCurr ?? null}
                  higherIsBetter={false}
                />
              );
            })()}

            {prefs.showMarathonCard && (() => {
              const blSecs = analytics.baselines?.marathonSeconds ?? null;
              const allTimePB = blSecs != null ? secsToHmmss(blSecs) : null;
              return (
                <PerfCard
                  title="Marathon"
                  icon={<Footprints className="w-4 h-4" />}
                  allTimePB={allTimePB}
                  currentEst={null}
                  higherIsBetter={false}
                />
              );
            })()}

            {prefs.showSquatE1RM && (() => {
              const allTimeSess = analytics.allTimeStrength?.squat ?? null;
              const blVal = analytics.baselines?.squatKg ?? null;
              const nums = [allTimeSess, blVal].filter((v): v is number => v !== null);
              const allTimePBNum = nums.length > 0 ? Math.max(...nums) : null;
              return (
                <PerfCard
                  title="Squat"
                  icon={<Dumbbell className="w-4 h-4" />}
                  allTimePB={allTimePBNum !== null ? `${allTimePBNum}kg` : null}
                  currentEst={strengthMetrics.squat.current !== null ? `${strengthMetrics.squat.current}kg` : null}
                  lastHeavyDate={analytics.lastHeavyDates?.squat ?? null}
                />
              );
            })()}

            {prefs.showBenchE1RM && (() => {
              const allTimeSess = analytics.allTimeStrength?.bench ?? null;
              const blVal = analytics.baselines?.benchKg ?? null;
              const nums = [allTimeSess, blVal].filter((v): v is number => v !== null);
              const allTimePBNum = nums.length > 0 ? Math.max(...nums) : null;
              return (
                <PerfCard
                  title="Bench"
                  icon={<Dumbbell className="w-4 h-4" />}
                  allTimePB={allTimePBNum !== null ? `${allTimePBNum}kg` : null}
                  currentEst={strengthMetrics.bench.current !== null ? `${strengthMetrics.bench.current}kg` : null}
                  lastHeavyDate={analytics.lastHeavyDates?.bench ?? null}
                />
              );
            })()}

            {prefs.showDeadliftE1RM && (() => {
              const allTimeSess = analytics.allTimeStrength?.deadlift ?? null;
              const blVal = analytics.baselines?.deadliftKg ?? null;
              const nums = [allTimeSess, blVal].filter((v): v is number => v !== null);
              const allTimePBNum = nums.length > 0 ? Math.max(...nums) : null;
              return (
                <PerfCard
                  title="Deadlift"
                  icon={<Dumbbell className="w-4 h-4" />}
                  allTimePB={allTimePBNum !== null ? `${allTimePBNum}kg` : null}
                  currentEst={strengthMetrics.deadlift.current !== null ? `${strengthMetrics.deadlift.current}kg` : null}
                  lastHeavyDate={analytics.lastHeavyDates?.deadlift ?? null}
                />
              );
            })()}
          </div>
        </section>
      )}

      {/* ── 5. Secondary metrics ─────────────────────────────── */}
      {(prefs.showDistanceRun || prefs.showVolumeLifted) && (
        <section>
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-2.5">This Week</h2>
          <div className="grid grid-cols-2 gap-3">

            {prefs.showDistanceRun && (() => {
              const curr = thisWeekData?.totalDistance ?? 0;
              const prev = lastWeekByNow.distance;
              const diff = curr - prev;
              const everRan = (analytics.sessions ?? []).some((s) => s.totalDistance > 0);
              if (curr > 0) {
                return (
                  <StatCard
                    title="Distance Run"
                    icon={<Footprints className="w-4 h-4" />}
                    value={fmtDist(curr)}
                    sub={prev > 0 ? (
                      <span>
                        {"By this point last week: "}{fmtDist(prev)}{" "}
                        <span className={diff >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                          {diff >= 0 ? `+${fmtDist(diff)} ahead` : `-${fmtDist(Math.abs(diff))} behind`}
                        </span>
                      </span>
                    ) : undefined}
                  />
                );
              }
              if (prev > 0) {
                return (
                  <StatCard
                    title="Distance Run"
                    icon={<Footprints className="w-4 h-4" />}
                    value={<span className="text-muted-foreground/70 font-normal">{fmtDist(prev)}</span>}
                    sub={<span><span className="text-muted-foreground">Last week. </span><span className="text-primary">Log a session</span></span>}
                  />
                );
              }
              return (
                <StatCard
                  title="Distance Run"
                  icon={<Footprints className="w-4 h-4" />}
                  value={<span className="text-sm text-muted-foreground font-normal">{everRan ? "Nothing yet this week" : "No runs logged yet"}</span>}
                />
              );
            })()}

            {prefs.showVolumeLifted && (() => {
              const curr = thisWeekData?.totalVolume ?? 0;
              const prev = lastWeekByNow.volume;
              const diff = curr - prev;
              const everLifted = (analytics.sessions ?? []).some((s) => s.totalVolume > 0);
              if (curr > 0) {
                return (
                  <StatCard
                    title="Volume Lifted"
                    icon={<TrendingUp className="w-4 h-4" />}
                    value={fmtVol(curr)}
                    sub={prev > 0 ? (
                      <span>
                        {"By this point last week: "}{fmtVol(prev)}{" "}
                        <span className={diff >= 0 ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>
                          {diff >= 0 ? `+${fmtVol(diff)} ahead` : `-${fmtVol(Math.abs(diff))} behind`}
                        </span>
                      </span>
                    ) : undefined}
                  />
                );
              }
              if (prev > 0) {
                return (
                  <StatCard
                    title="Volume Lifted"
                    icon={<TrendingUp className="w-4 h-4" />}
                    value={<span className="text-muted-foreground/70 font-normal">{fmtVol(prev)}</span>}
                    sub={<span><span className="text-muted-foreground">Last week. </span><span className="text-primary">Log a session</span></span>}
                  />
                );
              }
              return (
                <StatCard
                  title="Volume Lifted"
                  icon={<TrendingUp className="w-4 h-4" />}
                  value={<span className="text-sm text-muted-foreground font-normal">{everLifted ? "Nothing yet this week" : "No lifts logged yet"}</span>}
                />
              );
            })()}
          </div>

          {(prefs.showDistanceRun || prefs.showVolumeLifted) && (thisMonthData || lastMonthData) && (
            <>
              <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-2.5 mt-4">This Month</h2>
              <div className="grid grid-cols-2 gap-3">
                {prefs.showDistanceRun && (
                  <StatCard
                    title="Distance Run"
                    icon={<Footprints className="w-4 h-4" />}
                    value={thisMonthData?.totalDistance ? fmtDist(thisMonthData.totalDistance) : "—"}
                    delta={
                      <DeltaBadge
                        current={thisMonthData?.totalDistance ?? null}
                        previous={lastMonthData?.totalDistance ?? null}
                        kind="higher-better"
                        formatter={n => fmtDist(n)}
                      />
                    }
                    sub={lastMonthData?.totalDistance ? `${fmtDist(lastMonthData.totalDistance)} prev mo` : undefined}
                  />
                )}
                {prefs.showVolumeLifted && (
                  <StatCard
                    title="Volume Lifted"
                    icon={<TrendingUp className="w-4 h-4" />}
                    value={thisMonthData?.totalVolume ? fmtVol(thisMonthData.totalVolume) : "—"}
                    delta={
                      <DeltaBadge
                        current={thisMonthData?.totalVolume ?? null}
                        previous={lastMonthData?.totalVolume ?? null}
                        kind="higher-better"
                        formatter={n => fmtVol(n)}
                      />
                    }
                    sub={lastMonthData?.totalVolume ? `${fmtVol(lastMonthData.totalVolume)} prev mo` : undefined}
                  />
                )}
              </div>
            </>
          )}
        </section>
      )}


      {/* ── 7. Edit Dashboard button ─────────────────────────── */}
      <div className="pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground text-xs gap-1.5"
          onClick={() => setEditOpen(true)}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Edit Dashboard
        </Button>
      </div>

      {/* ── AI Coaching sheet ────────────────────────────────── */}
      <CoachingSheet
        open={coachingOpen}
        onOpenChange={setCoachingOpen}
        analytics={analytics}
        thisWeekData={thisWeekData}
        lastWeekData={lastWeekData}
        clientId={clientId}
        oneRMLines={oneRMLines}
      />

      {/* ── Preferences sheet ────────────────────────────────── */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left text-base">Customise Dashboard</SheetTitle>
          </SheetHeader>

          {/* ── YOUR GOAL ─────────────────────────────────────── */}
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2">Your Goal</p>
          <p className="text-xs text-muted-foreground mb-3">What are you working toward? Phil will use this to track progress and personalise your programme.</p>

          {/* Existing goals */}
          {goals.map(goal => (
            <div key={goal.id} className="flex items-start gap-2 mb-2 p-3 rounded-xl bg-muted/50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug">{goal.description}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {goal.targetDate && (
                    <span className="text-[11px] text-muted-foreground">
                      Target: {new Date(goal.targetDate + "T00:00:00").toLocaleDateString("default", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                  {goal.priority !== "equal" && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${goal.priority === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {goal.priority}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors p-1"
                disabled={deletingGoalId === goal.id}
                onClick={() => void handleDeleteGoal(goal.id)}
              >
                {deletingGoalId === goal.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}

          {/* Add new goal form */}
          {goals.length < 3 && (
            <div className="space-y-2 mt-1">
              <Input
                placeholder={goals.length === 0 ? `e.g. "130kg bench and sub 1:30 half marathon by October"` : "Add another goal…"}
                value={newGoalDesc}
                onChange={e => setNewGoalDesc(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") void handleAddGoal(); }}
                className="text-sm"
              />
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={newGoalDate}
                  onChange={e => setNewGoalDate(e.target.value)}
                  className="text-sm flex-1"
                  placeholder="Target date (optional)"
                />
                <select
                  value={newGoalPriority}
                  onChange={e => setNewGoalPriority(e.target.value as "primary" | "secondary" | "equal")}
                  className="text-sm border rounded-md px-2 py-1.5 bg-background text-foreground"
                >
                  <option value="equal">Equal</option>
                  <option value="primary">Primary</option>
                  <option value="secondary">Secondary</option>
                </select>
              </div>
              {goalError && <p className="text-xs text-red-500">{goalError}</p>}
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5"
                disabled={savingNewGoal || !newGoalDesc.trim()}
                onClick={() => void handleAddGoal()}
              >
                {savingNewGoal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {goals.length === 0 ? "Save goal" : "Add goal"}
              </Button>
            </div>
          )}

          {goals.length >= 3 && (
            <p className="text-xs text-muted-foreground mt-1">Maximum 3 goals. Remove one to add another.</p>
          )}

          {/* ── YOUR PBs ──────────────────────────────────────────── */}
          <div className="mt-6 mb-1">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2">Your PBs</p>
            <p className="text-xs text-muted-foreground mb-3">Your personal bests. Tap any row to edit. Phil uses these to track progress and build programmes.</p>
            <div className="space-y-1.5">

              {/* Fixed baseline metrics */}
              {BASELINE_METRICS.map(metric => {
                const bl = analytics?.baselines;
                const currentValue = (() => {
                  if (!bl) return null;
                  if (metric.key === "bench")        return bl.benchKg             != null ? `${bl.benchKg}kg`                           : null;
                  if (metric.key === "squat")        return bl.squatKg             != null ? `${bl.squatKg}kg`                           : null;
                  if (metric.key === "deadlift")     return bl.deadliftKg          != null ? `${bl.deadliftKg}kg`                        : null;
                  if (metric.key === "fiveK")        return bl.fiveKSeconds        != null ? secsToMmss(bl.fiveKSeconds)        : null;
                  if (metric.key === "tenK")         return bl.tenKSeconds         != null ? secsToMmss(bl.tenKSeconds)         : null;
                  if (metric.key === "halfMarathon") return bl.halfMarathonSeconds != null ? secsToMmss(bl.halfMarathonSeconds) : null;
                  if (metric.key === "marathon")     return bl.marathonSeconds     != null ? secsToHmmss(bl.marathonSeconds)   : null;
                  return null;
                })();
                const prefillValue = (() => {
                  if (!bl) return "";
                  if (metric.key === "bench")        return bl.benchKg             != null ? String(bl.benchKg)                 : "";
                  if (metric.key === "squat")        return bl.squatKg             != null ? String(bl.squatKg)                 : "";
                  if (metric.key === "deadlift")     return bl.deadliftKg          != null ? String(bl.deadliftKg)              : "";
                  if (metric.key === "fiveK")        return bl.fiveKSeconds        != null ? secsToMmss(bl.fiveKSeconds)        : "";
                  if (metric.key === "tenK")         return bl.tenKSeconds         != null ? secsToMmss(bl.tenKSeconds)         : "";
                  if (metric.key === "halfMarathon") return bl.halfMarathonSeconds != null ? secsToMmss(bl.halfMarathonSeconds) : "";
                  if (metric.key === "marathon")     return bl.marathonSeconds     != null ? secsToHmmss(bl.marathonSeconds)   : "";
                  return "";
                })();
                const isExpanded = expandedPBKey === metric.key;
                return (
                  <div key={metric.key} className="rounded-xl border bg-card overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                      onClick={() => {
                        const opening = !isExpanded;
                        setExpandedPBKey(opening ? metric.key : null);
                        if (opening) setPbInputs(p => ({ ...p, [metric.key]: prefillValue }));
                      }}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      <span className="flex-1 text-sm font-medium truncate">{metric.label}</span>
                      {currentValue !== null ? (
                        <span className="text-sm font-semibold tabular-nums">{currentValue}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No entry</span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t">
                        <div className="flex gap-2 items-center">
                          <Input
                            type={metric.isTime ? "text" : "number"}
                            placeholder={metric.placeholder}
                            step={metric.isTime ? undefined : metric.step}
                            min={metric.isTime ? undefined : "0"}
                            value={pbInputs[metric.key] ?? ""}
                            onChange={e => setPbInputs(p => ({ ...p, [metric.key]: e.target.value }))}
                            className="h-7 text-xs flex-1"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs px-3"
                            disabled={!pbInputs[metric.key]?.trim() || pbInputSaving[metric.key]}
                            onClick={() => void handleLogBaseline(metric.key)}
                          >
                            {pbInputSaving[metric.key] ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* User-added lifts (1RM tracker) */}
              {clientLifts.map(lift => {
                const goalTarget = getGoalTarget(lift.exerciseName, goals);
                const goalPct = goalTarget && lift.currentWeightKg
                  ? Math.min(100, Math.round((lift.currentWeightKg / goalTarget) * 100))
                  : null;
                const isExpanded = expandedLiftId === lift.id;
                return (
                  <div key={lift.id} className={`rounded-xl border bg-card overflow-hidden ${lift.isHidden ? "opacity-60" : ""}`}>
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                      onClick={() => setExpandedLiftId(isExpanded ? null : lift.id)}
                    >
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      <span className="flex-1 text-sm font-medium truncate">{lift.exerciseName}</span>
                      {lift.isHidden && <span className="text-[10px] text-muted-foreground mr-1">Hidden</span>}
                      {lift.currentWeightKg !== null ? (
                        <span className="text-sm font-semibold tabular-nums">{lift.currentWeightKg}kg</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No entry</span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t space-y-3">
                        {goalPct !== null && goalTarget && lift.currentWeightKg && (
                          <div>
                            <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                              <span>{lift.currentWeightKg}kg current</span>
                              <span>{goalPct}% of {goalTarget}kg goal</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${goalPct}%` }} />
                            </div>
                          </div>
                        )}
                        {lift.currentWeightKg !== null && (
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Training percentages</p>
                            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
                              {PCT_LEVELS.map(pct => (
                                <div key={pct} className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">{pct}%</span>
                                  <span className="font-medium tabular-nums">{roundHalf(lift.currentWeightKg! * pct / 100)}kg</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {lift.history.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">History</p>
                            <div className="space-y-1">
                              {lift.history.slice(0, 8).map((h, i) => (
                                <div key={h.id} className="flex justify-between text-xs">
                                  <span className="text-muted-foreground">
                                    {new Date(h.loggedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                                    {h.source !== "manual" && <span className="ml-1 opacity-60">({h.source})</span>}
                                  </span>
                                  <span className={i === 0 ? "font-semibold" : "text-muted-foreground"}>{h.weightKg}kg</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            placeholder="Log new 1RM (kg)"
                            step="0.5"
                            min="0"
                            value={liftLogInputs[lift.id] ?? ""}
                            onChange={e => setLiftLogInputs(p => ({ ...p, [lift.id]: e.target.value }))}
                            className="h-7 text-xs flex-1"
                          />
                          <Button
                            size="sm"
                            className="h-7 text-xs px-3"
                            disabled={!liftLogInputs[lift.id] || liftLogSaving[lift.id]}
                            onClick={() => void handleLogOneRM(lift.id, lift.exerciseName)}
                          >
                            {liftLogSaving[lift.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : "Log"}
                          </Button>
                          <button
                            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                            onClick={() => void handleToggleLiftHidden(lift.id)}
                          >
                            <Eye className="w-3 h-3" />
                            {lift.isHidden ? "Show" : "Hide"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {addLiftOpen ? (
              <div className="flex gap-2 items-center mt-2">
                <Input
                  placeholder="Exercise name"
                  value={newLiftName}
                  onChange={e => setNewLiftName(e.target.value)}
                  className="h-7 text-xs flex-1"
                  onKeyDown={e => { if (e.key === "Enter") void handleAddLift(); }}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-7 text-xs px-3"
                  disabled={!newLiftName.trim() || addLiftSaving}
                  onClick={() => void handleAddLift()}
                >
                  {addLiftSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs px-2"
                  onClick={() => { setAddLiftOpen(false); setNewLiftName(""); }}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground py-1 mt-1 hover:text-foreground"
                onClick={() => setAddLiftOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                Add lift
              </button>
            )}
          </div>

          <div className="space-y-0 divide-y mt-6">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2">Fitness Score</p>
            <PrefRow label="Show explanation line" checked={prefs.showFitnessExplanation} onToggle={() => toggle("showFitnessExplanation")} />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Cards</p>
            <PrefRow label="Weekly Win"     checked={prefs.showWeeklyWin}    onToggle={() => toggle("showWeeklyWin")}    />
            <PrefRow label="Consistency"    checked={prefs.showConsistency}  onToggle={() => toggle("showConsistency")}  />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Nutrition</p>
            <PrefRow label="Show on dashboard"        checked={prefs.showNutritionCard}       onToggle={() => toggle("showNutritionCard")}       />
            <PrefRow label="Include in fitness score" checked={prefs.includeNutritionInScore} onToggle={() => toggle("includeNutritionInScore")} disabled={!prefs.showNutritionCard} />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Performance</p>
            <PrefRow label="5K"            checked={prefs.showEstimated5K}    onToggle={() => toggle("showEstimated5K")}    />
            <PrefRow label="Half Marathon" checked={prefs.showHalfMarathonCard} onToggle={() => toggle("showHalfMarathonCard")} />
            <PrefRow label="Marathon"      checked={prefs.showMarathonCard}     onToggle={() => toggle("showMarathonCard")}     />
            <PrefRow label="Squat"         checked={prefs.showSquatE1RM}        onToggle={() => toggle("showSquatE1RM")}        />
            <PrefRow label="Bench"     checked={prefs.showBenchE1RM}    onToggle={() => toggle("showBenchE1RM")}    />
            <PrefRow label="Deadlift"  checked={prefs.showDeadliftE1RM} onToggle={() => toggle("showDeadliftE1RM")} />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Metrics</p>
            <PrefRow label="Distance Run"  checked={prefs.showDistanceRun}  onToggle={() => toggle("showDistanceRun")}  />
            <PrefRow label="Volume Lifted" checked={prefs.showVolumeLifted} onToggle={() => toggle("showVolumeLifted")} />
          </div>

          <Button className="w-full mt-6" onClick={() => setEditOpen(false)}>Done</Button>
        </SheetContent>
      </Sheet>

      {/* ── Share Progress Modal ──────────────────────────────── */}
      {showShare && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={closeShareModal} />
          <div className="relative bg-background rounded-t-3xl shadow-2xl max-h-[94vh] overflow-y-auto">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <button onClick={closeShareModal} className="text-sm text-foreground font-medium">Close</button>
              <p className="font-semibold text-sm">Share Progress</p>
              <div className="w-12" />
            </div>

            {/* Card preview */}
            <div className="flex justify-center py-5 px-5">
              <div
                className="relative rounded-2xl overflow-hidden shadow-xl"
                style={{
                  width: 210, height: 374,
                  backgroundImage: "linear-gradient(45deg,#8b8b8b 25%,transparent 25%),linear-gradient(-45deg,#8b8b8b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#8b8b8b 75%),linear-gradient(-45deg,transparent 75%,#8b8b8b 75%)",
                  backgroundSize: "18px 18px",
                  backgroundPosition: "0 0,0 9px,9px -9px,-9px 0",
                  backgroundColor: "#6b7280",
                }}
              >
                <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1 bg-black/55 backdrop-blur-sm text-white text-[9px] font-bold tracking-wider px-2 py-0.5 rounded">
                  TRANSPARENT
                </div>
                {shareLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
                  </div>
                ) : shareImageUrl ? (
                  <img src={shareImageUrl} alt="Progress card preview" className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-white/40 text-xs text-center px-4">Generating…</p>
                  </div>
                )}
              </div>
            </div>

            {/* Stat toggles */}
            <div className="px-5 pb-1">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold">Show on card</p>
                {shareMaxReached && (
                  <p className="text-xs text-amber-500 font-medium">Max 4 stats</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {SHARE_STAT_OPTIONS.map(opt => {
                  const available = buildDashboardStat(opt.key, analytics, thisWeekData, lastWeekData) !== null;
                  const active = shareStats.includes(opt.key);
                  return (
                    <button
                      key={opt.key}
                      onClick={() => available && toggleShareStat(opt.key)}
                      disabled={!available}
                      className={[
                        "flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm font-medium transition-all",
                        available
                          ? active
                            ? "bg-primary/10 border-primary text-primary"
                            : "bg-muted/40 border-border text-foreground hover:border-primary/40"
                          : "opacity-30 bg-muted/20 border-border text-muted-foreground cursor-not-allowed",
                      ].join(" ")}
                    >
                      <span>{opt.label}</span>
                      {available && active && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      {!available && <span className="text-[10px]">no data</span>}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2.5 text-center">
                Deltas show vs previous week · Preview updates as you toggle
              </p>
            </div>

            {/* Save button */}
            <div className="px-5 py-5">
              <button
                onClick={handleSaveImage}
                disabled={shareLoading || !shareFile}
                className="flex items-center justify-center gap-3 w-full py-4 rounded-2xl bg-primary text-primary-foreground font-semibold text-base shadow-md disabled:opacity-50 transition-opacity hover:bg-primary/90"
              >
                {shareSaved
                  ? <><Check className="w-5 h-5" /> Saved!</>
                  : shareLoading
                  ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
                  : <><Download className="w-5 h-5" /> Save Image</>
                }
              </button>
              <p className="text-xs text-muted-foreground text-center mt-3">
                Transparent PNG — layer over your content in Instagram or any editor.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
