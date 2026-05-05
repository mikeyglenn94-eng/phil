import { openai } from "@workspace/integrations-openai-ai-server";
import { QUESTION_WRITER_SYSTEM } from "./prompts.js";
import type { FlowMessage, SlotDef } from "./types.js";

const QUESTION_MODEL = "gpt-5.2";

export async function writeQuestion(opts: {
  slot: SlotDef;
  history: FlowMessage[];
  lastParseFailure?: string | null;
  /** Was the user's most recent message off-topic? Triggers a redirect line. */
  offTopic?: boolean;
}): Promise<string> {
  const { slot, history, lastParseFailure, offTopic } = opts;

  const slotBrief = `Current slot:\n${JSON.stringify({
    name: slot.name,
    kind: slot.kind,
    hint: slot.hint,
    options: slot.options?.map((o) => o.label),
    allowOther: slot.allowOther ?? false,
  }, null, 2)}`;

  const failureBrief = lastParseFailure
    ? `\n\nThe previous user message did not give a usable answer. Reason: ${lastParseFailure}\nRephrase your question more concretely.`
    : "";

  const offTopicBrief = offTopic
    ? `\n\nThe user's most recent message went off-topic. Redirect them back to the current question in one short line. Do not engage with the off-topic content.`
    : "";

  const userContent = `${slotBrief}${failureBrief}${offTopicBrief}\n\nWrite the next question.`;

  const completion = await openai.chat.completions.create({
    model: QUESTION_MODEL,
    max_completion_tokens: 256,
    messages: [
      { role: "system", content: QUESTION_WRITER_SYSTEM },
      ...truncateHistory(history),
      { role: "user", content: userContent },
    ],
  });

  return (completion.choices[0]?.message?.content ?? "").trim();
}

/** Keep only the last 6 turns so the writer has context but the prompt stays cheap. */
function truncateHistory(history: FlowMessage[]): FlowMessage[] {
  return history.slice(-6);
}
