import { Router, type IRouter } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const SYSTEM = `You are a fitness calendar command parser. Parse natural-language calendar commands into structured JSON.

Return ONLY a single valid JSON object matching exactly one of these schemas:

1. Reschedule a named programme to specific days of the week:
{"action":"reschedule","programmeQuery":"<name fragment>","targetDays":["Monday","Wednesday","Friday"]}

2. Remap ALL sessions from specific days to other days (1-to-1 mapping):
{"action":"day_remap","fromDays":["Monday","Wednesday","Friday"],"toDays":["Tuesday","Thursday","Sunday"]}
The fromDays and toDays arrays must be the same length.

3. Copy sessions from one week and paste into following weeks with optional per-week progression:
{"action":"copy_progress","sourceWeekOffset":0,"targetWeeks":4,"setsIncrement":1,"repsMultiplier":0.9}
- sourceWeekOffset: 0=this week, -1=last week, 1=next week
- targetWeeks: how many future weeks to paste into
- setsIncrement: integer sets added each successive week vs source (0 if no change)
- repsMultiplier: factor applied to reps each successive week vs source (1.0=same, 0.9=−10%, 1.1=+10%)

4. Delete sessions:
{"action":"delete","scope":"all"}
{"action":"delete","scope":"programme","programmeQuery":"<name fragment>"}

5. Unknown / unparseable:
{"action":"unknown","message":"<brief reason>"}

Rules:
- Day names must be full English names: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
- If the user says "next four weeks" that means targetWeeks=4
- If the user says "increase sets by 1" that means setsIncrement=1
- If the user says "reduce reps by 10%" that means repsMultiplier=0.9
- If the user says "increase reps by 5%" that means repsMultiplier=1.05
- Prefer day_remap over reschedule when the user specifies FROM days AND TO days
- Never wrap the JSON in markdown fences`;

router.post("/parse-calendar-command", async (req, res): Promise<void> => {
  const { command, programmeNames, currentDate } = req.body as {
    command: string;
    programmeNames: string[];
    currentDate: string;
  };

  if (!command?.trim()) {
    res.status(400).json({ action: "unknown", message: "Empty command" });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `${SYSTEM}\n\nToday: ${currentDate}\nAvailable programmes: ${programmeNames.length ? programmeNames.join(", ") : "(none)"}`,
        },
        { role: "user", content: command },
      ],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0,
    });

    const raw = completion.choices[0].message.content ?? "{}";
    const intent = JSON.parse(raw);
    res.json(intent);
  } catch (err) {
    console.error("parse-calendar-command error", err);
    res.status(500).json({ action: "unknown", message: "Failed to parse command" });
  }
});

export default router;
