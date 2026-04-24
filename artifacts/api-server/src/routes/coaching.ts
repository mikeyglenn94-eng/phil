import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { db, clientGoalsTable, clientBaselinesTable, programmesTable, clientsTable, clientOneRMsTable, sessionFeedbackTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { format, addDays, parseISO } from "date-fns";
import { logApiCost, logPhilInteraction, detectPhilInteractionType } from "../lib/log-api-cost";
import { extractAuth } from "../middlewares/require-auth";
import { sendCoachMessage, type CoachMessageContext } from "../lib/email";

const router: IRouter = Router();

// ── POST /clients/:clientId/coach-message ─────────────────────────
// Athlete-initiated message to the head coach (Mikey).
// Sends via Resend with optional session context attached as metadata.
router.post("/clients/:clientId/coach-message", async (req, res): Promise<void> => {
  extractAuth(req);

  // AuthZ: caller must be authenticated.
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId) || clientId <= 0) {
    res.status(400).json({ error: "invalid clientId" });
    return;
  }

  // AuthZ: athletes may only send for their own clientId. Coaches/admins are allowed.
  const isStaff = req.auth.roles.some(r => r === "coach" || r === "admin");
  if (!isStaff && req.auth.clientId !== clientId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { message, context, fromEmail } = req.body as {
    message?: string;
    context?: CoachMessageContext;
    fromEmail?: string;
  };

  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  if (message.length > 4000) {
    res.status(400).json({ error: "message too long" });
    return;
  }

  // Size-limit context fields to prevent oversized payload abuse.
  let safeContext: CoachMessageContext | undefined;
  if (context && typeof context === "object") {
    const cap = (s: unknown, n: number) => typeof s === "string" ? s.slice(0, n) : null;
    safeContext = {
      sessionName: cap(context.sessionName, 200),
      sessionDate: cap(context.sessionDate, 60),
      sessionType: cap(context.sessionType, 40),
      sessionComment: cap(context.sessionComment, 2000),
      exercisesLogged: Array.isArray(context.exercisesLogged)
        ? context.exercisesLogged.slice(0, 30).map(ex => ({
            name: typeof ex?.name === "string" ? ex.name.slice(0, 120) : "Exercise",
            sets: Array.isArray(ex?.sets)
              ? ex.sets.slice(0, 20).map(s => ({
                  weight: typeof s?.weight === "number" ? s.weight : null,
                  reps: typeof s?.reps === "number" ? s.reps : null,
                }))
              : [],
          }))
        : [],
    };
  }

  let fromName = "Athlete";
  try {
    const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    if (c?.name) fromName = c.name;
  } catch { /* non-fatal */ }

  const result = await sendCoachMessage({
    fromName,
    fromEmail: fromEmail?.trim() || null,
    message: message.trim(),
    context: safeContext,
  });

  if (!result.ok) {
    res.status(502).json({ error: result.reason ?? "send_failed" });
    return;
  }
  res.json({ ok: true });
});

