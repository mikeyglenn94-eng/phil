import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import { db, programmesTable, clientsTable } from "@workspace/db";
import type { Exercise } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays, parseISO, format } from "date-fns";
import { logApiCost } from "../lib/log-api-cost";
import { extractAuth } from "../middlewares/require-auth";
import { MG_PROGRAMMING_PHILOSOPHY } from "@workspace/generation-flow";
import {
  parseWorkout,
  adaptToStrengthSession,
  adaptToRunSession,
  type Sport,
} from "@workspace/workout-parser";

// ── Safe JSON parser — strips AI markdown fences before parsing ─────────────
function safeParseAIJson(raw: string): any {
  const cleaned = raw
    .replace(/```json\n?/gi, "")
    .replace(/```\n?/gi, "")
    .trim();
  return JSON.parse(cleaned);
}

// ── Model routing ──────────────────────────────────────────────────────────
// Use gpt-5.2 for complex multi-constraint programmes; gpt-4o for simple ones.
function selectModel(description: string): string {
  const d = description.toLowerCase();
  const complexSignals = [
    // Sport-specific
    "olympic", "weightlifting", "oly ", "snatch", "clean & jerk", "clean and jerk",
    "hyrox",
    // Engine / aerobic complexity
    "engine", "vo2", "aerobic base", "threshold", "hinshaw",
    // High frequency
    "5 day", "5x per week", "6 day", "6x per week", "five day", "six day",
    "5 session", "6 session",
    // Multi-modal complexity
    "triathlon", "crossfit games",
    // Multi-week programmes
    "4 week", "4-week", "four week", "3 week", "3-week", "three week",
    "5 week", "5-week", "6 week", "6-week", "8 week", "8-week",
    "week programme", "week program", "weekly progression", "progress over",
    // Complex bodybuilding / periodisation signals
    "superset", "super set",
    "max reps", "amrap", "failure",
    "rpe", "@rpe", "rpe8", "rpe9", "rpe 8", "rpe 9", "rpe 10",
    "periodis", "periodiz",
    "bulgarian", "pause squat", "paused", "deficit",
    "bodybuilding", "hypertrophy",
  ];
  // Multi-modal: mentions 3+ distinct training types
  const modalities = [
    /\bstrength\b/.test(d),
    /\brun(ning)?\b/.test(d),
    /\bwod\b|\bcrossFit\b|\bcondition(ing)?\b/.test(d),
    /\bsw(im|imming)\b/.test(d),
    /\bcycl(e|ing)\b/.test(d),
  ].filter(Boolean).length;

  if (complexSignals.some(kw => d.includes(kw)) || modalities >= 3) {
    return "gpt-5.2";
  }
  return "gpt-4o";
}

// ── Monthly programme limit ────────────────────────────────────────────────
const MONTHLY_LIMIT = 2;

async function getMonthlyCount(clientId: number): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // If the coach has reset credits, use the later of startOfMonth or creditResetAt
  const [clientRow] = await db.select({ creditResetAt: clientsTable.creditResetAt }).from(clientsTable).where(eq(clientsTable.id, clientId));
  const cutoff = clientRow?.creditResetAt && clientRow.creditResetAt > startOfMonth
    ? clientRow.creditResetAt
    : startOfMonth;

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(programmesTable)
    .where(and(eq(programmesTable.clientId, clientId), gte(programmesTable.createdAt, cutoff)));
  return rows[0]?.count ?? 0;
}

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const PARSE_SYSTEM_PROMPT = `You are a fitness programming assistant. You help coaches build and edit training sessions using voice or text commands.

You will receive a transcript from the coach AND the current list of exercises in the session. Your job is to apply whatever the coach says and return the COMPLETE updated exercise list.

## You must handle ALL of these command types:

### Adding new exercises (add to the list):
- "3x10 back squat" → add Back Squat: sets:3, reps:"10"
- "4 sets of 8 Romanian deadlift at RPE 8" → add with rpe:"8"
- "add pull-ups 3 sets to failure" → add Pull-Ups: sets:3, reps:"failure"
- "tempo 3 1 1 0" after naming an exercise → apply tempo to that new exercise

### Editing existing exercises (modify in place, PRESERVE their id):
- "change the bench press to 5 sets of 5" → update sets:5, reps:"5" on the existing bench press
- "make it 4 sets" → update the last exercise to sets:4
- "increase the squat reps to 12" → update reps:"12" on the squat
- "add RPE 9 to the deadlift" → update rpe:"9" on existing deadlift
- "change all rests to 2 minutes" → update rest:"2 min" on ALL exercises
- "add a note to the squat: brace hard" → update notes:"Brace hard" on the squat
- "set the bench press rest to 90 seconds" → update rest:"90s" on bench press
- "reduce reps on the lat pulldown by 2" → if reps was "10", change to "8"
- "change the tempo on everything to 3 1 1 0" → set tempo:"3-1-1-0" on all exercises

### Renaming / swapping exercises (modify in place, PRESERVE their id):
- "swap Romanian deadlift for leg press" → rename the Romanian deadlift to "Leg Press" (keep id)
- "replace the flyes with pec deck machine" → rename flyes to "Pec Deck Machine" (keep id)
- "change bench press to incline bench press" → rename (keep id)

### Removing exercises:
- "remove the lat pulldown" → delete it from the list entirely
- "delete the last exercise" → remove the last exercise in the list
- "take out the leg press" → remove it

### Reordering exercises:
- "move the deadlift to the end" → shift it to last position
- "put squats before deadlifts" → reorder so squats come first
- "move bench press to after the row" → reorder accordingly

### Variable rep schemes (per-set reps and/or RPE):
- "21/15/9 at RPE 9" or "21 reps set 1, 15 reps set 2, 9 reps set 3 all RPE 9" or "set 1: 21 reps RPE 9, set 2: 15 reps RPE 9, set 3: 9 reps RPE 9"
  → sets:3, perSetReps:["21","15","9"], rpe:"9" (global RPE since all the same)
- "set 1: 10 reps RPE 7, set 2: 8 reps RPE 8, set 3: 6 reps RPE 9"
  → sets:3, perSetReps:["10","8","6"], perSetRpe:["7","8","9"]
- If reps per set are variable but RPE is the same → set global rpe, no perSetRpe
- If reps are all the same → set global reps, no perSetReps
- To clear variable scheme: "make the bench press uniform 4 sets of 8" → clear perSetReps, perSetRpe; set reps:"8"

### Week progressions:
- "reduce reps by 2 each week for 3 weeks" with current reps "10" → weekProgression:[{week:1,reps:"10"},{week:2,reps:"8"},{week:3,reps:"6"}]
- "add 2.5 kilos each week for 4 weeks" → weekProgression:[{week:1,weight:"start"},{week:2,weight:"+2.5kg"},...]

## Matching rules:
- Match exercises by name fuzzy matching (e.g. "bench press" matches "Smith Machine Bench Press")
- "it" or "that exercise" or "this" = the last exercise in the list
- "all exercises" = apply to every exercise
- Contextual: a bare attribute command after naming an exercise applies to that exercise

## Output rules:
- ALWAYS return the COMPLETE exercise list after applying the changes (not just what changed)
- PRESERVE the original id of any exercise that already existed — never change an existing id
- New exercises get a fresh id like "ex-{random 6 chars}"
- Return ONLY valid JSON, no markdown, no explanation
- Include a "changes" array describing what you did (for UI feedback), e.g. ["Updated bench press sets to 5", "Removed lat pulldown"]

Return format:
{"exercises": [{"id":"ex-1","name":"...","sets":3,"reps":"10","rpe":"8-9","rest":"90s","tempo":null,"notes":null,"rawText":"...","weekProgression":[]}], "changes": ["Added Back Squat", "Updated Bench Press reps to 5"]}`;

