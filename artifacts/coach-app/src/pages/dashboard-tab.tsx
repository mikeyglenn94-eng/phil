import React, { useState, useEffect } from "react";
import {
  BarChart3, Trophy, CheckSquare, TrendingUp, Footprints,
  Timer, Dumbbell, SlidersHorizontal, ChevronDown, Sparkles,
  Share2, Download, Check, Loader2,
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

// ── Share helpers ─────────────────────────────────────────────────

const SHARE_STAT_OPTIONS = [
  { key: "fitnessScore", label: "Fitness Score" },
  { key: "squat",        label: "Squat e1RM" },
  { key: "bench",        label: "Bench e1RM" },
  { key: "deadlift",     label: "Deadlift e1RM" },
  { key: "est5K",        label: "Est. 5K" },
  { key: "distance",     label: "Distance" },
  { key: "pace",         label: "Pace" },
] as const;

type ShareStatKey = typeof SHARE_STAT_OPTIONS[number]["key"];

function parsePaceStr(pace: string): number | null {
  const m = pace.match(/^(\d+):(\d{2})$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : null;
}
function secsToMmss(secs: number): string {
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type StatDisplay = { label: string; primary: string; delta: string | null };

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
    const labelMap: Record<string, string> = { squat: "SQUAT E1RM", bench: "BENCH E1RM", deadlift: "DEADLIFT E1RM" };
    return { label: labelMap[key], primary: `${d.current}kg`, delta };
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

  // ── Empty state ───────────────────────────────────────────────────
  if (resolved.length === 0) {
    applyTextShadow();
    ctx.fillStyle = "rgba(255,255,255,0.32)";
    ctx.font      = "400 44px 'Inter', system-ui, sans-serif";
    ctx.fillText("Select stats to show on this card", cx, cy);
    clearShadow();
  } else {
    // ── Hero stat (first, typically Fitness Score) ─────────────────
    const [hero, ...rest] = resolved;

    // Label
    applyTextShadow();
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.font      = "600 32px 'Inter', system-ui, sans-serif";
    ctx.fillText(hero.label, cx, cy);
    clearShadow();
    cy += 6;

    // Hero value
    const heroFs = 196;
    applyTextShadow();
    ctx.font      = `900 ${heroFs}px 'Inter', system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(hero.primary, cx, cy + Math.round(heroFs * 1.15));
    const heroVw = ctx.measureText(hero.primary).width;

    // Hero delta (inline, right of value, vertically centred)
    if (hero.delta) {
      const pos = hero.delta.startsWith("+");
      ctx.font      = "700 52px 'Inter', system-ui, sans-serif";
      ctx.fillStyle = pos ? "rgba(134,239,172,0.94)" : "rgba(248,113,113,0.94)";
      ctx.fillText(hero.delta, cx + heroVw + 22, cy + Math.round(heroFs * 1.15) - 52);
    }
    clearShadow();
    cy += Math.round(heroFs * 1.15) + 48;

    // ── Supporting stats ──────────────────────────────────────────
    for (const s of rest) {
      // Label
      applyTextShadow();
      ctx.fillStyle = "rgba(255,255,255,0.58)";
      ctx.font      = "600 30px 'Inter', system-ui, sans-serif";
      ctx.fillText(s.label, cx, cy);
      clearShadow();
      cy += 6;

      // Value
      const vfs = 92;
      applyTextShadow();
      ctx.font      = `800 ${vfs}px 'Inter', system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.primary, cx, cy + Math.round(vfs * 1.15));
      const vw = ctx.measureText(s.primary).width;

      // Delta
      if (s.delta) {
        const pos = s.delta.startsWith("+");
        ctx.font      = `600 42px 'Inter', system-ui, sans-serif`;
        ctx.fillStyle = pos ? "rgba(134,239,172,0.94)" : "rgba(248,113,113,0.94)";
        ctx.fillText(s.delta, cx + vw + 18, cy + Math.round(vfs * 1.15) - 18);
      }
      clearShadow();
      cy += Math.round(vfs * 1.15) + 32;
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

export default function DashboardTab({ analytics, isLoading, clientId }: Props) {
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => loadPrefs(clientId));
  const [editOpen, setEditOpen] = useState(false);
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

  const toggle = (k: keyof DashboardPrefs) => setPrefs(p => ({ ...p, [k]: !p[k] }));

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
        await navigator.share({ files: [shareFile], title: "Axis Progress" });
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
