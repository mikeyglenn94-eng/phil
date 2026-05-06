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
  - "plan" and "programme" are SYNONYMS — every "plan" message is a programme intent.
  - Examples: "build me a programme", "build my plan", "build me a plan", "build a plan", "create a plan", "new plan", "I need a programme", "design me a 6-week strength block", "start a hyrox block", "I'm training for a marathon", "create a 4-week programme", "make me a plan"
  - Goal statements that imply a programme: "I want to get stronger", "training for a half marathon", "I want to lose weight" (any goal statement without an existing-programme reference)

start_session_flow
  - Generate ONE single workout session.
  - "add a session" / "add session" / "give me a session" / "build me a session" → ALWAYS this label.
  - Examples: "add a session", "add a session today", "give me a leg session", "give me a 45-min upper body workout", "build me a strength session", "what should I do today" (when generation is implied), "I need a session"

start_modification_flow
  - Modify an EXISTING programme. Requires explicit modification signal.
  - Trigger ONLY on:
    * Pain words: "hurts", "sore", "niggle", "tweaked", "aggravat-", "flared", "strained", "bad back/knee/shoulder/hip", "can't do X anymore"
    * Explicit swap: "swap X", "swap X for Y", "change X to Y", "replace X with Y", "remove X", "drop X"
    * Difficulty complaints: "too easy", "too hard", "too much", "not enough", "this is killing me", "this isn't working"
    * Equipment changes: "lost gym access", "no gym today", "no kit", "stuck at home", "lost my barbell"
  - Examples: "my back hurts", "knee is sore", "swap deadlifts for hip thrust", "this is too easy", "lost gym access", "rdl is aggravating my back"
  - DO NOT classify as modification on generic words alone. "Plan", "programme", "session", "training" — none of these on their own are modification intent. They are programme or session intent.
  - If hasActiveProgramme=false, modification requests fall back to start_programme_flow (nothing to modify).

start_progression_flow
  - Repeat / progress existing sessions across future weeks.
  - Examples: "repeat this week with progression", "progress my current block", "extend the block by 4 weeks", "do this for the next 4 weeks", "repeat for 3 weeks"

chat
  - Anything else: questions, advice, status checks, motivation, scheduling commands, library searches, reviews, greetings, social.
  - Examples: "how am I doing this week?", "what's my fitness score", "good morning", "thanks", "review my week", "find me a 30-min wod", "copy this week to next week"

Routing rules:
- Default to "chat" if uncertain. Better Phil asks "did you mean to build a programme?" than to drop someone into a flow they didn't want.
- "plan" alone, "build my plan", "create a plan" → start_programme_flow. "Plan" never indicates modification by itself.
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