router.post("/parse", async (req, res): Promise<void> => {
  const { transcript, existingExercises } = req.body as {
    transcript: string;
    existingExercises?: Exercise[];
  };

  if (!transcript) {
    res.status(400).json({ error: "Transcript is required" });
    return;
  }

  try {
    const contextNote = existingExercises?.length
      ? `\n\nExisting exercises in this programme (for context, in case the transcript modifies them):\n${JSON.stringify(existingExercises, null, 2)}`
      : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: PARSE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Parse this voice transcript into exercises:${contextNote}\n\nTranscript: "${transcript}"`,
        },
      ],
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "parse", model: "gpt-5.2", usage: completion.usage });

    const content = completion.choices[0]?.message?.content ?? "{}";

    let parsed: { exercises: Exercise[]; changes?: string[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      req.log.warn({ content }, "Failed to parse LLM response as JSON");
      const fallbackExercise: Exercise = {
        id: `ex-${randomUUID().slice(0, 8)}`,
        name: transcript.slice(0, 60),
        rawText: transcript,
        sets: null,
        reps: null,
        rpe: null,
        rest: null,
        tempo: null,
        notes: null,
        weekProgression: [],
      };
      res.json({ exercises: [fallbackExercise], rawTranscript: transcript, changes: [] });
      return;
    }

    const exercises = (parsed.exercises ?? []).map((ex) => ({
      ...ex,
      id: ex.id || `ex-${randomUUID().slice(0, 8)}`,
      weekProgression: ex.weekProgression ?? [],
    }));

    res.json({ exercises, rawTranscript: transcript, changes: parsed.changes ?? [] });
  } catch (err) {
    req.log.error({ err }, "Error parsing transcript");
    res.status(500).json({ error: "Failed to parse transcript" });
  }
});

router.post("/calendar-command", async (req, res): Promise<void> => {
  const { command, sessions, referenceDate } = req.body as {
    command: string;
    sessions: any[];
    referenceDate: string;
  };

  if (!command || !sessions || !referenceDate) {
    res.status(400).json({ error: "command, sessions, and referenceDate are required" });
    return;
  }

  const systemPrompt = `You are a fitness calendar assistant. You execute natural language commands on a coach's training calendar.

You receive:
1. A command from the coach
2. The complete list of sessions (each with id, date yyyy-MM-dd, name, exercises array)
3. A reference date (today's date) to resolve relative date references

Return the COMPLETE updated sessions array after applying the command.

## Date resolution
- "this week" = Mon-Sun of the week containing referenceDate
- "next week" / "the following week" = Mon-Sun of the NEXT week after referenceDate's week
- "Monday 23rd to Sunday 29th" = sessions with dates 2026-03-23 through 2026-03-29 (use the reference year)
- Week starts on Monday
- All dates use YYYY-MM-DD format

## Operations you MUST handle

### Copy sessions to another week:
"copy sessions from Mon X to Sun Y to the following week"
→ Find all sessions in the source date range
→ For each, create a NEW session with:
  - id: "session-copy-" + original_id
  - date: offset the date by exactly 7 days (or however many days to reach the target week)
  - name: same as original
  - exercises: deep copy of exercises with new exercise ids ("ex-copy-" + original_id)
→ ADD these new sessions to the array (keep originals too)

### Modifying exercises (apply to copied sessions OR specified sessions):
When combined with copy: apply modifications to the NEWLY COPIED sessions only
When standalone (e.g. "increase all reps next week"): apply to sessions in that date range

"decrease reps by N" → subtract N from each exercise's reps field:
  - "10" → "8" (if N=2)
  - "8-10" → "6-8" (subtract from both ends of range)
  - "failure" / "AMRAP" → leave unchanged
  - null → leave null
  - Result is always a string

"increase sets by N" → add N to each exercise's sets (integer field):
  - 3 → 4 (if N=1)
  - null → leave null

"decrease reps by N and increase sets by N2" → apply both

"add RPE X to all" → set rpe: "X" on all exercises in target sessions
"change rest to X" → set rest: "X" on all exercises in target sessions
"remove all notes" → set notes: null on all exercises in target sessions

### Delete:
"delete all sessions next week" → remove those sessions from array
"clear next week" → same

### Move:
"move [session name/date] to [date]" → update that session's date

## Output rules
- Return ONLY valid JSON, no markdown, no explanation
- Include ALL sessions (unchanged + modified/new)
- Preserve IDs of existing sessions — never change existing IDs
- New copied sessions use id: "session-copy-" + sourceId (make unique if needed)

Return format:
{"sessions": [...complete sessions array...], "changes": ["Copied 3 sessions from week of Mar 23 to Mar 30", "Decreased reps by 2 on all exercises in copied sessions", "Increased sets by 1 on all exercises in copied sessions"]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 16384,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Reference date (today): ${referenceDate}\n\nCurrent sessions:\n${JSON.stringify(sessions, null, 2)}\n\nCommand: "${command}"`,
        },
      ],
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "calendar-command", model: "gpt-5.2", usage: completion.usage });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { sessions: any[]; changes: string[] };

    try {
      parsed = JSON.parse(content);
    } catch {
      req.log.warn({ content }, "Failed to parse calendar command response as JSON");
      res.json({ sessions, changes: ["Command could not be parsed — no changes made"] });
      return;
    }

    // Strip client-logged results from any newly created sessions (e.g. from copy commands)
    // Existing sessions (same IDs as original) are left untouched so logged data is preserved.
    const originalIds = new Set(sessions.map((s: any) => s.id));
    const cleanedSessions = (parsed.sessions ?? sessions).map((s: any) => {
      if (originalIds.has(s.id)) return s;
      return {
        ...s,
        clientComment: undefined,
        exercises: (s.exercises ?? []).map(({ setReps: _sr, setWeights: _sw, clientComment: _cc, ...rest }: any) => rest),
      };
    });

    res.json({ sessions: cleanedSessions, changes: parsed.changes ?? [] });
  } catch (err) {
    req.log.error({ err }, "Error executing calendar command");
    res.status(500).json({ error: "Failed to execute calendar command" });
  }
});

router.post("/generate-rationale", async (req, res): Promise<void> => {
  const { description, startDate, strengthStyle } = req.body as { description: string; startDate: string; strengthStyle?: "straight" | "variety" };
  if (!description) { res.status(400).json({ error: "description is required" }); return; }

  const styleNote = strengthStyle === "variety"
    ? " The session style is VARIETY — mention techniques like wave loading, pyramids, drop sets, or AMRAP finishers where appropriate."
    : strengthStyle === "straight"
    ? " The session style is STRAIGHT SETS — all sessions use consistent, clean set/rep schemes with progressive overload."
    : "";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 512,
      messages: [
        {
          role: "system",
          content: `You are a sharp, experienced strength and conditioning coach. A client has just described the training plan they want. Write a brief, direct paragraph (3–5 sentences) explaining the programming rationale — the structure, why it fits their goals, how intensity progresses, and any key strategic calls (e.g. deload week, peaking phase, upper/lower split).${styleNote} Write directly to the client. Use modern, confident coach language. Avoid filler phrases like "this will involve", "the plan includes", "it is designed to", "in order to" — use "you'll", "focus is", "this gives you", "build your engine" instead. Be specific. No bullet points. Do not mention that you are an AI.`,
        },
        {
          role: "user",
          content: `Start date: ${startDate ?? "to be confirmed"}\n\nProgramme description: "${description}"`,
        },
      ],
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "generate-rationale", model: "gpt-5.2", usage: completion.usage });
    const rationale = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ rationale });
  } catch (err) {
    req.log.error({ err }, "Error generating rationale");
    res.status(500).json({ error: "Failed to generate rationale" });
  }
});

router.post("/generate-programme", async (req, res): Promise<void> => {
  const { description, startDate, strengthStyle, clientId, weekOnly } = req.body as {
    description: string; startDate: string; strengthStyle?: "straight" | "variety"; clientId?: number; weekOnly?: boolean;
  };
  if (!description || !startDate) {
    res.status(400).json({ error: "description and startDate are required" });
    return;
  }

  // Check monthly generation limit before spending AI tokens
  if (clientId && !isNaN(Number(clientId))) {
    const count = await getMonthlyCount(Number(clientId));
    if (count >= MONTHLY_LIMIT) {
      res.status(429).json({ error: "monthly_limit_reached" });
      return;
    }
  }

  // ── SSE: keeps Replit proxy alive on mobile during long AI generation ──────
  // Without this, the proxy drops idle connections before the AI responds.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const sseWrite = (obj: object) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
  const hbTimer = setInterval(() => sseWrite({ t: "hb" }), 5000);
  const sseEnd = (obj?: object) => { clearInterval(hbTimer); if (obj) sseWrite(obj); res.end(); };

  // weekOnly = preview mode: generate exactly 1 week so the user can review before committing
  // Otherwise: ensure a multi-week block is generated (default 6 weeks)
  const weekMentioned = /\b(\d+)[\s-]?week|\bweeks?\b/i.test(description);
  const effectiveDescription = weekOnly
    ? description
    : weekMentioned ? description : `6-week ${description}`;

  const chosenModel = selectModel(effectiveDescription);
  req.log.info({ model: chosenModel, hasClientId: !!clientId }, "generate-programme model selected");

  const systemPrompt = `You are Phil, the lead strength and conditioning coach at MG Coaching. You are building a training programme based on a brief provided by a coach. Generate a complete, realistic multi-week training programme as a JSON object.

${MG_PROGRAMMING_PHILOSOPHY}

## Scheduling rules — use dayNumber, NOT dates
- Sessions are positioned by **dayNumber** (integer), NOT by calendar date. Day 1 = the first training day of the programme (maps to startDate). Do NOT output a "date" field.
- dayNumber is a simple day counter: Day 1, Day 2, Day 3... across the full programme. Rest days are simply gaps in the sequence.
- **Multiple sessions can share the same dayNumber** — this places them on the same calendar day. Use this for same-day pairs (e.g. strength AM + WOD PM, strength + run). Each session still gets its own unique id.
- Use these dayNumber patterns (offsets within each 7-day week), counting training DAYS not sessions:
  - 3 training days/week → week N training days at (N-1)×7+1, (N-1)×7+3, (N-1)×7+5
  - 4 training days/week → week N training days at (N-1)×7+1, (N-1)×7+2, (N-1)×7+4, (N-1)×7+6
  - 5 training days/week → week N training days at (N-1)×7+1, (N-1)×7+2, (N-1)×7+3, (N-1)×7+4, (N-1)×7+6
- Example (4-day week with same-day pairing, 3 weeks): days 1,1,2,4,6, 8,8,9,11,13, 15,15,16,18,20 — where day 1, 8, and 15 each have two sessions
- NEVER use weekday names (Mon/Tue/Thu/Sat) to compute dates — use dayNumber integers only.
- Spread training days sensibly — avoid consecutive days where possible. Same-day pairs are not consecutive-day issues.
- Schedule for the number of weeks requested. **If no specific duration is mentioned, default to 6 weeks.** Hard maximum of 6 weeks. Never generate only 1 week of sessions unless the user explicitly asks for 1 week.
- Progress sessions week to week through overload variables (more weight, more reps, more sets, tighter rest, higher RPE) — see the session style section for whether exercise variation is permitted.
- Each session must have a unique id: "session-gen-{unique 8 chars}"

## Output format
Return ONLY valid JSON (no markdown):
{
  "title": "6-Week Strength & Conditioning Block",
  "blockLength": 6,
  "sessionsPerWeek": 4,
  "sessions": [
    {
      "id": "session-gen-abc12345",
      "dayNumber": 1,
      "name": "Upper Body",
      "exercises": [...]
    },
    {
      "id": "session-gen-def67890",
      "dayNumber": 2,
      "name": "WOD",
      "source": "wod_brain",
      "structure": "21-15-9 Thrusters 42.5kg and Pull-ups for time",
      "color": "#7c3aed",
      "exercises": [...]
    }
  ]
}

IMPORTANT:
- "blockLength": integer number of weeks in the programme (e.g. 4, 6). **Default is 6 if the user didn't specify a duration.**
- "sessionsPerWeek": integer number of training days per week (e.g. 3, 4, 5). Default is 4 if not specified.
- You MUST generate sessions for ALL weeks — if blockLength is 6 and sessionsPerWeek is 4, the output must contain exactly 24 sessions.
- Use "dayNumber" (integer), NOT "date" (string). The server computes the actual calendar date.`;

  const styleSection = strengthStyle === "variety" ? `

## PROGRESSION MODE: INTERMEDIATE+ VARIATION

**Primary lifts (main squat, main press, main hinge) — keep consistent for the full block.**
These are the exercises where progressive overload compounds most. They must remain the same across all weeks. Do not swap Back Squat for Front Squat, Bench Press for Incline Bench, or Deadlift for Romanian Deadlift within the block. Variation at these positions kills the progressive overload signal.

**Secondary compound movements — mostly stable (2–3 weeks minimum before any change).**
A swap is only appropriate if there is a clear coaching reason (e.g. addressing a specific weakness that has been identified), not for novelty.

**Accessories — can vary more freely.**
Accessory exercise changes are acceptable after 2 weeks if there is a good reason. Still do not change for novelty alone — every swap needs a purpose.

**Rep schemes:** Use clean, progressive straight sets. Progress through weight, reps, or sets across weeks.

**Critical rule:** Exercise names in Week 2, 3, and 4 sessions that are strength sessions must match Week 1 for all primary and secondary lifts. Check before finalising output.
` : `

## PROGRESSION MODE: STRICT PROGRESSION (default — this is the correct way to programme a strength block)

**This is non-negotiable: ALL exercises in ALL strength sessions must remain IDENTICAL across every week of the block.**

Think of Week 1 as defining the block template. Weeks 2, 3, and 4 are progressions of that exact template — same exercises, same session structure, different numbers.

**What changes week to week:**
- Sets (e.g. 3 sets → 4 sets → 5 sets → 3 sets deload)
- Reps or rep ranges (e.g. 8-12 → 10-14 → 6-10 → 5-8 deload)
- Load/intensity (heavier each week, backed off on deload)
- RPE targets (e.g. @RPE7 → @RPE8 → @RPE8-9 → @RPE6 deload)
- Rest periods (can tighten as weeks progress)
- Tempo (can add pauses or slow eccentrics in later weeks)

**What does NOT change:**
- Exercise name (Back Squat stays Back Squat every single week)
- Exercise order within the session
- The exercises in each session

**Correct example — Back Squat across a 4-week block:**
- Week 1: Back Squat, 4×8-12, @RPE7
- Week 2: Back Squat, 4×10-14, @RPE8
- Week 3: Back Squat, 5×6-10, @RPE8-9
- Week 4: Back Squat, 3×5-8, @RPE6 (deload)

**WRONG — do not do this:**
- Week 1: Back Squat
- Week 2: Front Squat ← WRONG. Exercise swap = broken overload.
- Week 3: Pause Squat ← WRONG. Still the same problem.

**Rep schemes:** Straight sets only. No pyramids, no wave loading, no drop sets unless the description specifically asked for them.

**Final check before outputting:** Scan every strength session. If any exercise name in Week 2+ differs from its Week 1 counterpart, replace it with the Week 1 exercise name. The output is only correct when every week has the same exercises.
`;

  const weekOnlySection = weekOnly ? `

## WEEK 1 PREVIEW ONLY — CRITICAL CONSTRAINT
Generate EXACTLY 1 week of sessions. All day numbers must be between 1 and 7 (inclusive). Do NOT generate any sessions with dayNumber greater than 7. blockLength must be 1. This is a preview for the user to review and tweak before the full programme is built.
` : "";

  try {
    const completion = await openai.chat.completions.create({
      model: weekOnly ? "gpt-4o" : chosenModel,
      max_completion_tokens: weekOnly ? 8192 : (chosenModel === "gpt-4o" ? 16384 : 32768),
      messages: [
        { role: "system", content: systemPrompt + weekOnlySection + styleSection },
        { role: "user", content: `Description: "${effectiveDescription}"` },
      ],
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "generate-programme", model: completion.model ?? chosenModel, usage: completion.usage });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { title: string; sessions: any[] };
    try {
      parsed = safeParseAIJson(raw);
    } catch {
      req.log.warn({ raw }, "Failed to parse generate-programme LLM response");
      return sseEnd({ t: "err", error: "AI returned invalid JSON — try rephrasing your description" });
    }

    const start = parseISO(startDate);
    const sessions = (parsed.sessions ?? []).map((s: any) => {
      // Prefer dayNumber; if AI ignored the instruction and returned a date, derive dayNumber from it.
      let dayNum: number | null = typeof s.dayNumber === "number" ? s.dayNumber : null;
      if (dayNum == null && s.date) {
        const diff = Math.round((parseISO(s.date).getTime() - start.getTime()) / 86400000);
        dayNum = diff + 1; // convert 0-indexed diff back to 1-indexed dayNumber
      }
      const sessionDate = dayNum != null
        ? format(addDays(start, dayNum - 1), "yyyy-MM-dd")
        : startDate;
      const base: any = {
        ...s,
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: sessionDate,
        dayNumber: dayNum ?? undefined,
        exercises: (s.exercises ?? []).map((ex: any) => ({
          ...ex,
          id: `ex-${randomUUID().slice(0, 8)}`,
          weekProgression: ex.weekProgression ?? [],
        })),
      };
      if (!s.source) delete base.source;
      return base;
    });

    sseEnd({
      t: "ok",
      title: parsed.title || "Custom Programme",
      blockLength: typeof parsed.blockLength === "number" ? parsed.blockLength : null,
      sessionsPerWeek: typeof parsed.sessionsPerWeek === "number" ? parsed.sessionsPerWeek : null,
      sessions,
    });
  } catch (err) {
    req.log.error({ err }, "Error generating programme");
    sseEnd({ t: "err", error: "Failed to generate programme" });
  }
});

router.post("/tweak-programme-preview", async (req, res): Promise<void> => {
  const { sessions, instruction, equipmentList } = req.body as {
    sessions: any[];
    instruction: string;
    equipmentList?: string;
  };
  if (!sessions || !instruction) {
    res.status(400).json({ error: "sessions and instruction are required" });
    return;
  }

  const equipmentContext = equipmentList
    ? `\n\nUSER'S EQUIPMENT: ${equipmentList}\nOnly prescribe exercises using this equipment. If the user requests an exercise requiring unavailable equipment, suggest alternatives that only use listed equipment.`
    : "";

  const systemPrompt = `You are a fitness programming assistant. The user has a 1-week programme preview and wants to tweak it.

You will receive the current sessions JSON and a natural language instruction. Apply ONLY what the instruction asks for and return the complete updated sessions.

CRITICAL RULES:
- When swapping or modifying an exercise, apply the change to ALL instances of that exercise across ALL sessions in the week, not just one session. After making the change, confirm it in your message: "Lat pulldown swapped for seated row across all sessions."
- Preserve all session structure: dates, ids, names, source fields, colors
- Do NOT restructure or rename sessions unless the instruction explicitly asks for it
- Do NOT change exercises the instruction didn't mention
- If the user asks to move a session to a different day, update the date field only
- Return ONLY valid JSON: {"sessions": [...complete updated sessions...], "message": "Brief description of what changed"}${equipmentContext}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Current week 1 sessions:\n${JSON.stringify(sessions, null, 2)}\n\nInstruction: "${instruction}"`,
        },
      ],
      response_format: { type: "json_object" },
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "tweak-programme-preview", model: "gpt-4o", usage: completion.usage });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let result: { sessions?: any[]; message?: string };
    try {
      result = safeParseAIJson(raw);
    } catch {
      res.status(500).json({ error: "AI returned invalid JSON" });
      return;
    }

    const updatedSessions = (result.sessions ?? sessions).map((s: any) => ({
      ...s,
      exercises: (s.exercises ?? []).map((ex: any) => ({
        ...ex,
        id: ex.id || `ex-${randomUUID().slice(0, 8)}`,
        weekProgression: ex.weekProgression ?? [],
      })),
    }));

    res.json({ sessions: updatedSessions, message: result.message ?? "Preview updated." });
  } catch (err) {
    req.log.error({ err }, "Error tweaking programme preview");
    res.status(500).json({ error: "Failed to tweak preview" });
  }
});

