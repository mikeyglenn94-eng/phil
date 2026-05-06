/**
 * parseWorkoutFromImage — vision-based extraction of endurance session
 * TOTALS from screenshots. The caller has already disambiguated sport via
 * the UI tab the user is on, so sport is required and not detected from
 * the image.
 *
 * Output is a single ParsedExercise row with distance + duration + pace.
 * No splits, no per-interval HR — Phil only needs the totals to populate
 * weekly distance / pace trends. Splits live in Strava.
 */

import { openai } from "@workspace/integrations-openai-ai-server";
import type { ModelUsage, ParseResult, ParsedExercise } from "./types.js";

const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 1024;

export type EnduranceSport = "run" | "cycle" | "swim";

export interface ImageInput {
  /** Base64-encoded image data, no data: URI prefix. */
  base64: string;
  mimeType: string;
}

export interface ParseFromImageOptions {
  /** Required — the tab the user is on. The model does not detect sport. */
  sport: EnduranceSport;
  sessionName?: string;
}

function buildSystemPrompt(sport: EnduranceSport): string {
  const paceFormat = sport === "swim" ? `"M:SS/100m" (e.g. "1:42/100m")` : `"M:SS/km" (e.g. "4:33/km")`;
  const paceConvert =
    sport === "swim"
      ? "If shown as min/100yd, convert to min/100m (multiply by 1.0936)."
      : "If shown as min/mile, convert to min/km (divide by 1.609). Always include the /km suffix.";
  return `You read totals off endurance-activity screenshots. The sport is ${sport}. The user has uploaded one or more images that are different views of the SAME activity.

You have NO personality. You ONLY produce JSON.

## Extract
- distanceKm: total distance in kilometres (convert miles to km if shown — multiply by 1.609).
- durationSeconds: total or moving time, in seconds.
- avgPace: average pace as a string in the format ${paceFormat}. ${paceConvert} ALWAYS include the unit suffix in the string. Examples: "4:33/km", "5:12/km", "1:42/100m". Never return a bare "4:33" without the suffix.
- date: ISO date string (YYYY-MM-DD) if visible, else null.
- name: activity title from the screenshot if visible, else null.

## Failure
If the images clearly show DIFFERENT activities (different distance, different time, different date), return:
{ "ok": false, "reason": "images_appear_to_be_different_activities", "message": "<short explanation>" }

## Success
{ "ok": true, "distanceKm": <number>, "durationSeconds": <number>, "avgPace": ${paceFormat} | null, "date": "<YYYY-MM-DD>" | null, "name": "<string>" | null }

Return ONLY the JSON object. No markdown fences. No commentary.`;
}

export async function parseWorkoutFromImage(
  images: ImageInput[],
  opts: ParseFromImageOptions,
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

  if (opts.sessionName?.trim()) {
    userParts.push({ type: "text", text: `Session name from user: ${opts.sessionName.trim()}` });
  }

  let rawModelOutput = "";
  let usage: ModelUsage | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: buildSystemPrompt(opts.sport) },
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
    if (parsed.reason === "images_appear_to_be_different_activities") {
      return {
        ok: false,
        reason: "images_appear_to_be_different_activities",
        message:
          typeof parsed.message === "string" && parsed.message.trim().length > 0
            ? parsed.message.trim()
            : "These look like different activities. Try uploading screenshots from one session at a time.",
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

  const distanceKm = typeof parsed.distanceKm === "number" ? parsed.distanceKm : null;
  const durationSeconds =
    typeof parsed.durationSeconds === "number" ? parsed.durationSeconds : null;
  const avgPace =
    typeof parsed.avgPace === "string" && parsed.avgPace.trim().length > 0
      ? normalisePaceSuffix(parsed.avgPace.trim(), opts.sport)
      : null;
  const date =
    typeof parsed.date === "string" && parsed.date.trim().length > 0 ? parsed.date.trim() : null;

  if (distanceKm == null && durationSeconds == null && avgPace == null) {
    return {
      ok: false,
      reason: "no_exercises_found",
      message: "Couldn't extract any data from the screenshot.",
      raw: "",
      rawModelOutput,
      usage,
    };
  }

  // Notes carry only the date — distance / duration / pace each have their
  // own ParsedExercise field, and adapt.ts's composeNotes will append pace.
  // Putting them in notes would duplicate them in the saved session.
  const exercise: ParsedExercise = {
    name: defaultExerciseName(opts.sport),
    sets: 1,
    reps: "",
    weight: null,
    rpe: null,
    tempo: null,
    rest: null,
    notes: date,
    distance: distanceKm != null ? `${distanceKm}km` : null,
    duration: durationSeconds != null ? formatDuration(durationSeconds) : null,
    pace: avgPace,
    effort: null,
    confidence: "high",
  };

  const modelName =
    typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "";
  const name = opts.sessionName?.trim() || modelName || autoName(opts.sport);

  return {
    ok: true,
    name,
    sport: opts.sport,
    exercises: [exercise],
    raw: "",
    rawModelOutput,
    usage,
  };
}

function defaultExerciseName(sport: EnduranceSport): string {
  switch (sport) {
    case "run":
      return "Run";
    case "cycle":
      return "Ride";
    case "swim":
      return "Swim";
  }
}

function autoName(sport: EnduranceSport): string {
  switch (sport) {
    case "run":
      return "Run Session";
    case "cycle":
      return "Cycle Session";
    case "swim":
      return "Swim Session";
  }
}

/** Defensive: if the model returns a bare "4:33" we tack on the unit suffix
 *  so downstream rendering shows the expected "4:33/km" form. */
function normalisePaceSuffix(pace: string, sport: EnduranceSport): string {
  if (/\/(km|100m|100yd|mi|mile)\b/i.test(pace)) return pace;
  const suffix = sport === "swim" ? "/100m" : "/km";
  return `${pace}${suffix}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
