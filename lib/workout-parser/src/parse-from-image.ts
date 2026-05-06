/**
 * parseWorkoutFromImage — vision-based extraction of endurance sessions from
 * screenshots. Same ParseResult shape as the text parser. Pure extraction,
 * no personality.
 *
 * Accepts 1+ images of a single activity (e.g. Strava map view + splits view).
 * Returns either a ParsedWorkout (with runLog populated for splits) or a
 * ParseFailure with a reason the UI can branch on.
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import type {
  ModelUsage,
  ParseResult,
  ParsedExercise,
  RunLogInterval,
  Sport,
} from "./types.js";

const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 4096;

export interface ImageInput {
  /** Base64-encoded image data, no data: URI prefix. */
  base64: string;
  mimeType: string;
}

export interface ParseFromImageOptions {
  /** Optional sport hint when the user has already disambiguated. */
  sport?: Sport;
  sessionName?: string;
}

const SYSTEM_PROMPT = `You are an endurance-activity screenshot reader. You receive 1+ images of ONE endurance session from apps like Strava, Garmin Connect, Apple Fitness, Coros, or treadmill consoles. Extract the data into a strict JSON object.

You have NO personality. You ONLY produce JSON.

## Multi-image handling
All images you receive are different VIEWS of the SAME activity (map view, splits view, summary). Merge overlapping data. If two views disagree, prefer the more detailed one. If the images clearly show DIFFERENT activities (different distances, different times, different sports, different dates), return failure with reason "images_appear_to_be_different_activities".

## Sport detection
Identify by icons, terminology, and split format:
- Run: km splits, footprint icon, pace shown as min/km
- Cycle: km splits, bicycle icon, speed shown as kph or mph, often higher distances (>20km)
- Swim: lap splits (typically 25m / 50m / 100m), pool icon, pace as min/100m

If the screenshot is a STRENGTH session (Hevy, Strong, weights in kg/lb, sets x reps logged), return failure with reason "appears_to_be_strength_session".

If the sport is genuinely ambiguous, return failure with reason "sport_unclear".

## Unit normalisation
- Distance: always km. Convert miles to km (multiply by 1.609).
- Pace: always MM:SS per km for run/cycle, MM:SS per 100m for swim. Convert min/mi to min/km (divide by 1.609).
- Duration: total or moving time, in seconds.
- Heart rate: bpm, integer.

## Output

SUCCESS:
{
  "ok": true,
  "sport": "run" | "cycle" | "swim",
  "name": "<title from screenshot if visible, else null>",
  "distanceKm": <number>,
  "durationSeconds": <number>,
  "avgPace": "<MM:SS>" | null,
  "avgHr": <integer> | null,
  "splits": [
    { "distanceKm": <number, default 1.0>, "pace": "<MM:SS>", "hr": <integer or null> }
  ]
}

FAILURE:
{ "ok": false, "reason": "images_appear_to_be_different_activities" | "sport_unclear" | "appears_to_be_strength_session", "message": "<short user-facing explanation>" }

Return ONLY the JSON object. No markdown fences. No commentary.`;

