import { openai } from "@workspace/integrations-openai-ai-server";
import {
  AFFECTED_EXERCISES_SYSTEM,
  CONFIRMATION_WRITER_SYSTEM,
  SWAP_OPTIONS_SYSTEM,
} from "./prompts.js";
import {
  advanceFlow as baseAdvance,
  isComplete as baseIsComplete,
  startFlow,
  withAssistantMessage,
} from "./flow-base.js";
import { detectBodyPart, injuryMatches } from "./injury-map.js";
import {
  type AffectedExerciseRef,
  type FlowState,
  type ModificationFlowContext,
  type ModifiedProgramme,
  type SwapChoiceSet,
  type SwapDecision,
  type SwapOption,
} from "./types.js";

const MODEL = "gpt-5.2";

export type ModificationFlowState = FlowState<ModificationFlowContext>;

export function startModificationFlow(
  context: ModificationFlowContext,
): ModificationFlowState {
  return startFlow("modification", context);
}

export { withAssistantMessage as withAssistantMessageModification };

/** advanceFlow for modification: same base logic, plus auto-fill of the
 *  affected_exercises slot when both modification_type and specifics are set. */
export async function advanceModificationFlow(
  state: ModificationFlowState,
  userMessage: string,
): Promise<ModificationFlowState> {
  // First, run the standard slot parser. This handles modification_type,
  // specifics, confirm, and any free-text-style swap_choices answers.
  let next = await baseAdvance(state, userMessage);

  // After the user answers `specifics`, identify affected exercises (auto-fill).
  if (
    next.slots.modification_type != null &&
    next.slots.specifics != null &&
    next.slots.affected_exercises == null
  ) {
    const affected = await identifyAffectedExercises(next);
    next = {
      ...next,
      slots: {
        ...next.slots,
        affected_exercises: JSON.stringify(affected),
      },
      currentSlot: "swap_choices",
    };
  }

  return next;
}

/** Generate the swap options for one affected exercise. Cached upstream — call
 *  once per exercise and reuse for the UI. */
