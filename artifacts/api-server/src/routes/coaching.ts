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
- Focus on: adherence, consistency, balanced training, gradual improvement.
- Speak like a real coach: clear, confident, slightly opinionated. No flattery. No generic advice.
- When data is missing, say so plainly: "Not enough data yet."
- Do not encourage chasing PRs or overreacting to one bad week.

TONE:
- Use "you'll", "hit", "build", "hold pace", not "this will involve" or "it is designed to"
- Short cause and effect: "2 missed sessions, score dropped" not full sentences
- Light personality is fine. Do not stack slang. Never use hype language.
- Sound like a coach who knows their stuff, not a motivational poster.

FORMAT:
- Short labelled lines: "Adherence:", "Strength:", "Running:", "Next:"
- One idea per line
- Max 8 lines total
- Blank line between observation section and Next steps

Never use em dashes in any response. Use a full stop, a comma, or rewrite the sentence instead.

The client's current dashboard context is provided in each message.`;

  const messages: { role: "user" | "assistant"; content: string }[] = [];

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
// Tab-aware conversational Phil. Accepts currentTab + optional context objects.
// Returns { reply, navigateTo?, action? }.

router.post("/clients/:clientId/phil-chat", async (req, res) => {
  const clientId = parseInt(req.params.clientId, 10);
  const { message, history, currentTab, dashboardContext, nutritionContext } = req.body as {
    message: string;
    history?: { role: "user" | "assistant"; content: string }[];
    currentTab?: "dashboard" | "nutrition" | "training";
    dashboardContext?: Record<string, unknown>;
    nutritionContext?: Record<string, unknown>;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  // Fetch client goals for context
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

  // Build tab-specific system prompt
  let tabSection = "";
  if (currentTab === "dashboard") {
    const ctx = dashboardContext ? JSON.stringify(dashboardContext, null, 2) : "No data available yet.";
    tabSection = `
You are currently on the user's DASHBOARD tab.

Dashboard data:
${ctx}

You can:
- Answer questions about their fitness score, consistency, performance metrics, and goals. Reference their actual numbers.
- Explain any dashboard metric in plain language.
- Answer general training and nutrition questions.
- If asked to build a programme, adjust the calendar, or anything requiring the training calendar, respond conversationally first (e.g. "Let's go to your training calendar for that.") and return navigateTo: "training" in your JSON.

Respond ONLY with a JSON object: { "reply": "...", "navigateTo": "training" | null }
Do not include navigateTo if no navigation is needed.`;
  } else if (currentTab === "nutrition") {
    const ctx = nutritionContext ? JSON.stringify(nutritionContext, null, 2) : "No nutrition data for today.";
    tabSection = `
You are currently on the user's NUTRITION tab.

Today's nutrition data:
${ctx}

You can:
- Answer nutrition questions in plain language.
- Log food directly. If the user asks to log food (e.g. "log 200g chicken for lunch"), return action: { type: "log_food", description: "..." } in your JSON with the food description to log. Say something like "Done, logged that for you."
- Explain macros, calories, and targets.
- If asked about training or calendar changes, respond conversationally first (e.g. "Let's go to your training calendar for that.") and return navigateTo: "training".

Respond ONLY with a JSON object: { "reply": "...", "navigateTo": "training" | null, "action": { "type": "log_food", "description": "..." } | null }
Only include action if logging food. Only include navigateTo if navigating.`;
  } else {
    // Training tab or unspecified — standard Phil behaviour
    tabSection = `
You are on the user's TRAINING tab. Handle training, scheduling, and programme questions as normal.

Respond ONLY with a JSON object: { "reply": "..." }`;
  }

  const systemPrompt = `You are Phil, the lead coach at MG Coaching. You are direct, knowledgeable, and results-driven. You speak like a real coach: concise, slightly opinionated, practical. Never robotic or over-hyped.

Keep replies SHORT (1-3 sentences max). Be warm but efficient.
If the client says "hi", "thanks", "great" — acknowledge briefly and prompt them to work.
If the client asks a question, answer directly and practically.
If the client states a vague goal, ask ONE focused clarifying question.
Reference the client's goals when relevant.
Never generate a full programme here.
Never expose technical error language.
Never use em dashes in any response. Use a full stop, a comma, or rewrite the sentence instead.${goalContext}

${tabSection}`;

  const msgs: { role: "user" | "assistant"; content: string }[] = [];
  if (history?.length) {
    for (const h of history.slice(-4)) msgs.push(h);
  }
  msgs.push({ role: "user", content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...msgs],
      max_tokens: 150,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Parse JSON response from Phil
    let parsed: { reply?: string; navigateTo?: string | null; action?: { type: string; description?: string } | null } = {};
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: treat entire response as reply text
      parsed = { reply: raw };
    }

    const reply = parsed.reply?.trim() || "What would you like to work on today?";
    const navigateTo = parsed.navigateTo && typeof parsed.navigateTo === "string" ? parsed.navigateTo : undefined;
    const action = parsed.action && parsed.action.type ? parsed.action : undefined;

    res.json({ reply, navigateTo, action });
  } catch (err) {
    console.error("[phil-chat] OpenAI error:", err);
    res.status(500).json({ error: "Failed to generate response" });
  }
});

export default router;
