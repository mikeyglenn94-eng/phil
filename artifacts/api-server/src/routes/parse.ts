import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import { db, programmesTable, clientsTable } from "@workspace/db";
import type { Exercise } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays, parseISO, format } from "date-fns";

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

## Coaching Philosophy (apply these principles to every programme, above all other defaults)

These are the non-negotiable guiding principles of this coach. They override generic programming defaults.

### 0. Rep ranges, not rep numbers — with two specific exceptions
- **Never programme a fixed rep number for hypertrophy or general strength work.** "3×10" is meaningless — it rewards counting, not effort. Always use a range.
- Hypertrophy bands:
  - **8–12:** moderate load, mechanical tension — primary hypertrophy driver
  - **12–18:** higher rep, metabolic stress — excellent for growth, especially isolation work
  - **15–25:** endurance-strength, pump, accessory and finishing work
- Strength work (intensification phase) uses lower ranges: 3–6, 2–4, or 1–3 — these can be tighter because load is the primary variable, not effort to failure.
- The purpose of a range is to demand intensity from the client. They stop when the reps are hard, not when they hit an arbitrary number. This brings out effort that a fixed number never would.
- Apply this everywhere: every hypertrophy exercise in every session must have a rep range, never a single number (e.g. "8-12" not "10").

**Exception 1 — Big 4 compound movements in a STRENGTH (not hypertrophy) context:**
When the primary goal is strength and the exercise is one of the Big 4 (Back Squat, Bench Press, Deadlift, Strict Press), a fixed rep number is appropriate because load progression is the variable, not proximity to failure. Classic formats like 5×5, 3×3, 5/3/1, or 1×5 are correct here. Use a specific number, not a range.

**Exception 2 — Olympic lifting movements always use a fixed rep number:**
Snatch, Clean & Jerk, Clean, Jerk, and their variations (Power Snatch, Hang Clean, etc.) must always have a specific rep number, never a range. These are skill-based movements where each rep is performed at high intent with full reset. Programme them as singles, doubles, or triples (e.g. 5×2, 6×1, 4×3) — never as "2-4" or "3-5". The load or percentage is the progression variable, not rep effort.

### 1. Progression drives consistency — overload, not novelty
- Clients who get stronger keep showing up. The most powerful motivator is measurable progress, not variety.
- Enjoyment comes from seeing numbers go up, hitting new rep PRs, and feeling the programme working — not from constantly changing exercises.
- By default, keep exercise selection stable across the full block. Progress through overload variables: more weight, more reps, more sets, less rest, harder effort (RPE), or more demanding tempo.
- The session style section below will specify whether exercise variation is permitted. Follow it strictly.

### 2. Intensity is the default for regular clients
- Most clients train 4–5 days per week. On busy days, they may do two sessions — a strength block in the morning and a WOD or run in the afternoon/evening. Same-day pairing is normal and expected in hybrid programmes.
- Not every session should make the client want to throw up, but they should be working hard most of the time. Hard and purposeful is the standard. Easy volume for its own sake is a waste of a session.
- This applies to both running and conditioning work. Do not pad programmes with easy filler. Every session earns its place by delivering a meaningful stimulus.

### 3. Running: quality over junk mileage
- The coach does NOT believe in junk miles (accumulating volume without meaningful stimulus).
- **The rule of proportionality:** Only prescribe steady/recovery runs when running frequency is already high (4–5 runs/week). At that volume, 1–2 steady runs per week are appropriate for recovery. But for most clients running 1–3 times per week, every run should have a PURPOSE (threshold, VO2 max, tempo, intervals, or sprint work).
- **The default bias is intensity, not volume.** When in doubt about what kind of run to programme, choose a structured quality session over a steady jog.
- Steady runs are recovery tools for high-volume programmes — they are NOT a substitute for intensity in low-frequency programmes.
- Terminology — use these exact terms. NEVER say "easy run":
  - "quality session" = intervals, threshold, hills, VO2 max, tempo work
  - "steady run" = continuous running at moderate aerobic pace, no strict structure
  - "long steady run" = longer continuous aerobic session
- Practical guide:
  - 1 run/week → make it a quality session: threshold or VO2 max work
  - 2 runs/week → 1 quality session + 1 steady run
  - 3 runs/week → 2 quality sessions + 1 steady run
  - 4 runs/week → 2 quality sessions + 1 tempo + 1 steady run
  - 5 runs/week → 2 quality sessions + 1 tempo + 2 steady runs (base building)

### 4. Running environment — always respect what the user has access to
- Treat treadmill as a first-class option equal to outdoor running. It is NOT a fallback.
- If the description mentions treadmill: use treadmill for interval/controlled quality sessions where relevant.
- If the description mentions track: use track for structured interval sessions.
- If the description mentions hills: include hill sessions where appropriate.
- If the user avoids a surface or environment: do not include it.
- Default (no environment specified): assume road-based training. Do not require hills or track.
- When reflecting environment in session names/structure, be concise: "Quality session — treadmill intervals", "Steady run — road", "Hill session — local hills".

## Session types and rules

### Strength sessions (no source field):
- "source" field must be OMITTED entirely (do not set it to null or undefined — just leave it out)
- Must have a "name" (e.g. "Upper Body", "Lower Body", "Full Body", "Push", "Pull", "Legs") — for Olympic Weightlifting sessions use movement-based names instead (see OWL section below)
- Must have 4–6 exercises, each with:
  - id: "ex-gen-{unique 6 chars}"
  - name: proper exercise name (e.g. "Back Squat", "Bench Press", "Romanian Deadlift")
  - sets: integer (3–5)
  - reps: string — ALWAYS a range for hypertrophy/general work (e.g. "8-12", "10-15", "15-20", "12-18"); tight ranges or singles only for true strength/peaking (e.g. "3-5", "1-3"); NEVER a single number like "10" or "12"
  - rpe: string or null (e.g. "7", "8-9", null)
  - rest: string or null (e.g. "90s", "2 min", "3 min", null)
  - tempo: null
  - notes: null
  - rawText: ""
  - weekProgression: []

