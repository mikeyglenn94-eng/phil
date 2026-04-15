import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, clientGoalsTable } from "@workspace/db";

const router: IRouter = Router();

// ── POST /api/clients/:clientId/coaching ──────────────────────────
// Accepts a natural-language question + structured dashboard context.
// Returns a concise, data-grounded coaching answer.

router.post("/clients/:clientId/coaching", async (req, res) => {
  const { question, context, history } = req.body as {
    question: string;
    context: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!question?.trim() || !context?.trim()) {
    res.status(400).json({ error: "question and context are required" });
    return;
  }

  const systemPrompt = `You are a sharp, direct fitness coach reviewing a client's training data.

CONTENT RULES:
- Answer ONLY from the data provided. Do not invent metrics or trends.
- Focus on: adherence → consistency → balanced training → gradual improvement.
- Speak like a real coach: clear, confident, slightly opinionated. No flattery. No generic advice.
- When data is missing, say so plainly: "Not enough data yet."
- Do not encourage chasing PRs or overreacting to one bad week.

TONE — modern and direct:
- Use "you'll", "hit", "build", "hold pace", not "this will involve" or "it is designed to"
- Short cause → effect: "2 missed sessions → score dropped" — not full sentences
- Light personality is fine. Do not stack slang. Never use hype language.
- Sound like a coach who knows their stuff, not a motivational poster.

FORMAT — scannable bullets only, no paragraphs:
- Short labelled lines: "Adherence:", "Strength:", "Running:", "Next:"
- One idea per line
- Max 8 lines total
- Blank line between observation section and Next steps

Example output:
Adherence: 1 of 3 sessions last week → consistency is the gap right now
Strength: e1RM trending up — keep the progressive overload going
Running: not enough data yet

Next:
- hit all 3 sessions this week before adjusting anything
- log at least one run so we have pace data to work with

The client's current dashboard context is provided in each message.`;

  const messages: { role: "user" | "assistant"; content: string }[] = [];

  // Inject prior turn if it exists (max 1 follow-up context turn)
  if (history?.length) {
    const lastTwo = history.slice(-2);
    for (const h of lastTwo) messages.push(h);
  }

  messages.push({
    role: "user",
    content: `Dashboard context:\n${context}\n\nQuestion: ${question}`,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 220,
      temperature: 0.4,
    });

    const answer = completion.choices[0]?.message?.content?.trim() ?? "No answer returned.";
    res.json({ answer });
  } catch (err) {
    console.error("[coaching] OpenAI error:", err);
    res.status(500).json({ error: "Failed to generate coaching response" });
  }
});

// ── POST /api/clients/:clientId/phil-chat ─────────────────────────────────
// Handles conversational messages to Phil — greetings, questions, goal statements.
// Phil responds in-character: direct, practical, coach voice.

router.post("/clients/:clientId/phil-chat", async (req, res) => {
  const clientId = parseInt(req.params.clientId, 10);
  const { message, history } = req.body as {
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  let goalContext = "";
  if (!isNaN(clientId)) {
    try {
      const goals = await db.select().from(clientGoalsTable).where(eq(clientGoalsTable.clientId, clientId));
      if (goals.length) {
        goalContext = "\n\nClient's current goals:\n" + goals.map(g =>
          `- ${g.description}${g.targetDate ? ` (target: ${g.targetDate})` : ""} [${g.priority}]`
        ).join("\n");
      }
    } catch { /* non-fatal */ }
  }

  const systemPrompt = `You are Phil, the lead coach at MG Coaching. You are direct, knowledgeable, and results-driven. You speak like a real coach — concise, slightly opinionated, and practical. You never sound robotic or over-hyped.

You are having a conversation with a client. Keep replies SHORT (1-3 sentences max). Be warm but efficient.

If the client says something like "hi", "thanks", "great" — acknowledge briefly and prompt them to get to work.
If the client asks a question, answer it directly and practically.
If the client states a vague goal without enough detail, ask ONE focused clarifying question (don't ask multiple questions at once).
Reference the client's goals when relevant — e.g. after a good session: mention how it contributes to their target.
Never generate a full programme here — just gather context and guide the client to the right action.
Never say "User request is vague" or expose any technical error language to the client.${goalContext}`;

  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  if (history?.length) {
    for (const h of history.slice(-4)) msgs.push(h);
  }
  msgs.push({ role: "user", content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
      max_tokens: 120,
      temperature: 0.6,
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "What would you like to work on today?";
    res.json({ reply });
  } catch (err) {
    console.error("[phil-chat] OpenAI error:", err);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

export default router;
