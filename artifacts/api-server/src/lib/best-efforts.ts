/**
 * Best Efforts compute.
 *
 * Lifting:
 *   - 1RM PBs per main lift, taken as the max of: stored client_one_rms entries
 *     and the best Epley estimate across logged sessions.
 *   - Rep PBs at 3, 5, 8, 10 reps per main lift — heaviest set at each rep count.
 *
 * Endurance:
 *   - Best time at standard distances (1k, 1mi, 5k, 10k, half, full marathon).
 *   - Prefer **actual** best efforts within logged runs: walk runLog intervals
 *     as a sliding window to find the fastest contiguous segment of the target
 *     distance.
 *   - Sessions without runLog detail get a whole-run fallback (avgPace × targetKm)
 *     when totalDistance >= targetKm.
 *   - Riegel-estimated PB is the LAST resort when no run is long enough — labelled
 *     so the UI can show "(estimated)".
 *
 *   TODO v2: when logged runs come with proper per-second GPS, re-implement the
 *   sliding window over those samples (currently only interval-level granularity).
 */

// ── Public types ───────────────────────────────────────────────────────────

export type LiftName = "bench" | "squat" | "deadlift" | "strict_press" | "front_squat" | "overhead_press";

export interface LiftBestEffort {
  kind: "lift";
  lift: LiftName;
  display: string;
  /** "1rm" | "5rm" | "8rm" etc — used by the UI to label the row. */
  recordType: string;
  /** kg lifted (or estimated 1RM for the e1RM record). */
  kg: number;
  reps: number;
  /** ISO date the record was set. */
  date: string;
  /** Source session id if known. Null for client_one_rms manual entries. */
  sessionId: string | null;
}

export type EnduranceDistance = "1km" | "1mi" | "5k" | "10k" | "half" | "marathon";

export interface EnduranceBestEffort {
  kind: "endurance";
  distance: EnduranceDistance;
  display: string;
  /** Total time in seconds. */
  seconds: number;
  /** Pace seconds per km. */
  paceSecondsPerKm: number;
  /** ISO date of the source session. */
  date: string;
  /** Source session id. */
  sessionId: string;
  /** True if the time was Riegel-estimated from a shorter run. */
  estimated: boolean;
}

export interface LongestEffort {
  kind: "longest";
  /** "run" | "cycle" | "swim" */
  sport: "run" | "cycle" | "swim";
  display: string;
  km: number;
  date: string;
  sessionId: string;
}

export type BestEffort = LiftBestEffort | EnduranceBestEffort | LongestEffort;

// ── Internal types — match the analytics SessionStat shape ─────────────────

export interface BestEffortsExSet {
  weight: number | null;
  reps: number | null;
}

export interface BestEffortsExercise {
  name: string;
  sets: BestEffortsExSet[];
}

export interface BestEffortsRunInterval {
  distance: number | null;
  pace: string | null;
}

export interface BestEffortsSessionInput {
  sessionId: string;
  date: string;
  source: string | null;
  totalVolume: number;
  totalDistance: number;
  /** Sum of paceSec × distance per interval — i.e. total run seconds. */
  weightedPaceSeconds: number;
  /** Average pace as "M:SS" — used for the runLog-absent fallback. */
  avgPace: string | null;
  exerciseBreakdown: BestEffortsExercise[];
  runLog: BestEffortsRunInterval[];
}

export interface ManualOneRm {
  exerciseName: string;
  weightKg: number;
  loggedAt: Date;
}

// ── Lifting matchers ───────────────────────────────────────────────────────

const LIFT_MATCHERS: Record<LiftName, { include: string[]; exclude: string[]; label: string }> = {
  bench: { include: ["bench"], exclude: [], label: "Bench Press" },
  squat: { include: ["squat"], exclude: ["front squat"], label: "Squat" },
  deadlift: { include: ["deadlift"], exclude: ["romanian", " rdl", "stiff leg", "stiff-leg", "trap bar"], label: "Deadlift" },
  strict_press: { include: ["strict press"], exclude: [], label: "Strict Press" },
  front_squat: { include: ["front squat"], exclude: [], label: "Front Squat" },
  overhead_press: { include: ["overhead press", "ohp"], exclude: [], label: "Overhead Press" },
};

function nameMatches(name: string, inc: string[], exc: string[]): boolean {
  const l = name.toLowerCase();
  if (exc.some((e) => l.includes(e))) return false;
  return inc.some((p) => l.includes(p));
}

function epley1RM(weight: number, reps: number): number {
  if (reps < 1 || reps > 10 || weight <= 0) return 0;
  return Math.round(weight * (1 + reps / 30));
}

// ── Lift best efforts ──────────────────────────────────────────────────────

const REP_PB_TARGETS = [3, 5, 8, 10] as const;