### WOD sessions (source: "wod_brain"):
- "source": "wod_brain"
- "name": "WOD" or a specific name (e.g. "WOD – Cardio Blast")
- "structure": the workout description (e.g. "21-15-9 Thrusters 42.5kg and Pull-ups for time" or "AMRAP 20: 10 Box Jumps, 10 Burpees, 200m Run")
- "color": "#7c3aed"
- exercises: list of the movements as exercises (name only, sets:1, reps per the structure, rest:null, rpe:null, tempo:null, notes:null, weekProgression:[])

### Run sessions (source: "run_brain"):
- "source": "run_brain"
- "name": descriptive session name. Use these terms only — NEVER "Easy Run":
  - "Quality Session" or specific name like "Tempo Intervals", "VO2 Max Intervals", "Hill Session", "Quality Session — Treadmill"
  - "Steady Run" or "Steady Run — Road" or "Long Steady Run"
  - "Threshold Run", "Pyramid Run", "Speed Session" as appropriate
- "structure": the run description (e.g. "4×1km at threshold with 90s rest" or "20 min steady run at aerobic pace" or "6×400m at VO2 max effort, 2 min rest — treadmill")
- "color": "#16a34a"
- exercises: the run broken into segments as exercises (e.g. {name:"4×1km Threshold", sets:4, reps:"1km", rest:"90s", ...})
- When environment is specified in the description, reflect it in the session name: e.g. "Treadmill Intervals", "Road Steady Run", "Hill Repeats"

### Cycling sessions (source: "cycle_brain"):
- "source": "cycle_brain"
- "name": descriptive session name — use these types only:
  - "Endurance Ride" — long steady effort, aerobic base, RPE 4-5
  - "Tempo Ride" — sustained comfortably-hard effort, 20-60 min, RPE 7-8
  - "Cycling Intervals" or "5×5 Min Intervals" (name the key effort) — short hard efforts with recovery, RPE 9-10
  - "Recovery Ride" — very easy spinning, active recovery only, RPE 1-2
  - "Race Sim" — race pace effort, longer sustained duration, RPE 8-9
  - "Sweet Spot" — 88-93% FTP, between tempo and threshold, RPE 7-8
- "structure": the full session description (e.g. "10 min warm-up, 5×5 min hard effort RPE 9-10 with 3 min easy spinning, 10 min cool-down")
- "color": "#ea580c"
- exercises: the session broken into segments as exercises (e.g. {name:"5×5 Min Hard Intervals", sets:5, reps:"5 min", rest:"3 min easy spin", rpe:"9-10", notes:null})

### Cycling progression rules (apply whenever cycling is in the programme):
- Never increase weekly volume more than 10% week on week
- Build for 3 weeks then programme 1 easier recovery week — apply this 3:1 structure to every cycling block
- Increase intensity OR volume in a given week, never both simultaneously
- Every training week must include at least 1 endurance ride as the aerobic base
- Max 2 interval sessions per week — intervals are the quality work, endurance is the volume

### Swimming sessions (source: "swim_brain"):
- "source": "swim_brain"
- "name": descriptive session name — use these types only:
  - "Endurance Swim" — steady continuous swimming, builds aerobic base
  - "CSS Set" — critical swim speed intervals, the primary fitness builder (all paces reference CSS)
  - "Technique" — drills focused, low intensity, correct form first
  - "Sprint Set" — short fast efforts, full recovery between reps
  - "Open Water" — sighting, navigation, race-specific practice
- "structure": the full session description (e.g. "400m warm-up, 10×100m on CSS+5s interval with 15s rest, 300m cool-down")
- "color": "#0284c7"
- exercises: the session broken into segments as exercises (e.g. {name:"10×100m CSS Intervals", sets:10, reps:"100m", rest:"15s", rpe:"7-8", notes:"at CSS pace"})

### Swimming progression rules (apply whenever swimming is in the programme):
- Never increase weekly total metres more than 10% week on week
- Build for 3 weeks, recover for 1 — same 3:1 block structure as cycling
- Technique before fitness — weaker swimmers get more drill work early; progress to CSS sets as technique improves
- CSS pace is the anchor metric for all interval work — write paces as "CSS", "CSS+5s", "CSS+10s"

## Multi-sport rules (apply when the programme includes 2 or more of: cycling, swimming, running, strength):
- Hard day in one sport means easy or rest in all other sports that same day — never stack two hard sessions on the same day
- Long ride and long run must not fall on consecutive days — ensure at least one easy or rest day between them
- Swim sessions can follow a hard run or ride on the same day but must never precede one
- Minimum one full rest day per week
- Strength work is supplementary — in a heavy training week it never replaces a sport-specific session
- Use RPE to judge intensity when scheduling: RPE 1-3 = recovery, RPE 4-6 = endurance/base, RPE 7-8 = tempo/threshold, RPE 9-10 = intervals/race effort

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

## Same-day session pairing rules

When the description involves hybrid training (strength + WOD, strength + run, WOD + run), use same-day pairing to fit the full training load within the client's available days. Guidelines:

**Valid pairings (use freely):**
- Strength + WOD: strength block first (heavier compound work), WOD finisher in the same session slot or labelled as a second session
- Strength + Run: strength block first, run after — works well when the run is a quality session (short, structured) or a steady run
- Strength + steady run: always strength first, run second — keeps quality high on both
- WOD + Run (short): WOD first, short quality run or sprint work after

**Order always matters:**
- Heavy compound strength always comes FIRST on a shared day — before cardio, before WODs
- Never programme a long steady run before a strength session on the same day

**When to put on separate days instead:**
- When the run is long (30+ min sustained) — give it its own day or separate it from heavy lifting
- When both sessions are high-intensity (two separate max-effort sessions) — better on different days

**How to schedule same-day pairs:**
- Give both sessions the same dayNumber integer
- Each gets a distinct id, name, and complete session content
- Example: dayNumber 1 → "Upper Body Strength" (strength session), dayNumber 1 → "WOD — Metcon Finisher" (wod_brain session)

