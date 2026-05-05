// ── Flow type ──────────────────────────────────────────────────────────────

export type FlowType = "programme" | "session" | "modification" | "progression";

// ── Slot definitions ───────────────────────────────────────────────────────

export type SlotKind = "single_select" | "multi_select" | "free_text" | "bool";

export interface SlotOption {
  value: string;
  label: string;
}

export interface SlotDef {
  name: string;
  kind: SlotKind;
  options?: SlotOption[];
  /** Allow a free-text "other" value in addition to the listed options. */
  allowOther?: boolean;
  /** What this slot is for, in plain language. Fed to the question writer. */
  hint: string;
  /** Optional gate — slot is only required when this returns true given the current state. */
  applies?: (slots: SlotValues) => boolean;
}

export type SlotValue =
  | string
  | string[]
  | boolean
  | { value: string; note: string | null };

export type SlotValues = Record<string, SlotValue | null>;

// ── Conversation state ─────────────────────────────────────────────────────

export interface FlowMessage {
  role: "user" | "assistant";
  content: string;
}

export interface FlowState<TContext = unknown> {
  type: FlowType;
  slots: SlotValues;
  currentSlot: string | null;
  history: FlowMessage[];
  context: TContext;
  /** Set to true once a preview has been generated. Used by the programme flow. */
  previewGenerated?: boolean;
  /** Cached preview output so the UI can render it without re-generating. */
  preview?: GeneratedProgramme;
  /** Last slot-parse failure reason (so the question writer can rephrase). */
  lastParseFailure?: string | null;
}

// ── Domain output types ────────────────────────────────────────────────────
// Loose shapes — the generators return arbitrary JSON that conforms to the
// existing programme/session schemas. Keeping these as `unknown`-friendly
// records so downstream consumers can validate with their own zod schemas.

export interface GeneratedProgrammeSession {
  id: string;
  dayNumber?: number;
  date?: string;
  name: string;
  source?: string;
  structure?: string;
  color?: string;
  exercises: GeneratedExercise[];
}

export interface GeneratedExercise {
  id: string;
  name: string;
  sets: number | null;
  reps: string | null;
  rpe: string | null;
  rest: string | null;
  tempo: string | null;
  notes: string | null;
  rawText?: string;
  weekProgression?: unknown[];
}

export interface GeneratedProgramme {
  title: string;
  blockLength: number | null;
  sessionsPerWeek: number | null;
  sessions: GeneratedProgrammeSession[];
}

export interface GeneratedSession {
  name: string;
  source?: string;
  structure?: string;
  color?: string;
  exercises: GeneratedExercise[];
}

export interface AffectedExerciseRef {
  programmeId: number;
  programmeName: string;
  sessionId: string;
  date?: string;
  exerciseId: string;
  exerciseName: string;
  /** Why this exercise was flagged (per the modification reason). */
  reason: string;
}

export interface SwapOption {
  name: string;
  reason: string;
  recommended: boolean;
}

export interface SwapChoiceSet {
  exerciseName: string;
  affectedRefs: AffectedExerciseRef[];
  options: SwapOption[];
}

export type SwapDecision =
  | { kind: "keep" }
  | { kind: "swap"; replacementName: string }
  | { kind: "remove" };

export interface ModifiedProgramme {
  programmeId: number;
  decisions: { exerciseName: string; decision: SwapDecision }[];
  /** Human-readable confirmation, in Phil's voice. */
  confirmation: string;
}

// ── Progression flow types ─────────────────────────────────────────────────

/** A subset of the live Session shape — what the progression generator needs
 *  to produce a coherent block. The full shape (drag handlers, team meta) is
 *  carried by the calendar UI; the LLM only sees what matters for progression. */
export interface ProgressionSourceSession {
  id: string;
  name: string;
  date: string;
  dayNumber?: number | null;
  source?: string | null;
  structure?: string | null;
  exercises: GeneratedExercise[];
  /** Optional run-interval log when the source was a logged run. */
  runLog?: { distance?: number | null; pace?: string | null }[];
}

export interface ProgressionFlowContext {
  clientId: number;
  /** The source sessions selected from the calendar (one or more). */
  sourceSessions: ProgressionSourceSession[];
  /** The programme id the progressed sessions should be appended to. */
  programmeId: number;
}

export interface ProgressedSession {
  id: string;
  date: string;
  dayNumber?: number | null;
  name: string;
  source: "progression_block";
  structure?: string;
  color?: string;
  exercises: GeneratedExercise[];
  /** Soft attribution back to the source session id, so the UI can group / undo. */
  progressedFromSessionId: string;
  /** 1-indexed week within the new block (1..weeks). */
  progressionWeek: number;
}

