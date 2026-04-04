import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import { db, programmesTable, clientsTable } from "@workspace/db";
import type { Exercise } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDays, parseISO, format } from "date-fns";

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
          content: `You are an expert strength and conditioning coach. A coach has described a training plan they want for a client. Write a brief, direct paragraph (3–6 sentences) explaining the programming rationale — what the structure will be, why it suits their goals, how intensity will progress across the weeks, and any specific strategic decisions (e.g. deload week, peaking phase, alternating upper/lower).${styleNote} Write as though you're a coach explaining your thinking to the client. Be specific, not generic. Do not use bullet points. Do not mention that you are an AI.`,
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
  const { description, startDate, strengthStyle, clientId } = req.body as {
    description: string; startDate: string; strengthStyle?: "straight" | "variety"; clientId?: number;
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

  const chosenModel = selectModel(description);
  req.log.info({ model: chosenModel, hasClientId: !!clientId }, "generate-programme model selected");

  const systemPrompt = `You are an expert fitness programming AI. A coach is describing the training plan they want for a client. Generate a complete, realistic multi-week training programme as a JSON object.

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

### 1. Enjoyment drives consistency — variety is not optional
- Clients who enjoy their training show up. Clients who are bored don't. Variety is therefore a performance tool, not a luxury.
- Do NOT repeat the same exercise selection for more than 3–4 weeks. After that, rotate to fresh variations (e.g. Back Squat → Front Squat or Pause Squat; Romanian Deadlift → Stiff-Leg Deadlift; Bench Press → Close Grip Bench or Incline Bench).
- Aim for intra-session variety: across weeks, the exercises within a given session should feel fresh — different variations, different angles, different stimuli — even when the movement pattern is the same.
- If a block is 4–6 weeks, plan which exercises to use in weeks 1–3 and which variations to rotate in from week 4 onwards. This should be a visible change, not just a small rep range tweak.

### 2. Intensity is the default for regular clients
- Most clients train 4–5 times per week, once per day. At this frequency, they do NOT need large amounts of easy/Zone 2 volume. The Z2-heavy model comes from endurance professionals running 100+ miles per week doing two-a-day sessions — it does not apply here.
- Not every session should make the client want to throw up, but they should be working hard most of the time. Hard and purposeful is the standard. Easy volume for its own sake is a waste of a session.
- This applies to both running and conditioning work. Do not pad programmes with easy filler. Every session earns its place by delivering a meaningful stimulus.

### 3. Running: quality over junk mileage
- The coach does NOT believe in junk miles (easy runs that accumulate volume without meaningful stimulus).
- **The rule of proportionality:** Only prescribe easy/recovery runs when running frequency is already high (4–5 runs/week). At that volume, 1–2 easy runs per week are appropriate for recovery. But for most clients running 1–3 times per week, every run should have a PURPOSE (threshold, VO2 max, tempo, intervals, or sprint work).
- **The default bias is intensity, not volume.** When in doubt about what kind of run to programme, choose a structured interval session over an easy jog.
- Easy runs are recovery tools for high-volume programmes — they are NOT a substitute for intensity in low-frequency programmes.
- Practical guide:
  - 1 run/week → make it quality: threshold or VO2 max work
  - 2 runs/week → 1 quality (threshold/intervals) + 1 aerobic base or tempo
  - 3 runs/week → 2 quality + 1 easy
  - 4 runs/week → 2 quality + 1 tempo + 1 easy
  - 5 runs/week → 2 quality + 1 tempo + 2 easy (base building)

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
- "name": "Run" or a specific name (e.g. "Tempo Run", "Easy Run")
- "structure": the run description (e.g. "5km easy Z2 run" or "4×1km at threshold with 90s rest" or "20 min tempo run at Z3")
- "color": "#16a34a"
- exercises: the run broken into segments as exercises (e.g. {name:"5km Easy Run", sets:1, reps:"5km", rest:null, ...})

## Scheduling rules — use dayNumber, NOT dates
- Sessions are positioned by **dayNumber** (integer), NOT by calendar date. Day 1 = the first training day of the programme (maps to startDate). Do NOT output a "date" field.
- dayNumber is a simple day counter: Day 1, Day 2, Day 3... across the full programme. Rest days are simply gaps in the sequence.
- Use these dayNumber patterns (offsets within each 7-day week):
  - 3 sessions/week → week N sessions at days (N-1)×7+1, (N-1)×7+3, (N-1)×7+5
  - 4 sessions/week → week N sessions at days (N-1)×7+1, (N-1)×7+2, (N-1)×7+4, (N-1)×7+6
  - 5 sessions/week → week N sessions at days (N-1)×7+1, (N-1)×7+2, (N-1)×7+3, (N-1)×7+4, (N-1)×7+6
  - 6 sessions/week → week N sessions at days (N-1)×7+1 through (N-1)×7+6
- Example (4-day, 3-week programme): dayNumbers would be 1,2,4,6, 8,9,11,13, 15,16,18,20
- NEVER use weekday names (Mon/Tue/Thu/Sat) to compute dates — use dayNumber integers only.
- Spread sessions sensibly — avoid consecutive days where possible.
- Schedule for the number of weeks requested, with a hard maximum of 6 weeks.
- Generate varied sessions week to week — rotate movements, vary rep ranges, increase load (periodisation).
- Each session must have a unique id: "session-gen-{unique 8 chars}"

## Endurance / cardio training principles (apply to ALL run sessions and any programme with significant running or cardio content)

These principles come from Chris Hinshaw — former professional triathlete (2nd place Hawaiian Ironman World Championships), endurance coach to CrossFit Games champions including Rich Froning, Mat Fraser, Jason Khalipa, Camille LeBlanc-Bazinet, and Katrin Davidsdóttir.

### The 5 endurance training zones
Every run programme should draw from these zones in appropriate proportion. Do NOT just generate "easy runs" and "intervals" — use this precise vocabulary and design sessions that genuinely target the zone named.

**1. Aerobic Threshold (the foundation — most volume goes here)**
- Steady, moderate intensity — develops fuel efficiency (fat burning), musculoskeletal system, aerobic base
- Think: long easy runs, Z2 runs, conversational pace
- These are the "rest" component of mixed sessions and the backbone of an aerobic base block
- Example structure: 20–60 min continuous easy run, or recovery jogs between harder efforts
- Use source: "run_brain", name: "Easy Run" or "Aerobic Base Run" or "Z2 Run"

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
- **Aerobic base matters — but context is everything:** for high-volume endurance athletes (100+ miles/week, two-a-day sessions), easy Z2 work forms the majority of volume. For regular clients training 4–5x/week once per day, this does NOT apply. Most of their running should still have purpose and intensity — easy runs are only appropriate once frequency is high enough to need recovery sessions between hard efforts.
- **Endurance does not hurt strength — in moderation:** don't be afraid to programme running in strength-focused weeks. Rich Froning's mile improved AND his back squat went up. Mat Fraser ran 5400m at 6-min/mile pace then hit a C&J PR three hours later.
- **Variety in structure:** use creative, named session formats. Not just "run 5km". Think pyramid runs, hop-scotch style (build distance then descend), Bombolini-style mixed pace sessions.
- **The recovery interval IS the rest:** in mixed-pace sessions, the easy pace interval is the rest — it should be written as part of the structure, not omitted.

### Example session formats to use
- **Pyramid run (aerobic threshold):** 200m easy / 100m sprint / 400m easy / 100m sprint / 600m easy / 100m sprint... then descend back down. Continuous, non-stop. Sprints at 97–98% (not max — retain form). Total ~4–6km.
- **Bombolini (mixed threshold/speed):** 3 sets of [500m fast (between 1-mile and 400m PR pace) + 200m recovery jog + 100m sprint], 5 min rest between sets.
- **Threshold intervals:** 4×1km at 10k pace, 90s rest between reps.
- **VO2 Max track session:** 8×400m at faster than 5k pace, 90s rest.
- **Long easy run:** 40–60 min at aerobic threshold / Z2 pace. Comfortable, continuous.
- **Speed session:** 6×100m sprint, 3 min full recovery between each.

### Periodisation for endurance blocks
- Early weeks: predominantly aerobic threshold volume (build the base)
- Mid weeks: introduce lactate threshold intervals (1–2 per week) alongside easy runs
- Later weeks: add VO2 max work (1 session/week) — requires the aerobic base to be present first
- Speed endurance: used sparingly, primarily near events or when sharpening
- Deload: reduce to easy aerobic runs only, no intervals

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

## Hyrox specific rules (apply when the description mentions "Hyrox", "HYROX", "hyrox race", or similar)

When the programme is Hyrox-focused, apply the following principles:

### The priority hierarchy — stick to this strictly
The MAJORITY of training volume should NOT be Hyrox-specific. Structure every week around this priority order:

**Priority 1 — Running capacity (most of the programme)**
- Run development is the spine of the programme. Most sessions each week should be runs.
- Use the 5km and 10km as primary benchmarks — target these distances and paces.
- A half marathon is also relevant but use it as secondary context.
- Run types to include across the week: easy Z2 runs, threshold intervals (e.g. 4×1km, 6×800m), tempo runs, long easy runs.
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
- If 6 weeks: deload final week — easy runs only, light strength, no Hyrox circuits

## Output format
Return ONLY valid JSON (no markdown):
{
  "title": "6-Week Strength & Conditioning Block",
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

IMPORTANT: Use "dayNumber" (integer), NOT "date" (string). The server computes the actual calendar date.`;

  const styleSection = strengthStyle === "variety" ? `

## Session style: VARIETY (the coach has requested this)
Use varied rep schemes and intensity techniques within strength sessions. Apply these across the programme:

- **Wave loading:** sets where the weight undulates up then resets to a heavier wave (e.g. 3 waves of 6/4/2 — wave 1: 70/75/80%, wave 2: 72/77/82%, wave 3: 74/79/84%)
- **Pyramid sets:** ascending (add weight, reduce reps each set: 12→10→8→6→4) or descending (reduce weight, add reps)
- **Drop sets:** final set drops weight immediately and continues for more reps (e.g. "10 reps @RPE9, then strip 20% and go to failure")
- **AMRAP finishers:** last set of a compound movement done for as many reps as possible with good form
- **Cluster sets:** e.g. 5 reps, rest 15s, 5 reps, rest 15s, 5 reps (all within one "set")
- **Back-off sets:** after heavy work, reduce load by 15–20% and do a higher rep set

Mix these intelligently — don't pile every technique into one session. A typical session might use pyramid loading on the primary lift, straight sets on assistance work, and an AMRAP finisher on the last compound movement.

Express these in the exercises using the "reps" field creatively (e.g. "6/4/2 wave × 3", "12-10-8-6", "AMRAP", "cluster: 5+5+5") and use the "notes" field to describe the technique (e.g. "3 waves — wave 1: 70/75/80%, wave 2: 72/77/82%", "drop 20% after last set and go to failure").

Still apply all periodisation principles (overload, phase potentiation, fatigue management) — variety is a tool within the structure, not instead of it.
` : `

## Session style: STRAIGHT SETS (the coach has requested this)
Use clean, consistent straight sets throughout. Every exercise should have a defined number of sets and a consistent rep target. No drop sets, no pyramids, no complex schemes.

- Sets and reps are simple and consistent: e.g. 4×5, 3×8, 5×3
- Progressive overload is expressed through increasing weight each week, not changing rep schemes
- Intensity is expressed via RPE targets in the notes field (e.g. "@RPE8", "leave 1-2 reps in tank")
- Deload weeks reduce volume (fewer sets) and intensity (lower RPE)
- The notes field can include load guidance (e.g. "85% of 1RM", "heavy for reps") but no complex technique instructions
`;

  try {
    const completion = await openai.chat.completions.create({
      model: chosenModel,
      max_completion_tokens: chosenModel === "gpt-4o" ? 16384 : 32768,
      messages: [
        { role: "system", content: systemPrompt + styleSection },
        { role: "user", content: `Start date: ${startDate}\n\nDescription: "${description}"` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { title: string; sessions: any[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      req.log.warn({ raw }, "Failed to parse generate-programme LLM response");
      res.status(500).json({ error: "AI returned invalid JSON — try rephrasing your description" });
      return;
    }

    const start = parseISO(startDate);
    const sessions = (parsed.sessions ?? []).map((s: any) => {
      // Convert dayNumber → ISO date. dayNumber 1 = startDate, dayNumber 2 = startDate+1, etc.
      const dayNum = typeof s.dayNumber === "number" ? s.dayNumber : null;
      const sessionDate = dayNum != null
        ? format(addDays(start, dayNum - 1), "yyyy-MM-dd")
        : (s.date ?? startDate); // fallback for any legacy response that still includes a date
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

    res.json({ title: parsed.title || "Custom Programme", sessions });
  } catch (err) {
    req.log.error({ err }, "Error generating programme");
    res.status(500).json({ error: "Failed to generate programme" });
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

  const systemPrompt = `You are a running coach assistant. Parse the user's run session description into structured JSON.

Rules:
- Extract DURATION in minutes (number, null if not mentioned)
- Extract DISTANCE in km (number, null if not mentioned). Convert miles to km (1 mile = 1.609 km), convert metres to km.
- Extract INTENSITY as a short label: "Easy", "Steady", "Tempo", "Intervals", "Hill Repeats", "Time Trial", "Sprint", "Recovery", or infer from context
- Generate a concise SESSION NAME (e.g. "Easy Run", "Tempo Intervals", "Long Run", "Hill Repeats", "5K Time Trial")
- Write a human-readable STRUCTURE string that fully describes the session (e.g. "30 min easy run at conversational pace", "5 × 1km at tempo pace, 90s jog recovery")
- Return ONLY valid JSON, no markdown fences

Response format:
{
  "name": "Tempo Intervals",
  "duration": 35,
  "distanceKm": 8,
  "intensity": "Tempo",
  "structure": "5 × 1 km at tempo pace, 90s jog recovery, total ~35 min"
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
    const sessionName = name?.trim() || parsed.name || "Run";
    const duration: number | null = typeof parsed.duration === "number" ? parsed.duration : null;
    const distanceKm: number | null = typeof parsed.distanceKm === "number" ? Math.round(parsed.distanceKm * 10) / 10 : null;
    const intensity: string = parsed.intensity ?? "";
    const structure: string = parsed.structure ?? description.trim();

    const notesParts: string[] = [];
    if (duration) notesParts.push(`${duration} min`);
    if (distanceKm) notesParts.push(`${distanceKm} km`);
    if (intensity) notesParts.push(intensity);
    const notes = notesParts.join(" · ");

    const now = Date.now();
    const exercises = [{
      id: `ex-${now}-0`,
      name: sessionName,
      sets: null,
      reps: null,
      rpe: null,
      rest: null,
      tempo: null,
      notes,
      rawText: structure,
      weekProgression: [],
      clientComment: null,
      perSetReps: null,
      perSetRpe: null,
      setWeights: null,
      setReps: null,
      weight: null,
    }];

    res.json({ name: sessionName, source: "run_brain", structure, exercises });
  } catch (err) {
    req.log.error({ err }, "Error parsing run session");
    res.status(500).json({ error: "Failed to parse run session" });
  }
});

// ── Quick WOD / conditioning session builder ────────────────────────────────
// POST /parse-wod-session  { description, name? }
// Returns a ready-to-save WOD session (source: "wod_brain") from free-text.
router.post("/parse-wod-session", async (req, res): Promise<void> => {
  const { description, name } = req.body as { description?: string; name?: string };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const systemPrompt = `You are a conditioning coach assistant. Parse the user's WOD/conditioning description into structured JSON.

Rules:
- Identify the workout FORMAT: "amrap", "emom", "for_time", "interval", "ladder", or "other"
- Extract DURATION in minutes (integer). If not stated, infer from context (amrap usually has a stated duration; default to 20 if unclear)
- Extract each movement/exercise as a BLOCK with: movement (lowercase name), amount (number), unit ("reps","m","km","cal","seconds","minutes")
- For distances: convert miles to km, keep metres as "m"
- Generate a concise workout NAME if not provided (e.g. "30 Min AMRAP", "EMOM 12", "Mixed Conditioning")
- Write a human-readable STRUCTURE string (e.g. "AMRAP 30: 15 press ups, 1 km bike erg, 500 m run")
- Return ONLY valid JSON, no markdown fences

Response format:
{
  "format": "amrap",
  "duration": 30,
  "name": "Mixed AMRAP",
  "structure": "AMRAP 30: 15 press ups, 1 km bike erg, 500 m run",
  "blocks": [
    { "movement": "press ups", "amount": 15, "unit": "reps" },
    { "movement": "bike erg", "amount": 1, "unit": "km" },
    { "movement": "running", "amount": 500, "unit": "m" }
  ]
}`;

  const FORMAT_LABELS: Record<string, string> = {
    amrap: "AMRAP", emom: "EMOM", for_time: "For Time",
    interval: "Intervals", ladder: "Ladder", other: "Conditioning",
  };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `WOD name (optional): ${name?.trim() || "(auto-generate)"}\n\nDescription:\n${description.trim()}` },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    const format: string = parsed.format ?? "other";
    const formatLabel = FORMAT_LABELS[format] ?? "Conditioning";
    const duration: number = typeof parsed.duration === "number" ? parsed.duration : 20;
    const wodName = name?.trim() || parsed.name || `${formatLabel} ${duration}`;
    const structure: string = parsed.structure ?? description.trim();
    const blocks: { movement: string; amount: number; unit: string }[] = parsed.blocks ?? [];

    const now = Date.now();
    const exercises = blocks.map((block, idx) => ({
      id: `ex-${now}-${idx}`,
      name: block.movement.charAt(0).toUpperCase() + block.movement.slice(1),
      sets: null,
      reps: null,
      rpe: null,
      rest: null,
      tempo: null,
      notes: `${block.amount} ${block.unit}`,
      rawText: `${block.amount} ${block.unit} ${block.movement}`,
      weekProgression: [],
      clientComment: null,
      perSetReps: null,
      perSetRpe: null,
      setWeights: null,
      setReps: null,
      weight: null,
    }));

    res.json({ name: wodName, source: "wod_brain", structure, exercises });
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

  const systemPrompt = `You are a personal training assistant. Convert the user's exercise list into a structured session.

Rules:
- Parse each exercise extracting: name, sets (integer), reps (string e.g. "8", "8-10", "AMRAP"), rpe (string e.g. "7", "8-9" — if mentioned), rest (string e.g. "90s", "2 min" — if mentioned), weight (string e.g. "80kg", "185lb" — if mentioned), notes (anything else)
- Accept any common format: "4x8 bench press", "bench press 4 sets 8 reps", "3×10 squat @80kg @RPE8"
- If a field is not mentioned, set it to null
- Generate a descriptive session name from the exercises if the user didn't provide one (e.g. "Upper Body Push", "Leg Day", "Back & Biceps")
- Return ONLY valid JSON, no markdown fences

Response format:
{
  "name": "Upper Body Push",
  "exercises": [
    { "name": "Bench Press", "sets": 4, "reps": "8", "rpe": "8", "rest": "90s", "weight": null, "notes": null },
    { "name": "Barbell Row", "sets": 3, "reps": "10", "rpe": null, "rest": null, "weight": "80kg", "notes": null }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Session name (optional): ${name?.trim() || "(auto-generate)"}\n\nExercises:\n${description.trim()}` },
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

    res.json({ name: sessionName, source: "strength_block", exercises });
  } catch (err) {
    req.log.error({ err }, "Error parsing session");
    res.status(500).json({ error: "Failed to parse session" });
  }
});

export default router;