## Endurance / cardio training principles (apply to ALL run sessions and any programme with significant running or cardio content)

These principles come from Chris Hinshaw — former professional triathlete (2nd place Hawaiian Ironman World Championships), endurance coach to CrossFit Games champions including Rich Froning, Mat Fraser, Jason Khalipa, Camille LeBlanc-Bazinet, and Katrin Davidsdóttir.

### The 5 endurance training zones
Every run programme should draw from these zones in appropriate proportion. Do NOT just generate "steady runs" and "intervals" — use this precise vocabulary and design sessions that genuinely target the zone named.

**1. Aerobic Threshold (the foundation — most volume goes here)**
- Steady, moderate intensity — develops fuel efficiency (fat burning), musculoskeletal system, aerobic base
- Think: long steady runs, Z2 pace, conversational pace
- These are the "rest" component of mixed sessions and the backbone of an aerobic base block
- Example structure: 20–60 min continuous steady run, or recovery jogs between harder efforts
- Use source: "run_brain", name: "Steady Run" or "Long Steady Run" or "Aerobic Base Run" — NEVER "Easy Run"

**2. Lactate Threshold**
- Higher volume intervals at threshold intensity — the pace you could hold for ~45–60 min if pushed
- Longer interval distances (600m–2km), less rest between reps
- Develops the ability to sustain a fast pace without accumulating lactate
- Example: 4×1km at threshold (10k race pace), 60s rest. Or 3×1.5km, 90s rest. Or tempo runs (20 min continuous at threshold)
- Use name: "Lactate Threshold Run" or "Tempo Intervals"

**3. VO2 Max**
- Lower volume, shorter intervals, higher intensity than threshold, more rest between reps
- Interval distances: typically 200m–800m
- More rest than lactate threshold work (2–3 min between reps)
- Develops maximal aerobic power
- Example: 6×400m at VO2 max effort (faster than 5k pace), 2 min rest. Or 8×200m, 90s rest.
- Use name: "VO2 Max Intervals" or "Track Intervals"

**4. Speed Endurance**
- Very low volume, very short intervals (under 60 seconds — typically 100m–300m), extremely high intensity
- FULL recovery between reps (3–5 min) — quality over quantity
- Recruits fast-twitch fibres and forces them to develop endurance
- Example: 6×100m sprint, full recovery. Or 4×200m at 95% effort, 4 min rest.
- Use name: "Speed Endurance" or "Sprint Intervals"

**5. Strength Endurance**
- Low volume, high intensity intervals that include explosive movements
- Recruits and develops fast-twitch muscle fibres under fatigue
- Can combine short runs with explosive bodyweight or light loaded movements
- Example: 5 rounds: 200m sprint + 10 box jumps + 10 burpees (minimal rest between rounds)
- Use source: "wod_brain" for these (they are WOD-style conditioning, not pure runs)

### Chris Hinshaw's benchmark paces/distances
When programming running, reference and develop these specific time domains:
- Recovery jog: ~90 min pace (very easy, used as active recovery between harder work)
- 10k pace: ~40 min time domain (lactate threshold territory)
- 5k pace: ~20 min time domain (between threshold and VO2 max)
- 1 mile pace: ~5–6 min time domain (VO2 max to speed endurance)
- 400m: Critical for CrossFit athletes — must develop a fast, repeatable 400m

### Key principles
- **Build an "arsenal of gears":** athletes must know and train at different paces, not just "fast" and "easy". Programme should develop multiple distinct pace points.
- **Aerobic base matters — but context is everything:** for high-volume endurance athletes (100+ miles/week, two-a-day sessions), easy Z2 work forms the majority of volume. For regular clients training 4–5x/week once per day, this does NOT apply. Most of their running should still have purpose and intensity — recovery runs are only appropriate once frequency is high enough to need recovery sessions between hard efforts.
- **Endurance does not hurt strength — in moderation:** don't be afraid to programme running in strength-focused weeks. Rich Froning's mile improved AND his back squat went up. Mat Fraser ran 5400m at 6-min/mile pace then hit a C&J PR three hours later.
- **Variety in structure:** use creative, named session formats. Not just "run 5km". Think pyramid runs, hop-scotch style (build distance then descend), Bombolini-style mixed pace sessions.
- **The recovery interval IS the rest:** in mixed-pace sessions, the easy pace interval is the rest — it should be written as part of the structure, not omitted.

### Example session formats to use
- **Pyramid run (aerobic threshold):** 200m steady / 100m sprint / 400m steady / 100m sprint / 600m steady / 100m sprint... then descend back down. Continuous, non-stop. Sprints at 97–98% (not max — retain form). Total ~4–6km.
- **Bombolini (mixed threshold/speed):** 3 sets of [500m fast (between 1-mile and 400m PR pace) + 200m recovery jog + 100m sprint], 5 min rest between sets.
- **Threshold intervals:** 4×1km at 10k pace, 90s rest between reps.
- **VO2 Max quality session:** 8×400m at faster than 5k pace, 90s rest.
- **Long steady run:** 40–60 min at aerobic threshold / Z2 pace. Comfortable, continuous. Name: "Long Steady Run".
- **Speed session:** 6×100m sprint, 3 min full recovery between each.

### Periodisation for endurance blocks
- Early weeks: predominantly aerobic threshold volume (build the base)
- Mid weeks: introduce lactate threshold intervals (1–2 per week) alongside steady runs
- Later weeks: add VO2 max work (1 session/week) — requires the aerobic base to be present first
- Speed endurance: used sparingly, primarily near events or when sharpening
- Deload: reduce to steady aerobic runs only, no intervals

## Olympic Weightlifting specific rules (apply when the description mentions "weightlifting", "Olympic lifting", "Oly", "snatch", "clean & jerk", or similar)

