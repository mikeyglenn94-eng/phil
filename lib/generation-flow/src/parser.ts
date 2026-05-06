import { openai } from "@workspace/integrations-openai-ai-server";
import { SLOT_PARSER_SYSTEM } from "./prompts.js";
import type { SlotDef, SlotValue } from "./types.js";

export interface ParsedSlots {
  /** Slot name → extracted value. Missing slots = user did not answer. */
  extracted: Record<string, SlotValue | null>;
  /** Slot name → reason the parser couldn't extract a clean value. */
  failures: Record<string, string>;
}

const PARSER_MODEL = "gpt-5.2";

export async function parseSlots(opts: {
  userMessage: string;
  candidateSlots: SlotDef[];
}): Promise<ParsedSlots> {
  const { userMessage, candidateSlots } = opts;

  if (candidateSlots.length === 0) {
    return { extracted: {}, failures: {} };
  }

  const slotSpec = candidateSlots.map(slotToSpec);

  const userContent = `Slot definitions:\n${JSON.stringify(slotSpec, null, 2)}\n\nUser message:\n"""${userMessage}"""\n\nExtract any slot values the user gave. Return JSON.`;

  const completion = await openai.chat.completions.create({
    model: PARSER_MODEL,
    max_completion_tokens: 1024,
    messages: [
      { role: "system", content: SLOT_PARSER_SYSTEM },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let parsed: ParsedSlots;
  try {
    const j = JSON.parse(raw) as Partial<ParsedSlots>;
    parsed = {
      extracted: (j.extracted ?? {}) as Record<string, SlotValue | null>,
      failures: (j.failures ?? {}) as Record<string, string>,
    };
  } catch {
    parsed = { extracted: {}, failures: {} };
  }

  return validateExtracted(parsed, candidateSlots);
}

function slotToSpec(def: SlotDef) {
  return {
    name: def.name,
    kind: def.kind,
    // Only enabled options are sent to the LLM as valid extractables. Disabled
    // values are listed separately so the LLM knows to route those answers to
    // "other" with a free-text note instead of selecting a value the
    // validator will reject.
    options: def.options?.filter((o) => !o.disabled).map((o) => o.value),
    disabledOptions: def.options?.filter((o) => o.disabled).map((o) => o.value),
    allowOther: def.allowOther ?? false,
    hint: def.hint,
  };
}

function validateExtracted(parsed: ParsedSlots, defs: SlotDef[]): ParsedSlots {
  const result: ParsedSlots = { extracted: {}, failures: { ...parsed.failures } };

  for (const def of defs) {
    const raw = parsed.extracted[def.name];
    if (raw === undefined) continue;

    const validated = coerceSlot(def, raw);
    if (validated.ok) {
      result.extracted[def.name] = validated.value;
    } else {
      result.failures[def.name] = validated.reason;
    }
  }

  return result;
}

type CoerceResult =
  | { ok: true; value: SlotValue | null }
  | { ok: false; reason: string };

function coerceSlot(def: SlotDef, raw: unknown): CoerceResult {
  if (raw == null) return { ok: true, value: null };

  switch (def.kind) {
    case "single_select":
      return coerceSingleSelect(def, raw);
    case "multi_select":
      return coerceMultiSelect(def, raw);
    case "free_text":
      return coerceFreeText(raw);
    case "bool":
      return coerceBool(raw);
  }
}

function coerceSingleSelect(def: SlotDef, raw: unknown): CoerceResult {
  // Build the set of accepted values: enabled options + "other" if allowed.
  // Disabled options are dropped from the validator so the model / user can't
  // route the flow into a coming-soon path.
  const enabledValues = new Set(
    (def.options ?? []).filter((o) => !o.disabled).map((o) => o.value),
  );
  const disabledValues = new Set(
    (def.options ?? []).filter((o) => o.disabled).map((o) => o.value),
  );
  const validValues = new Set(enabledValues);
  if (def.allowOther) validValues.add("other");

  const rejectIfDisabled = (v: string): CoerceResult | null =>
    disabledValues.has(v)
      ? {
          ok: false,
          reason: `value "${v}" is currently disabled (coming soon). Pick one of: ${[...enabledValues].join(", ")}`,
        }
      : null;

  if (typeof raw === "string") {
    const disabledReject = rejectIfDisabled(raw);
    if (disabledReject) return disabledReject;
    if (validValues.has(raw)) return { ok: true, value: raw };
    return {
      ok: false,
      reason: `value "${raw}" is not one of ${[...validValues].join(", ")}`,
    };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as { value?: unknown; note?: unknown };
    const v = typeof obj.value === "string" ? obj.value : null;
    if (!v) return { ok: false, reason: "object value missing valid 'value' field" };
    const disabledReject = rejectIfDisabled(v);
    if (disabledReject) return disabledReject;
    if (validValues.has(v)) {
      const note = typeof obj.note === "string" ? obj.note.trim() : "";
      return { ok: true, value: { value: v, note: note || null } };
    }
    return { ok: false, reason: "object value missing valid 'value' field" };
  }
  return { ok: false, reason: "expected string or {value,note}" };
}

function coerceMultiSelect(def: SlotDef, raw: unknown): CoerceResult {
  const validValues = new Set(def.options?.map((o) => o.value) ?? []);
  if (def.allowOther) validValues.add("other");

  if (!Array.isArray(raw)) {
    return { ok: false, reason: "expected array" };
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") {
      return { ok: false, reason: "array item not a string" };
    }
    if (!validValues.has(v)) {
      return {
        ok: false,
        reason: `value "${v}" is not one of ${[...validValues].join(", ")}`,
      };
    }
    out.push(v);
  }
  return { ok: true, value: out };
}

function coerceFreeText(raw: unknown): CoerceResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "expected string" };
  }
  return { ok: true, value: raw.trim() };
}

function coerceBool(raw: unknown): CoerceResult {
  if (typeof raw === "boolean") return { ok: true, value: raw };
  return { ok: false, reason: "expected boolean" };
}
