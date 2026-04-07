import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

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

  const systemPrompt = `You are a focused fitness coach reviewing a client's training dashboard data.

Your job:
- Answer ONLY from the data provided. Do not invent metrics or trends.
- Be concise, specific, and action-oriented. Max 120 words per answer.
- Prioritise: adherence → consistency → balanced training (lift + run) → gradual improvement.
- Use a calm, direct coaching tone. No flattery, no generic internet fitness advice.
- When data is missing or insufficient, say so plainly: e.g. "There isn't enough running data yet to judge your 5K trend."
- Format: one direct sentence answer, then 2–4 short observations, then optionally 1–2 next steps. No headers.
- Do NOT encourage chasing PRs, max effort testing, or overreacting to a single bad week.

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

export default router;
