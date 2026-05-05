import { openai } from "@workspace/integrations-openai-ai-server";
import { STRENGTH_PROMPT, ENDURANCE_PROMPT } from "./prompt.js";
import type { ModelUsage, ParseOptions, ParseResult, ParsedExercise, Sport } from "./types.js";

const MODEL = "gpt-5.2";
const MAX_TOKENS = 16384;

export async function parseWorkout(
  input: string,
  opts: ParseOptions = {},
): Promise<ParseResult> {
  const raw = (input ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      reason: "empty_input",
      message: "Input is empty.",
      raw,
      rawModelOutput: null,
      usage: null,
    };
  }

  const sport: Sport = opts.sport ?? "strength";
  const isEndurance = sport === "run" || sport === "cycle" || sport === "swim";
  const systemPrompt = isEndurance ? ENDURANCE_PROMPT : STRENGTH_PROMPT;

  const userParts = [
    opts.sessionName?.trim() ? `Session name (provided by user): ${opts.sessionName.trim()}` : null,
    `Sport: ${sport}`,
    `Workout description (text or voice transcript):`,
    raw,
  ].filter((s): s is string => Boolean(s));

  let rawModelOutput = "";
  let usage: ModelUsage | null = null;
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n\n") },
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
      message: err instanceof Error ? err.message : "Model call failed.",
      raw,
      rawModelOutput: rawModelOutput || null,
      usage,
    };
  }

  let parsed: { name?: unknown; exercises?: unknown };
  try {
    parsed = JSON.parse(rawModelOutput);
  } catch {
    return {
      ok: false,
      reason: "json_parse_error",
      message: "Model returned invalid JSON.",
      raw,
      rawModelOutput,
      usage,
    };
  }

  const exercises: ParsedExercise[] = Array.isArray(parsed.exercises)
    ? parsed.exercises.map((e) => coerceExercise(e, isEndurance))
    : [];

  if (exercises.length === 0) {
    return {
      ok: false,
      reason: "no_exercises_found",
      message: "No exercises detected in input.",
      raw,
      rawModelOutput,
      usage,
    };
  }

  const modelName =
    typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "";
  const name =
    opts.sessionName?.trim() || modelName || autoName(sport);

  return {
    ok: true,
    name,
    sport,
    exercises,
    raw,
    rawModelOutput,
    usage,
  };
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

function coerceExercise(raw: unknown, isEndurance: boolean): ParsedExercise {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    name: stringOrEmpty(r.name).trim(),
    sets: coerceSets(r.sets),
    reps: r.reps != null ? String(r.reps) : "",
    weight: isEndurance ? null : stringOrNull(r.weight),
    rpe: stringOrNull(r.rpe),
    tempo: isEndurance ? null : stringOrNull(r.tempo),
    rest: stringOrNull(r.rest),
    notes: stringOrNull(r.notes),
    distance: isEndurance ? stringOrNull(r.distance) : null,
    duration: isEndurance ? stringOrNull(r.duration) : null,
    pace: isEndurance ? stringOrNull(r.pace) : null,
    effort: isEndurance ? stringOrNull(r.effort) : null,
    confidence: r.confidence === "low" ? "low" : "high",
  };
}

function stringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function stringOrEmpty(v: unknown): string {
  return v == null ? "" : String(v);
}

function coerceSets(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}
