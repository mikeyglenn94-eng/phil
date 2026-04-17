import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, clientGoalsTable, clientBaselinesTable, programmesTable, clientsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { format, addDays, parseISO } from "date-fns";

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

  const fmtMmss = (secs: number) => {
    const m = Math.floor(secs / 60), s = Math.round(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  const fmtHmmss = (secs: number) => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.round(secs % 60);
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Fetch client goals for context
  let goalContext = "";
  let baselineContext = "";
  if (!isNaN(clientId)) {
    try {
      const goals = await db.select().from(clientGoalsTable).where(eq(clientGoalsTable.clientId, clientId));
      if (goals.length) {
        goalContext = "\n\nClient's current goals:\n" + goals.map(g =>
          `- ${g.description}${g.targetDate ? ` (target: ${g.targetDate})` : ""} [${g.priority}]`
        ).join("\n");
      }
    } catch { /* non-fatal */ }
    try {
      const [bl] = await db.select().from(clientBaselinesTable).where(eq(clientBaselinesTable.clientId, clientId));
      if (bl) {
        const parseN = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? null : n; };
        const parts: string[] = [];
        const bench    = parseN(bl.benchKg);
        const squat    = parseN(bl.squatKg);
        const deadlift = parseN(bl.deadliftKg);
        if (bench    != null) parts.push(`Bench: ${bench}kg`);
        if (squat    != null) parts.push(`Squat: ${squat}kg`);
        if (deadlift != null) parts.push(`Deadlift: ${deadlift}kg`);
        if (bl.fiveKSeconds)        parts.push(`5K: ${fmtMmss(bl.fiveKSeconds)}`);
        if (bl.tenKSeconds)         parts.push(`10K: ${fmtMmss(bl.tenKSeconds)}`);
        if (bl.halfMarathonSeconds) parts.push(`Half Marathon: ${fmtMmss(bl.halfMarathonSeconds)}`);
        if (bl.marathonSeconds)     parts.push(`Marathon: ${fmtHmmss(bl.marathonSeconds)}`);
        if (parts.length > 0) {
          baselineContext = `\n\nClient's current PBs (${bl.setManually ? "manually entered" : "from logged sessions"}):\n${parts.join("\n")}`;
        }
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
Never use em dashes in any response. Use a full stop, a comma, or rewrite the sentence instead.${goalContext}${baselineContext}

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
      // Try to extract a JSON object embedded anywhere in the response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          // Strip any JSON-like blocks so they never appear as visible text
          parsed = { reply: raw.replace(/\{[\s\S]*?\}/g, "").trim() || "What would you like to work on today?" };
        }
      } else {
        parsed = { reply: raw };
      }
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

// ── POST /api/clients/:clientId/injury-chat ──────────────────────────────────
// Multi-phase injury modification flow.
// Phases: start → severity → choice → done (swaps applied inline).

const INJURY_MAP: Record<string, string[]> = {
  back: [
    "deadlift", "romanian deadlift", "rdl", "good morning",
    "bent over row", "back squat", "barbell row", "hyperextension",
    "stiff leg", "sumo deadlift", "rack pull",
  ],
  knee: [
    "squat", "lunge", "leg press", "step up", "bulgarian split squat",
    "hack squat", "leg extension", "running", "jump", "box jump",
  ],
  shoulder: [
    "bench press", "overhead press", "ohp", "lateral raise",
    "upright row", "pull up", "chin up", "dip", "arnold press",
    "front raise", "face pull", "cable fly", "chest fly",
  ],
  elbow: [
    "bench press", "incline bench", "decline bench", "close grip bench",
    "overhead press", "strict press", "ohp", "dip", "skull crusher",
    "tricep pushdown", "tricep extension", "push up", "db press",
    "dumbbell press", "cable pushdown", "french press", "curl",
    "bicep curl", "hammer curl", "preacher curl", "row", "pull down",
    "lat pulldown", "seated row", "cable row",
  ],
  wrist: [
    "bench press", "overhead press", "front squat", "clean",
    "snatch", "curl", "wrist curl", "push up",
  ],
  hip: [
    "squat", "deadlift", "lunge", "hip thrust", "running",
    "leg press", "step up", "bulgarian split squat",
  ],
};

const INJURY_SYSTEM_PROMPT = `You are Phil, the lead coach at MG Coaching. Direct, results-driven, concise.
You have strong knowledge of exercise substitutions for common injuries.
When modifying for injury, prioritise keeping training load as similar as possible while removing the aggravating movement.
Prefer substitutions that train the same muscle group through a different movement pattern or reduced range of motion.
Never suggest someone push through pain. For confirmed or ongoing injuries, recommend seeing a physio once but do not repeat it.
When suggesting injury substitutions, always check the user's equipment profile. Never recommend equipment the user does not have.
Never use em dashes. Keep replies to 2-4 sentences max.

Injury substitution principles:
- Lower back: replace spinal loading with hip-dominant or machine alternatives. Leg press, hip thrust, cable pull-throughs, machine rows.
- Knee: replace deep knee flexion with partial range or hip-dominant alternatives. Leg press (shallow), hip thrust, Nordic curl, straight leg deadlift.
- Shoulder: replace overhead/horizontal pressing with cable or machine alternatives at pain-free angles. Cable chest press, landmine press, neutral grip dumbbell press.
- Elbow/Golfer's elbow: medial epicondylitis is aggravated by gripping, curling, and forearm pronation under load. This includes all pressing movements, rows, curls, and pulling movements. Flag ALL of these in the programme, not just the obvious ones. Recommend the athlete avoids heavy gripping and considers lifting straps for pulling movements if they want to continue. Substitutions: machine-based pressing with neutral grip, resistance band work, lightweight isolation with very slow tempo, or full rest from the affected movements. Always recommend they see a physio for a confirmed case.
- Hip: replace hip flexion under load. Leg curl, Nordic curl, upper body sessions, bike for cardio.
- Wrist: replace barbell gripping with neutral grip or machine alternatives. Hammer grip dumbbell press, machine press, trap bar deadlift.`;

router.post("/clients/:clientId/injury-chat", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }

  const { phase, message, context } = req.body as {
    phase: "start" | "severity" | "choice";
    message: string;
    context?: Record<string, any>;
  };

  // ── Phase: start ─────────────────────────────────────────────────────────────
  // Extract body part / specific exercise, return severity question.
  if (phase === "start") {
    // Fetch equipment profile
    const [client] = await db.select({ equipmentList: clientsTable.equipmentList })
      .from(clientsTable).where(eq(clientsTable.id, clientId));
    const equipmentList = client?.equipmentList || null;

    // Use GPT to extract body part and specific exercise
    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract the affected body part and/or specific exercise from the user's injury message.
Return ONLY valid JSON (no markdown): { "bodyPart": "back"|"knee"|"shoulder"|"elbow"|"hip"|"wrist"|null, "specificExercise": string|null }
bodyPart must be one of the listed values or null. Use "elbow" for golfer's elbow, tennis elbow, elbow pain, or any elbow-related issue. specificExercise is the exercise they named, or null.`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 80,
      temperature: 0,
    });

    let bodyPart: string | null = null;
    let specificExercise: string | null = null;
    try {
      const raw = extraction.choices[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim());
      bodyPart = parsed.bodyPart || null;
      specificExercise = parsed.specificExercise || null;
    } catch { /* use nulls */ }

    const reply = "Noted. Is this a niggle that came on recently, or something that's been going on for a while or diagnosed?";
    res.json({
      reply,
      nextPhase: "severity",
      context: { originalMessage: message, bodyPart, specificExercise, equipmentList },
    });
    return;
  }

  // ── Phase: severity ───────────────────────────────────────────────────────────
  // Determine niggle/confirmed, find affected sessions, generate substitution suggestions.
  if (phase === "severity") {
    const ctx = context ?? {};

    // Classify severity
    const severityCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `The user is answering whether their injury is a recent niggle or a confirmed/ongoing injury.
Return ONLY valid JSON: { "severity": "niggle" | "confirmed" }
niggle = came on recently, not sure, minor, muscle soreness.
confirmed = ongoing, weeks, diagnosed, has seen a doctor/physio.`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 30,
      temperature: 0,
    });

    let severity: "niggle" | "confirmed" = "niggle";
    try {
      const raw = severityCompletion.choices[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim());
      if (parsed.severity === "confirmed") severity = "confirmed";
    } catch { /* default to niggle */ }

    const windowDays = severity === "niggle" ? 7 : 42;
    const today = format(new Date(), "yyyy-MM-dd");
    const windowEnd = format(addDays(new Date(), windowDays), "yyyy-MM-dd");

    // Fetch client programmes
    const programmes = await db.select().from(programmesTable)
      .where(eq(programmesTable.clientId, clientId));

    // Find affected sessions within the window
    const affectedItems: Array<{
      programmeId: number;
      programmeName: string;
      sessionId: string;
      date: string;
      exerciseId: string;
      exerciseName: string;
    }> = [];

    const bodyPart: string | null = ctx.bodyPart || null;
    const specificExercise: string | null = ctx.specificExercise || null;

    for (const prog of programmes) {
      for (const session of (prog.sessions as any[])) {
        if (!session.date) continue;
        if (session.date < today || session.date > windowEnd) continue;
        for (const ex of (session.exercises || [])) {
          const exNameLower = (ex.name || "").toLowerCase();
          let isAffected = false;
          if (specificExercise) {
            isAffected = exNameLower.includes(specificExercise.toLowerCase());
          } else if (bodyPart && INJURY_MAP[bodyPart]) {
            isAffected = INJURY_MAP[bodyPart].some(p => exNameLower.includes(p.toLowerCase()));
          }
          if (isAffected) {
            affectedItems.push({
              programmeId: prog.id,
              programmeName: (prog as any).title ?? "Programme",
              sessionId: session.id,
              date: session.date,
              exerciseId: ex.id,
              exerciseName: ex.name,
            });
          }
        }
      }
    }

    if (affectedItems.length === 0) {
      const windowLabel = windowDays === 7 ? "next 7 days" : "next 6 weeks";
      let reply: string;
      if (bodyPart && INJURY_MAP[bodyPart]) {
        const loadTypes = bodyPart === "elbow"
          ? "pressing, rowing, curling, or pulling movements"
          : bodyPart === "knee" ? "squatting, lunging, or leg-dominant movements"
          : bodyPart === "shoulder" ? "pressing or overhead movements"
          : bodyPart === "back" ? "spinal-loading or hinge movements"
          : bodyPart === "hip" ? "hip-dominant or lower body movements"
          : bodyPart === "wrist" ? "barbell gripping movements"
          : `${bodyPart}-loading movements`;
        reply = `Looking at your ${windowLabel} I can't see any direct ${loadTypes}. If something specific is aggravating it, tell me the exercise name and I'll swap it out.`;
      } else {
        reply = `Looking at your ${windowLabel} I can't see any exercises that match what you've described. Tell me the specific exercise name that's causing trouble and I'll swap it out.`;
      }
      res.json({ reply, nextPhase: "done", context: {} });
      return;
    }

    // Get unique exercise names and generate substitutions
    const uniqueExercises = [...new Set(affectedItems.map(a => a.exerciseName))];
    const equipmentList: string | null = ctx.equipmentList || null;

    interface SubstitutionOption { name: string; reason: string; recommended: boolean; }
    interface Suggestion { exerciseName: string; count: number; options: SubstitutionOption[]; }
    const suggestions: Suggestion[] = [];

    for (const exName of uniqueExercises) {
      const count = affectedItems.filter(a => a.exerciseName === exName).length;
      const subCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: INJURY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `The user needs a substitution for "${exName}" due to a ${bodyPart || "injury"} issue.
Available equipment: ${equipmentList || "full commercial gym"}.
Suggest exactly 3 alternatives. Return ONLY valid JSON:
{ "options": [{ "name": "Exercise Name", "reason": "One sentence why it works for this injury and equipment.", "recommended": true|false }] }
Mark exactly one as recommended: true. No markdown.`,
          },
        ],
        max_tokens: 300,
        temperature: 0.4,
      });

      let options: SubstitutionOption[] = [];
      try {
        const raw = subCompletion.choices[0]?.message?.content?.trim() ?? "{}";
        const parsed = JSON.parse(raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim());
        options = parsed.options ?? [];
      } catch { /* skip */ }

      if (options.length > 0) suggestions.push({ exerciseName: exName, count, options });
    }

    // Build Phil's message
    const physioNote = severity === "confirmed" ? " Worth getting eyes on this with a physio if you haven't already." : "";

    // Group affected items by date for the listing
    const dateGroups: Record<string, string[]> = {};
    for (const item of affectedItems) {
      const label = format(parseISO(item.date), "EEEE do MMM");
      if (!dateGroups[label]) dateGroups[label] = [];
      if (!dateGroups[label].includes(item.exerciseName)) dateGroups[label].push(item.exerciseName);
    }
    const sessionLines = Object.entries(dateGroups)
      .map(([day, exs]) => `${day}: ${exs.join(", ")}`)
      .join("\n");
    const windowLabel = windowDays === 7 ? "next 7 days" : "next 6 weeks";
    const bodyPartLabel = bodyPart === "elbow" ? "Golfer's elbow hits anything that loads the forearm and elbow." : "";

    let reply = `${bodyPartLabel ? bodyPartLabel + " " : ""}In your ${windowLabel} I can see:\n${sessionLines}\n\nI'll swap those out.${physioNote}\n\n`;
    for (const s of suggestions) {
      reply += `For ${s.exerciseName}, here are your options:\n`;
      s.options.forEach((o, i) => {
        reply += `${i + 1}. ${o.name} — ${o.reason}${o.recommended ? " My pick." : ""}\n`;
      });
      reply += "\n";
    }
    reply += suggestions.length === 1
      ? `I'd go with ${suggestions[0].options.find(o => o.recommended)?.name ?? suggestions[0].options[0]?.name}. Want me to use that?`
      : `I'd go with my picks above. Want me to apply all of those?`;

    res.json({
      reply: reply.trim(),
      nextPhase: "choice",
      context: {
        ...ctx,
        severity,
        windowDays,
        affectedItems,
        suggestions,
      },
    });
    return;
  }

  // ── Phase: choice ─────────────────────────────────────────────────────────────
  // Parse user's acceptance, apply swaps to programme, confirm.
  if (phase === "choice") {
    const ctx = context ?? {};
    const affectedItems: any[] = ctx.affectedItems ?? [];
    const suggestions: any[] = ctx.suggestions ?? [];

    if (affectedItems.length === 0) {
      res.json({ reply: "Nothing to swap. Your programme is unchanged.", nextPhase: "done", context: {} });
      return;
    }

    // Use GPT to determine which replacement to use for each exercise
    const decisionCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `The user is responding to injury substitution suggestions. Determine which replacement to use for each exercise.
Return ONLY valid JSON: { "decisions": [{ "exerciseName": "...", "replacementName": "...", "skip": false }] }
If the user accepts the recommendation or says yes/go for it/sounds good, use the recommended option.
If they pick a numbered option or name a specific exercise, use that.
If they want to skip an exercise (not swap it), set skip: true.
If they suggest their own alternative, use that name.
exercises: ${JSON.stringify(suggestions.map((s: any) => ({ exerciseName: s.exerciseName, options: s.options })))}`,
        },
        { role: "user", content: message },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    let decisions: Array<{ exerciseName: string; replacementName: string; skip: boolean }> = [];
    try {
      const raw = decisionCompletion.choices[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim());
      decisions = parsed.decisions ?? [];
    } catch { /* fall back: use all recommended */ }

    // If GPT returned nothing, default to recommended for each
    if (decisions.length === 0) {
      for (const s of suggestions) {
        const rec = s.options.find((o: any) => o.recommended) ?? s.options[0];
        if (rec) decisions.push({ exerciseName: s.exerciseName, replacementName: rec.name, skip: false });
      }
    }

    // Build the confirmed swaps list
    const confirmedSwaps: Array<{
      programmeId: number; sessionId: string; exerciseId: string;
      exerciseName: string; replacementName: string;
    }> = [];

    for (const item of affectedItems) {
      const decision = decisions.find(d => d.exerciseName === item.exerciseName);
      if (!decision || decision.skip) continue;
      confirmedSwaps.push({ ...item, replacementName: decision.replacementName });
    }

    if (confirmedSwaps.length === 0) {
      res.json({ reply: "No problem. Your programme stays exactly as it is. Let me know if you change your mind.", nextPhase: "done", context: {} });
      return;
    }

    // Group swaps by programme
    const progGroups: Record<number, typeof confirmedSwaps> = {};
    for (const swap of confirmedSwaps) {
      if (!progGroups[swap.programmeId]) progGroups[swap.programmeId] = [];
      progGroups[swap.programmeId].push(swap);
    }

    // Apply swaps to each programme
    for (const [progIdStr, swaps] of Object.entries(progGroups)) {
      const progId = parseInt(progIdStr, 10);
      const [prog] = await db.select().from(programmesTable).where(eq(programmesTable.id, progId));
      if (!prog) continue;

      const updatedSessions = (prog.sessions as any[]).map((session: any) => {
        const sessionSwaps = swaps.filter(s => s.sessionId === session.id);
        if (sessionSwaps.length === 0) return session;
        return {
          ...session,
          exercises: (session.exercises ?? []).map((ex: any) => {
            const swap = sessionSwaps.find(s => s.exerciseId === ex.id);
            if (!swap) return ex;
            return {
              ...ex,
              id: randomUUID(),
              name: swap.replacementName,
              clientComment: null,
              setWeights: null,
              setReps: null,
            };
          }),
        };
      });

      await db.update(programmesTable)
        .set({ sessions: updatedSessions as any, updatedAt: new Date() })
        .where(eq(programmesTable.id, progId));
    }

    // Build confirmation message
    const uniqueSwapDescs = [...new Set(
      confirmedSwaps.map(s => `${s.exerciseName} for ${s.replacementName}`)
    )];
    const sessionCount = new Set(confirmedSwaps.map(s => s.sessionId)).size;
    const reply = `Done. Swapped ${uniqueSwapDescs.join(" and ")} across ${sessionCount} session${sessionCount !== 1 ? "s" : ""}. Everything else stays the same. Hope it settles down.`;

    res.json({ reply, nextPhase: "done", context: { confirmedSwaps } });
    return;
  }

  res.status(400).json({ error: "Invalid phase" });
});

export default router;