export interface ProgressedBlock {
  /** Total weeks generated. */
  weeks: number;
  /** The style the LLM applied (in case it picked from "auto"). */
  style: string;
  /** Flat list of progressed sessions across all generated weeks. */
  sessions: ProgressedSession[];
}

// ── Programme-flow context ─────────────────────────────────────────────────

export interface ProgrammeFlowContext {
  clientId?: number;
  clientName?: string;
  fivekSeconds?: number | null;
  tenkSeconds?: number | null;
}

// ── Session-flow context ───────────────────────────────────────────────────

export interface SessionFlowContext {
  clientId?: number;
  clientName?: string;
  fivekSeconds?: number | null;
  tenkSeconds?: number | null;
}

// ── Modification-flow context ──────────────────────────────────────────────

export interface ModificationFlowContext {
  clientId: number;
  programmeId: number;
  programmeName: string;
  /** Future-only sessions (date >= today) that are candidates for modification. */
  futureSessions: GeneratedProgrammeSession[];
  equipmentList?: string | null;
}

// ── Slot list — programme flow (per brief) ─────────────────────────────────

export const PROGRAMME_SLOTS: SlotDef[] = [
  {
    name: "goal",
    kind: "single_select",
    allowOther: true,
    options: [
      { value: "strength", label: "Strength" },
      { value: "hypertrophy", label: "Hypertrophy" },
      { value: "fat_loss", label: "Fat loss" },
      { value: "general_fitness", label: "General fitness" },
      { value: "sport_specific", label: "Sport-specific" },
    ],
    hint: "What the client is training for. If they say a sport or event, set sport_specific and capture the detail in the note.",
  },
  {
    name: "experience",
    kind: "single_select",
    options: [
      { value: "beginner", label: "Beginner" },
      { value: "intermediate", label: "Intermediate" },
      { value: "advanced", label: "Advanced" },
    ],
    hint: "Roughly how long the client has trained. New (under a year) = beginner, 1–3 years consistent = intermediate, 3+ years = advanced.",
  },
  {
    name: "days_per_week",
    kind: "single_select",
    options: [
      { value: "2", label: "2" },
      { value: "3", label: "3" },
      { value: "4", label: "4" },
      { value: "5", label: "5" },
      { value: "6", label: "6" },
    ],
    hint: "Training days per week.",
  },
  {
    name: "session_length",
    kind: "single_select",
    options: [
      { value: "30", label: "30 min" },
      { value: "45", label: "45 min" },
      { value: "60", label: "60 min" },
      { value: "75", label: "75 min" },
      { value: "90", label: "90 min" },
    ],
    hint: "How long each session is.",
  },
  {
    name: "equipment",
    kind: "multi_select",
    allowOther: true,
    options: [
      { value: "full_gym", label: "Full gym" },
      { value: "home_gym", label: "Home gym (rack + barbell)" },
      { value: "dumbbells_only", label: "Dumbbells only" },
      { value: "bodyweight", label: "Bodyweight" },
    ],
    hint: "What equipment is available. Multi-select; multiple answers are valid.",
  },
  {
    name: "injuries_or_avoid",
    kind: "free_text",
    hint: "Anything off the table — niggling injuries, exercises they want to avoid. 'None' is a valid answer.",
  },
  {
    name: "preview_confirmed",
    kind: "bool",
    hint: "Whether the user has reviewed the week-1 preview and approved building the full block.",
  },
];

// ── Slot list — session flow (per brief) ───────────────────────────────────

export const SESSION_SLOTS: SlotDef[] = [
  {
    name: "session_type",
    kind: "single_select",
    options: [
      { value: "strength", label: "Strength" },
      { value: "run", label: "Run" },
      { value: "cycle", label: "Cycle" },
      { value: "swim", label: "Swim" },
      { value: "conditioning", label: "Conditioning" },
    ],
    hint: "What kind of session. Conditioning covers WOD-style metcons.",
  },
  {
    name: "focus",
    kind: "single_select",
    allowOther: true,
    options: [
      { value: "full_body", label: "Full body" },
      { value: "upper", label: "Upper" },
      { value: "lower", label: "Lower" },
      { value: "push", label: "Push" },
      { value: "pull", label: "Pull" },
      { value: "legs", label: "Legs" },
    ],
    hint: "Strength session focus.",
    applies: (slots) => slotEquals(slots, "session_type", "strength"),
  },
  {
    name: "intensity",
    kind: "single_select",
    options: [
      { value: "easy", label: "Easy" },
      { value: "steady", label: "Steady" },
      { value: "tempo", label: "Tempo" },
      { value: "intervals", label: "Intervals" },
      { value: "long", label: "Long" },
    ],
    hint: "Endurance session intensity profile.",
    applies: (slots) =>
      slotIsOneOf(slots, "session_type", ["run", "cycle", "swim"]),
  },
  {
    name: "duration",
    kind: "single_select",
    options: [
      { value: "30", label: "30 min" },
      { value: "45", label: "45 min" },
      { value: "60", label: "60 min" },
      { value: "75", label: "75 min" },
      { value: "90", label: "90 min" },
    ],
    hint: "How long the session is.",
  },
  {
    name: "equipment",
    kind: "multi_select",
    allowOther: true,
    options: [
      { value: "full_gym", label: "Full gym" },
      { value: "home_gym", label: "Home gym (rack + barbell)" },
      { value: "dumbbells_only", label: "Dumbbells only" },
      { value: "bodyweight", label: "Bodyweight" },
    ],
    hint: "What equipment is available for this session.",
    applies: (slots) =>
      slotEquals(slots, "session_type", "strength") ||
      slotEquals(slots, "session_type", "conditioning"),
  },
  {
    name: "notes",
    kind: "free_text",
    hint: "Anything else worth knowing for this session. Optional. The user can skip with 'none' or 'skip'.",
  },
];

