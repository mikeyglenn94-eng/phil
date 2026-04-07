import React, { useState, useEffect } from "react";
import {
  BarChart3, Trophy, CheckSquare, TrendingUp, Footprints,
  Timer, Dumbbell, SlidersHorizontal, ChevronDown, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import CoachingSheet from "@/components/coaching-sheet";

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
}

// ── Preferences ───────────────────────────────────────────────────

interface DashboardPrefs {
  showFitnessExplanation: boolean;
  showWeeklyWin:          boolean;
  showConsistency:        boolean;
  showEstimated5K:        boolean;
  showSquatE1RM:          boolean;
  showBenchE1RM:          boolean;
  showDeadliftE1RM:       boolean;
  showDistanceRun:        boolean;
  showVolumeLifted:       boolean;
}

const DEFAULT_PREFS: DashboardPrefs = {
  showFitnessExplanation: true,
  showWeeklyWin:          true,
  showConsistency:        true,
  showEstimated5K:        true,
  showSquatE1RM:          true,
  showBenchE1RM:          true,
  showDeadliftE1RM:       true,
  showDistanceRun:        true,
  showVolumeLifted:       true,
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
    rLines.push(`Estimated 5K: ${estimated5K.current}`);
    rLines.push("No previous estimate to compare yet");
  } else {
    const cs = paceToSeconds(estimated5K.current);
    const ps = paceToSeconds(estimated5K.previous);
    if (cs && ps) {
      const diff = ps - cs; // positive = faster
      if (diff > 10) {
        rPolarity = "positive";
        rLabel = "positive";
        rLines.push(`Estimated 5K improved by ${diff}s`);
        rLines.push(`${estimated5K.previous} → ${estimated5K.current}`);
      } else if (diff < -10) {
        rPolarity = "negative";
        rLabel = "negative";
        rLines.push(`Estimated 5K slower by ${Math.abs(diff)}s`);
        rLines.push(`${estimated5K.previous} → ${estimated5K.current}`);
      } else {
        rPolarity = "neutral";
        rLabel = "stable";
        rLines.push(`Estimated 5K unchanged at ~${estimated5K.current}`);
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
    if (prev === null) { firstLogs.push(`${name}: ${curr}kg e1RM (first record)`); continue; }
    if (curr > prev)   { gains.push(`${name} e1RM up ${curr - prev}kg to ${curr}kg`); continue; }
    if (curr < prev)   { losses.push(`${name} e1RM down ${prev - curr}kg to ${curr}kg`); }
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
  title: string; value: string; unavailable?: boolean; sub?: React.ReactNode;
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

// ── Pref row ─────────────────────────────────────────────────────

function PrefRow({
  label, checked, onToggle,
}: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-0">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onToggle} />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

interface Props {
  analytics: AnalyticsData | undefined;
  isLoading: boolean;
  clientId: number;
}

export default function DashboardTab({ analytics, isLoading, clientId }: Props) {
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => loadPrefs(clientId));
  const [editOpen, setEditOpen] = useState(false);
  const [drilldownOpen, setDrilldownOpen] = useState(false);
  const [coachingOpen, setCoachingOpen] = useState(false);

  useEffect(() => { savePrefs(clientId, prefs); }, [prefs, clientId]);

  const toggle = (k: keyof DashboardPrefs) => setPrefs(p => ({ ...p, [k]: !p[k] }));

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!analytics || analytics.sessions.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground px-6">
        <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-25" />
        <p className="font-semibold">No logged sessions yet</p>
        <p className="text-sm mt-1">Complete a session to see your stats here.</p>
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

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 pb-24 space-y-5">

      {/* ── 1. Fitness Score ──────────────────────────────────── */}
      <div className="bg-card border rounded-2xl px-5 py-5">
        <div className="flex items-start justify-between mb-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Fitness Score</span>
          <BarChart3 className="w-4 h-4 text-muted-foreground/40" />
        </div>

        <div className="flex items-end gap-3 mt-1">
          <span className="text-5xl font-black tabular-nums leading-none">{fitnessScore.current}</span>
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

      {/* ── 4. Core performance cards ────────────────────────── */}
      {(prefs.showEstimated5K || prefs.showSquatE1RM || prefs.showBenchE1RM || prefs.showDeadliftE1RM) && (
        <section>
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-2.5">Performance</h2>
          <div className="grid grid-cols-2 gap-3">

            {prefs.showEstimated5K && (
              <StatCard
                title="Est. 5K"
                icon={<Footprints className="w-4 h-4" />}
                value={runMetrics.estimated5K.current ?? "Add a steady run to estimate"}
                unavailable={!runMetrics.estimated5K.current}
                delta={<TimeDeltaBadge current={runMetrics.estimated5K.current} previous={runMetrics.estimated5K.previous} />}
                sub={
                  runMetrics.estimated5K.previous
                    ? `was ${runMetrics.estimated5K.previous}`
                    : runMetrics.estimated5K.current
                      ? FIRST_BENCHMARK_LABEL
                      : undefined
                }
              />
            )}

            {prefs.showSquatE1RM && (
              <StatCard
                title="Squat e1RM"
                icon={<Dumbbell className="w-4 h-4" />}
                value={strengthMetrics.squat.current !== null ? `${strengthMetrics.squat.current}kg` : getLiftEmptyState("squat")}
                unavailable={strengthMetrics.squat.current === null}
                delta={<DeltaBadge current={strengthMetrics.squat.current} previous={strengthMetrics.squat.previous} kind="higher-better" suffix="kg" />}
                sub={
                  strengthMetrics.squat.previous !== null
                    ? `was ${strengthMetrics.squat.previous}kg`
                    : strengthMetrics.squat.current !== null
                      ? FIRST_BENCHMARK_LABEL
                      : undefined
                }
              />
            )}

            {prefs.showBenchE1RM && (
              <StatCard
                title="Bench e1RM"
                icon={<Dumbbell className="w-4 h-4" />}
                value={strengthMetrics.bench.current !== null ? `${strengthMetrics.bench.current}kg` : getLiftEmptyState("bench")}
                unavailable={strengthMetrics.bench.current === null}
                delta={<DeltaBadge current={strengthMetrics.bench.current} previous={strengthMetrics.bench.previous} kind="higher-better" suffix="kg" />}
                sub={
                  strengthMetrics.bench.previous !== null
                    ? `was ${strengthMetrics.bench.previous}kg`
                    : strengthMetrics.bench.current !== null
                      ? FIRST_BENCHMARK_LABEL
                      : undefined
                }
              />
            )}

            {prefs.showDeadliftE1RM && (
              <StatCard
                title="Deadlift e1RM"
                icon={<Dumbbell className="w-4 h-4" />}
                value={strengthMetrics.deadlift.current !== null ? `${strengthMetrics.deadlift.current}kg` : getLiftEmptyState("deadlift")}
                unavailable={strengthMetrics.deadlift.current === null}
                delta={<DeltaBadge current={strengthMetrics.deadlift.current} previous={strengthMetrics.deadlift.previous} kind="higher-better" suffix="kg" />}
                sub={
                  strengthMetrics.deadlift.previous !== null
                    ? `was ${strengthMetrics.deadlift.previous}kg`
                    : strengthMetrics.deadlift.current !== null
                      ? FIRST_BENCHMARK_LABEL
                      : undefined
                }
              />
            )}
          </div>
        </section>
      )}

      {/* ── 5. Secondary metrics ─────────────────────────────── */}
      {(prefs.showDistanceRun || prefs.showVolumeLifted) && (
        <section>
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase mb-2.5">This Week</h2>
          <div className="grid grid-cols-2 gap-3">

            {prefs.showDistanceRun && (
              <StatCard
                title="Distance Run"
                icon={<Footprints className="w-4 h-4" />}
                value={thisWeekData?.totalDistance ? fmtDist(thisWeekData.totalDistance) : "—"}
                delta={
                  <DeltaBadge
                    current={thisWeekData?.totalDistance ?? null}
                    previous={lastWeekData?.totalDistance ?? null}
                    kind="higher-better"
                    formatter={n => fmtDist(n)}
                  />
                }
                sub={lastWeekData?.totalDistance ? `${fmtDist(lastWeekData.totalDistance)} last wk` : undefined}
              />
            )}

            {prefs.showVolumeLifted && (
              <StatCard
                title="Volume Lifted"
                icon={<TrendingUp className="w-4 h-4" />}
                value={thisWeekData?.totalVolume ? fmtVol(thisWeekData.totalVolume) : "—"}
                delta={
                  <DeltaBadge
                    current={thisWeekData?.totalVolume ?? null}
                    previous={lastWeekData?.totalVolume ?? null}
                    kind="higher-better"
                    formatter={n => fmtVol(n)}
                  />
                }
                sub={lastWeekData?.totalVolume ? `${fmtVol(lastWeekData.totalVolume)} last wk` : undefined}
              />
            )}
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

      {/* ── 6. Edit Dashboard button ─────────────────────────── */}
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
      />

      {/* ── Preferences sheet ────────────────────────────────── */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-left text-base">Customise Dashboard</SheetTitle>
          </SheetHeader>

          <div className="space-y-0 divide-y">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2">Fitness Score</p>
            <PrefRow label="Show explanation line" checked={prefs.showFitnessExplanation} onToggle={() => toggle("showFitnessExplanation")} />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Cards</p>
            <PrefRow label="Weekly Win"     checked={prefs.showWeeklyWin}    onToggle={() => toggle("showWeeklyWin")}    />
            <PrefRow label="Consistency"    checked={prefs.showConsistency}  onToggle={() => toggle("showConsistency")}  />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Performance</p>
            <PrefRow label="Estimated 5K"   checked={prefs.showEstimated5K}  onToggle={() => toggle("showEstimated5K")}  />
            <PrefRow label="Squat e1RM"     checked={prefs.showSquatE1RM}    onToggle={() => toggle("showSquatE1RM")}    />
            <PrefRow label="Bench e1RM"     checked={prefs.showBenchE1RM}    onToggle={() => toggle("showBenchE1RM")}    />
            <PrefRow label="Deadlift e1RM"  checked={prefs.showDeadliftE1RM} onToggle={() => toggle("showDeadliftE1RM")} />

            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pb-2 pt-4">Metrics</p>
            <PrefRow label="Distance Run"   checked={prefs.showDistanceRun}  onToggle={() => toggle("showDistanceRun")}  />
            <PrefRow label="Volume Lifted"  checked={prefs.showVolumeLifted} onToggle={() => toggle("showVolumeLifted")} />
          </div>

          <Button className="w-full mt-6" onClick={() => setEditOpen(false)}>Done</Button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
