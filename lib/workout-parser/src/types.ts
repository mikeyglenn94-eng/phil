export type Sport = "strength" | "run" | "cycle" | "swim";

export type Confidence = "high" | "low";

export interface ParsedExercise {
  name: string;
  sets: number;
  reps: string;

  weight: string | null;
  rpe: string | null;
  tempo: string | null;
  rest: string | null;
  notes: string | null;

  distance: string | null;
  duration: string | null;
  pace: string | null;
  effort: string | null;

  confidence: Confidence;
}

export interface ModelUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface RunLogInterval {
  distance: number | null;
  pace: string | null;
  hr: number | null;
}

export interface ParsedWorkout {
  ok: true;
  name: string;
  sport: Sport;
  exercises: ParsedExercise[];
  /** Per-interval log when the input is an endurance screenshot. Optional —
   *  text-parsed sessions don't populate this. */
  runLog?: RunLogInterval[];
  raw: string;
  rawModelOutput: string;
  usage: ModelUsage | null;
}

export type ParseFailureReason =
  | "empty_input"
  | "no_exercises_found"
  | "model_error"
  | "json_parse_error"
  | "images_appear_to_be_different_activities"
  | "sport_unclear"
  | "appears_to_be_strength_session";

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  message: string;
  raw: string;
  rawModelOutput: string | null;
  usage: ModelUsage | null;
}

export type ParseResult = ParsedWorkout | ParseFailure;

export interface ParseOptions {
  sport?: Sport;
  sessionName?: string;
}
