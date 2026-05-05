import type { ParsedWorkout } from "./types.js";

interface LegacyExercise {
  id: string;
  name: string;
  sets: number | null;
  reps: string | null;
  rpe: string | null;
  rest: string | null;
  tempo: string | null;
  notes: string | null;
  rawText: string;
  weekProgression: never[];
  clientComment: null;
  perSetReps: null;
  perSetRpe: null;
  setWeights: null;
  setReps: null;
  weight: string | null;
}

interface LegacyStrengthSession {
  name: string;
  source: "strength_block";
  exercises: LegacyExercise[];
}

interface LegacyRunRow {
  rowType: "interval" | "rest" | "run";
  repNumber?: number;
  distance?: string | null;
  duration?: string | null;
  pace?: string | null;
  effort?: string | null;
  description?: string;
}

interface LegacyRunBlock {
  blockType: "main";
  label: "Main Set";
  rows: LegacyRunRow[];
}

interface LegacyRunSegment {
  label: string;
  description: string;
  distance: string | null;
  duration: string | null;
  effort: string | null;
  rest: null;
  reps: null;
  rowType: LegacyRunRow["rowType"];
  pace: string | null;
}

interface LegacyRunSession {
  name: string;
  source: "run_brain";
  structure: string;
  segments: LegacyRunSegment[];
  duration: number | null;
  distanceKm: number | null;
  intensity: string;
  runBlocks: LegacyRunBlock[];
  exercises: LegacyExercise[];
}

const idForIndex = (i: number): string => `ex-${Date.now()}-${i}`;

export function adaptToStrengthSession(workout: ParsedWorkout): LegacyStrengthSession {
  return {
    name: workout.name,
    source: "strength_block",
    exercises: workout.exercises.map((ex, i) => ({
      id: idForIndex(i),
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps || null,
      rpe: ex.rpe,
      rest: ex.rest,
      tempo: ex.tempo,
      notes: composeNotes(ex.notes, ex.confidence),
      rawText: "",
      weekProgression: [],
      clientComment: null,
      perSetReps: null,
      perSetRpe: null,
      setWeights: null,
      setReps: null,
      weight: ex.weight,
    })),
  };
}

export function adaptToRunSession(workout: ParsedWorkout): LegacyRunSession {
  const rows: LegacyRunRow[] = [];
  for (let i = 0; i < workout.exercises.length; i++) {
    const ex = workout.exercises[i];
    if (!ex) continue;
    const isContinuous = ex.sets <= 1;
    if (isContinuous) {
      rows.push({
        rowType: "run",
        description: ex.name,
        distance: ex.distance,
        duration: ex.duration,
        pace: ex.pace,
        effort: ex.effort,
      });
    } else {
      for (let r = 0; r < ex.sets; r++) {
        rows.push({
          rowType: "interval",
          repNumber: r + 1,
          distance: ex.distance,
          duration: ex.duration,
          pace: ex.pace,
          effort: ex.effort,
        });
        if (ex.rest && r < ex.sets - 1) {
          rows.push({
            rowType: "rest",
            description: ex.rest,
            duration: ex.rest,
          });
        }
      }
    }
  }

  const runBlocks: LegacyRunBlock[] = [{ blockType: "main", label: "Main Set", rows }];

  const segments: LegacyRunSegment[] = rows.map((row) => ({
    label:
      row.rowType === "interval"
        ? `Rep ${row.repNumber ?? ""}`.trim()
        : row.rowType === "rest"
        ? "Rest"
        : "",
    description:
      row.rowType === "interval"
        ? [row.distance ?? row.duration, row.pace ? `@ ${row.pace}` : null, row.effort]
            .filter(Boolean)
            .join(" ")
        : row.description ?? row.duration ?? "",
    distance: row.distance ?? null,
    duration: row.duration ?? null,
    effort: row.rowType === "rest" ? "rest" : row.effort ?? null,
    rest: null,
    reps: null,
    rowType: row.rowType,
    pace: row.pace ?? null,
  }));

  const totalKm = workout.exercises.reduce((sum, ex) => {
    const km = parseDistanceKm(ex.distance);
    return km != null ? sum + km * Math.max(1, ex.sets) : sum;
  }, 0);
  const distanceKm = totalKm > 0 ? Math.round(totalKm * 10) / 10 : null;

  const intensity = pickIntensity(workout.exercises.map((e) => e.effort));

  const exercises: LegacyExercise[] = workout.exercises.map((ex, i) => ({
    id: idForIndex(i),
    name: ex.name,
    sets: ex.sets,
    reps: ex.distance ?? ex.duration ?? ex.reps ?? null,
    rpe: ex.rpe,
    rest: ex.rest,
    tempo: null,
    notes: composeNotes(
      [ex.notes, ex.pace ? `@ ${ex.pace}` : null, ex.effort].filter(Boolean).join(" · ") || null,
      ex.confidence,
    ),
    rawText: "",
    weekProgression: [],
    clientComment: null,
    perSetReps: null,
    perSetRpe: null,
    setWeights: null,
    setReps: null,
    weight: null,
  }));

  return {
    name: workout.name,
    source: "run_brain",
    structure: workout.raw,
    segments,
    duration: null,
    distanceKm,
    intensity,
    runBlocks,
    exercises,
  };
}

function composeNotes(notes: string | null, confidence: "high" | "low"): string | null {
  if (confidence === "low") {
    const tag = "(low confidence)";
    return notes ? `${notes} ${tag}` : tag;
  }
  return notes;
}

function parseDistanceKm(distance: string | null): number | null {
  if (!distance) return null;
  const s = distance.toLowerCase().trim();
  const km = s.match(/^(\d+(?:\.\d+)?)\s*k(m|ilometer|ilometre)?s?$/);
  if (km && km[1]) return Number.parseFloat(km[1]);
  const m = s.match(/^(\d+(?:\.\d+)?)\s*m(eter|etre)?s?$/);
  if (m && m[1]) return Number.parseFloat(m[1]) / 1000;
  const mi = s.match(/^(\d+(?:\.\d+)?)\s*mi(le)?s?$/);
  if (mi && mi[1]) return Number.parseFloat(mi[1]) * 1.609;
  return null;
}

function pickIntensity(efforts: (string | null)[]): string {
  const seen = efforts.filter((e): e is string => Boolean(e));
  if (seen.length === 0) return "Run";
  const lower = seen.map((s) => s.toLowerCase());
  if (lower.some((e) => e.includes("interval") || e.includes("vo2") || e.includes("threshold"))) return "Intervals";
  if (lower.some((e) => e.includes("tempo"))) return "Tempo";
  if (lower.every((e) => e.includes("easy") || e.includes("recovery"))) return "Easy";
  return "Mixed";
}
