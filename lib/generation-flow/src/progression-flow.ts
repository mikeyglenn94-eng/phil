/**
 * Progression flow — multi-week progression of selected calendar sessions.
 *
 * Slots: weeks → style → confirm.
 * Generator: single LLM call producing weeks × sourceSessions copies, each
 * progressed coherently across the block. Date math runs in code (not the LLM)
 * to avoid drift; IDs minted server-side with a "session-prog-" prefix.
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import { PROGRESSION_GENERATOR_SYSTEM } from "./prompts.js";
import { advanceFlow, isComplete, startFlow, withAssistantMessage } from "./flow-base.js";
import {
  getSlotList,
  nextUnfilledSlot,
  type FlowState,
  type GeneratedExercise,
  type ProgressedBlock,
  type ProgressedSession,
  type ProgressionFlowContext,
  type ProgressionSourceSession,
  type SlotValue,
} from "./types.js";

const MODEL = "gpt-5.2";
const MAX_TOKENS = 32768;

export type ProgressionFlowState = FlowState<ProgressionFlowContext>;

export function startProgressionFlow(
  context: ProgressionFlowContext,
): ProgressionFlowState {
  return startFlow("progression", context);
}

export {
  advanceFlow as advanceProgressionFlow,
  isComplete as isProgressionFlowComplete,
  withAssistantMessage as withAssistantMessageProgression,
};

export function currentSlot(state: ProgressionFlowState): string | null {
  if (isComplete(state)) return null;
  const defs = getSlotList("progression");
  return nextUnfilledSlot(state.slots, defs)?.name ?? null;
}

/** Generate the progressed block. Throws if isComplete is false. */
export async function generate(
  state: ProgressionFlowState,
): Promise<ProgressedBlock> {
  if (!isComplete(state)) {
    throw new Error("generate: progression flow state is not complete");
  }

  const weeks = parseWeeks(state.slots.weeks);
  const style = parseStyle(state.slots.style);
  const sourceSessions = state.context.sourceSessions;

  if (weeks <= 0) throw new Error("generate: weeks must be > 0");
  if (sourceSessions.length === 0) {
    throw new Error("generate: no source sessions");
  }

  const userContent = buildUserBrief(weeks, style, sourceSessions);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: PROGRESSION_GENERATOR_SYSTEM },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow(raw);

  const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const styleApplied =
    typeof parsed.style === "string" && parsed.style.length > 0 ? parsed.style : style;

  const sessions = rawSessions
    .map((raw, i) => coerceProgressedSession(raw, sourceSessions, i))
    .filter((s): s is ProgressedSession => s !== null);

  return {
    weeks,
    style: styleApplied,
    sessions,
  };
}

// ── User brief ─────────────────────────────────────────────────────────────

function buildUserBrief(
  weeks: number,
  style: string,
  sources: ProgressionSourceSession[],
): string {
  const compactSources = sources.map((s) => ({
    id: s.id,
    name: s.name,
    date: s.date,
    dayNumber: s.dayNumber ?? null,
    source: s.source ?? null,
    structure: s.structure ?? null,
    exercises: s.exercises.map((ex) => ({
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      rpe: ex.rpe,
      rest: ex.rest,
      tempo: ex.tempo,
      notes: ex.notes,
    })),
    runLog: s.runLog ?? [],
  }));

  return [
    `weeks: ${weeks}`,
    `style: ${style}`,
    `sourceSessions:`,
    JSON.stringify(compactSources, null, 2),
    "",
    `Generate ${weeks} × ${sources.length} = ${weeks * sources.length} progressed sessions.`,
    `Apply the style coherently across the entire block. Copy each session's name verbatim — do NOT add week suffixes.`,
  ].join("\n");
}

// ── Coercion ───────────────────────────────────────────────────────────────

