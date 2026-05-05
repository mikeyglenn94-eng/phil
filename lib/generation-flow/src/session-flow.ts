import { openai } from "@workspace/integrations-openai-ai-server";
import { SESSION_GENERATOR_SYSTEM } from "./prompts.js";
import { advanceFlow, isComplete, startFlow, withAssistantMessage } from "./flow-base.js";
import {
  getSlotList,
  nextUnfilledSlot,
  type FlowState,
  type GeneratedSession,
  type SessionFlowContext,
  type SlotValues,
} from "./types.js";

const SESSION_MODEL = "gpt-5.2";
const SESSION_TOKENS = 4096;

export type SessionFlowState = FlowState<SessionFlowContext>;

export function startSessionFlow(context: SessionFlowContext): SessionFlowState {
  return startFlow("session", context);
}

export {
  advanceFlow as advanceSessionFlow,
  isComplete as isSessionFlowComplete,
  withAssistantMessage as withAssistantMessageSession,
};

export async function generate(state: SessionFlowState): Promise<GeneratedSession> {
  if (!isComplete(state)) {
    throw new Error("generate: session flow state is not complete");
  }

  const brief = formatSlotsAsBrief(state.slots, state.context);
  const completion = await openai.chat.completions.create({
    model: SESSION_MODEL,
    max_completion_tokens: SESSION_TOKENS,
    messages: [
      { role: "system", content: SESSION_GENERATOR_SYSTEM },
      { role: "user", content: brief },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = parseJsonOrThrow(raw);

  return {
    name: typeof parsed.name === "string" ? parsed.name : "Session",
    source: typeof parsed.source === "string" ? parsed.source : undefined,
    structure: typeof parsed.structure === "string" ? parsed.structure : undefined,
    color: typeof parsed.color === "string" ? parsed.color : undefined,
    exercises: Array.isArray(parsed.exercises)
      ? (parsed.exercises as GeneratedSession["exercises"])
      : [],
  };
}

function formatSlotsAsBrief(slots: SlotValues, context: SessionFlowContext): string {
  return [
    "FILLED SLOT VALUES:",
    JSON.stringify(slots, null, 2),
    "",
    "ATHLETE CONTEXT:",
    JSON.stringify(
      {
        clientName: context.clientName ?? null,
        fivekSeconds: context.fivekSeconds ?? null,
        tenkSeconds: context.tenkSeconds ?? null,
      },
      null,
      2,
    ),
    "",
    "Generate exactly one session per the philosophy and the slot values above.",
  ].join("\n");
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
        throw new Error("Session generator returned invalid JSON");
      }
    }
    throw new Error("Session generator returned no JSON");
  }
}

export function currentSlot(state: SessionFlowState): string | null {
  if (isComplete(state)) return null;
  const defs = getSlotList("session");
  return nextUnfilledSlot(state.slots, defs)?.name ?? null;
}