export async function parseWorkoutFromImage(
  images: ImageInput[],
  opts: ParseFromImageOptions = {},
): Promise<ParseResult> {
  if (!images || images.length === 0) {
    return {
      ok: false,
      reason: "empty_input",
      message: "No images provided.",
      raw: "",
      rawModelOutput: null,
      usage: null,
    };
  }

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } };

  const userParts: ContentPart[] = images.map((img) => ({
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.base64}`,
      detail: "low",
    },
  }));

  const hintLines: string[] = [];
  if (opts.sport) hintLines.push(`Sport hint from user: ${opts.sport}`);
  if (opts.sessionName?.trim()) hintLines.push(`Session name from user: ${opts.sessionName.trim()}`);
  if (hintLines.length > 0) {
    userParts.push({ type: "text", text: hintLines.join("\n") });
  }

  let rawModelOutput = "";
  let usage: ModelUsage | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userParts as never },
      ],
      response_format: { type: "json_object" },
    });
    rawModelOutput = completion.choices[0]?.message?.content ?? "";
    usage = completion.usage
      ? {
          prompt_tokens: completion.usage.prompt_tokens,
          completion_tokens: completion.usage.completion_tokens,
          total_tokens: completion.usage.total_tokens,
        }
      : null;
  } catch (err) {
    return {
      ok: false,
      reason: "model_error",
      message: err instanceof Error ? err.message : "Vision model call failed.",
      raw: "",
      rawModelOutput: rawModelOutput || null,
      usage,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawModelOutput) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      reason: "json_parse_error",
      message: "Vision model returned invalid JSON.",
      raw: "",
      rawModelOutput,
      usage,
    };
  }

  if (parsed.ok === false) {
    const reason = parsed.reason;
    if (
      reason === "images_appear_to_be_different_activities" ||
      reason === "sport_unclear" ||
      reason === "appears_to_be_strength_session"
    ) {
      return {
        ok: false,
        reason,
        message:
          typeof parsed.message === "string" && parsed.message.trim().length > 0
            ? parsed.message.trim()
            : defaultMessageFor(reason),
        raw: "",
        rawModelOutput,
        usage,
      };
    }
    return {
      ok: false,
      reason: "model_error",
      message:
        typeof parsed.message === "string" ? parsed.message : "Unknown failure from vision model.",
      raw: "",
      rawModelOutput,
      usage,
    };
  }

  const sportRaw = typeof parsed.sport === "string" ? parsed.sport.toLowerCase() : "";
  const sport: Sport =
    sportRaw === "cycle" || sportRaw === "swim" || sportRaw === "run"
      ? (sportRaw as Sport)
      : opts.sport ?? "run";

  const distanceKm = typeof parsed.distanceKm === "number" ? parsed.distanceKm : null;
  const durationSeconds =
    typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : null;
  const avgPace = typeof parsed.avgPace === "string" ? parsed.avgPace : null;
  const avgHr = typeof parsed.avgHr === "number" ? Math.round(parsed.avgHr) : null;

  const splits: RunLogInterval[] = Array.isArray(parsed.splits)
    ? parsed.splits.map((s) => coerceSplit(s)).filter((s): s is RunLogInterval => s !== null)
    : [];

  if (distanceKm == null && durationSeconds == null && splits.length === 0) {
    return {
      ok: false,
      reason: "no_exercises_found",
      message: "Couldn't extract any data from the screenshot.",
      raw: "",
      rawModelOutput,
      usage,
    };
  }

  const summaryNotes = [
    distanceKm != null ? `${distanceKm} km` : null,
    durationSeconds != null ? formatDuration(durationSeconds) : null,
    avgPace ? `@ ${avgPace}` : null,
    avgHr != null ? `${avgHr} bpm avg` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const exercise: ParsedExercise = {
    name: defaultExerciseName(sport),
    sets: 1,
    reps: "",
    weight: null,
    rpe: null,
    tempo: null,
    rest: null,
    notes: summaryNotes || null,
    distance: distanceKm != null ? `${distanceKm}km` : null,
    duration: durationSeconds != null ? formatDuration(durationSeconds) : null,
    pace: avgPace,
    effort: null,
    confidence: "high",
  };

  const modelName = typeof parsed.name === "string" && parsed.name.trim().length > 0
    ? parsed.name.trim()
    : "";
  const name = opts.sessionName?.trim() || modelName || autoName(sport);

  return {
    ok: true,
    name,
    sport,
    exercises: [exercise],
    runLog: splits.length > 0 ? splits : undefined,
    raw: "",
    rawModelOutput,
    usage,
  };
}

function coerceSplit(raw: unknown): RunLogInterval | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const distance = typeof r.distanceKm === "number" ? r.distanceKm : null;
  const pace = typeof r.pace === "string" && r.pace.trim().length > 0 ? r.pace.trim() : null;
  const hr = typeof r.hr === "number" ? Math.round(r.hr) : null;
  if (distance == null && pace == null && hr == null) return null;
  return { distance, pace, hr };
}

function defaultMessageFor(reason: string): string {
  switch (reason) {
    case "images_appear_to_be_different_activities":
      return "These look like different activities. Try uploading screenshots from one session at a time.";
    case "sport_unclear":
      return "Couldn't tell what sport this is. Tell us and try again.";
    case "appears_to_be_strength_session":
      return "This looks like a strength session. Want to log it that way instead?";
    default:
      return "Couldn't read this screenshot.";
  }
}

function defaultExerciseName(sport: Sport): string {
  switch (sport) {
    case "run":
      return "Run";
    case "cycle":
      return "Ride";
    case "swim":
      return "Swim";
    default:
      return "Session";
  }
}

function autoName(sport: Sport): string {
  switch (sport) {
    case "strength":
      return "Strength Session";
    case "run":
      return "Run Session";
    case "cycle":
      return "Cycle Session";
    case "swim":
      return "Swim Session";
  }
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