function coerceProgressedSession(
  raw: unknown,
  sources: ProgressionSourceSession[],
  index: number,
): ProgressedSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const progressedFromSessionId =
    typeof r.progressedFromSessionId === "string" ? r.progressedFromSessionId : "";
  const progressionWeek =
    typeof r.progressionWeek === "number" && r.progressionWeek >= 1
      ? Math.round(r.progressionWeek)
      : 1;

  const sourceSession = sources.find((s) => s.id === progressedFromSessionId) ?? sources[0];
  if (!sourceSession) return null;

  const computedDate = addDays(sourceSession.date, 7 * (progressionWeek - 1));

  const id = `session-prog-${randomId(8)}-${index}`;
  const dayNumber = sourceSession.dayNumber ?? null;
  const name =
    typeof r.name === "string" && r.name.trim().length > 0
      ? r.name.trim()
      : sourceSession.name;

  const exercisesRaw = Array.isArray(r.exercises) ? r.exercises : [];
  const exercises: GeneratedExercise[] = exercisesRaw.map((ex, i) => coerceExercise(ex, i));

  return {
    id,
    date: computedDate,
    dayNumber,
    name,
    source: "progression_block",
    structure: typeof r.structure === "string" ? r.structure : undefined,
    color: typeof r.color === "string" ? r.color : undefined,
    exercises,
    progressedFromSessionId: sourceSession.id,
    progressionWeek,
  };
}

function coerceExercise(raw: unknown, index: number): GeneratedExercise {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: `ex-prog-${randomId(6)}-${index}`,
    name: typeof r.name === "string" ? r.name : "",
    sets: typeof r.sets === "number" ? r.sets : null,
    reps: r.reps != null ? String(r.reps) : null,
    rpe: r.rpe != null ? String(r.rpe) : null,
    rest: r.rest != null ? String(r.rest) : null,
    tempo: r.tempo != null ? String(r.tempo) : null,
    notes: r.notes != null ? String(r.notes) : null,
    rawText: "",
    weekProgression: [],
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseWeeks(v: SlotValue | null | undefined): number {
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    const inner = (v as { value: unknown }).value;
    if (typeof inner === "string") {
      const n = parseInt(inner, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

function parseStyle(v: SlotValue | null | undefined): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === "string" ? inner : "auto";
  }
  return "auto";
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function randomId(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function parseJsonOrThrow(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Record<string, unknown>;
      } catch {
        throw new Error("Progression generator returned invalid JSON");
      }
    }
    throw new Error("Progression generator returned no JSON");
  }
}

// ── Style option filtering — used by the route at serve time ───────────────

export interface ProgressionStyleOption {
  value: string;
  label: string;
}

/** Compute which style options to surface, given the source-session mix and
 *  the already-filled `weeks` value. Wave is dropped when weeks < 3.
 *  Strength-only / endurance-only show their respective styles + auto.
 *  Mixed shows auto only. */
export function computeStyleOptions(
  sources: ProgressionSourceSession[],
  weeksValue: number,
): ProgressionStyleOption[] {
  const breakdown = classifySessions(sources);
  const allowWave = weeksValue >= 3;

  if (breakdown === "mixed") {
    return [{ value: "auto", label: "Auto (philosophy picks)" }];
  }

  if (breakdown === "strength") {
    return [
      { value: "linear", label: "Linear" },
      { value: "volume_accumulation", label: "Volume Accumulation" },
      { value: "intensity", label: "Intensity" },
      ...(allowWave ? [{ value: "wave", label: "Wave Loading" }] : []),
      { value: "auto", label: "Auto (philosophy picks)" },
    ];
  }

  // endurance
  return [
    { value: "distance", label: "Distance" },
    { value: "pace", label: "Pace" },
    { value: "intervals", label: "Intervals" },
    { value: "volume", label: "Volume" },
    { value: "auto", label: "Auto (philosophy picks)" },
  ];
}

function classifySessions(
  sources: ProgressionSourceSession[],
): "strength" | "endurance" | "mixed" {
  let hasStrength = false;
  let hasEndurance = false;
  for (const s of sources) {
    const src = s.source ?? null;
    if (src === "run_brain" || src === "cycle_brain" || src === "swim_brain" || src === "endurance_cycle") {
      hasEndurance = true;
    } else {
      // Treat strength_block, wod_brain, progression_block, null/undefined as strength-leaning.
      // WOD progressions are uncommon; if a user selects only WODs, the strength
      // styles will at least apply to the structured movements.
      hasStrength = true;
    }
  }
  if (hasStrength && hasEndurance) return "mixed";
  if (hasEndurance) return "endurance";
  return "strength";
}