**CRITICAL format rules for OWL sessions:**
- OWL sessions use the STRENGTH session format: NO source field, with individual exercises listed in the exercises array
- NEVER use source: "wod_brain" or a structure field for OWL sessions — each movement must be its own exercise entry
- NEVER name OWL sessions with body-part labels ("Full Body", "Upper Body", "Lower Body", "Push", "Pull") — always use movement-based names (see examples below)
- Must have 4–6 individual exercises per session (Snatch, Clean & Jerk, Back Squat, etc.), each with sets, reps, and notes for load/intensity

When the programme is Olympic Weightlifting-focused, apply the following principles from coach Greg Everett:

### Day selection by frequency (these describe GAP patterns — always apply as offsets from startDate, never anchor to weekday names)
- 3 days/week: gaps +0, +2, +4 (every other day — Mon/Wed/Fri spacing)
- 4 days/week: gaps +0, +1, +3, +5 (Mon/Tue/Thu/Sat spacing — back-to-back early, lighter on +1 day)
- 5 days/week: gaps +0, +1, +2, +3, +5 (Mon/Tue/Wed/Thu/Sat preferred)
- 6 days/week: gaps +0, +1, +2, +3, +4, +5 (one rest day per week)

### Big vs Little days (for 4+ days/week)
Strictly alternate big and little days. Never schedule two big days back-to-back unless separated by a rest day.

**5-day preferred pattern:**
- Monday: BIG
- Tuesday: LITTLE
- Wednesday: BIG
- Thursday: LITTLE
- Saturday: BIG

**Big days** are the most systemically taxing. They include:
- Heavy competition lifts: Snatch, Clean & Jerk (from the floor, full lifts)
- Pulls: Snatch Pull, Clean Pull, Clean Deadlift
- Squats: Back Squat, Front Squat
- Heavy posterior chain accessory at end: SLDL, Good Morning (NOT before a big day)
Session name examples: "Snatch + Back Squat", "Clean & Jerk + Front Squat", "Heavy Day"

**Little days** are lower intensity, faster to get through. They include:
- Power or hang variations: Power Snatch, Hang Power Clean, Hang Snatch (inherently lower intensity)
- Overhead/technique work: Overhead Squat, Snatch Balance, Jerk, Push Press, Jerk Support, Muscle Snatch
- Bodybuilding or overhead stability accessory: Pull-ups, Dips, Rows, Face Pulls, Shoulder stability
Session name examples: "Power Snatch + OHS + Jerk", "Technique & Overhead", "Light Day"

### Exercise order within a session
Always follow this sequence on big days:
1. Snatch (or snatch variation) — first, when most fresh
2. Clean & Jerk (or C&J variation) — second
3. Pulls (snatch pull or clean pull)
4. Squats (back squat or front squat)
5. Accessory (posterior chain work at END, not start)

On little days:
1. Speed/technique work first (power snatch, hang variations, snatch balance)
2. Overhead work second (OHS, push press, jerk)
3. Lighter accessory last (pulling, bodybuilding)

### Periodisation for weightlifting
- Week 1–2: Build volume, moderate intensity (e.g. 75–82%)
- Week 3–4: Increase intensity, reduce volume slightly (e.g. 80–88%)
- Week 5: Peak — heavy singles and doubles, low volume (e.g. 85–93%)
- Week 6 (if included): Deload — 60–70%, technique focus, reduced volume by ~40%
- Use notes field to indicate percentages or RPE targets (e.g. "Work to heavy double @RPE8", "5×3 @75%")
- Do NOT use the same exercise every big day every week — rotate between Snatch and Clean & Jerk as the primary lift, and use Front Squat on C&J days, Back Squat on Snatch days

## Strength training principles (apply when the description mentions "strength", "powerlifting", "hypertrophy", "lifting", "weights", "resistance training", "strength block", or general training that isn't explicitly Hyrox or Oly Weightlifting)

These 7 principles come from Israetel, Hoffmann & Smith's "Scientific Principles of Strength Training." Apply them to every general strength programme:

### 1. Specificity — the most important principle
- Train the movements that produce the goal. For strength, this means compound barbell movements: Squat, Deadlift, Romanian Deadlift, Bench Press, Overhead Press, Barbell Row.
- Assistance work must serve the primary movements — build the muscles that actually move the bar. No random exercises. Every exercise choice must have a clear reason.
- As a goal event or test approaches (e.g. a fitness test, competition, or end of a block), make training more specific — increase the primary lifts, reduce variation.
- The spectrum: heavy compound lifts (most specific) → accessory compound work → isolation machines (least specific). Use accordingly.

### 2. Overload — progress week to week
- Each week must present a greater demand than the week before. This can be: more weight, more sets, more reps, or less rest.
- Use barbell movements first (highest homeostatic disruption), then dumbbell, then cable, then machine. Machines are fine for accessory work but shouldn't be the foundation.
- Track progression: if week 1 is 3×8 at RPE 7, week 2 should be heavier or have an extra set.
- Unstable or gimmick equipment reduces overload — avoid BOSU balls, oscillating bars, and novelty tools for strength.

### 3. Fatigue Management — training is only useful if you can recover from it
- MRV (Maximum Recoverable Volume): there's a ceiling to how much training is productive. Beyond it, fatigue accumulates faster than adaptation. Don't programme more than a client can recover from.
- MEV (Minimum Effective Volume): there's a floor below which training produces no adaptation. Don't go too light.
- Deload every 3–4 weeks: reduce volume by ~40% and keep intensity moderate. This dissipates accumulated fatigue and allows adaptations to express themselves.
- Rest days matter. Do not stack hard sessions back to back without a reason.
- Practical rule: if a session requires a muscle group to work hard, give it 48–72 hours before working it hard again.

### 4. SRA — Stimulus, Recovery, Adaptation
- Training creates a stimulus, which causes a temporary performance dip (recovery phase), then a rise above baseline (adaptation). The next session should hit at or near the adaptation peak — not before recovery and not so late that adaptations decay.
- Practical frequency: train each major muscle group or movement pattern 2× per week minimum for intermediate clients. Once per week is maintenance at best.
- "Stimulate, don't annihilate" — a session that creates maximum damage requires maximum recovery time and produces no more adaptation than a well-dosed session.
- If a client is very sore and performance is declining week to week, fatigue has outpaced recovery — add a deload.

