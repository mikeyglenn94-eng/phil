import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, programmesTable, clientGoalsTable, clientBaselinesTable } from "@workspace/db";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════════════════
// DATE UTILITIES
// ═══════════════════════════════════════════════════════════════════

function weekStartMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getTime() + diff * 86_400_000).toISOString().slice(0, 10);
}

function weekEndSunday(weekStartStr: string): string {
  const d = new Date(weekStartStr + "T00:00:00Z");
  return new Date(d.getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
}

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function offsetWeek(weekStartStr: string, offsetWeeks: number): string {
  const d = new Date(weekStartStr + "T00:00:00Z");
  return new Date(d.getTime() + offsetWeeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════
// PACE / TIME UTILITIES
// ═══════════════════════════════════════════════════════════════════

function paceToSeconds(pace: string): number | null {
  const s = pace.trim();
  // MM:SS  e.g. "4:30"
  const mmss = s.match(/^(\d+):(\d{2})$/);
  if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
  // Bare whole minutes e.g. "4"
  const wholeMin = s.match(/^(\d+)$/);
  if (wholeMin) return parseInt(wholeMin[1], 10) * 60;
  // Decimal minutes e.g. "4.5"
  const decMin = s.match(/^(\d+\.\d+)$/);
  if (decMin) return Math.round(parseFloat(decMin[1]) * 60);
  return null;
}

function secondsToPace(secs: number): string {
  const mins = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${mins}:${s.toString().padStart(2, "0")}`;
}

function formatMMSS(totalSecs: number): string {
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Riegel: t2 = t1 × (d2 / d1)^1.06
function estimateTo5KSeconds(paceSecsPerKm: number, distanceKm: number): number {
  return paceSecsPerKm * distanceKm * Math.pow(5 / distanceKm, 1.06);
}

// ═══════════════════════════════════════════════════════════════════
// STRENGTH UTILITIES
// ═══════════════════════════════════════════════════════════════════

function epley1RM(weight: number, reps: number): number {
  if (reps < 1 || reps > 10 || weight <= 0) return 0;
  return Math.round(weight * (1 + reps / 30));
}

const SQUAT_INCLUDE    = ["squat"];
const BENCH_INCLUDE    = ["bench"];
const DEADLIFT_INCLUDE = ["deadlift"];
const DEADLIFT_EXCLUDE = ["romanian", " rdl", "stiff leg", "stiff-leg"];

function nameMatches(name: string, inc: string[], exc: string[] = []): boolean {
  const l = name.toLowerCase();
  if (exc.some(e => l.includes(e))) return false;
  return inc.some(p => l.includes(p));
}

interface ExSet { weight: number | null; reps: number | null }
interface ExData { name: string; sets: ExSet[] }

function bestE1RM(exercises: ExData[], inc: string[], exc: string[] = []): number | null {
  let best: number | null = null;
  for (const ex of exercises) {
    if (!nameMatches(ex.name, inc, exc)) continue;
    for (const s of ex.sets) {
      if (!s.weight || !s.reps || s.reps < 1 || s.reps > 10 || s.weight <= 0) continue;
      const e = epley1RM(s.weight, s.reps);
      if (e > 0 && (best === null || e > best)) best = e;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════
// SESSION STATS
// ═══════════════════════════════════════════════════════════════════

export interface SessionStat {
  sessionId: string;
  date: string;
  name: string;
  source: string | null;
  totalVolume: number;
  totalReps: number;
  totalDistance: number;
  weightedPaceSeconds: number;
  avgPace: string | null;
  intervalCount: number;
  exerciseBreakdown: ExData[];
}

function isLogged(s: any): boolean {
  const hasStrength = (s.exercises ?? []).some((ex: any) =>
    (ex.setReps ?? []).some((r: any) => r !== null) ||
    (ex.setWeights ?? []).some((w: any) => w !== null)
  );
  // runLog with at least one entry = detailed run logged
  const hasRun = ((s.runLog ?? []) as any[]).length > 0;
  // runSurface is only persisted when the client opens and saves a run session,
  // so its presence (any value) proves the session was completed and saved
  const hasRunSurface = s.runSurface != null;
  const hasComment = !!(s.clientComment);
  // WOD sessions log results into wodResult (rounds, reps, time, score, completed)
  const hasWodResult = s.wodResult != null &&
    Object.values(s.wodResult as Record<string, unknown>).some(
      v => v !== null && v !== undefined && v !== ""
    );
  return hasStrength || hasRun || hasRunSurface || hasComment || hasWodResult;
}

function computeStats(session: any): SessionStat {
  const source: string | null = session.source ?? null;
  const isRun = source === "run_brain" || source === "endurance_cycle";

  let totalVolume = 0, totalReps = 0;
  const exerciseBreakdown: ExData[] = [];

  for (const ex of session.exercises ?? []) {
    const rawWeights: unknown[] = ex.setWeights ?? [];
    const rawReps:    unknown[] = ex.setReps    ?? [];
    // Parse defensively — JSONB can return numbers or numeric strings
    const parseNum = (v: unknown): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return isNaN(n) ? null : n;
    };
    const setWeights: (number | null)[] = rawWeights.map(parseNum);
    const setReps:    (number | null)[] = rawReps.map(parseNum);
    const count = Math.max(setWeights.length, setReps.length);
    const sets: ExSet[] = [];
    for (let i = 0; i < count; i++) {
      const w = setWeights[i] ?? null;
      const r = setReps[i]    ?? null;
      if (r !== null) { totalReps += r; }
      if (r !== null && w !== null) { totalVolume += w * r; }
      sets.push({ weight: w, reps: r });
    }
    if (count > 0) exerciseBreakdown.push({ name: ex.name, sets });
  }

  let totalDistance = 0, weightedPaceSeconds = 0, intervalCount = 0;
  if (isRun) {
    for (const iv of (session.runLog ?? []) as any[]) {
      // distance may be stored as a number or as a string ("9.57" / "10 km") — parse defensively
      const rawDist = iv.distance;
      const dist: number | null = rawDist == null
        ? null
        : typeof rawDist === "number"
          ? rawDist
          : (() => { const n = parseFloat(String(rawDist)); return isNaN(n) ? null : n; })();
      const ps = iv.pace ? paceToSeconds(iv.pace) : null;
      if (dist != null && dist > 0) {
        totalDistance += dist;
        intervalCount++;
        if (ps !== null) weightedPaceSeconds += ps * dist;
      }
    }
  }

  return {
    sessionId: session.id,
    date: session.date,
    name: session.name ?? "Session",
    source,
    totalVolume,
    totalReps,
    totalDistance,
    weightedPaceSeconds,
    avgPace: totalDistance > 0 ? secondsToPace(weightedPaceSeconds / totalDistance) : null,
    intervalCount,
    exerciseBreakdown,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PERFORMANCE METRICS
// ═══════════════════════════════════════════════════════════════════

function strengthInPeriod(sessions: SessionStat[], from: string, to: string) {
  const exs = sessions
    .filter(s => s.date >= from && s.date <= to)
    .flatMap(s => s.exerciseBreakdown);
  return {
    squat:    bestE1RM(exs, SQUAT_INCLUDE),
    bench:    bestE1RM(exs, BENCH_INCLUDE),
    deadlift: bestE1RM(exs, DEADLIFT_INCLUDE, DEADLIFT_EXCLUDE),
  };
}

function estimated5KInPeriod(sessions: SessionStat[], from: string, to: string): string | null {
  let best: number | null = null;
  for (const s of sessions) {
    if (s.date < from || s.date > to || s.totalDistance < 3 || !s.avgPace) continue;
    const ps = paceToSeconds(s.avgPace);
    if (!ps || ps < 180 || ps > 480) continue; // 3:00–8:00 min/km only
    const est = estimateTo5KSeconds(ps, s.totalDistance);
    if (best === null || est < best) best = est;
  }
  return best !== null ? formatMMSS(best) : null;
}

// ═══════════════════════════════════════════════════════════════════
// WEEK BUCKETS
// ═══════════════════════════════════════════════════════════════════

interface WeekBucket {
  weekStart: string;
  planned: number;
  completed: number;
  hasLift: boolean;
  hasRun: boolean;
  totalVolume: number;
  totalDistance: number;
}

// ═══════════════════════════════════════════════════════════════════
// FITNESS SCORE
// ═══════════════════════════════════════════════════════════════════

function computeRawScore(
  bucket: WeekBucket,
  perfTrend: number,
  balance: number
): number {
  const planned = Math.max(bucket.planned, 1);
  const ratio   = Math.min(bucket.completed / planned, 1);

  let consistency: number;
  if      (ratio >= 1.00) consistency = 95;
  else if (ratio >= 0.75) consistency = 75;
  else if (ratio >= 0.50) consistency = 50;
  else if (ratio >  0)    consistency = 30;
  else                    consistency = 10;

  if (bucket.hasLift && bucket.hasRun) consistency = Math.min(consistency + 10, 100);

  return Math.round(consistency * 0.40 + perfTrend * 0.35 + balance * 0.25);
}

function goalWeightsFromTargets(parsedGoals: any[]): { squat: number; bench: number; deadlift: number; running: number } {
  const raw = { squat: 0, bench: 0, deadlift: 0, running: 0 };
  for (const goal of parsedGoals) {
    if (!goal?.parsedTargets) continue;
    const w = goal.priority === "primary" ? 2 : 1;
    for (const t of (goal.parsedTargets as any[])) {
      if (t.metric === "squat_e1rm")    raw.squat    += w;
      if (t.metric === "bench_e1rm")    raw.bench    += w;
      if (t.metric === "deadlift_e1rm") raw.deadlift += w;
      if (t.metric === "5k" || t.metric === "half_marathon" || t.metric === "10k" || t.metric === "marathon") raw.running += w;
    }
  }
  const total = raw.squat + raw.bench + raw.deadlift + raw.running;
  if (total === 0) return { squat: 0.25, bench: 0.25, deadlift: 0.25, running: 0.25 };
  return {
    squat:    raw.squat    / total,
    bench:    raw.bench    / total,
    deadlift: raw.deadlift / total,
    running:  raw.running  / total,
  };
}

function computePerfTrendScore(
  curr: { squat: number | null; bench: number | null; deadlift: number | null; est5K: string | null },
  prev: { squat: number | null; bench: number | null; deadlift: number | null; est5K: string | null },
  weights?: { squat: number; bench: number; deadlift: number; running: number }
): number {
  let score = 50;

  const w = weights ?? { squat: 0.25, bench: 0.25, deadlift: 0.25, running: 0.25 };

  const liftDelta = (c: number | null, p: number | null): number | null => {
    if (c === null || p === null || p === 0) return null;
    return (c - p) / p;
  };
  const timeDelta = (c: string | null, p: string | null): number | null => {
    if (!c || !p) return null;
    const cs = paceToSeconds(c), ps = paceToSeconds(p);
    if (!cs || !ps || ps === 0) return null;
    return (ps - cs) / ps; // positive = faster = better
  };

  // Scale contribution by weight relative to equal (0.25 baseline = multiplier 1.0)
  const entries: [number | null, number][] = [
    [liftDelta(curr.squat,    prev.squat),    w.squat],
    [liftDelta(curr.bench,    prev.bench),    w.bench],
    [liftDelta(curr.deadlift, prev.deadlift), w.deadlift],
    [timeDelta(curr.est5K,    prev.est5K),    w.running],
  ];

  for (const [d, mw] of entries) {
    if (d === null) continue;
    const scale = mw * 4; // 0.25 baseline × 4 = 1.0 multiplier
    if      (d >  0.05) score += Math.round(15 * scale);
    else if (d >  0.02) score += Math.round( 8 * scale);
    else if (d >  0)    score += Math.round( 3 * scale);
    else if (d > -0.02) score -= Math.round( 3 * scale);
    else if (d > -0.05) score -= Math.round( 8 * scale);
    else                score -= Math.round(15 * scale);
  }

  return Math.max(0, Math.min(100, score));
}

function computeBalanceScore(bucket: WeekBucket, recentAvgSessions: number): number {
  let score = 50;

  const ratio = recentAvgSessions > 0 ? bucket.completed / recentAvgSessions : 1;
  if      (ratio >= 1)    score += 15;
  else if (ratio >= 0.75) score += 5;
  else if (ratio <  0.5)  score -= 15;
  else                    score -= 5;

  if      (bucket.hasLift && bucket.hasRun) score += 15;
  else if (bucket.hasLift || bucket.hasRun) score += 5;
  else                                      score -= 15;

  return Math.max(0, Math.min(100, score));
}

function smoothScores(raws: number[]): number[] {
  if (!raws.length) return [];
  const out = [raws[0]];
  for (let i = 1; i < raws.length; i++) {
    out.push(Math.round(0.6 * out[i - 1] + 0.4 * raws[i]));
  }
  return out;
}

function cappedChange(current: number, previous: number): number {
  const d = current - previous;
  if (d >  8) return  8;
  if (d < -5) return -5;
  return d;
}

// ═══════════════════════════════════════════════════════════════════
// ADHERENCE STREAK
// ═══════════════════════════════════════════════════════════════════

function computeStreak(bucketMap: Map<string, WeekBucket>, today: string): number {
  let streak = 0;
  let wk = weekStartMonday(today);
  for (let i = 0; i < 52; i++) {
    const b = bucketMap.get(wk);
    if (!b || b.planned === 0) {
      if (i === 0) { wk = offsetWeek(wk, -1); continue; } // skip empty current week
      break;
    }
    if (b.completed / b.planned >= 0.75) streak++;
    else break;
    wk = offsetWeek(wk, -1);
  }
  return streak;
}

// ═══════════════════════════════════════════════════════════════════
// WEEKLY WIN
// ═══════════════════════════════════════════════════════════════════

function generateWeeklyWin(
  thisWeek: WeekBucket | undefined,
  strengthCurr: { squat: number | null; bench: number | null; deadlift: number | null },
  strengthPrev: { squat: number | null; bench: number | null; deadlift: number | null },
  est5KCurr: string | null,
  est5KPrev: string | null,
  streak: number
): string {
  // 1. Full adherence + streak
  if (thisWeek && thisWeek.planned > 0 && thisWeek.completed >= thisWeek.planned) {
    if (streak >= 4) return `${streak}-week streak — every session completed`;
    if (streak >= 2) return `${streak} weeks in a row with full adherence`;
    return "Completed every planned session this week";
  }

  // 2. Lift PRs
  const lifts: [string, number | null, number | null][] = [
    ["Squat",    strengthCurr.squat,    strengthPrev.squat],
    ["Bench",    strengthCurr.bench,    strengthPrev.bench],
    ["Deadlift", strengthCurr.deadlift, strengthPrev.deadlift],
  ];
  for (const [name, curr, prev] of lifts) {
    if (curr !== null && prev !== null && curr > prev) {
      return `${name} e1RM up ${curr - prev}kg to ${curr}kg`;
    }
  }

  // 3. Running improvement
  if (est5KCurr && est5KPrev) {
    const cs = paceToSeconds(est5KCurr), ps = paceToSeconds(est5KPrev);
    if (cs && ps && cs < ps) {
      return `Estimated 5K improved by ${ps - cs}s`;
    }
  }

  // 4. Streak alone
  if (streak >= 3) return `${streak}-week training streak maintained`;

  // 5. Something completed
  if (thisWeek && thisWeek.completed > 0) return "Consistent week completed";

  return "Baseline maintained this week";
}

// ═══════════════════════════════════════════════════════════════════
// ROUTE
// ═══════════════════════════════════════════════════════════════════

router.get("/clients/:clientId/analytics", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }

  const programmes = await db
    .select()
    .from(programmesTable)
    .where(eq(programmesTable.clientId, clientId));

  const today = todayStr();

  // All sessions (for planned counts)
  const allSessions: any[] = [];
  for (const prog of programmes) {
    for (const s of (prog.sessions as any[]) ?? []) {
      allSessions.push(s);
    }
  }

  // Logged sessions (for performance data)
  const loggedRaw = allSessions.filter(s => s.date && s.date <= today && isLogged(s));
  loggedRaw.sort((a, b) => a.date.localeCompare(b.date));
  const sessions = loggedRaw.map(computeStats);

  // ── Week buckets (planned + completed) ──────────────────────────

  const bucketMap = new Map<string, WeekBucket>();
  const getBucket = (wk: string): WeekBucket => {
    if (!bucketMap.has(wk)) {
      bucketMap.set(wk, { weekStart: wk, planned: 0, completed: 0, hasLift: false, hasRun: false, totalVolume: 0, totalDistance: 0 });
    }
    return bucketMap.get(wk)!;
  };

  for (const s of allSessions) {
    if (!s.date || s.date > today) continue;
    getBucket(weekStartMonday(s.date)).planned++;
  }
  for (const s of sessions) {
    const b = getBucket(weekStartMonday(s.date));
    b.completed++;
    b.totalVolume   += s.totalVolume;
    b.totalDistance += s.totalDistance;
    if (s.totalVolume > 0 || s.totalReps > 0) b.hasLift = true;
    // Count as a run week if distance logged OR it's a run-type session (even if intervals weren't detailed)
    if (s.totalDistance > 0 || s.source === "run_brain" || s.source === "endurance_cycle") b.hasRun = true;
  }

  // ── byWeek ──────────────────────────────────────────────────────

  const weekMap = new Map<string, {
    weekStart: string; totalVolume: number; totalReps: number;
    totalDistance: number; weightedPaceSeconds: number;
    sessionCount: number; strengthSessions: number; runSessions: number;
    plannedCount: number; completedCount: number;
  }>();

  for (const s of sessions) {
    const wk = weekStartMonday(s.date);
    if (!weekMap.has(wk)) {
      const b = bucketMap.get(wk);
      weekMap.set(wk, {
        weekStart: wk, totalVolume: 0, totalReps: 0, totalDistance: 0,
        weightedPaceSeconds: 0, sessionCount: 0, strengthSessions: 0, runSessions: 0,
        plannedCount: b?.planned ?? 0, completedCount: b?.completed ?? 0,
      });
    }
    const w = weekMap.get(wk)!;
    w.totalVolume        += s.totalVolume;
    w.totalReps          += s.totalReps;
    w.totalDistance      += s.totalDistance;
    w.weightedPaceSeconds+= s.weightedPaceSeconds;
    w.sessionCount++;
    if (s.totalDistance > 0) w.runSessions++;
    if (s.totalVolume > 0 || s.totalReps > 0) w.strengthSessions++;
  }

  // Ensure this week always appears
  const thisWk = weekStartMonday(today);
  if (!weekMap.has(thisWk)) {
    const b = bucketMap.get(thisWk);
    weekMap.set(thisWk, {
      weekStart: thisWk, totalVolume: 0, totalReps: 0, totalDistance: 0,
      weightedPaceSeconds: 0, sessionCount: 0, strengthSessions: 0, runSessions: 0,
      plannedCount: b?.planned ?? 0, completedCount: 0,
    });
  }

  const byWeek = Array.from(weekMap.values())
    .map(w => ({ ...w, avgPace: w.totalDistance > 0 ? secondsToPace(w.weightedPaceSeconds / w.totalDistance) : null }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ── byMonth ─────────────────────────────────────────────────────

  const monthMap = new Map<string, {
    month: string; totalVolume: number; totalReps: number;
    totalDistance: number; weightedPaceSeconds: number;
    sessionCount: number; strengthSessions: number; runSessions: number;
  }>();

  for (const s of sessions) {
    const mo = monthOf(s.date);
    if (!monthMap.has(mo)) {
      monthMap.set(mo, { month: mo, totalVolume: 0, totalReps: 0, totalDistance: 0, weightedPaceSeconds: 0, sessionCount: 0, strengthSessions: 0, runSessions: 0 });
    }
    const m = monthMap.get(mo)!;
    m.totalVolume        += s.totalVolume;
    m.totalReps          += s.totalReps;
    m.totalDistance      += s.totalDistance;
    m.weightedPaceSeconds+= s.weightedPaceSeconds;
    m.sessionCount++;
    if (s.totalDistance > 0) m.runSessions++;
    if (s.totalVolume > 0 || s.totalReps > 0) m.strengthSessions++;
  }

  const byMonth = Array.from(monthMap.values())
    .map(m => ({ ...m, avgPace: m.totalDistance > 0 ? secondsToPace(m.weightedPaceSeconds / m.totalDistance) : null }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ── Performance metrics (current 4wk vs previous 4wk) ──────────

  const curr4wkStart = offsetWeek(thisWk, -3);
  const curr4wkEnd   = weekEndSunday(thisWk);
  const prev4wkStart = offsetWeek(thisWk, -7);
  const prev4wkEnd   = weekEndSunday(offsetWeek(thisWk, -4));

  const strengthCurr = strengthInPeriod(sessions, curr4wkStart, curr4wkEnd);
  const strengthPrev = strengthInPeriod(sessions, prev4wkStart, prev4wkEnd);
  const est5KCurr    = estimated5KInPeriod(sessions, curr4wkStart, curr4wkEnd);
  const est5KPrev    = estimated5KInPeriod(sessions, prev4wkStart, prev4wkEnd);

  // ── Fitness score (rolling 12 weeks with smoothing) ─────────────

  const LOOKBACK = 12;
  const recentWeeks = Array.from({ length: LOOKBACK }, (_, i) => offsetWeek(thisWk, -(LOOKBACK - 1) + i));

  const recentCompletedAvg = recentWeeks.slice(0, LOOKBACK - 1)
    .map(wk => bucketMap.get(wk)?.completed ?? 0)
    .reduce((a, b) => a + b, 0) / (LOOKBACK - 1);

  const clientGoals = await db.select().from(clientGoalsTable).where(eq(clientGoalsTable.clientId, clientId));
  const goalWeights = goalWeightsFromTargets(clientGoals);

  // Fetch manual baselines — used as fallback when no logged session data exists yet
  const baselinesRows = await db.select().from(clientBaselinesTable).where(eq(clientBaselinesTable.clientId, clientId));
  const manualBaselines = baselinesRows[0] ?? null;

  const parseNumeric = (v: string | number | null | undefined): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? null : n;
  };

  // Use manual baselines as fallback for performance trend when no logged sessions yet
  const effectiveCurrStrength = {
    squat:    strengthCurr.squat    ?? parseNumeric(manualBaselines?.squatKg),
    bench:    strengthCurr.bench    ?? parseNumeric(manualBaselines?.benchKg),
    deadlift: strengthCurr.deadlift ?? parseNumeric(manualBaselines?.deadliftKg),
  };
  const effectiveCurrEst5K = est5KCurr ?? (manualBaselines?.fiveKSeconds != null ? formatMMSS(manualBaselines.fiveKSeconds) : null);

  const perfTrend = computePerfTrendScore(
    { ...effectiveCurrStrength, est5K: effectiveCurrEst5K },
    { ...strengthPrev, est5K: est5KPrev },
    goalWeights
  );

  // Auto-reconcile: if logged data beats manual baselines, update them (fire-and-forget)
  if (manualBaselines) {
    const updates: Record<string, unknown> = {};
    const storedBench    = parseNumeric(manualBaselines.benchKg);
    const storedSquat    = parseNumeric(manualBaselines.squatKg);
    const storedDeadlift = parseNumeric(manualBaselines.deadliftKg);
    if (strengthCurr.bench    != null && (storedBench    == null || strengthCurr.bench    > storedBench))    updates.benchKg    = String(strengthCurr.bench);
    if (strengthCurr.squat    != null && (storedSquat    == null || strengthCurr.squat    > storedSquat))    updates.squatKg    = String(strengthCurr.squat);
    if (strengthCurr.deadlift != null && (storedDeadlift == null || strengthCurr.deadlift > storedDeadlift)) updates.deadliftKg = String(strengthCurr.deadlift);
    if (est5KCurr) {
      const est5KSecs = paceToSeconds(est5KCurr);
      if (est5KSecs && (manualBaselines.fiveKSeconds == null || est5KSecs < manualBaselines.fiveKSeconds)) {
        updates.fiveKSeconds = est5KSecs;
      }
    }
    if (Object.keys(updates).length > 0) {
      updates.setManually = false;
      updates.setAt = new Date();
      db.update(clientBaselinesTable).set(updates).where(eq(clientBaselinesTable.clientId, clientId)).catch(() => {});
    }
  }

  const rawScores = recentWeeks.map(wk => {
    const b = bucketMap.get(wk) ?? { weekStart: wk, planned: 0, completed: 0, hasLift: false, hasRun: false, totalVolume: 0, totalDistance: 0 };
    return computeRawScore(b, perfTrend, computeBalanceScore(b, recentCompletedAvg));
  });

  const smoothed = smoothScores(rawScores);
  const currentScore   = smoothed[smoothed.length - 1] ?? 50;
  const prevWeekScore  = smoothed.length >= 2 ? smoothed[smoothed.length - 2] : null;
  const scoreChange    = prevWeekScore !== null ? cappedChange(currentScore, prevWeekScore) : null;
  const prevMonthScore = smoothed.length >= 5 ? smoothed[smoothed.length - 5] : null;
  const monthlyChange  = prevMonthScore !== null ? cappedChange(currentScore, prevMonthScore) : null;

  // ── Score explanation ────────────────────────────────────────────

  const thisWeekBucket = bucketMap.get(thisWk);

  function explainScore(): string {
    const b = thisWeekBucket;
    if (!b || b.completed === 0) return "No sessions logged yet this week";
    if (b.planned > 0 && b.completed < b.planned * 0.5) return "Held back by missed sessions this week";
    if (scoreChange !== null && scoreChange >= 3) {
      if (b.hasLift && b.hasRun) return "Driven by full consistency and balanced training";
      if (b.planned > 0 && b.completed >= b.planned) return "Driven by full adherence this week";
      return "Good training week across the board";
    }
    if (scoreChange !== null && scoreChange <= -3) {
      if (b.planned > 0 && b.completed < b.planned) return "Held back by missed sessions this week";
      return "Slight dip — keep going";
    }
    return "Steady training maintained";
  }

  // ── Adherence ───────────────────────────────────────────────────

  const streak       = computeStreak(bucketMap, today);
  const bothMod      = (thisWeekBucket?.hasLift ?? false) && (thisWeekBucket?.hasRun ?? false);
  const thisCompleted = thisWeekBucket?.completed ?? 0;
  const thisPlanned   = thisWeekBucket?.planned   ?? 0;

  let adherenceStatus: string;
  if (thisPlanned > 0) {
    if (thisCompleted >= thisPlanned) {
      adherenceStatus = bothMod ? "All sessions completed · Lift + Run" : "All planned sessions completed";
    } else {
      const remaining = thisPlanned - thisCompleted;
      adherenceStatus = `${remaining} planned session${remaining > 1 ? "s" : ""} remaining`;
    }
  } else if (thisCompleted > 0) {
    adherenceStatus = `${thisCompleted} session${thisCompleted > 1 ? "s" : ""} logged this week`;
  } else {
    adherenceStatus = "No sessions logged yet this week";
  }

  // ── Weekly win ───────────────────────────────────────────────────

  const weeklyWin = generateWeeklyWin(
    thisWeekBucket,
    strengthCurr, strengthPrev,
    est5KCurr, est5KPrev,
    streak
  );

  // ── Response ─────────────────────────────────────────────────────

  res.json({
    sessions,
    byWeek,
    byMonth,
    fitnessScore: {
      current:      currentScore,
      previousWeek: prevWeekScore,
      change:       scoreChange,
      monthlyChange,
      explanation:  explainScore(),
    },
    weeklyWin,
    adherence: {
      thisWeek: { completed: thisCompleted, planned: thisPlanned },
      streak,
      bothModalities: bothMod,
      status: adherenceStatus,
    },
    strengthMetrics: {
      squat:    { current: strengthCurr.squat,    previous: strengthPrev.squat    },
      bench:    { current: strengthCurr.bench,    previous: strengthPrev.bench    },
      deadlift: { current: strengthCurr.deadlift, previous: strengthPrev.deadlift },
    },
    runMetrics: {
      estimated5K: { current: est5KCurr, previous: est5KPrev },
    },
    baselines: manualBaselines ? {
      benchKg:             parseNumeric(manualBaselines.benchKg),
      squatKg:             parseNumeric(manualBaselines.squatKg),
      deadliftKg:          parseNumeric(manualBaselines.deadliftKg),
      fiveKSeconds:        manualBaselines.fiveKSeconds,
      tenKSeconds:         manualBaselines.tenKSeconds,
      halfMarathonSeconds: manualBaselines.halfMarathonSeconds,
      marathonSeconds:     manualBaselines.marathonSeconds,
      setManually:         manualBaselines.setManually,
    } : null,
  });
});

export default router;
