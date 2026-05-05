import { openai } from "@workspace/integrations-openai-ai-server";
import { PROGRAMME_GENERATOR_SYSTEM } from "./prompts.js";
import { advanceFlow, isComplete, startFlow, withAssistantMessage } from "./flow-base.js";
import {
  getSlotList,
  nextUnfilledSlot,
  type FlowState,
  type GeneratedProgramme,
  type ProgrammeFlowContext,
  type SlotValues,
} from "./types.js";

const PROGRAMME_MODEL = "gpt-5.2";
const PROGRAMME_PREVIEW_TOKENS = 8192;
const PROGRAMME_FULL_TOKENS = 32768;

export type ProgrammeFlowState = FlowState<ProgrammeFlowContext>;

export function startProgrammeFlow(context: ProgrammeFlowContext): ProgrammeFlowState {
  return startFlow("programme", context);
}

export {
  advanceFlow as advanceProgrammeFlow,
  isComplete as isProgrammeFlowComplete,
  withAssistantMessage as withAssistantMessageProgramme,
};

/** True when every slot except preview_confirmed is filled — preview can be built. */
export function previewReady(state: ProgrammeFlowState): boolean {
  if (state.previewGenerated) return false;
  const defs = getSlotList("programme");
  for (const def of defs) {
    if (def.name === "preview_confirmed") continue;
    if (state.slots[def.name] == null) return false;
  }
  return true;
}

/** Generate the week-1 preview. Throws if previewReady() is false. */
export async function generatePreview(state: ProgrammeFlowState): Promise<GeneratedProgramme> {
  if (!previewReady(state)) {
    throw new Error("generatePreview: state is not previewReady");
  }
  return runGenerator(state, "preview");
}

/** Generate the full multi-week programme. Throws if isComplete() is false. */
export async function generate(state: ProgrammeFlowState): Promise<GeneratedProgramme> {
  if (!isComplete(state)) {
    throw new Error("generate: state is not complete");
  }
  return runGenerator(state, "full");
}

async function runGenerator(
  state: ProgrammeFlowState,
  mode: "preview" | "full",
): Promise<GeneratedProgramme> {
  const brief = formatSlotsAsBrief(state.slots, state.context, mode);
  const completion = await openai.chat.completions.create({
    model: PROGRAMME_MODEL,
    max_completion_tokens: mode === "preview" ? PROGRAMME_PREVIEW_TOKENS : PROGRAMME_FULL_TOKENS,
    messages: [
      { role: "system", content: PROGRAMME_GENERATOR_SYSTEM },
      { role: "user", content: brief },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow(raw);

  return {
    title: typeof parsed.title === "string" ? parsed.title : "Programme",
    blockLength: typeof parsed.blockLength === "number" ? parsed.blockLength : null,
    sessionsPerWeek: typeof parsed.sessionsPerWeek === "number" ? parsed.sessionsPerWeek : null,
    sessions: Array.isArray(parsed.sessions) ? (parsed.sessions as GeneratedProgramme["sessions"]) : [],
  };
}

function formatSlotsAsBrief(
  slots: SlotValues,
  context: ProgrammeFlowContext,
  mode: "preview" | "full",
): string {
  const lines: string[] = [];
  lines.push("FILLED SLOT VALUES:");
  lines.push(JSON.stringify(slots, null, 2));
  lines.push("");
  lines.push("ATHLETE CONTEXT:");
  lines.push(JSON.stringify(contextSnapshot(context), null, 2));
  lines.push("");
  lines.push(`MODE: ${mode}`);
  if (mode === "preview") {
    lines.push("Generate EXACTLY 1 week of sessions. blockLength=1. dayNumber 1–7 only.");
  } else {
    lines.push("Generate the full multi-week block per the philosophy.");
  }
  return lines.join("\n");
}

function contextSnapshot(context: ProgrammeFlowContext): Record<string, unknown> {
  return {
    clientName: context.clientName ?? null,
    fivekSeconds: context.fivekSeconds ?? null,
    tenkSeconds: context.tenkSeconds ?? null,
  };
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
        throw new Error("Generator returned invalid JSON");
      }
    }
    throw new Error("Generator returned no JSON");
  }
}

/** Helper: which slot the next question should target. */
export function currentSlot(state: ProgrammeFlowState): string | null {
  if (isComplete(state)) return null;
  const defs = getSlotList("programme");
  return nextUnfilledSlot(state.slots, defs)?.name ?? null;
}