// ── POST /clients/:clientId/session-feedback ─────────────────────
// Persist a Smashed/Clean/Grim chip pick (and optional notes / voice URL)
// against a finished session. Mounted under /api by app.ts.
router.post("/clients/:clientId/session-feedback", async (req, res): Promise<void> => {
  extractAuth(req);
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId) || clientId <= 0) {
    res.status(400).json({ error: "invalid clientId" });
    return;
  }
  const isStaff = req.auth.roles.some(r => r === "coach" || r === "admin");
  if (!isStaff && req.auth.clientId !== clientId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const { sessionId, programmeId, rating, notes, voiceNoteUrl } = req.body as {
    sessionId?: string;
    programmeId?: number | null;
    rating?: "smashed" | "clean" | "grim";
    notes?: string | null;
    voiceNoteUrl?: string | null;
  };
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  if (rating !== "smashed" && rating !== "clean" && rating !== "grim") {
    res.status(400).json({ error: "rating must be smashed | clean | grim" });
    return;
  }

  try {
    // Idempotent: if the athlete double-taps a chip or the request is retried,
    // upsert keeps a single canonical row per (client, session) pair.
    const [row] = await db.insert(sessionFeedbackTable).values({
      clientId,
      sessionId: sessionId.slice(0, 200),
      programmeId: typeof programmeId === "number" ? programmeId : null,
      rating,
      notes: typeof notes === "string" ? notes.slice(0, 4000) : null,
      voiceNoteUrl: typeof voiceNoteUrl === "string" ? voiceNoteUrl.slice(0, 1000) : null,
    }).onConflictDoUpdate({
      target: [sessionFeedbackTable.clientId, sessionFeedbackTable.sessionId],
      set: {
        rating,
        notes: typeof notes === "string" ? notes.slice(0, 4000) : null,
        voiceNoteUrl: typeof voiceNoteUrl === "string" ? voiceNoteUrl.slice(0, 1000) : null,
        programmeId: typeof programmeId === "number" ? programmeId : null,
      },
    }).returning({ id: sessionFeedbackTable.id });
    res.json({ ok: true, id: row?.id });
  } catch (err) {
    console.error("[session-feedback] insert failed:", err);
    res.status(500).json({ error: "failed_to_save_feedback" });
  }
});

// ── POST /clients/:clientId/session-summary ──────────────────────
// Build the two post-Finish bubbles: a short Phil commentary (LLM) + a
// feedback prompt with chips and a voice-note affordance. The handler also
// tallies PBs hit by comparing each working set's Epley est-1RM against the
// athlete's stored 1RM history.

type WorkingSet = { weight: number | null; reps: number | null; rpe?: number | null };
type ExerciseSummary = { name: string; sets: WorkingSet[] };