// ── Slot list — modification flow (per brief) ──────────────────────────────

export const MODIFICATION_SLOTS: SlotDef[] = [
  {
    name: "modification_type",
    kind: "single_select",
    allowOther: true,
    options: [
      { value: "swap_aggravating_exercises", label: "Swap aggravating exercises" },
      { value: "change_difficulty", label: "Change difficulty" },
      { value: "swap_equipment", label: "Swap equipment" },
      { value: "change_volume", label: "Change volume" },
      { value: "change_frequency", label: "Change frequency" },
      { value: "change_focus", label: "Change focus" },
    ],
    hint: "What kind of modification the user is asking for.",
  },
  {
    name: "specifics",
    kind: "free_text",
    hint: "The detail behind the modification. e.g. for swap_aggravating_exercises this is the body part or exercise; for change_difficulty this is too easy / too hard and where; for change_volume / change_focus it's the area to push or pull back.",
  },
  {
    name: "affected_exercises",
    kind: "free_text",
    hint: "Internal — filled by the modifier LLM call once specifics are known. Holds a JSON array of affected exercise references.",
  },
  {
    name: "swap_choices",
    kind: "free_text",
    hint: "Internal — filled as the user works through each affected exercise. Holds a JSON object mapping exerciseName → decision.",
  },
  {
    name: "confirm",
    kind: "bool",
    hint: "User has reviewed the summary of changes and approved them.",
  },
];

// ── Slot list — progression flow ───────────────────────────────────────────

export const PROGRESSION_SLOTS: SlotDef[] = [
  {
    name: "weeks",
    kind: "single_select",
    options: [
      { value: "2", label: "2 weeks" },
      { value: "3", label: "3 weeks" },
      { value: "4", label: "4 weeks" },
      { value: "5", label: "5 weeks" },
      { value: "6", label: "6 weeks" },
    ],
    hint: "How many weeks the progression should run.",
  },
  {
    name: "style",
    kind: "single_select",
    options: [
      // Strength styles
      { value: "linear", label: "Linear" },
      { value: "volume_accumulation", label: "Volume Accumulation" },
      { value: "intensity", label: "Intensity" },
      { value: "wave", label: "Wave Loading" },
      // Endurance styles
      { value: "distance", label: "Distance" },
      { value: "pace", label: "Pace" },
      { value: "intervals", label: "Intervals" },
      { value: "volume", label: "Volume" },
      // Always available
      { value: "auto", label: "Auto (philosophy picks)" },
    ],
    // The route narrows these dynamically at serve time — strength sessions →
    // strength styles only; endurance → endurance styles only; mixed → auto only;
    // wave is dropped if weeks < 3.
    hint: "Progression style. The route filters this list based on weeks + session-type breakdown.",
  },
  {
    name: "confirm",
    kind: "bool",
    hint: "User has reviewed the summary and approved generating the block.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function slotEquals(slots: SlotValues, name: string, target: string): boolean {
  const v = slots[name];
  if (typeof v === "string") return v === target;
  if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) {
    return (v as { value: string }).value === target;
  }
  return false;
}

function slotIsOneOf(slots: SlotValues, name: string, targets: string[]): boolean {
  return targets.some((t) => slotEquals(slots, name, t));
}

export function getSlotList(type: FlowType): SlotDef[] {
  switch (type) {
    case "programme":
      return PROGRAMME_SLOTS;
    case "session":
      return SESSION_SLOTS;
    case "modification":
      return MODIFICATION_SLOTS;
    case "progression":
      return PROGRESSION_SLOTS;
  }
}

export function nextUnfilledSlot(
  slots: SlotValues,
  defs: SlotDef[],
): SlotDef | null {
  for (const def of defs) {
    if (def.applies && !def.applies(slots)) continue;
    const v = slots[def.name];
    if (v == null) return def;
  }
  return null;
}