export async function generateSwapOptions(
  state: ModificationFlowState,
  exerciseName: string,
): Promise<SwapOption[]> {
  const reason = String(state.slots.specifics ?? "");
  const equipment = state.context.equipmentList ?? "full commercial gym";
  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 512,
    messages: [
      { role: "system", content: SWAP_OPTIONS_SYSTEM },
      {
        role: "user",
        content: `Exercise to replace: "${exerciseName}"
Modification reason: "${reason}"
Athlete's available equipment: ${equipment}

Suggest exactly 3 alternatives. Mark exactly one as recommended. Return JSON.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = safeParse(raw);
  const options = Array.isArray(parsed.options) ? parsed.options : [];
  return options
    .filter((o): o is SwapOption => isSwapOption(o))
    .slice(0, 3);
}

/** Build the per-exercise SwapChoiceSet list — used by the UI to render
 *  one card per affected exercise with its options. */
export async function buildSwapChoiceSets(
  state: ModificationFlowState,
): Promise<SwapChoiceSet[]> {
  const affected = readAffectedExercises(state);
  // Group by exercise name so we generate options once per unique exercise.
  const byName = new Map<string, AffectedExerciseRef[]>();
  for (const ref of affected) {
    const list = byName.get(ref.exerciseName) ?? [];
    list.push(ref);
    byName.set(ref.exerciseName, list);
  }

  const out: SwapChoiceSet[] = [];
  for (const [exerciseName, refs] of byName) {
    const options = await generateSwapOptions(state, exerciseName);
    out.push({ exerciseName, affectedRefs: refs, options });
  }
  return out;
}

/** Record the user's decision for one exercise. Updates swap_choices. */
export function recordSwapDecision(
  state: ModificationFlowState,
  exerciseName: string,
  decision: SwapDecision,
): ModificationFlowState {
  const existing = readSwapChoices(state);
  existing[exerciseName] = decision;

  const affected = readAffectedExercises(state);
  const uniqueNames = new Set(affected.map((a) => a.exerciseName));
  const allDecided = [...uniqueNames].every((n) => existing[n] != null);

  return {
    ...state,
    slots: {
      ...state.slots,
      swap_choices: JSON.stringify(existing),
    },
    currentSlot: allDecided ? "confirm" : "swap_choices",
  };
}

/** Modification flow is complete when modification_type, specifics,
 *  affected_exercises, all swap_choices, and confirm are filled. */
export function isModificationFlowComplete(state: ModificationFlowState): boolean {
  if (!baseIsComplete(state)) return false;
  if (state.slots.confirm !== true) return false;
  return true;
}

/** Apply the recorded decisions and return a ModifiedProgramme. The caller
 *  is responsible for actually writing the modified programme back to the DB. */
export async function generate(
  state: ModificationFlowState,
): Promise<ModifiedProgramme> {
  if (!isModificationFlowComplete(state)) {
    throw new Error("generate: modification flow state is not complete");
  }

  const decisionsObj = readSwapChoices(state);
  const decisions = Object.entries(decisionsObj).map(([exerciseName, decision]) => ({
    exerciseName,
    decision,
  }));

  const confirmation = await writeConfirmation(decisions);

  return {
    programmeId: state.context.programmeId,
    decisions,
    confirmation,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function identifyAffectedExercises(
  state: ModificationFlowState,
): Promise<AffectedExerciseRef[]> {
  const futureSessions = state.context.futureSessions;
  const modificationType = String(getValue(state.slots.modification_type) ?? "");
  const specifics = String(state.slots.specifics ?? "");

  // LLM-first identification.
  const compactProgramme = futureSessions.map((s) => ({
    sessionId: s.id,
    name: s.name,
    date: s.date,
    exercises: s.exercises.map((ex) => ({ id: ex.id, name: ex.name })),
  }));

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: AFFECTED_EXERCISES_SYSTEM },
      {
        role: "user",
        content: `Modification type: ${modificationType}
Modification reason: "${specifics}"

Future sessions in the programme (for review):
${JSON.stringify(compactProgramme, null, 2)}

Return the list of exercise IDs to review.`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = safeParse(raw);
  const llmHits = Array.isArray(parsed.affected) ? parsed.affected : [];

  // Index every exercise so we can resolve by id.
  const byId = new Map<string, { sessionId: string; date?: string; name: string; exerciseName: string }>();
  for (const s of futureSessions) {
    for (const ex of s.exercises) {
      byId.set(ex.id, {
        sessionId: s.id,
        date: s.date,
        name: s.name,
        exerciseName: ex.name,
      });
    }
  }

  const refs: AffectedExerciseRef[] = [];
  const seen = new Set<string>();

  const addRef = (exerciseId: string, reason: string) => {
    if (seen.has(exerciseId)) return;
    const meta = byId.get(exerciseId);
    if (!meta) return;
    seen.add(exerciseId);
    refs.push({
      programmeId: state.context.programmeId,
      programmeName: state.context.programmeName,
      sessionId: meta.sessionId,
      date: meta.date,
      exerciseId,
      exerciseName: meta.exerciseName,
      reason,
    });
  };

  for (const hit of llmHits) {
    if (!hit || typeof hit !== "object") continue;
    const obj = hit as { exerciseId?: unknown; reason?: unknown };
    if (typeof obj.exerciseId !== "string") continue;
    const reason = typeof obj.reason === "string" ? obj.reason : "Flagged by Phil.";
    addRef(obj.exerciseId, reason);
  }

  // Safety net: for swap_aggravating_exercises, layer the deterministic
  // INJURY_MAP keyword match on top — catches anything the LLM missed.
  if (modificationType === "swap_aggravating_exercises") {
    const bodyPart = detectBodyPart(specifics);
    if (bodyPart) {
      for (const s of futureSessions) {
        for (const ex of s.exercises) {
          if (injuryMatches(ex.name, bodyPart)) {
            addRef(ex.id, `Loads the ${bodyPart}.`);
          }
        }
      }
    }
  }

  return refs;
}

async function writeConfirmation(
  decisions: { exerciseName: string; decision: SwapDecision }[],
): Promise<string> {
  const summary = decisions
    .map((d) => {
      switch (d.decision.kind) {
        case "keep":
          return `${d.exerciseName}: kept`;
        case "swap":
          return `${d.exerciseName}: swapped to ${d.decision.replacementName}`;
        case "remove":
          return `${d.exerciseName}: removed`;
      }
    })
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 128,
    messages: [
      { role: "system", content: CONFIRMATION_WRITER_SYSTEM },
      { role: "user", content: `Decisions:\n${summary}` },
    ],
  });

  return (completion.choices[0]?.message?.content ?? "Done.").trim();
}

function readAffectedExercises(state: ModificationFlowState): AffectedExerciseRef[] {
  const raw = state.slots.affected_exercises;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AffectedExerciseRef[]) : [];
  } catch {
    return [];
  }
}

function readSwapChoices(state: ModificationFlowState): Record<string, SwapDecision> {
  const raw = state.slots.swap_choices;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, SwapDecision>)
      : {};
  } catch {
    return {};
  }
}

function getValue(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "value" in (v as Record<string, unknown>)) {
    const inner = (v as { value: unknown }).value;
    return typeof inner === "string" ? inner : null;
  }
  return null;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function isSwapOption(o: unknown): o is SwapOption {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x.name === "string" &&
    typeof x.reason === "string" &&
    typeof x.recommended === "boolean"
  );
}
