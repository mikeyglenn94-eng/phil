import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import multer from "multer";
import type { Exercise } from "@workspace/db";
import { randomUUID } from "crypto";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const PARSE_SYSTEM_PROMPT = `You are a fitness programming assistant. Parse voice transcripts from a coach into structured exercise data.

Rules:
- Extract each exercise with: name, sets (integer), reps (string like "10" or "8-10"), RPE (string like "8-9"), rest (string like "90s" or "2 min"), tempo (string like "3-1-1-0"), notes (string)
- Handle week progressions: "reduce reps by 2 each week for 3 weeks" → weekProgression array
- Common patterns:
  - "3x10 back squat" → sets:3, reps:"10", name:"Back Squat"
  - "4 sets of 8 Romanian deadlift" → sets:4, reps:"8", name:"Romanian Deadlift"
  - "RPE 8" or "RPE 8 to 9" → rpe:"8" or rpe:"8-9"
  - "rest 90 seconds" / "rest 2 minutes" → rest:"90s" / rest:"2 min"
  - "tempo 3 1 1 0" → tempo:"3-1-1-0"
  - "add note: control the lowering" → notes:"Control the lowering"
  - "reduce reps by 2 each week for 3 weeks" with current reps 10 → weekProgression:[{week:1,reps:"10"},{week:2,reps:"8"},{week:3,reps:"6"}]
  - "add 2.5 kilos each week for 4 weeks" → weekProgression:[{week:1,weight:"start"},{week:2,weight:"+2.5kg"},...]
- If a phrase modifies the LAST exercise (e.g. "rest 90 seconds" after naming an exercise), apply it to that exercise
- If the transcript contains multiple exercises, return all of them
- If something is ambiguous, still make your best guess and set rawText to the original phrase
- Generate a unique short id for each exercise (like "ex-1", "ex-2")
- Return ONLY valid JSON, no markdown, no explanation

Return format:
{"exercises": [{"id":"ex-1","name":"...","sets":3,"reps":"10","rpe":"8-9","rest":"90s","tempo":null,"notes":null,"rawText":"...","weekProgression":[]}]}`;

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

    let parsed: { exercises: Exercise[] };
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
      res.json({ exercises: [fallbackExercise], rawTranscript: transcript });
      return;
    }

    const exercises = (parsed.exercises ?? []).map((ex) => ({
      ...ex,
      id: ex.id || `ex-${randomUUID().slice(0, 8)}`,
      weekProgression: ex.weekProgression ?? [],
    }));

    res.json({ exercises, rawTranscript: transcript });
  } catch (err) {
    req.log.error({ err }, "Error parsing transcript");
    res.status(500).json({ error: "Failed to parse transcript" });
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
