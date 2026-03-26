import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import type { Exercise } from "@workspace/db";
import { randomUUID } from "crypto";

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

router.post("/generate-programme", async (req, res): Promise<void> => {
  const { description, startDate } = req.body as { description: string; startDate: string };
  if (!description || !startDate) {
    res.status(400).json({ error: "description and startDate are required" });
    return;
  }

  const systemPrompt = `You are an expert fitness programming AI. A coach is describing the training plan they want for a client. Generate a complete, realistic multi-week training programme as a JSON object.

## Session types and rules

### Strength sessions (no source field):
- "source" field must be OMITTED entirely (do not set it to null or undefined — just leave it out)
- Must have a "name" (e.g. "Upper Body", "Lower Body", "Full Body", "Push", "Pull", "Legs")
- Must have 4–6 exercises, each with:
  - id: "ex-gen-{unique 6 chars}"
  - name: proper exercise name (e.g. "Back Squat", "Bench Press", "Romanian Deadlift")
  - sets: integer (3–5)
  - reps: string (e.g. "5", "8-10", "12", "failure")
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

## Scheduling rules
- Start from the provided startDate
- Week starts on Monday
- Spread sessions sensibly — avoid consecutive days where possible (aim for rest days between hard sessions)
- Typical pattern: Mon/Wed/Fri for 3x strength, add Tue or Thu for run/WOD
- For 5+ sessions/week, days like Mon/Tue/Thu/Fri/Sat are reasonable
- Schedule for the number of weeks requested, with a hard maximum of 6 weeks. If more than 6 weeks are requested, cap at 6 weeks.
- Generate varied sessions week to week — don't repeat identical exercises every week. Rotate movements, vary rep ranges, increase load week to week (periodisation). Use different exercise variations across weeks.
- Each session must have a unique id: "session-gen-{unique 8 chars}"

## Output format
Return ONLY valid JSON (no markdown):
{
  "title": "6-Week Strength & Conditioning Block",
  "sessions": [
    {
      "id": "session-gen-abc12345",
      "date": "2026-03-30",
      "name": "Upper Body",
      "exercises": [...]
    },
    {
      "id": "session-gen-def67890",
      "date": "2026-04-01",
      "name": "WOD",
      "source": "wod_brain",
      "structure": "21-15-9 Thrusters 42.5kg and Pull-ups for time",
      "color": "#7c3aed",
      "exercises": [...]
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 32768,
      messages: [
        { role: "system", content: systemPrompt },
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

    const sessions = (parsed.sessions ?? []).map((s: any) => {
      const base: any = {
        ...s,
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

export default router;
