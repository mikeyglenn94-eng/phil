import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// ── POST /api/coach-parse ──────────────────────────────────────────────────
// Parses a natural-language training request (programme or session brief).
// Extracts constraints, checks sufficiency, makes sensible assumptions,
// and returns a structured response the frontend can act on.
//
// Request body:
//   input          – the user's natural-language message
//   followUpAnswer – (optional) user's answer to a prior follow-up question
//   clientContext  – (optional) { name, programmes, goals }
//
// Response (CoachParseResult):
//   requestType       – "programme" | "session"
//   acknowledgement   – 1-2 sentence summary of what the coach understood
//   hasEnough         – whether there's enough info to produce a draft
//   followUpQuestion  – single question if !hasEnough
//   assumptions       – list of assumptions made (when hasEnough)
//   suggestedBrief    – complete brief for the plan/session builder (when hasEnough)
//   parsedConstraints – extracted structured fields

const PARSE_SYSTEM_PROMPT = `You are an experienced strength and conditioning coach with 15 years of practice. You listen carefully to client requests and understand context well.

Your job is to parse a training request and return a structured JSON response.

TRAINING PHILOSOPHY (apply when making assumptions):
- Prefer simple, repeatable structures. 3–4 day splits work best for most clients.
- Straight sets before advanced techniques. Progressive overload: linear first.
- Strength sessions: compound-first (squat, hinge, press, pull patterns).
- Hybrid training: keep strength and running on separate days when possible.
- Sessions: 45–60 min is the sweet spot. 30 min minimum is worth doing.
- Running: easy aerobic base + one quality session per week is enough for most goals.
- Do not overcomplicate. Simple and consistent beats clever and inconsistent.

SUFFICIENCY RULES — you have enough to produce a sensible first draft when you know at least:
1. Whether they want a programme or a single session
2. A general goal or training focus
3. Approximate frequency OR which days are available

You do NOT need every detail. Make sensible assumptions for non-critical items.

ASSUMPTION RULES (when to assume instead of asking):
- Split type (full-body vs upper/lower vs push-pull): assume based on frequency and goal
- Weekly order: assume practical defaults (compound strength early week, runs mid-week)
- Progression style: assume linear unless context suggests otherwise
- Equipment: assume barbell, rack, dumbbells unless stated otherwise
- Session duration: assume 45–60 min if not stated
- Rest days: fill in around stated available or unavailable days

ASK (a single follow-up question) ONLY when the missing info would materially affect:
- Safety (e.g. specific injury requiring exercise modification)
- Feasibility (e.g. home gym vs commercial gym changes the entire session)
- Programme structure (e.g. powerlifting vs general fitness completely changes emphasis)

NEVER ask for information the user already provided.
NEVER ask more than one question.
NEVER ask broad generic questions like "what are your goals?" if the user already stated them.

Return a JSON object with EXACTLY this shape (no extra fields):
{
  "requestType": "programme" | "session",
  "acknowledgement": "1–2 sentences confirming what you understood. Be specific, not generic.",
  "hasEnough": true | false,
  "followUpQuestion": "One focused, specific question. Only include when hasEnough is false. Omit when hasEnough is true.",
  "assumptions": ["Short assumption 1", "Short assumption 2"],
  "suggestedBrief": "Complete natural-language description for the plan/session builder. Include all stated constraints and your assumptions inline. Write it as if describing to a builder, not back to the user. Only include when hasEnough is true.",
  "parsedConstraints": {
    "daysPerWeek": null or number,
    "availableDays": null or string[],
    "goal": null or string,
    "modalitySplit": null or string,
    "equipment": null or string[],
    "sessionDurationMinutes": null or number,
    "injuries": null or string[],
    "schedulingConstraints": null or string[],
    "exercisePreferences": null or string,
    "simplicity": null or "simple" or "moderate" or "advanced",
    "performancePriorities": null or string
  }
}`;

router.post("/coach-parse", async (req, res) => {
  const { input, followUpAnswer, clientContext } = req.body as {
    input: string;
    followUpAnswer?: string;
    clientContext?: { name?: string; programmes?: string[]; goals?: string };
  };

  if (!input?.trim()) {
    res.status(400).json({ error: "input is required" });
    return;
  }

  const contextLines: string[] = [];
  if (clientContext?.name) contextLines.push(`Client: ${clientContext.name}`);
  if (clientContext?.programmes?.length) {
    contextLines.push(`Existing programmes: ${clientContext.programmes.join(", ")}`);
  }
  if (clientContext?.goals) contextLines.push(`Goals on file: ${clientContext.goals}`);

  const contextBlock = contextLines.length
    ? `\n\nClient context:\n${contextLines.join("\n")}`
    : "";

  const userContent = followUpAnswer
    ? `Original request: ${input}\n\nMy answer to your question: ${followUpAnswer}\n\nNow produce a complete response using all information above.`
    : input;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PARSE_SYSTEM_PROMPT + contextBlock },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 700,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(500).json({ error: "Failed to parse coach response" });
      return;
    }

    res.json(parsed);
  } catch (err) {
    console.error("[coach-parse] OpenAI error:", err);
    res.status(500).json({ error: "Coach parse service unavailable" });
  }
});

export default router;