function epley1RM(weight: number, reps: number): number {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

router.post("/clients/:clientId/session-summary", async (req, res): Promise<void> => {
  extractAuth(req);
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId) || clientId <= 0) {
    res.status(400).json({ error: "invalid clientId" });
    return;
  }
  const isStaff = req.auth.roles.some(r => r === "coach" || r === "admin");
  if (!isStaff && req.auth.clientId !== clientId) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const {
    sessionId,
    sessionName,
    durationSec,
    programmeId,
    exercises,
  } = req.body as {
    sessionId?: string;
    sessionName?: string;
    durationSec?: number;
    programmeId?: number | null;
    exercises?: ExerciseSummary[];
  };

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const safeExercises: ExerciseSummary[] = Array.isArray(exercises)
    ? exercises.slice(0, 50).map(ex => ({
        name: typeof ex?.name === "string" ? ex.name.slice(0, 120) : "Exercise",
        sets: Array.isArray(ex?.sets)
          ? ex.sets.slice(0, 20).map(s => ({
              weight: typeof s?.weight === "number" ? s.weight : null,
              reps: typeof s?.reps === "number" ? s.reps : null,
              rpe: typeof s?.rpe === "number" ? s.rpe : null,
            }))
          : [],
      }))
    : [];

  // Tally totals client-side already, but recompute server-side to trust the numbers.
  let totalVolume = 0;
  let loggedSets = 0;
  const rpeValues: number[] = [];
  for (const ex of safeExercises) {
    for (const s of ex.sets) {
      if (s.weight != null && s.reps != null) {
        totalVolume += s.weight * s.reps;
        loggedSets += 1;
      }
      if (typeof s.rpe === "number" && s.rpe > 0) rpeValues.push(s.rpe);
    }
  }
  const avgRpe = rpeValues.length ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : null;

  // PB tally: for each lift name in this session, find the athlete's best stored 1RM
  // and check whether any working set's Epley estimate exceeds it.
  let pbsHit = 0;
  try {
    const oneRms = await db
      .select()
      .from(clientOneRMsTable)
      .where(eq(clientOneRMsTable.clientId, clientId));
    const bestByName = new Map<string, number>();
    for (const r of oneRms) {
      const key = r.exerciseName.trim().toLowerCase();
      const w = parseFloat(String(r.weightKg));
      if (!isFinite(w)) continue;
      const prior = bestByName.get(key) ?? 0;
      if (w > prior) bestByName.set(key, w);
    }
    for (const ex of safeExercises) {
      const key = ex.name.trim().toLowerCase();
      const baseline = bestByName.get(key);
      if (baseline == null) continue;
      for (const s of ex.sets) {
        if (s.weight == null || s.reps == null) continue;
        if (epley1RM(s.weight, s.reps) > baseline) {
          pbsHit += 1;
          break; // count one PB per lift, not per set
        }
      }
    }
  } catch (err) {
    // PB enrichment is best-effort — we still want to send the bubbles.
    console.warn("[session-summary] 1RM lookup failed:", err);
  }

  // Build a tight summary for the model. Trim aggressively — Phil is concise.
  const minutes = Math.round((durationSec ?? 0) / 60);
  const summaryLines: string[] = [
    sessionName ? `Session: ${sessionName}` : `Session: workout`,
    `Sets logged: ${loggedSets}`,
    `Total volume: ${Math.round(totalVolume)} kg`,
    `PBs hit: ${pbsHit}`,
    avgRpe != null ? `Avg RPE: ${avgRpe.toFixed(1)}` : "Avg RPE: not logged",
    minutes > 0 ? `Duration: ${minutes} min` : "",
  ].filter(Boolean);

  const systemPrompt = `You are Phil, a no-nonsense strength coach.

Persona rules:
- 12 words max. One or two short sentences only.
- Direct, observant, never hype. No flattery.
- Never say "easy". Never use em dashes (use a comma or full stop).
- React to what actually happened in the data: volume, PBs, RPE, sets.
- If PBs were hit, acknowledge them plainly. If RPE was high, note it.
- Plain English. No emojis. No coach cliches.`;

  const userPrompt = `Post-session data:\n${summaryLines.join("\n")}\n\nGive your one-line take.`;

  let commentary = "Logged. Onto the next one.";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.4,
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "session-summary", model: "gpt-4o-mini", usage: completion.usage });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (raw) {
      // Strip em dashes defensively in case the model slips.
      let cleaned = raw.replace(/[—–]/g, ",").trim();
      // Phil voice rule: never use the word "easy" in user-facing copy. Swap to "smooth".
      cleaned = cleaned.replace(/\beasy\b/gi, (m) => (m[0] === m[0].toUpperCase() ? "Smooth" : "smooth"));
      commentary = cleaned;
    }
  } catch (err) {
    console.warn("[session-summary] LLM error, falling back:", err);
  }

  res.json({
    summary: {
      sessionId,
      sessionName: sessionName ?? null,
      durationSec: durationSec ?? null,
      loggedSets,
      totalVolume: Math.round(totalVolume),
      pbsHit,
      avgRpe,
    },
    bubbles: [
      {
        kind: "text" as const,
        content: commentary,
        payload: { sessionId, clientId, programmeId: programmeId ?? undefined },
      },
      {
        kind: "feedback-prompt" as const,
        content: "How'd it feel?",
        quickReplies: [
          { label: "Smashed", value: "smashed" },
          { label: "Clean", value: "clean" },
          { label: "Grim", value: "grim" },
        ],
        payload: { sessionId, clientId, programmeId: programmeId ?? undefined },
      },
    ],
  });
});

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

    void logApiCost({ userId: req.auth?.userId, endpoint: "coaching", model: "gpt-4o-mini", usage: completion.usage });
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
  extractAuth(req);
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

