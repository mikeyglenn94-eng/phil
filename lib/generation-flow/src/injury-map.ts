// Hand-coded body-part → exercise-name keyword map.
// Used as a deterministic safety net layered on top of the LLM-driven
// affected-exercises identifier for `modification_type: swap_aggravating_exercises`.
//
// Keep this map exhaustive but conservative — better to flag a movement as
// possibly affected and let the user keep it than to miss it.

export const INJURY_MAP: Record<string, string[]> = {
  back: [
    "deadlift", "romanian deadlift", "rdl", "good morning",
    "bent over row", "back squat", "barbell row", "hyperextension",
    "stiff leg", "sumo deadlift", "rack pull",
  ],
  knee: [
    "squat", "lunge", "leg press", "step up", "bulgarian split squat",
    "hack squat", "leg extension", "running", "jump", "box jump",
  ],
  shoulder: [
    "bench press", "overhead press", "ohp", "lateral raise",
    "upright row", "pull up", "chin up", "dip", "arnold press",
    "front raise", "face pull", "cable fly", "chest fly",
  ],
  elbow: [
    "bench press", "incline bench", "decline bench", "close grip bench",
    "overhead press", "strict press", "ohp", "dip", "skull crusher",
    "tricep pushdown", "tricep extension", "push up", "db press",
    "dumbbell press", "cable pushdown", "french press", "curl",
    "bicep curl", "hammer curl", "preacher curl", "row", "pull down",
    "lat pulldown", "seated row", "cable row",
  ],
  wrist: [
    "bench press", "overhead press", "front squat", "clean",
    "snatch", "curl", "wrist curl", "push up",
  ],
  hip: [
    "squat", "deadlift", "lunge", "hip thrust", "running",
    "leg press", "step up", "bulgarian split squat",
  ],
};

/** Keyword extraction: pick the first body part mentioned in free text. */
export function detectBodyPart(text: string): string | null {
  const t = text.toLowerCase();
  if (/(lower\s*back|low\s*back|back\b)/.test(t)) return "back";
  if (/\bknee/.test(t)) return "knee";
  if (/\bshoulder/.test(t)) return "shoulder";
  if (/(elbow|golfer'?s|tennis\s+elbow|epicondylitis)/.test(t)) return "elbow";
  if (/\bwrist/.test(t)) return "wrist";
  if (/\bhip/.test(t)) return "hip";
  return null;
}

export function injuryMatches(exerciseName: string, bodyPart: string): boolean {
  const list = INJURY_MAP[bodyPart];
  if (!list) return false;
  const ex = exerciseName.toLowerCase();
  return list.some((kw) => ex.includes(kw));
}