router.post("/programmes/:id/session-feedback", async (req, res): Promise<void> => {
  const { completedSession, feedback, allSessions } = req.body as {
    completedSession: any;
    feedback: string;
    allSessions: any[];
  };

  if (!completedSession || !feedback?.trim() || !Array.isArray(allSessions)) {
    res.status(400).json({ error: "completedSession, feedback, and allSessions are required" });
    return;
  }

  const futureSessions = allSessions.filter(
    (s: any) => s.id !== completedSession.id && s.date > completedSession.date
  );

  if (futureSessions.length === 0) {
    res.json({ updatedSessions: [], userConfirmation: "There are no future sessions in this programme to adjust." });
    return;
  }

  const systemPrompt = `You are an expert fitness programming AI acting as a coach making targeted adjustments to a training programme.

A client has just completed a session and left feedback. Your job is to:
1. Identify which future sessions correspond to the completed session — meaning sessions with the same name, same type, or same training role (e.g. "Upper Body", "Run", "WOD")
2. Apply the client's feedback as targeted, minimal changes to ONLY those corresponding future sessions
3. Preserve the programme's overall structure, progression, and intent
4. Return ONLY the modified sessions (full objects, original IDs preserved) and a one-sentence user confirmation

Rules:
- Only modify sessions with the same name or same training role as the completed session
- Do NOT modify unrelated sessions (different session types or training goals)
- Preserve ALL session IDs exactly as provided — never generate new IDs
- Keep the same session intent unless the user explicitly asks to change it
- Make surgical edits: exercise swaps, slight volume changes, pacing tweaks, structure adjustments
- Preserve progression logic — sessions should still escalate week to week
- Do NOT rewrite sessions from scratch
- If the feedback is positive ("loved it", "perfect") and no changes are needed, return updatedSessions: []
- userConfirmation must be ONE sentence telling the client what will be different next time

Feedback interpretation examples:
- "Too easy" → increase sets, reps, or load slightly in future corresponding sessions
- "Too hard" → reduce volume, load, or intensity slightly
- "Too much leg fatigue" → reduce lower-body volume or swap exercises
- "Swap burpees" → replace burpees with a similar movement (box step-overs, jumping lunges)
- "Loved this format" → return updatedSessions: [] with a positive confirmation
- "Running felt too hard" → reduce pace demand, interval distance, or density in future run sessions
- "More variety" → swap some exercises for alternatives with same stimulus

Return ONLY valid JSON (no markdown):
{
  "updatedSessions": [
    { ...full session object with ORIGINAL id and modified fields... }
  ],
  "userConfirmation": "One sentence describing what changes next time."
}`;

  const userContent = `Completed session:
${JSON.stringify(completedSession, null, 2)}

Client feedback: "${feedback.trim()}"

All future sessions in this programme (only modify the corresponding ones):
${JSON.stringify(futureSessions, null, 2)}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 8000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "session-feedback", model: "gpt-4o-mini", usage: completion.usage });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { updatedSessions: any[]; userConfirmation: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { updatedSessions: [], userConfirmation: "Your feedback has been noted." };
    }

    res.json({
      updatedSessions: Array.isArray(parsed.updatedSessions) ? parsed.updatedSessions : [],
      userConfirmation: parsed.userConfirmation ?? "Your feedback has been applied to future sessions.",
    });
  } catch (err) {
    req.log.error({ err }, "Error applying session feedback");
    res.status(500).json({ error: "Failed to apply feedback" });
  }
});

router.post("/transcribe", upload.single("audio"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  try {
    const file = new File([req.file.buffer], "audio.webm", { type: req.file.mimetype });
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      response_format: "json",
    });
    res.json({ transcript: transcription.text });
  } catch (err) {
    req.log.error({ err }, "Error transcribing audio");
    res.status(500).json({ error: "Failed to transcribe audio" });
  }
});

// ── Quick run session builder ───────────────────────────────────────────────
// POST /parse-run-session  { description, name?, sport? }
// Returns a ready-to-save endurance session (source: "run_brain") from free-text/voice.
// Backed by the @workspace/workout-parser pure-extraction function.
router.post("/parse-run-session", async (req, res): Promise<void> => {
  const { description, name, sport } = req.body as {
    description?: string;
    name?: string;
    sport?: Sport;
  };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const resolvedSport: Sport =
    sport === "cycle" || sport === "swim" || sport === "run" ? sport : "run";

  const result = await parseWorkout(description, {
    sport: resolvedSport,
    sessionName: name,
  });

  void logApiCost({
    userId: req.auth?.userId,
    endpoint: "parse-run-session",
    model: "gpt-5.2",
    usage: result.usage,
  });

  if (!result.ok) {
    if (result.reason === "no_exercises_found") {
      res.status(422).json({ error: "No exercises detected in your description.", reason: result.reason });
      return;
    }
    req.log.warn({ reason: result.reason, message: result.message }, "parseWorkout failed (run)");
    res.status(500).json({ error: "Failed to parse session", reason: result.reason });
    return;
  }

  res.json(adaptToRunSession(result));
});

// ── WOD canonical schema helpers (mirrors wod-schema.ts in the frontend) ─────
type WodStepUnit = "reps" | "seconds" | "m" | "km" | "cal";
type StepTargetType = "reps" | "seconds" | "distance" | "calories" | "free_text";

function wodNormaliseUnit(unit: string | undefined): StepTargetType {
  if (!unit) return "reps";
  const u = unit.toLowerCase().trim();
  if (u === "seconds" || u === "sec" || u === "s") return "seconds";
  if (u === "m" || u === "metres" || u === "meters" || u === "km") return "distance";
  if (u === "calories" || u === "cal" || u === "cals") return "calories";
  return "reps";
}

function wodResolveUnit(unit: string | undefined): WodStepUnit {
  if (!unit) return "reps";
  const u = unit.toLowerCase().trim();
  if (u === "seconds" || u === "sec" || u === "s") return "seconds";
  if (u === "m" || u === "metres" || u === "meters") return "m";
  if (u === "km") return "km";
  if (u === "calories" || u === "cal" || u === "cals") return "cal";
  return "reps";
}

/**
 * Extract the raw amount string from a block — may be a number OR a range like "12-18".
 * Returns { single: number } | { range: [number, number] } | undefined
 */
function wodExtractRawAmount(block: Record<string, unknown>): { single: number } | { range: [number, number] } | undefined {
  const candidates = ["amount", "reps", "duration", "time", "seconds", "distance", "calories", "value", "count"];
  for (const key of candidates) {
    const v = block[key];
    if (v === undefined || v === null || v === "") continue;
    // Numeric single value
    const n = Number(v);
    if (!Number.isNaN(n)) return { single: n };
    if (typeof v === "string") {
      // Range string e.g. "12-18" or "10-12"
      const rangeMatch = v.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
      if (rangeMatch) return { range: [Number(rangeMatch[1]), Number(rangeMatch[2])] };
      // Fallback: first number
      const m = v.match(/\d+/);
      if (m) return { single: Number(m[0]) };
    }
  }
  return undefined;
}

/** Defensively extract a numeric amount (for legacy display use) */
function wodExtractAmount(block: Record<string, unknown>): number | undefined {
  const raw = wodExtractRawAmount(block);
  if (!raw) return undefined;
  if ("single" in raw) return raw.single;
  return raw.range[0]; // for display: use min of range
}

/** Build a safe notes display string — never produces "undefined ..." */
function wodBuildNotes(block: Record<string, unknown>): string {
  const raw = wodExtractRawAmount(block);
  const unit = wodResolveUnit(block.unit as string | undefined);
  const loadDisplay = block.weight as string | undefined;
  if (!raw) return loadDisplay ?? "";
  const display = "range" in raw ? `${raw.range[0]}-${raw.range[1]}` : String(raw.single);
  return loadDisplay ? `${display} ${unit} (${loadDisplay})` : `${display} ${unit}`;
}

/** Build canonical steps from a flat blocks array */
function wodBlocksToSteps(blocks: Record<string, unknown>[], blockIndexOffset = 0) {
  return blocks.map((block, idx) => {
    const raw = wodExtractRawAmount(block);
    const rawUnit = block.unit as string | undefined;
    const targetType = wodNormaliseUnit(rawUnit);
    const unit = wodResolveUnit(rawUnit);
    const movementRaw = (block.movement as string | undefined) ?? "";
    const movName = movementRaw.charAt(0).toUpperCase() + movementRaw.slice(1);
    const loadDisplay = block.weight as string | undefined;
    const minuteLabel = block.minuteLabel as string | undefined;
    const target: Record<string, unknown> = { type: targetType, unit };
    if (raw) {
      if ("range" in raw) {
        target.valueRange = raw.range;
        target.targetText = `${raw.range[0]}–${raw.range[1]} ${unit}`;
        target.value = null;
      } else {
        target.value = raw.single;
      }
    }
    return {
      id: `step-${blockIndexOffset}-${idx}`,
      movement: { name: movName },
      target,
      ...(loadDisplay ? { load: { display: loadDisplay } } : {}),
      ...(minuteLabel ? { label: minuteLabel } : {}),
    };
  });
}

/** Build canonical WOD from multi-segment AI response */
function wodBuildFromSegments(
  format: string,
  segments: Array<{ segmentType?: string; label?: string; rounds?: number; restNote?: string; blocks: Record<string, unknown>[] }>,
  durationMinutes?: number
) {
  const fmtMap: Record<string, string> = {
    emom: "emom", amrap: "amrap", for_time: "for_time", rounds_for_time: "for_time",
    chipper: "chipper", interval: "intervals", intervals: "intervals",
    fixed: "for_time", rounds: "for_time",
  };
  const canonicalFormat = fmtMap[(format ?? "").toLowerCase()] ?? "for_time";
  const canonicalBlocks = segments.map((seg, bi) => {
    const steps = wodBlocksToSteps(seg.blocks ?? [], bi);
    const segType = fmtMap[(seg.segmentType ?? "fixed").toLowerCase()] ?? "for_time";
    return {
      id: `block-${bi}`,
      type: segType,
      steps,
      ...(seg.label ? { label: seg.label } : {}),
      ...(seg.rounds != null ? { rounds: seg.rounds } : {}),
    };
  });
  return {
    format: canonicalFormat,
    blocks: canonicalBlocks,
    ...(durationMinutes != null ? { totalDurationSeconds: durationMinutes * 60 } : {}),
  };
}

/** Build a canonical WodWorkout object from raw AI blocks */
function wodBuildCanonical(format: string, blocks: Record<string, unknown>[], durationMinutes?: number, rounds?: number) {
  const fmtMap: Record<string, string> = {
    emom: "emom", amrap: "amrap", for_time: "for_time",
    rounds_for_time: "for_time", chipper: "chipper", interval: "intervals", intervals: "intervals",
  };
  const canonicalFormat = fmtMap[(format ?? "").toLowerCase()] ?? "custom";

  const steps = blocks.map((block, idx) => {
    const raw = wodExtractRawAmount(block);
    const rawUnit = block.unit as string | undefined;
    const targetType = wodNormaliseUnit(rawUnit);
    const unit = wodResolveUnit(rawUnit);
    const movementRaw = (block.movement as string | undefined) ?? "";
    const movName = movementRaw.charAt(0).toUpperCase() + movementRaw.slice(1);
    const loadDisplay = block.weight as string | undefined;
    const minuteLabel = block.minuteLabel as string | undefined;

    // Build target — preserve ranges
    const target: Record<string, unknown> = { type: targetType, unit };
    if (raw) {
      if ("range" in raw) {
        target.valueRange = raw.range;
        target.targetText = `${raw.range[0]}–${raw.range[1]} ${unit}`;
        target.value = null;
      } else {
        target.value = raw.single;
      }
    }

    return {
      id: `step-${idx}`,
      movement: { name: movName },
      target,
      ...(loadDisplay ? { load: { display: loadDisplay } } : {}),
      ...(minuteLabel ? { label: minuteLabel } : {}),
    };
  });

  const canonicalBlock = {
    id: "block-0",
    type: canonicalFormat,
    steps,
    ...(durationMinutes != null ? { durationSeconds: durationMinutes * 60 } : {}),
    ...(rounds != null ? { rounds } : {}),
  };

  return {
    format: canonicalFormat,
    blocks: [canonicalBlock],
    ...(durationMinutes != null ? { totalDurationSeconds: durationMinutes * 60 } : {}),
  };
}

// POST /parse-wod-session  { description, name? }
// Returns a ready-to-save WOD session (source: "wod_brain") from free-text.
router.post("/parse-wod-session", async (req, res): Promise<void> => {
  const { description, name, mode } = req.body as { description?: string; name?: string; mode?: "parse" | "generate" };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const systemPrompt = mode === "parse"
    ? `You are a WOD parser. Your only job is to convert the user's input into structured workout data.

CRITICAL RULES:
- Return ONLY ONE option — the exact workout the user described.
- Do NOT invent a second option or alternative.
- Use EXACTLY the movements, reps, format, and timing the user specified.
- Do NOT add extra movements, change rep counts, or alter the format.
- Your job is parsing, not programming.

Return a valid JSON object with a single item in the "options" array, using the standard format with "name", "format", "blocks" (or "segments"), "estimatedMinutes", and "structure".`
    : `You are an expert conditioning coach. Design TWO different WOD workout options from the user's movements and constraints.

Supported formats: amrap, for_time, emom, rounds_for_time, chipper, interval.

Rules:
- Choose the TWO most appropriate formats given the movements. If the user specifies a format (e.g. "EMOM"), use it for the first option.
- Design SPECIFIC workouts — decide all reps, distances, loads, and timing yourself.
- Write a concise human-readable STRUCTURE string as a coach would write on a whiteboard (no theory, no fluff).
- AMRAP rounds should complete in 60-90s. EMOM minutes achievable in 35-45s.
- Return ONLY valid JSON, no markdown fences.
- Do NOT include coaching language such as "compound-first approach", "gradual intensity increase", "progressive overload", or any programming theory in any field.

TITLE RULES — "name" field:
- Use a publish-ready title like "EMOM 21", "AMRAP 20", "For Time: 21-15-9", "Intervals: 6×2 Min Row".
- Do NOT use generic names like "WOD", "test", or "Session".
- If the user provided a title hint, use it only if it is meaningful.

TIME ESTIMATION — CRITICAL:
Never estimate duration from total reps or calories alone. Use the structured model below.

STEP 1 — CLASSIFY FORMAT FIRST:
- AMRAP N min / EMOM N min / EMOM N with M movements → duration IS N minutes. Do not override it. estimatedMinutes = [N-2, N+2].
- E2MOM N / Interval with explicit time per interval → calculate from interval count × interval length.
- For Time / Rounds For Time / Chipper → estimate using steps 2–7 below.

STEP 2 — BREAK INTO SECTIONS:
Estimate each section (buy-in, main work, cash-out, finisher) independently, then sum.

STEP 3 — MOVEMENT TIME MODELS (per-rep or per-unit, moderate pace):
Machine calories:
  - Bike Erg: 1 cal = 7 sec (high fatigue multiplier: 1.15× per round)
  - Row Erg:  1 cal = 8 sec (fatigue multiplier: 1.12× per round)
  - Ski Erg:  1 cal = 9 sec (fatigue multiplier: 1.12× per round)

Running:
  - 100m = 30 sec, 200m = 60 sec, 400m = 2 min, 1km = 5 min (fatigue multiplier: 1.05×)

Simple bodyweight (press-ups, air squats, sit-ups, GHD sit-ups, jumping jacks):
  - 10 reps = 20 sec (fatigue multiplier: 1.08× per round)

Gymnastics (pull-ups, ring dips, toes-to-bar, muscle-ups, HSPU):
  - 10 reps = 40 sec (fatigue multiplier: 1.18× per round)

Barbell / dumbbell cycling (light–moderate: thrusters, power cleans, KB swings, wall balls):
  - 10 reps = 40 sec (fatigue multiplier: 1.15× per round)

Heavy barbell strength reps (deadlifts, squats, strict press at high load):
  - 10 reps = 60 sec (fatigue multiplier: 1.05× per round)

Burpees (any variation):
  - 10 reps = 50 sec (fatigue multiplier: 1.25× per round — highest)

Carries, holds, sled work:
  - 10m = 15 sec carry; 30 sec per hold set

Box / step work (box jumps, step-ups, lunges):
  - 10 reps = 30 sec (fatigue multiplier: 1.10× per round)

STEP 4 — APPLY FATIGUE SCALING FOR ROUNDS:
For "N rounds for time" with M movements per round:
  round_1_time = sum of (reps ÷ 10 × movement_pace) for each movement
  round_k_time = round_1_time × fatigue_multiplier^(k-1)   (use the highest multiplier in the round)
  total_main_work = sum of round_1_time through round_N_time

STEP 5 — ADD TRANSITIONS (per movement change):
  - Moving between exercises: +5 sec each
  - Getting on/off a machine: +10 sec
  Keep small but consistent.

STEP 6 — ADD REST:
  - If rest is explicitly written: include it exactly.
  - If no rest is written: assume continuous effort. Do not add rest.

STEP 7 — COMPUTE RANGE:
  low_estimate  = total × 0.85  (fast athlete)
  high_estimate = total × 1.20  (fatigued athlete)
  Round to nearest minute.
  estimatedMinutes = [low_estimate, high_estimate]

ADJUSTMENT HIERARCHY (if estimated time ≠ target duration by >20%):
  1. Adjust machine calories (biggest single lever)
  2. Adjust round count
  3. Adjust buy-in / cash-out volume
  4. Adjust reps — last resort

CONFIDENCE:
  - high: explicit time format (AMRAP, EMOM) or clear rounds + simple movements
  - medium: multi-segment or mixed modal
  - low: ambiguous structure → set estimatedMinutes to null and do not guess

Always include "estimatedMinutes": [min, max] (or null if confidence is low) in each option.

CRITICAL — blocks field rules:
- ALWAYS include "amount". NEVER use "duration", "time", "reps", or other synonyms — only "amount".
- amount can be a NUMBER (e.g. 15) OR a RANGE STRING (e.g. "12-18") when the user specifies a range or ambiguity.
- For time-based: amount=35, unit="seconds" (or "30-40" if user said "30 to 40 seconds")
- For reps: amount=15, unit="reps" (or "12-18" if user said "12 to 18 reps")
- For distance: amount=200, unit="m"
- For calories: amount=12, unit="cal" (or "10-12" if user said "10 or 12 cal")
- PRESERVE ranges — if user says "12 or 10 cal", write amount="10-12". Do NOT average or pick one number.
- If user says "20 to 25 reps", write amount="20-25", NOT 22 or 25.
- For EMOM, add "minuteLabel" to each block, e.g. "Minute 1", "Minute 2", "Minute 3".
- Only use a single number when the prescription is unambiguously exact.

EXTRA FIELDS (include when relevant):
- "rounds": integer — how many times the block sequence repeats. For EMOM 21 with 3 movements: rounds=7.
- "repeatNote": string — plain English repeat instruction, e.g. "Repeat for 7 rounds".
- "restNote": string — rest instruction if applicable, e.g. "Rest the remainder of each minute", "60s rest between rounds".

MULTI-SEGMENT WODs — use "segments" instead of "blocks" when:
- The description has a buy-in / cash-out / buy-out pattern
- There are clearly distinct phases (e.g. fixed opener + repeated block + fixed closer)

Segment types: "fixed", "rounds", "amrap", "emom", "interval"
Semantic labels: "Buy-in", "Cash-out", "Buy-out", "Finisher"
Use plain label for rounds: "4 rounds", "6 rounds"
Use format + duration for timed blocks: "AMRAP 8 min", "EMOM 10 min"

Multi-segment example:
{
  "format": "for_time", "name": "Buy-in · Grind · Cash-out", "duration": 20,
  "segments": [
    { "segmentType": "fixed", "label": "Buy-in", "blocks": [{ "movement": "Bike Erg", "amount": 25, "unit": "cal" }] },
    { "segmentType": "rounds", "label": "4 rounds", "rounds": 4, "restNote": "Rest 30s between rounds",
      "blocks": [
        { "movement": "Step-Ups", "amount": 16, "unit": "reps" },
        { "movement": "Press-Ups", "amount": 12, "unit": "reps" },
        { "movement": "Air Squats", "amount": 20, "unit": "reps" }
      ]
    },
    { "segmentType": "fixed", "label": "Cash-out", "blocks": [{ "movement": "Bike Erg", "amount": 15, "unit": "cal" }] }
  ]
}

For simple single-phase WODs, continue to use flat "blocks" as before.

Result type per format:
  amrap → "rounds_reps" | for_time → "finish_time" | emom → "completed" | rounds_for_time → "finish_time" | chipper → "finish_time" | interval → "total_output"

Response format — EMOM example:
{
  "options": [
    {
      "format": "emom",
      "name": "EMOM 21",
      "structure": "EMOM 21: Min 1: 35s Burpees | Min 2: 40s Wall Balls | Min 3: 40s Machine",
      "duration": 21,
      "rounds": 7,
      "repeatNote": "Repeat for 7 rounds",
      "restNote": "Rest the remainder of each minute",
      "resultType": "completed",
      "blocks": [
        { "movement": "Burpees", "amount": 35, "unit": "seconds", "minuteLabel": "Minute 1" },
        { "movement": "Wall Balls", "amount": 40, "unit": "seconds", "minuteLabel": "Minute 2" },
        { "movement": "Machine", "amount": 40, "unit": "seconds", "minuteLabel": "Minute 3" }
      ]
    },
    {
      "format": "amrap",
      "name": "AMRAP 20",
      "structure": "AMRAP 20: 15 Wall Balls (9kg), 200m Run, 10 Burpees",
      "duration": 20,
      "resultType": "rounds_reps",
      "blocks": [
        { "movement": "Wall Balls", "amount": 15, "unit": "reps", "weight": "9kg" },
        { "movement": "Run", "amount": 200, "unit": "m" },
        { "movement": "Burpees", "amount": 10, "unit": "reps" }
      ]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Session name (optional): ${name?.trim() || "(auto-generate)"}\n\nDescription:\n${description.trim()}` },
      ],
      response_format: { type: "json_object" },
    });
    void logApiCost({ userId: req.auth?.userId, endpoint: "parse-wod-session", model: "gpt-4o", usage: completion.usage });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const options: any[] = parsed.options ?? [];

    const now = Date.now();
    const sessionOptions = options.map((opt: any, oi: number) => {
      const rawBlocks: Record<string, unknown>[] = opt.blocks ?? [];
      const rawSegments: any[] = opt.segments ?? [];
      const durationMin: number | undefined = typeof opt.duration === "number" ? opt.duration : undefined;
      const rounds: number | undefined = typeof opt.rounds === "number" ? opt.rounds : undefined;

      // Multi-segment or single-block canonical WOD
      const wodCanonical = rawSegments.length > 0
        ? wodBuildFromSegments(opt.format ?? "for_time", rawSegments, durationMin)
        : wodBuildCanonical(opt.format ?? "amrap", rawBlocks, durationMin, rounds);

      // All raw blocks for legacy exercises array
      const allRawBlocks: Record<string, unknown>[] = rawSegments.length > 0
        ? rawSegments.flatMap((s: any) => s.blocks ?? [])
        : rawBlocks;

      // Build legacy exercises array for backward compat — with safe notes (never "undefined ...")
      const exercises = allRawBlocks.map((block, idx) => {
        const notes = wodBuildNotes(block);
        const movementRaw = (block.movement as string | undefined) ?? "";
        const movName = movementRaw.charAt(0).toUpperCase() + movementRaw.slice(1);
        return {
          id: `ex-${now}-${oi}-${idx}`,
          name: movName,
          sets: null, reps: null, rpe: null, rest: null, tempo: null,
          notes,
          rawText: notes ? `${notes} ${movementRaw}` : movementRaw,
          weekProgression: [], clientComment: null,
          perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
        };
      });

      // Use AI-generated name unless user provided a clearly meaningful name
      const userNameMeaningful = name?.trim() && name.trim().toLowerCase() !== "test" && name.trim().length > 2;
      const sessionName = userNameMeaningful ? name!.trim() : (opt.name || "WOD");

      return {
        name: sessionName,
        source: "wod_brain",
        format: opt.format ?? "amrap",
        structure: opt.structure ?? description.trim(),
        repeatNote: opt.repeatNote ?? "",
        restNote: opt.restNote ?? "",
        scoreType: opt.resultType ?? "",
        wod: wodCanonical,
        exercises,
        ...(Array.isArray(opt.estimatedMinutes) && opt.estimatedMinutes.length === 2
          ? { estimatedMinutes: opt.estimatedMinutes as [number, number] }
          : {}),
      };
    });

    if (sessionOptions.length === 0) {
      res.json({ name: name?.trim() || "WOD", source: "wod_brain", structure: description.trim(), wod: null, exercises: [] });
      return;
    }

    res.json({ options: sessionOptions });
  } catch (err) {
    req.log.error({ err }, "Error parsing WOD session");
    res.status(500).json({ error: "Failed to parse WOD session" });
  }
});

// ── Quick single-session builder ───────────────────────────────────────────
// POST /parse-session  { description, name? }
// Returns a ready-to-save strength session (source: "strength_block").
// Backed by the @workspace/workout-parser pure-extraction function.
router.post("/parse-session", async (req, res): Promise<void> => {
  const { description, name } = req.body as { description?: string; name?: string };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const result = await parseWorkout(description, {
    sport: "strength",
    sessionName: name,
  });

  void logApiCost({
    userId: req.auth?.userId,
    endpoint: "parse-session",
    model: "gpt-5.2",
    usage: result.usage,
  });

  if (!result.ok) {
    if (result.reason === "no_exercises_found") {
      res.status(422).json({ error: "No exercises detected in your description.", reason: result.reason });
      return;
    }
    req.log.warn({ reason: result.reason, message: result.message }, "parseWorkout failed (strength)");
    res.status(500).json({ error: "Failed to parse session", reason: result.reason });
    return;
  }

  res.json(adaptToStrengthSession(result));
});

// ── Dev playground ─────────────────────────────────────────────────────────
// POST /parse-workout-debug  { input, sport?, sessionName? }
// Returns the full ParseResult (including raw model output) so the playground
// can show exactly what came back. NEVER call from production code paths.
router.post("/parse-workout-debug", async (req, res): Promise<void> => {
  const { input, sport, sessionName } = req.body as {
    input?: string;
    sport?: Sport;
    sessionName?: string;
  };
  if (!input?.trim()) {
    res.status(400).json({ error: "input is required" });
    return;
  }
  const resolvedSport: Sport =
    sport === "run" || sport === "cycle" || sport === "swim" || sport === "strength"
      ? sport
      : "strength";

  const result = await parseWorkout(input, { sport: resolvedSport, sessionName });
  void logApiCost({
    userId: req.auth?.userId,
    endpoint: "parse-workout-debug",
    model: "gpt-5.2",
    usage: result.usage,
  });
  res.json(result);
});

export default router;