export function computeLiftBestEfforts(
  sessions: BestEffortsSessionInput[],
  manualOneRMs: ManualOneRm[],
): LiftBestEffort[] {
  const out: LiftBestEffort[] = [];

  for (const lift of Object.keys(LIFT_MATCHERS) as LiftName[]) {
    const cfg = LIFT_MATCHERS[lift];

    // Best e1RM (unbounded reps) — across logged sessions only.
    let bestE1rm: { e: number; date: string; sessionId: string; weight: number; reps: number } | null = null;
    // Per-rep-count heaviest set.
    const repPb = new Map<number, { weight: number; date: string; sessionId: string }>();

    for (const s of sessions) {
      for (const ex of s.exerciseBreakdown) {
        if (!nameMatches(ex.name, cfg.include, cfg.exclude)) continue;
        for (const set of ex.sets) {
          if (!set.weight || !set.reps || set.weight <= 0) continue;
          const reps = set.reps;
          const weight = set.weight;

          const e = epley1RM(weight, reps);
          if (e > 0 && (!bestE1rm || e > bestE1rm.e)) {
            bestE1rm = { e, date: s.date, sessionId: s.sessionId, weight, reps };
          }

          if ((REP_PB_TARGETS as readonly number[]).includes(reps)) {
            const existing = repPb.get(reps);
            if (!existing || weight > existing.weight) {
              repPb.set(reps, { weight, date: s.date, sessionId: s.sessionId });
            }
          }
        }
      }
    }

    // Manual one-RM entries take precedence if they exceed the session-derived e1RM.
    let manualBest: { kg: number; date: string } | null = null;
    for (const r of manualOneRMs) {
      if (!nameMatches(r.exerciseName, cfg.include, cfg.exclude)) continue;
      if (!manualBest || r.weightKg > manualBest.kg) {
        manualBest = { kg: r.weightKg, date: r.loggedAt.toISOString().slice(0, 10) };
      }
    }

    // Emit 1RM record — manual takes precedence if higher, else best e1RM.
    const sessionPbKg = bestE1rm?.e ?? null;
    if (manualBest != null && (sessionPbKg == null || manualBest.kg >= sessionPbKg)) {
      out.push({
        kind: "lift",
        lift,
        display: `${cfg.label} · 1RM ${manualBest.kg}kg`,
        recordType: "1rm",
        kg: manualBest.kg,
        reps: 1,
        date: manualBest.date,
        sessionId: null,
      });
    } else if (bestE1rm) {
      out.push({
        kind: "lift",
        lift,
        display: `${cfg.label} · ${bestE1rm.reps} reps @ ${bestE1rm.weight}kg`,
        recordType: "1rm",
        kg: bestE1rm.e,
        reps: bestE1rm.reps,
        date: bestE1rm.date,
        sessionId: bestE1rm.sessionId,
      });
    }

    // Rep-count PBs — only emit if at-or-above 8 reps stayed below the headline e1RM,
    // i.e. they're a *different* effort. Always emit so the user can see them.
    for (const reps of REP_PB_TARGETS) {
      const r = repPb.get(reps);
      if (!r) continue;
      out.push({
        kind: "lift",
        lift,
        display: `${cfg.label} · ${reps} reps @ ${r.weight}kg`,
        recordType: `${reps}rm`,
        kg: r.weight,
        reps,
        date: r.date,
        sessionId: r.sessionId,
      });
    }
  }

  return out;
}

// ── Endurance best efforts ─────────────────────────────────────────────────

const STANDARD_DISTANCES: { key: EnduranceDistance; km: number; label: string }[] = [
  { key: "1km", km: 1, label: "1 km" },
  { key: "1mi", km: 1.60934, label: "1 mile" },
  { key: "5k", km: 5, label: "5 km" },
  { key: "10k", km: 10, label: "10 km" },
  { key: "half", km: 21.0975, label: "Half Marathon" },
  { key: "marathon", km: 42.195, label: "Marathon" },
];

function paceToSeconds(pace: string | null): number | null {
  if (!pace) return null;
  const s = pace.trim();
  const mmss = s.match(/^(\d+):(\d{2})$/);
  if (mmss) return parseInt(mmss[1] ?? "0", 10) * 60 + parseInt(mmss[2] ?? "0", 10);
  const wholeMin = s.match(/^(\d+)$/);
  if (wholeMin) return parseInt(wholeMin[1] ?? "0", 10) * 60;
  const decMin = s.match(/^(\d+\.\d+)$/);
  if (decMin) return Math.round(parseFloat(decMin[1] ?? "0") * 60);
  return null;
}

