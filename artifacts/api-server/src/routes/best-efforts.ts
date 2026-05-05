/**
 * GET /clients/:clientId/best-efforts
 *
 * Returns the full list of Best Efforts for the client. Used by the
 * /best-efforts dedicated page. The dashboard widget uses the top-5
 * already bundled inside the /analytics response.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  programmesTable,
  clientOneRMsTable,
} from "@workspace/db";
import {
  computeBestEfforts,
  type BestEffort,
  type BestEffortsExercise,
  type BestEffortsRunInterval,
  type BestEffortsSessionInput,
  type ManualOneRm,
} from "../lib/best-efforts";

const router: IRouter = Router();

router.get("/clients/:clientId/best-efforts", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }

  const programmes = await db
    .select()
    .from(programmesTable)
    .where(eq(programmesTable.clientId, clientId));

  const allSessions: Array<Record<string, unknown>> = [];
  for (const prog of programmes) {
    for (const s of (prog.sessions as Array<Record<string, unknown>> | null) ?? []) {
      allSessions.push(s);
    }
  }

  const sessionsForBE: BestEffortsSessionInput[] = allSessions
    .filter((s): s is Record<string, unknown> => isLoggedSession(s))
    .map((s) => toBestEffortsInput(s));

  const oneRmRows = await db
    .select()
    .from(clientOneRMsTable)
    .where(eq(clientOneRMsTable.clientId, clientId));

  const manualOneRMs: ManualOneRm[] = oneRmRows.map((r) => ({
    exerciseName: r.exerciseName,
    weightKg: parseFloat(String(r.weightKg)),
    loggedAt: r.loggedAt,
  }));

  const list: BestEffort[] = computeBestEfforts(sessionsForBE, manualOneRMs);

  res.json({ bestEfforts: list });
});

// ── Helpers — mirror the SessionStat compute that lives in /analytics. ────

function isLoggedSession(s: Record<string, unknown>): boolean {
  const exercises = (s.exercises as Array<Record<string, unknown>> | undefined) ?? [];
  const hasStrength = exercises.some((ex) => {
    const setReps = (ex.setReps as Array<unknown> | undefined) ?? [];
    const setWeights = (ex.setWeights as Array<unknown> | undefined) ?? [];
    return setReps.some((r) => r !== null) || setWeights.some((w) => w !== null);
  });
  const runLog = (s.runLog as Array<unknown> | undefined) ?? [];
  return hasStrength || runLog.length > 0;
}

function toBestEffortsInput(s: Record<string, unknown>): BestEffortsSessionInput {
  const sessionId = String(s.id ?? "");
  const date = String(s.date ?? "");
  const source = (s.source as string | undefined) ?? null;
  const exercises = (s.exercises as Array<Record<string, unknown>> | undefined) ?? [];
  const runLog = (s.runLog as Array<Record<string, unknown>> | undefined) ?? [];

  let totalVolume = 0;
  let totalDistance = 0;
  let weightedPaceSeconds = 0;

  const exerciseBreakdown: BestEffortsExercise[] = exercises.map((ex) => {
    const name = String(ex.name ?? "");
    const setReps = (ex.setReps as Array<number | null> | undefined) ?? [];
    const setWeights = (ex.setWeights as Array<number | null> | undefined) ?? [];
    const sets = setReps.map((r, i) => ({
      reps: r ?? null,
      weight: setWeights[i] ?? null,
    }));
    for (const set of sets) {
      if (set.weight && set.reps) totalVolume += set.weight * set.reps;
    }
    return { name, sets };
  });

  const runIntervals: BestEffortsRunInterval[] = runLog.map((iv) => {
    const distance = typeof iv.distance === "number" ? iv.distance : null;
    const pace = typeof iv.pace === "string" ? iv.pace : null;
    if (distance != null && distance > 0) {
      totalDistance += distance;
      const ps = paceToSeconds(pace);
      if (ps != null) weightedPaceSeconds += ps * distance;
    }
    return { distance, pace };
  });

  const avgPace =
    totalDistance > 0
      ? secondsToPace(weightedPaceSeconds / totalDistance)
      : null;

  return {
    sessionId,
    date,
    source,
    totalVolume,
    totalDistance,
    weightedPaceSeconds,
    avgPace,
    exerciseBreakdown,
    runLog: runIntervals,
  };
}

function paceToSeconds(pace: string | null): number | null {
  if (!pace) return null;
  const s = pace.trim();
  const mmss = s.match(/^(\d+):(\d{2})$/);
  if (mmss) return parseInt(mmss[1] ?? "0", 10) * 60 + parseInt(mmss[2] ?? "0", 10);
  const wholeMin = s.match(/^(\d+)$/);
  if (wholeMin) return parseInt(wholeMin[1] ?? "0", 10) * 60;
  return null;
}

function secondsToPace(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default router;
