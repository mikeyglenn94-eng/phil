import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, programmesTable } from "@workspace/db";
import type { Session, Exercise } from "@workspace/db";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function paceToSeconds(pace: string): number | null {
  const m = pace.trim().match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function secondsToPace(secs: number): string {
  const mins = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${mins}:${s.toString().padStart(2, "0")}`;
}

// ISO Monday of the week containing the given date string (yyyy-MM-dd)
function weekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun 1=Mon … 6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  const monday = new Date(d.getTime() + diff * 86400000);
  return monday.toISOString().slice(0, 10);
}

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // "2026-04"
}

interface SessionStats {
  sessionId: string;
  date: string;
  name: string;
  source: string | null;
  // Strength
  totalVolume: number;         // kg lifted (weight × reps summed)
  totalReps: number;           // total reps logged (including bodyweight)
  exerciseBreakdown: {
    name: string;
    sets: { reps: number | null; weight: number | null }[];
    volume: number;
    reps: number;
  }[];
  // Run
  totalDistance: number;       // km
  weightedPaceSeconds: number; // sum(pace_sec × distance) — divide by totalDistance for avg
  avgPace: string | null;      // "5:30" or null if no run data
  intervalCount: number;
}

function computeSessionStats(session: Session & { runLog?: { distance?: number | null; pace?: string | null }[] }): SessionStats {
  const source = (session as any).source as string | null ?? null;
  const isRun = source === "run_brain" || source === "endurance_cycle";

  // ── Strength volume ──
  let totalVolume = 0;
  let totalReps = 0;
  const exerciseBreakdown: SessionStats["exerciseBreakdown"] = [];

  for (const ex of session.exercises ?? []) {
    const setWeights = (ex as any).setWeights as (number | null)[] | undefined ?? [];
    const setReps = (ex as any).setReps as (number | null)[] | undefined ?? [];
    const count = Math.max(setWeights.length, setReps.length);
    let exVol = 0;
    let exReps = 0;
    const sets: { reps: number | null; weight: number | null }[] = [];
    for (let i = 0; i < count; i++) {
      const w = setWeights[i] ?? null;
      const r = setReps[i] ?? null;
      if (r !== null) {
        exReps += r;
        totalReps += r;
        if (w !== null) {
          exVol += w * r;
          totalVolume += w * r;
        }
      }
      sets.push({ reps: r, weight: w });
    }
    if (count > 0) {
      exerciseBreakdown.push({ name: ex.name, sets, volume: exVol, reps: exReps });
    }
  }

  // ── Run distance + pace ──
  let totalDistance = 0;
  let weightedPaceSeconds = 0;
  let intervalCount = 0;

  if (isRun) {
    const runLog = (session as any).runLog as { distance?: number | null; pace?: string | null }[] | undefined ?? [];
    for (const interval of runLog) {
      const dist = interval.distance ?? null;
      const paceStr = interval.pace ?? null;
      if (dist !== null && dist > 0) {
        totalDistance += dist;
        intervalCount++;
        if (paceStr) {
          const ps = paceToSeconds(paceStr);
          if (ps !== null) weightedPaceSeconds += ps * dist;
        }
      }
    }
  }

  const avgPace = totalDistance > 0
    ? secondsToPace(weightedPaceSeconds / totalDistance)
    : null;

  return {
    sessionId: session.id,
    date: session.date,
    name: session.name ?? "Session",
    source,
    totalVolume,
    totalReps,
    exerciseBreakdown,
    totalDistance,
    weightedPaceSeconds,
    avgPace,
    intervalCount,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/clients/:clientId/analytics", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  const programmes = await db
    .select()
    .from(programmesTable)
    .where(eq(programmesTable.clientId, clientId));

  // Collect all sessions across all programmes for this client
  const allSessions: (Session & { runLog?: any })[] = [];
  for (const prog of programmes) {
    for (const s of (prog.sessions as Session[]) ?? []) {
      allSessions.push(s as any);
    }
  }

  // Only include sessions in the past or today that have logged data
  const today = new Date().toISOString().slice(0, 10);
  const logged = allSessions.filter(s => {
    if (!s.date || s.date > today) return false;
    const hasStrength = (s.exercises ?? []).some(ex =>
      ((ex as any).setReps ?? []).some((r: any) => r !== null) ||
      ((ex as any).setWeights ?? []).some((w: any) => w !== null)
    );
    const hasRun = ((s as any).runLog ?? []).length > 0;
    const hasComment = !!(s as any).clientComment;
    return hasStrength || hasRun || hasComment;
  });

  // Sort chronologically
  logged.sort((a, b) => a.date.localeCompare(b.date));

  const sessions = logged.map(computeSessionStats);

  // ── By week ──
  const weekMap = new Map<string, {
    weekStart: string;
    totalVolume: number;
    totalReps: number;
    totalDistance: number;
    weightedPaceSeconds: number;
    sessionCount: number;
    strengthSessions: number;
    runSessions: number;
  }>();

  for (const s of sessions) {
    const wk = weekStart(s.date);
    if (!weekMap.has(wk)) {
      weekMap.set(wk, { weekStart: wk, totalVolume: 0, totalReps: 0, totalDistance: 0, weightedPaceSeconds: 0, sessionCount: 0, strengthSessions: 0, runSessions: 0 });
    }
    const w = weekMap.get(wk)!;
    w.totalVolume += s.totalVolume;
    w.totalReps += s.totalReps;
    w.totalDistance += s.totalDistance;
    w.weightedPaceSeconds += s.weightedPaceSeconds;
    w.sessionCount++;
    if (s.totalDistance > 0) w.runSessions++;
    if (s.totalVolume > 0 || s.totalReps > 0) w.strengthSessions++;
  }

  const byWeek = Array.from(weekMap.values()).map(w => ({
    ...w,
    avgPace: w.totalDistance > 0 ? secondsToPace(w.weightedPaceSeconds / w.totalDistance) : null,
  })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // ── By month ──
  const monthMap = new Map<string, {
    month: string;
    totalVolume: number;
    totalReps: number;
    totalDistance: number;
    weightedPaceSeconds: number;
    sessionCount: number;
    strengthSessions: number;
    runSessions: number;
  }>();

  for (const s of sessions) {
    const mo = monthOf(s.date);
    if (!monthMap.has(mo)) {
      monthMap.set(mo, { month: mo, totalVolume: 0, totalReps: 0, totalDistance: 0, weightedPaceSeconds: 0, sessionCount: 0, strengthSessions: 0, runSessions: 0 });
    }
    const m = monthMap.get(mo)!;
    m.totalVolume += s.totalVolume;
    m.totalReps += s.totalReps;
    m.totalDistance += s.totalDistance;
    m.weightedPaceSeconds += s.weightedPaceSeconds;
    m.sessionCount++;
    if (s.totalDistance > 0) m.runSessions++;
    if (s.totalVolume > 0 || s.totalReps > 0) m.strengthSessions++;
  }

  const byMonth = Array.from(monthMap.values()).map(m => ({
    ...m,
    avgPace: m.totalDistance > 0 ? secondsToPace(m.weightedPaceSeconds / m.totalDistance) : null,
  })).sort((a, b) => a.month.localeCompare(b.month));

  res.json({ sessions, byWeek, byMonth });
});

export default router;