### 5. Variation — prevent adaptation stagnation
- The body adapts to repeated identical stimuli and stops improving. Strategic variation maintains responsiveness.
- Vary exercise selection, rep ranges, and volume across mesocycles (every 3–6 weeks), not within the same week.
- Don't rotate exercises too frequently (every week) — adaptations need time to consolidate before switching.
- Good variation examples: swap Back Squat for Front Squat or Pause Squat; swap Bench Press for Close Grip Bench or Incline Bench; swap Deadlift for Romanian Deadlift or Deficit Deadlift.
- Always keep variation within the specificity boundary — never add exercises that don't contribute to the training goal.

### 6. Phase Potentiation — sequence training phases logically
This is the most advanced structural principle. The order of phases within a block matters enormously:

**For strength programmes, the correct phase sequence is:**
**Hypertrophy → Strength → Peaking (if applicable)**

- **Hypertrophy phase (Accumulation):** Higher volume, moderate intensity. Always use REP RANGES — never specific numbers. The three hypertrophy bands are: 8–12 (moderate load hypertrophy), 12–18 (higher rep hypertrophy), 15–25 (pump/endurance strength). The goal is to bring intensity out of the client — the range demands they push to a hard stop, not count to an arbitrary number. Weeks 1–2 of a 4–6 week block.
- **Strength phase (Intensification):** Lower volume, higher intensity (rep ranges 3–6). Neural adaptations, force production improvement. Building on the mass created in the hypertrophy phase. Weeks 3–4 of a block.
- **Peaking / Expression phase (if the programme has a defined goal/test/event):** Very low volume, very high intensity (1–3 reps). Sharpening the expression of strength. Only appropriate for the final 1–2 weeks before a specific performance goal.
- **Deload:** After accumulation phases, a deload week (~40% volume reduction, moderate intensity) dissipates fatigue and allows the adaptation to appear.

**Practical application for a 4-week block:**
- Week 1: Accumulation — e.g. 4×8-12 @RPE7 (volume-focused, rep range not fixed number)
- Week 2: Accumulation — e.g. 4×10-15 @RPE8 (slight intensity increase, still a range)
- Week 3: Intensification — e.g. 5×4-6 @RPE8-9 (heavier, less volume)
- Week 4: Deload — e.g. 3×5-8 @RPE6 (reduce volume ~40%, keep movement)

**Practical application for a 6-week block:**
- Weeks 1–2: Accumulation (ranges: 8–12 or 12–18, higher volume, moderate load)
- Weeks 3–4: Intensification (ranges: 4–6, moderate volume, heavier load)
- Week 5: Peaking or final intensification (ranges: 2–4, heavy, low volume)
- Week 6: Deload (reduce volume 40%, keep intensity moderate)

### 7. Individual Difference
- Beginners respond to almost anything; keep it simple, linear, high-frequency.
- Intermediates need structured periodisation — apply Phases 1–6 above.
- Advanced athletes need more sophisticated variation and longer phases.
- If the client description mentions injuries, weaknesses, or specific goals, tailor exercise selection accordingly. A weak posterior chain needs more RDL, Good Morning, or Hip Thrust. A weak upper back needs more Barbell Row, Face Pull, and Rear Delt work.

### Practical exercise selection for strength sessions
**Lower body compound (choose 1–2 per session):** Back Squat, Front Squat, Goblet Squat, Romanian Deadlift, Deadlift, Sumo Deadlift, Trap Bar Deadlift, Hip Thrust, Bulgarian Split Squat, Step-up, Leg Press
**Upper body push (choose 1–2):** Bench Press, Incline Bench Press, Close Grip Bench, Overhead Press, Dumbbell Press, Dips
**Upper body pull (choose 1–2):** Barbell Row, Pendlay Row, Pull-up, Lat Pulldown, Cable Row, Face Pull, Dumbbell Row
**Accessory (choose 1–2 to address weaknesses):** RDL, Good Morning, Nordic Curl, Leg Curl, Leg Extension, Dumbbell Lateral Raise, Bicep Curl, Tricep Extension, Core work

### Strength session structure
- Open with 1–2 compound barbell movements (these receive the most volume and intensity)
- Follow with 1–2 compound assistance movements
- Close with 1–2 isolation or accessory exercises (lower fatigue cost)
- Total exercises per session: 4–6
- Do NOT programme intensity techniques (drop sets, supersets, failure) unless the client description asks for it

### Compound vs Accessory sets and reps — STRICT RULE
**Primary compounds** (Back Squat, Front Squat, Bench Press, Close Grip Bench, Incline Bench, Deadlift, Romanian Deadlift used as main lift, Strict Press, Overhead Press):
- Sets: 3–5 (may reach 5 across a block as sets progress)
- Reps: prescribe an EXACT number — e.g. 5, 4, 3, 8, 6. Sub-6 rep prescriptions are only appropriate here.
- Reps can decrease week-over-week as sets increase (e.g. Week 1: 3×8, Week 2: 4×6, Week 3: 5×4)

**All other exercises** (rows, curls, lunges, push-downs, lateral raises, leg press, RDL as accessory, etc.):
- Sets: maximum 4. NEVER prescribe 5 sets on an accessory or isolation movement.
- Reps: ALWAYS a range, NEVER a single number — e.g. "12-15", "15-20", "8-12". Ranges may go up to 20.
- Rep range stays FIXED across a block — only sets increase week-over-week.
- NEVER prescribe fewer than 6 reps on any non-compound movement.

## Hyrox specific rules (apply when the description mentions "Hyrox", "HYROX", "hyrox race", or similar)

When the programme is Hyrox-focused, apply the following principles:

### The priority hierarchy — stick to this strictly
The MAJORITY of training volume should NOT be Hyrox-specific. Structure every week around this priority order:

**Priority 1 — Running capacity (most of the programme)**
- Run development is the spine of the programme. Most sessions each week should be runs.
- Use the 5km and 10km as primary benchmarks — target these distances and paces.
- A half marathon is also relevant but use it as secondary context.
- Run types to include across the week: recovery runs, threshold intervals (e.g. 4×1km, 6×800m), tempo runs, long steady runs.
- More running = arriving at stations fresher, recovering faster between stations, and raising global fitness capacity. This is the biggest lever.
- Use source: "run_brain" for all run sessions.

**Priority 2 — Strength (enough to not be the limiter)**
- 1–2 strength sessions per week. Not bodybuilding, not powerlifting — functional strength that makes the stations feel easy.
- Focus on: Back Squat, Romanian Deadlift, Single-leg work (step-ups, Bulgarian split squat), Hip thrust, Pull-ups/Rows, Push-ups/Dips, Farmer's carry, Sandbag work
- Rep ranges: 3–6 for strength (heavy), 8–15 for hypertrophy/endurance strength
- Goal is that stations like ski erg, sled push, farmers carry, wall balls never feel like a strength issue
- Use plain strength sessions (no source field)

**Priority 3 — Hyrox-specific work (layer in, do NOT make it the backbone)**
- Hyrox circuit/station work is included but should be a minority of total volume
- Increase Hyrox-specific work as the race approaches (more in final 2–3 weeks)
- Station exercises: Ski Erg, Sled Push, Sled Pull, Burpee Broad Jump, Rowing, Farmers Carry, Sandbag Lunges, Wall Balls
- Simulate race conditions: back-to-back stations with short runs between, or "Hyrox circuit" as a WOD session (source: "wod_brain")
- Example WOD: "Hyrox Station Circuit: 1km run, then 1000m ski erg, 1km run, 50m sled push (×2), 1km run, 200m farmers carry"
- In the final 1–2 weeks, include one full simulation session if appropriate

### Scheduling pattern
- 3–4 runs per week (mix of easy, interval, tempo)
- 1–2 strength sessions per week
- 1 Hyrox-specific session per week (increasing to 2 in the final 2 weeks)
- Rest days or active recovery between hard sessions
- Don't programme a strength session the day before a Hyrox circuit session

### Periodisation
- Early weeks: high run volume (easy and moderate), foundational strength, minimal Hyrox-specific work
- Middle weeks: introduce threshold intervals, heavier strength, 1 Hyrox circuit/week
- Final 2–3 weeks before race: taper run volume slightly, increase Hyrox simulation, keep strength maintenance only
- If 6 weeks: deload final week — recovery runs only, light strength, no Hyrox circuits

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

