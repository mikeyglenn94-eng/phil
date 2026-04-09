export type WorkoutType = "strength" | "wod" | "run";

export type WorkoutFormat =
  | "emom"
  | "amrap"
  | "for_time"
  | "intervals"
  | "chipper"
  | "tabata"
  | "custom";

export type WorkoutSource =
  | "manual"
  | "voice"
  | "ai_generated"
  | "library"
  | "coach_assigned";

export type WodBlockType =
  | "emom"
  | "amrap"
  | "for_time"
  | "intervals"
  | "task_list"
  | "rest";

export type StepTargetType =
  | "reps"
  | "seconds"
  | "distance"
  | "calories"
  | "rest"
  | "free_text";

export type StepUnit = "reps" | "seconds" | "metres" | "m" | "km" | "calories" | "cal";

export interface WodStep {
  id: string;
  movement: {
    name: string;
    category?: "gymnastics" | "barbell" | "dumbbell" | "machine" | "running" | "bodyweight" | "other";
    loadingType?: "bodyweight" | "external_load" | "bodyweight_plus_load" | "none";
  };
  target: {
    type: StepTargetType;
    value?: number;
    unit?: StepUnit;
    notes?: string;
  };
  load?: {
    value?: number;
    unit?: "kg" | "lb";
    display?: string;
  };
  notes?: string;
}

export interface WodBlock {
  id: string;
  type: WodBlockType;
  label?: string;
  durationSeconds?: number;
  intervalSeconds?: number;
  rounds?: number | "until_time";
  steps: WodStep[];
}

export interface WodWorkout {
  format: WorkoutFormat;
  totalDurationSeconds?: number;
  timeCapSeconds?: number;
  blocks: WodBlock[];
  scoring?: {
    type?: "rounds_reps" | "time" | "reps" | "distance" | "calories" | "custom";
    label?: string;
  };
}

/** Normalise a raw AI block unit string to a canonical StepUnit */
export function normaliseUnit(unit: string | undefined): StepTargetType {
  if (!unit) return "reps";
  const u = unit.toLowerCase().trim();
  if (u === "seconds" || u === "sec" || u === "s") return "seconds";
  if (u === "reps" || u === "rep" || u === "repetitions") return "reps";
  if (u === "m" || u === "metres" || u === "meters" || u === "km") return "distance";
  if (u === "calories" || u === "cal" || u === "cals") return "calories";
  return "reps";
}

/** Resolve the canonical unit label from a raw AI block unit string */
export function resolveUnit(unit: string | undefined): StepUnit {
  if (!unit) return "reps";
  const u = unit.toLowerCase().trim();
  if (u === "seconds" || u === "sec" || u === "s") return "seconds";
  if (u === "m" || u === "metres" || u === "meters") return "m";
  if (u === "km") return "km";
  if (u === "calories" || u === "cal" || u === "cals") return "cal";
  return "reps";
}

/** Safely extract a numeric amount from an AI block — tries common field name variants */
export function extractAmount(block: Record<string, unknown>): number | undefined {
  const candidates = ["amount", "reps", "duration", "time", "seconds", "distance", "calories", "value"];
  for (const key of candidates) {
    const v = block[key];
    if (v !== undefined && v !== null && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}

/** Build a WodWorkout from raw AI-parsed blocks */
export function buildWodFromBlocks(
  format: string,
  blocks: Record<string, unknown>[],
  durationMinutes?: number,
): WodWorkout {
  const canonicalFormat = normaliseFormat(format);

  const steps: WodStep[] = blocks.map((block, idx) => {
    const rawAmount = extractAmount(block);
    const rawUnit = (block.unit as string | undefined) ?? "reps";
    const targetType = normaliseUnit(rawUnit);
    const unit = resolveUnit(rawUnit);
    const movementRaw = (block.movement as string | undefined) ?? "";
    const name = movementRaw.charAt(0).toUpperCase() + movementRaw.slice(1);
    const loadDisplay = block.weight as string | undefined;

    const step: WodStep = {
      id: `step-${idx}`,
      movement: { name },
      target: {
        type: targetType,
        value: rawAmount,
        unit,
      },
    };
    if (loadDisplay) {
      step.load = { display: loadDisplay };
    }
    return step;
  });

  const block: WodBlock = {
    id: "block-0",
    type: canonicalFormat as WodBlockType,
    steps,
    ...(durationMinutes != null ? { durationSeconds: durationMinutes * 60 } : {}),
  };

  return {
    format: canonicalFormat,
    blocks: [block],
    ...(durationMinutes != null ? { totalDurationSeconds: durationMinutes * 60 } : {}),
  };
}

function normaliseFormat(fmt: string | undefined): WorkoutFormat {
  switch ((fmt ?? "").toLowerCase()) {
    case "emom": return "emom";
    case "amrap": return "amrap";
    case "for_time": case "fortime": return "for_time";
    case "intervals": case "interval": return "intervals";
    case "chipper": return "chipper";
    case "tabata": return "tabata";
    default: return "custom";
  }
}

/** Build a safe notes string for the legacy exercises array — never produces "undefined ..." */
export function buildNotes(block: Record<string, unknown>): string {
  const amount = extractAmount(block);
  const rawUnit = (block.unit as string | undefined) ?? "reps";
  const unit = resolveUnit(rawUnit);
  const loadDisplay = block.weight as string | undefined;
  if (amount == null) return loadDisplay ?? "";
  return loadDisplay ? `${amount} ${unit} (${loadDisplay})` : `${amount} ${unit}`;
}