function formatHmmss(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Walk the intervals as a sliding window. Returns the fastest contiguous
 *  block totalling >= targetKm, or null if no window reaches the target. */
function fastestSplit(
  intervals: { distance: number; paceSec: number }[],
  targetKm: number,
): number | null {
  if (intervals.length === 0) return null;
  let best: number | null = null;
  for (let i = 0; i < intervals.length; i++) {
    let dist = 0;
    let time = 0;
    for (let j = i; j < intervals.length; j++) {
      const iv = intervals[j];
      if (!iv) break;
      const remaining = targetKm - dist;
      if (iv.distance >= remaining) {
        time += iv.paceSec * remaining;
        if (best === null || time < best) best = time;
        break;
      }
      dist += iv.distance;
      time += iv.distance * iv.paceSec;
    }
  }
  return best;
}

/** Riegel: t2 = t1 × (d2/d1)^1.06 */
function riegelEstimate(fromKm: number, fromSec: number, toKm: number): number {
  return fromSec * Math.pow(toKm / fromKm, 1.06);
}

export function computeEnduranceBestEfforts(
  sessions: BestEffortsSessionInput[],
): EnduranceBestEffort[] {
  // Only run sessions for now. Cycling/swimming PBs are out of scope for v1.
  const runs = sessions.filter((s) => s.source === "run_brain" && s.totalDistance > 0);

  const out: EnduranceBestEffort[] = [];

  for (const dist of STANDARD_DISTANCES) {
    let bestActual:
      | { sec: number; date: string; sessionId: string }
      | null = null;
    let bestEstimated:
      | { sec: number; date: string; sessionId: string }
      | null = null;

    for (const r of runs) {
      // Try the actual-split path first.
      const ivs = (r.runLog ?? [])
        .map((iv) => {
          const d = iv.distance;
          const ps = paceToSeconds(iv.pace ?? null);
          if (typeof d !== "number" || d <= 0 || ps == null) return null;
          return { distance: d, paceSec: ps };
        })
        .filter((x): x is { distance: number; paceSec: number } => x !== null);

      const totalIvKm = ivs.reduce((a, b) => a + b.distance, 0);

      if (totalIvKm >= dist.km && ivs.length > 0) {
        const sec = fastestSplit(ivs, dist.km);
        if (sec != null && sec > 0) {
          if (!bestActual || sec < bestActual.sec) {
            bestActual = { sec, date: r.date, sessionId: r.sessionId };
          }
          continue;
        }
      }

      // Fallback path 1: whole-run avgPace × targetKm if totalDistance >= target.
      if (r.totalDistance >= dist.km && r.weightedPaceSeconds > 0) {
        // Average pace per km × targetKm.
        const avgPaceSec = r.weightedPaceSeconds / r.totalDistance;
        const sec = avgPaceSec * dist.km;
        if (!bestActual || sec < bestActual.sec) {
          bestActual = { sec, date: r.date, sessionId: r.sessionId };
        }
        continue;
      }

      // Fallback path 2: Riegel-estimate from shorter runs (only if no actual win).
      if (r.totalDistance > 0 && r.totalDistance < dist.km && r.weightedPaceSeconds > 0) {
        const sec = riegelEstimate(r.totalDistance, r.weightedPaceSeconds, dist.km);
        if (sec > 0 && (!bestEstimated || sec < bestEstimated.sec)) {
          bestEstimated = { sec, date: r.date, sessionId: r.sessionId };
        }
      }
    }

    const chosen = bestActual ?? bestEstimated;
    if (!chosen) continue;
    const estimated = !bestActual && !!bestEstimated;
    const paceSecondsPerKm = chosen.sec / dist.km;
    out.push({
      kind: "endurance",
      distance: dist.key,
      display: `${dist.label}${estimated ? " (estimated)" : ""} · ${formatHmmss(chosen.sec)}`,
      seconds: Math.round(chosen.sec),
      paceSecondsPerKm: Math.round(paceSecondsPerKm),
      date: chosen.date,
      sessionId: chosen.sessionId,
      estimated,
    });
  }

  return out;
}

// ── Longest single sessions per sport ──────────────────────────────────────

export function computeLongestEfforts(
  sessions: BestEffortsSessionInput[],
): LongestEffort[] {
  const sportMap: Record<string, LongestEffort["sport"]> = {
    run_brain: "run",
    cycle_brain: "cycle",
    swim_brain: "swim",
  };
  const longestBySport: Record<LongestEffort["sport"], { km: number; date: string; sessionId: string } | null> = {
    run: null,
    cycle: null,
    swim: null,
  };

  for (const s of sessions) {
    const sport = s.source ? sportMap[s.source] : null;
    if (!sport) continue;
    if (s.totalDistance <= 0) continue;
    const cur = longestBySport[sport];
    if (!cur || s.totalDistance > cur.km) {
      longestBySport[sport] = { km: s.totalDistance, date: s.date, sessionId: s.sessionId };
    }
  }

  const out: LongestEffort[] = [];
  const sportLabels: Record<LongestEffort["sport"], string> = {
    run: "Longest run",
    cycle: "Longest ride",
    swim: "Longest swim",
  };
  for (const sport of ["run", "cycle", "swim"] as const) {
    const r = longestBySport[sport];
    if (!r) continue;
    out.push({
      kind: "longest",
      sport,
      display: `${sportLabels[sport]} · ${r.km.toFixed(1)} km`,
      km: r.km,
      date: r.date,
      sessionId: r.sessionId,
    });
  }
  return out;
}

// ── Top-level orchestrator ─────────────────────────────────────────────────

export function computeBestEfforts(
  sessions: BestEffortsSessionInput[],
  manualOneRMs: ManualOneRm[],
): BestEffort[] {
  return [
    ...computeLiftBestEfforts(sessions, manualOneRMs),
    ...computeEnduranceBestEfforts(sessions),
    ...computeLongestEfforts(sessions),
  ].sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
}