router.post("/parse-log", async (req, res): Promise<void> => {
  const { transcript, exerciseName, totalSets } = req.body as {
    transcript: string;
    exerciseName: string;
    totalSets: number;
  };

  if (!transcript || !exerciseName || !totalSets) {
    res.status(400).json({ error: "transcript, exerciseName, and totalSets are required" });
    return;
  }

  const systemPrompt = `You are a fitness log parser. A client has just spoken their results for a single exercise after completing it.
Your job is to parse the spoken log into per-set data (weight in kg and reps achieved).

Rules:
- The exercise has exactly ${totalSets} sets (indexed 0 to ${totalSets - 1})
- Extract weight (kg, can be decimal like 22.5) and reps for each set mentioned
- "sets 1 and 2" means setIndex 0 and 1 (convert to 0-based)
- "last set" = setIndex ${totalSets - 1}
- "all sets" = every set
- "first set" = setIndex 0
- "second set" = setIndex 1, etc.
- If a set is not mentioned, still include it with null values
- Weight and reps can be null if not mentioned for that set
- Return ONLY valid JSON, no markdown, no explanation

Exercise: ${exerciseName}
Total sets: ${totalSets}

Return format:
{"sets": [{"setIndex": 0, "weight": 20, "reps": 9}, {"setIndex": 1, "weight": 20, "reps": 9}, {"setIndex": 2, "weight": 22, "reps": 8}]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Parse this log: "${transcript}"` },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { sets: { setIndex: number; weight: number | null; reps: number | null }[] };

    try {
      parsed = JSON.parse(content);
    } catch {
      req.log.warn({ content }, "Failed to parse log LLM response as JSON");
      // Return nulled-out sets as fallback
      parsed = {
        sets: Array.from({ length: totalSets }, (_, i) => ({ setIndex: i, weight: null, reps: null })),
      };
    }

    // Ensure all sets are represented
    const setsMap = new Map(parsed.sets.map(s => [s.setIndex, s]));
    const fullSets = Array.from({ length: totalSets }, (_, i) =>
      setsMap.get(i) ?? { setIndex: i, weight: null, reps: null }
    );

    res.json({ sets: fullSets });
  } catch (err) {
    req.log.error({ err }, "Error parsing log");
    res.status(500).json({ error: "Failed to parse log" });
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
// POST /parse-run-session  { description, name? }
// Returns a ready-to-save run session (source: "run_brain") from free-text.
router.post("/parse-run-session", async (req, res): Promise<void> => {
  const { description, name } = req.body as { description?: string; name?: string };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const systemPrompt = `You are a running coach. Parse the user's run description into a structured session.

CRITICAL EXPANSION RULE:
- "3x500m" → expand into 3 individual interval rows of 500 m each (NOT one row with reps=3)
- "2x1km" → expand into 2 individual interval rows of 1 km each
- "5 × 3 min" → expand into 5 individual interval rows of 3 min each
- NEVER use a "reps" count — always expand fully into individual rows

CRITICAL DISTANCE vs DURATION RULE:
- If the user specifies a DISTANCE (e.g. "10km", "5 miles", "800m"), you MUST set the "distance" field on the row (e.g. "10 km"). Do NOT replace it with a duration.
- If the user specifies a DURATION (e.g. "45 min run"), set the "duration" field on the row instead.
- If both are given (e.g. "10km in 50 min"), set BOTH fields. Distance must always reflect what the user said.
- Example: "10km easy" → row: { "rowType": "run", "distance": "10 km", "duration": "50 min", "effort": "steady" }
- Example: "45 min jog" → row: { "rowType": "run", "duration": "45 min", "effort": "easy" }
- Example: "5km tempo" → row: { "rowType": "run", "distance": "5 km", "effort": "tempo" }

Return ONLY valid JSON, no markdown fences.
Never use "easy run" — use "steady run", "recovery run", or "long steady run" instead.

Row types:
- "interval": a work rep — has repNumber, distance (e.g. "1 km"), duration (e.g. "3 min"), pace (e.g. "4:30/km"), effort (e.g. "threshold")
- "rest": recovery between reps — has description (e.g. "90 sec jog"), duration
- "run": a continuous non-interval block — has description, distance (set this if user mentioned km/miles/metres), duration, effort, pace

Block types: "warmup", "main", "cooldown", "recovery", "strides", "hills"

Response format:
{
  "name": "Pyramid Intervals",
  "duration": 50,
  "distanceKm": 10,
  "intensity": "Intervals",
  "structure": "10 min warm-up · 2 km + 1 km + 1 km + 500m × 3 + 1 km + 2 km · 10 min cool-down",
  "blocks": [
    {
      "blockType": "warmup",
      "label": "Warm-up",
      "rows": [
        { "rowType": "run", "description": "10 min steady jog", "duration": "10 min", "effort": "easy" }
      ]
    },
    {
      "blockType": "main",
      "label": "Main Set",
      "rows": [
        { "rowType": "interval", "repNumber": 1, "distance": "2 km", "pace": "4:25/km", "effort": "tempo" },
        { "rowType": "rest", "description": "2 min jog", "duration": "2 min" },
        { "rowType": "interval", "repNumber": 2, "distance": "1 km", "pace": "4:15/km", "effort": "threshold" },
        { "rowType": "rest", "description": "90 sec", "duration": "90 sec" },
        { "rowType": "interval", "repNumber": 3, "distance": "1 km", "pace": "4:15/km", "effort": "threshold" }
      ]
    },
    {
      "blockType": "cooldown",
      "label": "Cool-down",
      "rows": [
        { "rowType": "run", "description": "10 min recovery jog", "duration": "10 min", "effort": "easy" }
      ]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Session name (optional): ${name?.trim() || "(auto-generate)"}\n\nDescription:\n${description.trim()}` },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const userNameMeaningful = name?.trim() && name.trim().toLowerCase() !== "test" && name.trim().length > 2;
    const sessionName = userNameMeaningful ? name!.trim() : (parsed.name || "Run Session");
    const duration: number | null = typeof parsed.duration === "number" ? parsed.duration : null;
    const distanceKm: number | null = typeof parsed.distanceKm === "number" ? Math.round(parsed.distanceKm * 10) / 10 : null;
    const intensity: string = parsed.intensity ?? "";
    const structure: string = parsed.structure ?? description.trim();

    // New: blocks-based structure (individual expanded rows)
    const runBlocks: any[] = Array.isArray(parsed.blocks) ? parsed.blocks : [];

    // Legacy segments for backward compat — derive from blocks if present
    const segments: any[] = runBlocks.length > 0
      ? runBlocks.flatMap((block: any) =>
          (block.rows ?? []).map((row: any) => ({
            label: row.rowType === "interval" ? `Rep ${row.repNumber ?? ""}`.trim() : (row.rowType === "rest" ? "Rest" : (block.label || "")),
            description: row.rowType === "interval"
              ? [row.distance || row.duration, row.pace ? `@ ${row.pace}` : null, row.effort].filter(Boolean).join(" ")
              : (row.description || row.duration || ""),
            distance: row.distance ?? null,
            duration: row.duration ?? null,
            effort: row.rowType === "rest" ? "rest" : (row.effort ?? null),
            rest: null,
            reps: null,
            rowType: row.rowType,
            pace: row.pace ?? null,
          }))
        )
      : [];

    const notesParts: string[] = [];
    if (duration) notesParts.push(`${duration} min`);
    if (distanceKm) notesParts.push(`${distanceKm} km`);
    if (intensity) notesParts.push(intensity);
    const notes = notesParts.join(" · ");

    const now = Date.now();
    // Create one exercise per interval row (not rest rows) for logging pre-population
    const intervalRows = runBlocks.flatMap((b: any) =>
      (b.rows ?? []).filter((r: any) => r.rowType === "interval" || r.rowType === "run")
    );
    const exercises = intervalRows.length > 0
      ? intervalRows.map((row: any, idx: number) => ({
          id: `ex-${now}-${idx}`,
          name: row.rowType === "interval" ? `Rep ${row.repNumber ?? idx + 1}` : (row.description || sessionName),
          sets: null,
          reps: row.distance || row.duration || null,
          rpe: null, rest: null, tempo: null,
          notes: [row.pace ? `@ ${row.pace}` : null, row.effort].filter(Boolean).join(" ") || null,
          rawText: [row.distance || row.duration, row.pace, row.effort].filter(Boolean).join(" "),
          weekProgression: [], clientComment: null,
          perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
        }))
      : [{
          id: `ex-${now}-0`,
          name: sessionName,
          sets: null, reps: null, rpe: null, rest: null, tempo: null,
          notes,
          rawText: structure,
          weekProgression: [], clientComment: null,
          perSetReps: null, perSetRpe: null, setWeights: null, setReps: null, weight: null,
        }];

    res.json({
      name: sessionName, source: "run_brain", structure, segments, duration, distanceKm, intensity,
      runBlocks: runBlocks.length > 0 ? runBlocks : null,
      exercises,
    });
  } catch (err) {
    req.log.error({ err }, "Error parsing run session");
    res.status(500).json({ error: "Failed to parse run session" });
  }
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
  const { description, name } = req.body as { description?: string; name?: string };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const systemPrompt = `You are an expert conditioning coach. Design TWO different WOD workout options from the user's movements and constraints.

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
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Session name (optional): ${name?.trim() || "(auto-generate)"}\n\nDescription:\n${description.trim()}` },
      ],
      response_format: { type: "json_object" },
    });

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
// Returns a ready-to-save session object with structured exercises.
router.post("/parse-session", async (req, res): Promise<void> => {
  const { description, name } = req.body as { description?: string; name?: string };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const systemPrompt = `You are a personal training assistant applying MG Coaching's programming philosophy. Your job is to produce a complete, ready-to-use strength session from whatever the user provides — either an explicit exercise list or a vague description.

## Mode A — Explicit exercise list (e.g. "4x8 bench press, 3x10 squat @RPE8")
Parse each exercise extracting: name, sets (integer), reps (string), rpe (string e.g. "7", "8-9"), rest (string e.g. "90s", "2 min"), weight (string e.g. "80kg", "185lb"), notes. Accept any common format. If a field is not mentioned, set it to null.

## Mode B — Vague description (e.g. "full body session using barbell and smith machine, 45 mins")
Generate a complete, well-programmed session matching the equipment, muscle groups, duration, and goals mentioned. Apply all the philosophy rules below when choosing exercises and parameters.

## MG Coaching Programming Philosophy (apply to all sessions)

### Rep ranges — CRITICAL
- NEVER use a single fixed rep number for hypertrophy or general strength work. Always use a range.
- Hypertrophy: "8-12", "10-15", "12-18", "15-20", "15-25" — client stops when it's hard, not at a number
- General strength: "4-6", "3-5", "2-4"
- Exception 1 — Big 4 (Back Squat, Bench Press, Deadlift, Strict Press) in a pure STRENGTH context: fixed number is correct (e.g. 5×5, 3×3). Use a specific number, not a range.
- Exception 2 — Olympic lifts (Snatch, Clean & Jerk, Power Snatch, Hang Clean etc.): always fixed rep number, never a range. Programme as singles, doubles, or triples.

### Exercise selection and ordering
- Compound barbell movements first (Squat, Deadlift, RDL, Bench, OHP, Barbell Row) — highest overload, most important
- Dumbbell compound work second
- Cable/machine accessory work last
- 4–6 exercises per session — no more, no less
- Every exercise must have a clear purpose. No random or gimmick exercises (no BOSU balls, oscillating bars)
- Match exercise selection to the equipment mentioned

### Loading and intensity
- Default to hard and purposeful — not easy filler
- Compounds: sets of 3–5, rest 2–3 min
- Accessories: sets of 3–4, rest 60–90s
- Use RPE where useful: "7-8" for volume work, "8-9" for intensification, "9" for top sets
- Leave weight as null unless the user specifies it

### Compound vs Accessory sets and reps — STRICT RULE
**Primary compounds** (Squat, Bench Press, Deadlift, Strict Press / OHP, and their close variations):
- Sets: 3–5. Sub-6 rep prescriptions are only appropriate here.
- Reps: prescribe an EXACT number (e.g. "5", "4", "3", "8", "6") — never a range on a true compound main lift.

**All other exercises** (rows, curls, lunges, push-downs, RDL as accessory, lat pulldown, etc.):
- Sets: maximum 4. NEVER prescribe 5 sets on an accessory or secondary movement.
- Reps: ALWAYS a range, never a single number — e.g. "12-15", "15-20", "8-12". Ranges may go up to 20.
- NEVER prescribe fewer than 6 reps or more than 4 sets on accessory work.

### Progression
- Overload is the priority, not novelty. Choose exercises that allow measurable progression.

## Rules for both modes
- Always produce 4–6 exercises — NEVER return an empty list
- Generate a descriptive session name (e.g. "Full Body Strength", "Upper Body Push", "Leg Day — Barbell Focus")
- Return ONLY valid JSON, no markdown fences

Response format:
{
  "name": "Full Body Strength",
  "exercises": [
    { "name": "Barbell Back Squat", "sets": 4, "reps": "6-8", "rpe": "8", "rest": "2 min", "weight": null, "notes": null },
    { "name": "Romanian Deadlift", "sets": 3, "reps": "10-14", "rpe": "8", "rest": "90s", "weight": null, "notes": null },
    { "name": "Dumbbell Bench Press", "sets": 3, "reps": "10-14", "rpe": "8-9", "rest": "90s", "weight": null, "notes": null },
    { "name": "Barbell Row", "sets": 3, "reps": "10-14", "rpe": "8", "rest": "90s", "weight": null, "notes": null }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Session name (optional): ${name?.trim() || "(auto-generate)"}\n\nDescription:\n${description.trim()}` },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const sessionName = name?.trim() || parsed.name || "Session";
    const now = Date.now();
    const exercises = (parsed.exercises ?? []).map((ex: any, i: number) => ({
      id: `ex-${now}-${i}`,
      name: ex.name ?? "",
      sets: typeof ex.sets === "number" ? ex.sets : (typeof ex.sets === "string" && !isNaN(Number(ex.sets)) ? Number(ex.sets) : null),
      reps: ex.reps != null ? String(ex.reps) : null,
      rpe: ex.rpe != null ? String(ex.rpe) : null,
      rest: ex.rest != null ? String(ex.rest) : null,
      tempo: null,
      notes: ex.notes ?? null,
      rawText: ex.rawText ?? "",
      weekProgression: [],
      clientComment: null,
      perSetReps: null,
      perSetRpe: null,
      setWeights: null,
      setReps: null,
      weight: ex.weight ?? null,
    }));

    if (exercises.length === 0) {
      req.log.warn({ description }, "parse-session returned 0 exercises — rejecting");
      res.status(500).json({ error: "Failed to generate exercises — please try again with more detail." });
      return;
    }

    res.json({ name: sessionName, source: "strength_block", exercises });
  } catch (err) {
    req.log.error({ err }, "Error parsing session");
    res.status(500).json({ error: "Failed to parse session" });
  }
});

export default router;
