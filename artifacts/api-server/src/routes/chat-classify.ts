/**
 * POST /chat-classify
 *
 * Pure-extraction intent classifier for the Phil chat dispatcher. Given a user
 * message and a tiny bit of context, returns one of five labels:
 *
 *   - "start_programme_flow"
 *   - "start_session_flow"
 *   - "start_modification_flow"
 *   - "start_progression_flow"
 *   - "chat"  (everything else — falls through to legacy free-form Phil)
 *
 * No personality, no philosophy. Single label. Cheap (gpt-4o-mini).
 *
 * The frontend wraps this — generation labels start the corresponding state
 * machine, "chat" hands off to the existing legacy classifier so review /
 * library / schedule / conversational paths survive intact.
 */

import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logApiCost } from "../lib/log-api-cost";

const router: IRouter = Router();

const MODEL = "gpt-4o-mini";

const VALID_INTENTS = new Set([
  "start_programme_flow",
  "start_session_flow",
  "start_modification_flow",
  "start_progression_flow",
  "chat",
]);

const SYSTEM_PROMPT = `You classify a single user message into ONE of five intent labels for a fitness coaching app called Phil.

You return ONLY the label. No prose, no JSON, no quotes. One bare lowercase label per response.

The five labels:

start_programme_flow
  - Build a new multi-week training programme.
  - Examples: "build me a programme", "create a 4-week plan", "I need a new programme", "design me a 6-week strength block", "start a hyrox block", "I'm training for a marathon"
  - Goal statements that imply a programme: "I want to get stronger", "training for a half marathon"

start_session_flow
  - Generate ONE single workout session.
  - Examples: "add a session today", "give me a leg session", "build me a 45-min upper body workout", "what should I do today" (when generation is implied)

start_modification_flow
  - Modify an existing programme. Pain, equipment changes, difficulty complaints, explicit swaps.
  - Examples: "my back hurts", "knee is sore", "swap deadlifts for hip thrust", "this is too easy", "lost gym access", "rdl is aggravating my back"
  - Note: if the user has no active programme (hasActiveProgramme=false), modification requests fall back to start_programme_flow because there's nothing to modify yet.

start_progression_flow
  - Repeat / progress sessions across future weeks.
  - Examples: "repeat this week with progression", "progress my current block", "extend the block by 4 weeks", "do this for the next 4 weeks", "repeat for 3 weeks"

chat
  - Anything else: questions, advice, status checks, motivation, scheduling commands, library searches, reviews, greetings, social.
  - Examples: "how am I doing this week?", "what's my fitness score", "good morning", "thanks", "review my week", "find me a 30-min wod", "copy this week to next week"

Routing rules:
- Default to "chat" if uncertain. Better Phil asks "did you mean to build a programme?" than to drop someone into a flow they didn't want.
- Pain words ("hurts", "sore", "niggle", "tweaked") → start_modification_flow if hasActiveProgramme=true, else start_programme_flow.
- Calendar commands ("copy this week", "delete sessions") → chat (the legacy scheduler handles them).
- Library / search / browse → chat.

Output: ONE label, lowercase, no surrounding text.`;

interface ClassifyBody {
  message: string;
  hasActiveProgramme?: boolean;
}

router.post("/chat-classify", async (req, res): Promise<void> => {
  const { message, hasActiveProgramme } = (req.body ?? {}) as ClassifyBody;
  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const userContent = `User message: ${message.trim()}\n\nhasActiveProgramme: ${hasActiveProgramme ? "true" : "false"}\n\nReturn one label.`;

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 16,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    void logApiCost({
      userId: req.auth?.userId,
      endpoint: "chat-classify",
      model: MODEL,
      usage: completion.usage,
    });

    const raw = (completion.choices[0]?.message?.content ?? "").trim().toLowerCase();
    // Defensive: extract any of the known labels from the response, in case the
    // model wraps it in punctuation or a sentence.
    let intent = "chat";
    for (const candidate of VALID_INTENTS) {
      if (raw.includes(candidate)) {
        intent = candidate;
        break;
      }
    }

    res.json({ intent });
  } catch (err) {
    req.log.warn({ err }, "chat-classify failed; defaulting to chat");
    // Never block the chat — failure mode is "fall through to legacy".
    res.json({ intent: "chat" });
  }
});

export default router;