Respond ONLY with a JSON object: { "reply": "...", "navigateTo": "training" | null, "quickReplies": [...] | null, "kind": "text" | "plan-preview" | "quick-log" | "rpe" | "session-card" | null, "payload": {...} | null }
Do not include navigateTo if no navigation is needed. Include quickReplies per the QUICK REPLIES section above. Include kind+payload per the TYPED BUBBLES section.`;
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

Respond ONLY with a JSON object: { "reply": "...", "navigateTo": "training" | null, "action": { "type": "log_food", "description": "..." } | null, "quickReplies": [...] | null, "kind": "text" | "plan-preview" | "quick-log" | "rpe" | "session-card" | null, "payload": {...} | null }
Only include action if logging food. Only include navigateTo if navigating. Include quickReplies per the QUICK REPLIES section above. Include kind+payload per the TYPED BUBBLES section.`;
  } else {
    // Training tab or unspecified — standard Phil behaviour
    tabSection = `
You are on the user's TRAINING tab. Handle training, scheduling, and programme questions as normal.

Respond ONLY with a JSON object: { "reply": "...", "quickReplies": [...] | null, "kind": "text" | "plan-preview" | "quick-log" | "rpe" | "session-card" | null, "payload": {...} | null }
Include quickReplies per the QUICK REPLIES section above. Include kind+payload per the TYPED BUBBLES section.`;
  }

  // ─ QUICK REPLIES (chip-first) ─────────────────────────────────────────────
  // Phil's questions should default to chips when the answer is short. Typing and
  // voice remain available as escape hatches. The frontend renders these as a
  // tappable chip row below the message; do NOT surface "Easy" as user-facing copy
  // outside the internal effort scale.
  const quickRepliesSection = `
QUICK REPLIES (chip-first responses):

Default to offering 3–5 quick-reply chips whenever your reply ends with a short-answer question (any answer that fits in under 5 words).

DO NOT include quickReplies when:
- You are making a statement, summary, or confirmation (no question).
- You are asking an open-ended question that needs detail (e.g. "Tell me about the niggle", "What's different this week?", "Why?").
- You are asking the client to provide free-form text (a name, a number outside a fixed range, a description).

DO include quickReplies when the question fits one of the standard patterns below. Use these presets verbatim where they apply so the experience stays consistent:

- State of self ("How's the body?" / "How are you holding up?"):
  [{"label":"💪 Strong","value":"strong"},{"label":"👌 Steady","value":"steady"},{"label":"😮‍💨 Tired","value":"tired"},{"label":"🤕 Beat up","value":"beat up"}]

- Post-session feedback ("How'd that go?" / "How was it?"):
  [{"label":"💪 Smashed","value":"smashed"},{"label":"👌 Clean","value":"clean"},{"label":"😬 Grim","value":"grim"}]

- Duration ("How long have you got?"):
  [{"label":"30 min","value":"30 min"},{"label":"45 min","value":"45 min"},{"label":"60 min","value":"60 min"},{"label":"90 min","value":"90 min"}]

- Effort / intensity (internal scale only, never surface "Easy" as copy elsewhere):
  [{"label":"Easy","value":"easy"},{"label":"Moderate","value":"moderate"},{"label":"Hard","value":"hard"},{"label":"All out","value":"all out"}]

- Binary decision (when proposing one path):
  [{"label":"Yes","value":"yes"},{"label":"Tweak it","value":"tweak it"}]
  or [{"label":"Do it","value":"do it"},{"label":"Not today","value":"not today"}]

- Energy today ("How's the energy?"):
  [{"label":"Full beans","value":"full beans"},{"label":"Average","value":"average"},{"label":"Flat","value":"flat"}]

For other short-answer questions, generate 3–5 chips that fit the answer space. Match the chip count to the question:
- Binary decision → 2 chips
- State-of-self → 4 chips
- Duration → 4–5 chips

Each chip object has:
- label: the visible text, may include a leading emoji (e.g. "💪 Smashed")
- value: the plain-text reply that gets sent on tap (lowercase, no emoji)

Keep chip labels under ~14 characters. Never include em dashes. Never include the word "Easy" in any chip label outside the internal effort scale.`;

  // ─ TYPED BUBBLES (W4.1) ──────────────────────────────────────────────────
  // Specialised bubble layouts for content that text + chips can't express.
  // The frontend defaults kind to "text" — every existing reply still works.
  // Only emit a non-text kind when the structured layout adds real value.
  const typedBubblesSection = `
TYPED BUBBLES (specialised layouts):

DEFAULT to omitting kind+payload. Plain text + quickReplies handles 95% of turns.

Only emit a non-text kind when the structured content adds real value over text + chips. The four kinds:

1) "plan-preview" — when you have just outlined a Week 1 training plan and want the client to react.
   payload: { "days": [ { "dayName": "Mon", "sessionType": "Strength", "title": "Lower body", "exercises": ["Squat 5x5", "RDL 3x8", "Walking lunge 3x10"] }, ... up to 7 days ] }
   The bubble renders a horizontally scrollable card strip with three chips below: "Build full block", "Tweak", "Not yet". Use Phil's voice in the reply text above (short, direct).

2) "quick-log" — when you proactively ask the client to log a single set's numbers.
   payload: { "exerciseName": "Bench press", "setLabel": "Set 3", "unit": "kg" }
   The bubble renders weight + reps inputs and a "Log" button. Use only when you genuinely want a number back. setLabel and unit are optional.

3) "rpe" — when you ask specifically about perceived effort for a recent set or lift (ad-hoc, not the in-logger RPE).
   payload: { "contextLabel": "Last set of bench" }
   The bubble renders the 5-pill emoji selector (6–10). Use only when you want an RPE number. contextLabel is optional.

4) "session-card" — when you reference one specific session on the client's calendar.
   payload: { "sessionId": "<id>", "programmeId": "<id>", "date": "2026-04-25", "sessionType": "Strength", "title": "Lower body session" }
   The bubble renders a tappable card linking to that session.

NEVER emit a typed bubble for:
- Generic acknowledgements, summaries, or open questions.
- Anything you can already express with text + quickReplies.
- A plan you have not actually outlined yet.
- A session whose id you do not know.

When you emit kind+payload, your reply text stays SHORT (1-2 sentences) and sits above the bubble's structured content. The bubble's own buttons carry their own labels — do not repeat them in the reply text.

Phil's voice in bubble copy: no em dashes, never "easy" outside the internal effort scale, short lines.`;

  const systemPrompt = `You are Phil, the lead coach at MG Coaching. You are direct, knowledgeable, and results-driven. You speak like a real coach: concise, slightly opinionated, practical. Never robotic or over-hyped.

Keep replies SHORT (1-3 sentences max). Be warm but efficient.
If the client says "hi", "thanks", "great" — acknowledge briefly and prompt them to work.
If the client asks a question, answer directly and practically.
If the client states a vague goal, ask ONE focused clarifying question.
Reference the client's goals when relevant.
Never generate a full programme here.
Never expose technical error language.
Never use em dashes in any response. Use a full stop, a comma, or rewrite the sentence instead.${goalContext}${baselineContext}

${quickRepliesSection}

${typedBubblesSection}

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
      // Bumped from 150 to give plan-preview payloads (7 days × 3 exercises) headroom.
      // Plain text replies still come back short — Phil's voice keeps them concise.
      max_tokens: 350,
      temperature: 0.6,
    });

    if (req.auth?.userId) {
      void logApiCost({ userId: req.auth.userId, endpoint: "phil-chat", model: "gpt-4o-mini", usage: completion.usage });
      void logPhilInteraction({ userId: req.auth.userId, interactionType: detectPhilInteractionType(message) });
    }

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

    // Normalise quickReplies coming back from the LLM into a strict shape the
    // frontend can render predictably. Bad shapes are silently dropped — the
    // chat falls back to typing/voice as the input affordances.
    type RawQuickReply = { label?: unknown; value?: unknown; emoji?: unknown };
    const rawQuickReplies = (parsed as { quickReplies?: unknown }).quickReplies;
    let quickReplies: { label: string; value: string; emoji?: string }[] | undefined;
    if (Array.isArray(rawQuickReplies) && rawQuickReplies.length > 0) {
      const cleaned = rawQuickReplies
        .map((r: unknown): { label: string; value: string; emoji?: string } | null => {
          if (!r || typeof r !== "object") return null;
          const rr = r as RawQuickReply;
          const label = typeof rr.label === "string" ? rr.label.trim() : "";
          const value = typeof rr.value === "string" ? rr.value.trim() : label.trim();
          if (!label || !value) return null;
          const emoji = typeof rr.emoji === "string" && rr.emoji.trim() ? rr.emoji.trim() : undefined;
          // Hard cap label length so styling never breaks.
          return { label: label.slice(0, 40), value: value.slice(0, 80), ...(emoji ? { emoji } : {}) };
        })
        .filter((r): r is { label: string; value: string; emoji?: string } => r !== null)
        .slice(0, 8);
      if (cleaned.length > 0) quickReplies = cleaned;
    }

    // ── Normalise W4.1 typed-bubble fields (kind + payload) ────────────────
    // The frontend defaults missing/invalid kind to "text" — backward-compatible
    // with W1 messages. We strip anything that does not match the documented schema
    // for each kind so the bubble renderer never sees malformed data.
    const VALID_KINDS = new Set(["text", "plan-preview", "quick-log", "rpe", "session-card"]);
    const rawKind = (parsed as { kind?: unknown }).kind;
    const rawPayload = (parsed as { payload?: unknown }).payload;
    let kind: string | undefined;
    let payload: Record<string, unknown> | undefined;

    if (typeof rawKind === "string" && VALID_KINDS.has(rawKind) && rawKind !== "text") {
      // Validate payload shape per kind. Drop the bubble entirely if the payload is
      // missing or wrong-shaped — Phil's text reply still renders normally.
      if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
        const p = rawPayload as Record<string, unknown>;

        if (rawKind === "plan-preview") {
          const days = Array.isArray(p.days) ? p.days : null;
          if (days && days.length > 0) {
            const cleanedDays = days
              .map((d: unknown) => {
                if (!d || typeof d !== "object") return null;
                const dd = d as Record<string, unknown>;
                const dayName = typeof dd.dayName === "string" ? dd.dayName.slice(0, 12) : "";
                const sessionType = typeof dd.sessionType === "string" ? dd.sessionType.slice(0, 24) : "";
                const title = typeof dd.title === "string" ? dd.title.slice(0, 60) : "";
                const exercises = Array.isArray(dd.exercises)
                  ? dd.exercises.filter((e): e is string => typeof e === "string").slice(0, 3).map(e => e.slice(0, 60))
                  : [];
                if (!dayName || !title) return null;
                return { dayName, sessionType, title, exercises };
              })
              .filter((d): d is { dayName: string; sessionType: string; title: string; exercises: string[] } => d !== null)
              .slice(0, 7);
            if (cleanedDays.length > 0) {
              kind = "plan-preview";
              payload = { days: cleanedDays };
            }
          }
        } else if (rawKind === "quick-log") {
          const exerciseName = typeof p.exerciseName === "string" ? p.exerciseName.trim().slice(0, 60) : "";
          if (exerciseName) {
            kind = "quick-log";
            payload = {
              exerciseName,
              ...(typeof p.setLabel === "string" && p.setLabel.trim() ? { setLabel: p.setLabel.trim().slice(0, 24) } : {}),
              ...(p.unit === "kg" || p.unit === "lb" ? { unit: p.unit } : {}),
              ...(typeof p.sessionId === "string" ? { sessionId: p.sessionId } : {}),
              ...(typeof p.setId === "string" ? { setId: p.setId } : {}),
            };
          }
        } else if (rawKind === "rpe") {
          kind = "rpe";
          payload = {
            ...(typeof p.contextLabel === "string" && p.contextLabel.trim() ? { contextLabel: p.contextLabel.trim().slice(0, 60) } : {}),
          };
        } else if (rawKind === "session-card") {
          const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
          const date = typeof p.date === "string" ? p.date : "";
          const title = typeof p.title === "string" ? p.title.trim().slice(0, 80) : "";
          if (sessionId && date && title) {
            kind = "session-card";
            payload = {
              sessionId,
              date,
              title,
              sessionType: typeof p.sessionType === "string" ? p.sessionType.slice(0, 24) : "",
              ...(typeof p.programmeId === "string" ? { programmeId: p.programmeId } : {}),
            };
          }
        }
      } else if (rawKind === "rpe") {
        // RPE is the only kind whose payload is fully optional — accept with no payload.
        kind = "rpe";
        payload = {};
      }
    }

    res.json({ reply, navigateTo, action, quickReplies, kind, payload });
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
