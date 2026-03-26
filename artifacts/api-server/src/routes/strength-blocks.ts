import { Router, type IRouter } from "express";
import { db, programmesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { randomUUID } from "crypto";
import { addDays, addWeeks, startOfWeek, format, parseISO } from "date-fns";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BlockExercise {
  name: string;
  sets: number;
  reps: string;
  percentage: string;
  notes?: string;
}

interface BlockSession {
  dayOfWeek: number; // 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun
  name: string;
  exercises: BlockExercise[];
}

interface BlockWeek {
  week: number;
  label: string;
  sessions: BlockSession[];
}

interface StrengthBlockTemplate {
  id: string;
  name: string;
  liftFocus: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  level: "beginner" | "intermediate" | "advanced";
  tags: string[];
  description: string;
  notes: string;
  weeks: BlockWeek[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Data
// ─────────────────────────────────────────────────────────────────────────────

const templates: StrengthBlockTemplate[] = [
  
  {
    id: "smolov-powerlifting-split",
    name: "Smolov Powerlifting Split (SBD)",
    liftFocus: "squat,bench,deadlift",
    durationWeeks: 11,
    sessionsPerWeek: 3,
    level: "advanced",
    tags: ["powerlifting", "peaking", "intensity", "SBD", "squat", "bench", "deadlift"],
    description: "11-week powerlifting peaking cycle covering all three competition lifts. Introduction, base mesocycle, switching test, and intense peaking phases with max-out in Week 11.",
    notes: "Mon = Squat · Wed = Bench · Fri = Deadlift. Percentages based on current 1RM for each lift independently. test_max = open selection attempt.",
    weeks: [
      {
        week: 1, label: "Introduction — Week 1",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — Wave Loading",
            exercises: [
              { name: "Back Squat", sets: 3, reps: "8", percentage: "65%" },
              { name: "Back Squat", sets: 1, reps: "5", percentage: "70%" },
              { name: "Back Squat", sets: 2, reps: "2", percentage: "75%" },
              { name: "Back Squat", sets: 1, reps: "1", percentage: "80%" },
            ],
          },
          {
            dayOfWeek: 3, name: "Bench Press — Wave Loading",
            exercises: [
              { name: "Bench Press", sets: 3, reps: "8", percentage: "65%" },
              { name: "Bench Press", sets: 1, reps: "5", percentage: "70%" },
              { name: "Bench Press", sets: 2, reps: "2", percentage: "75%" },
              { name: "Bench Press", sets: 1, reps: "1", percentage: "80%" },
            ],
          },
          {
            dayOfWeek: 5, name: "Deadlift — Wave Loading",
            exercises: [
              { name: "Deadlift", sets: 4, reps: "5", percentage: "70%" },
              { name: "Deadlift", sets: 1, reps: "3", percentage: "75%" },
              { name: "Deadlift", sets: 2, reps: "2", percentage: "80%" },
              { name: "Deadlift", sets: 1, reps: "1", percentage: "90%" },
            ],
          },
        ],
      },
      {
        week: 2, label: "Test Week — Week 2",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 2×2 @ 85%",
            exercises: [{ name: "Back Squat", sets: 2, reps: "2", percentage: "85%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 1×3 @ 85%",
            exercises: [{ name: "Bench Press", sets: 1, reps: "3", percentage: "85%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 1×5 @ 85%",
            exercises: [{ name: "Deadlift", sets: 1, reps: "5", percentage: "85%" }],
          },
        ],
      },
      {
        week: 3, label: "Base Mesocycle — Week 1 of 3",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 4×9 @ 70%",
            exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "70%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 5×7 @ 75%",
            exercises: [{ name: "Bench Press", sets: 5, reps: "7", percentage: "75%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 7×5 @ 80%",
            exercises: [{ name: "Deadlift", sets: 7, reps: "5", percentage: "80%" }],
          },
        ],
      },
      {
        week: 4, label: "Base Mesocycle — Week 2 of 3",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 4×9 @ 70% +load",
            exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "70%", notes: "+load vs last week" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 5×7 @ 75% +load",
            exercises: [{ name: "Bench Press", sets: 5, reps: "7", percentage: "75%", notes: "+load vs last week" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 7×5 @ 80% +load",
            exercises: [{ name: "Deadlift", sets: 7, reps: "5", percentage: "80%", notes: "+load vs last week" }],
          },
        ],
      },
      {
        week: 5, label: "Base Mesocycle — Week 3 of 3",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 4×9 @ 70% +load",
            exercises: [{ name: "Back Squat", sets: 4, reps: "9", percentage: "70%", notes: "+load vs last week" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 5×7 @ 75% +load",
            exercises: [{ name: "Bench Press", sets: 5, reps: "7", percentage: "75%", notes: "+load vs last week" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 7×5 @ 80% +load",
            exercises: [{ name: "Deadlift", sets: 7, reps: "5", percentage: "80%", notes: "+load vs last week" }],
          },
        ],
      },
      {
        week: 6, label: "Switching Week — Max Test (SQ/BP)",
        sessions: [
          {
            dayOfWeek: 3, name: "Back Squat — 1RM Test",
            exercises: [{ name: "Back Squat", sets: 1, reps: "1", percentage: "", notes: "Max test — select opening attempts" }],
          },
          {
            dayOfWeek: 5, name: "Bench Press — 1RM Test",
            exercises: [{ name: "Bench Press", sets: 1, reps: "1", percentage: "", notes: "Max test — select opening attempts" }],
          },
        ],
      },
      {
        week: 7, label: "Intense Mesocycle — Week 1 of 4",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 5×5 @ 80%",
            exercises: [{ name: "Back Squat", sets: 5, reps: "5", percentage: "80%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 5×3 @ 85%",
            exercises: [{ name: "Bench Press", sets: 5, reps: "3", percentage: "85%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 5×2 @ 88%",
            exercises: [{ name: "Deadlift", sets: 5, reps: "2", percentage: "88%" }],
          },
        ],
      },
      {
        week: 8, label: "Intense Mesocycle — Week 2 of 4",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 5×4 @ 82%",
            exercises: [{ name: "Back Squat", sets: 5, reps: "4", percentage: "82%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 5×2 @ 88%",
            exercises: [{ name: "Bench Press", sets: 5, reps: "2", percentage: "88%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 4×4 @ 85%",
            exercises: [{ name: "Deadlift", sets: 4, reps: "4", percentage: "85%" }],
          },
        ],
      },
      {
        week: 9, label: "Intense Mesocycle — Week 3 of 4",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 4×4 @ 85%",
            exercises: [{ name: "Back Squat", sets: 4, reps: "4", percentage: "85%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 4×2 @ 90%",
            exercises: [{ name: "Bench Press", sets: 4, reps: "2", percentage: "90%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 3×3 @ 87%",
            exercises: [{ name: "Deadlift", sets: 3, reps: "3", percentage: "87%" }],
          },
        ],
      },
      {
        week: 10, label: "Intense Mesocycle — Week 4 of 4",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 3×3 @ 87%",
            exercises: [{ name: "Back Squat", sets: 3, reps: "3", percentage: "87%" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 3×1 @ 92%",
            exercises: [{ name: "Bench Press", sets: 3, reps: "1", percentage: "92%" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 3×1 @ 92%",
            exercises: [{ name: "Deadlift", sets: 3, reps: "1", percentage: "92%" }],
          },
        ],
      },
      {
        week: 11, label: "Competition Week — Max Test (SBD)",
        sessions: [
          {
            dayOfWeek: 1, name: "Back Squat — 1RM Test",
            exercises: [{ name: "Back Squat", sets: 1, reps: "1", percentage: "", notes: "Competition max — opening attempt selection" }],
          },
          {
            dayOfWeek: 3, name: "Bench Press — 1RM Test",
            exercises: [{ name: "Bench Press", sets: 1, reps: "1", percentage: "", notes: "Competition max — opening attempt selection" }],
          },
          {
            dayOfWeek: 5, name: "Deadlift — 1RM Test",
            exercises: [{ name: "Deadlift", sets: 1, reps: "1", percentage: "", notes: "Competition max — opening attempt selection" }],
          },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: score a template against a query string
// ─────────────────────────────────────────────────────────────────────────────

function scoreTemplate(template: StrengthBlockTemplate, query: string): number {
  const q = query.toLowerCase();
  let score = 0;

  // Programme name match
  if (q.includes("smolov jr") && template.id === "smolov_jr") score += 20;
  if ((q.includes("smolov senior") || q.includes("full smolov")) && template.id === "smolov_senior") score += 20;
  if ((q.includes("russian") || q.includes("rsr")) && template.id === "russian_squat") score += 20;
  if ((q.includes("beginner") || q.includes("starter") || q.includes("start")) && template.level === "beginner") score += 10;

  // Level
  if (q.includes("beginner") && template.level === "beginner") score += 8;
  if (q.includes("intermediate") && template.level === "intermediate") score += 8;
  if (q.includes("advanced") && template.level === "advanced") score += 8;

  // Frequency / days per week
  if ((q.includes("3 day") || q.includes("3x") || q.includes("3 session") || q.includes("three day")) && template.sessionsPerWeek === 3) score += 8;
  if ((q.includes("4 day") || q.includes("4x") || q.includes("4 session") || q.includes("four day")) && template.sessionsPerWeek === 4) score += 8;

  // Duration
  if ((q.includes("short") || q.includes("3 week")) && template.durationWeeks <= 3) score += 5;
  if ((q.includes("6 week") || q.includes("six week")) && template.durationWeeks === 6) score += 8;
  if ((q.includes("long") || q.includes("13 week") || q.includes("peaking cycle")) && template.durationWeeks >= 10) score += 5;

  // Rep range — low rep = intensity templates
  if ((q.includes("low rep") || q.includes("heavy") || q.includes("singles") || q.includes("1rm") || q.includes("max") || q.includes("peaking")) && template.tags.includes("intensity")) score += 8;
  if ((q.includes("low rep") || q.includes("heavy") || q.includes("peaking")) && template.tags.includes("peaking")) score += 5;

  // Volume
  if ((q.includes("volume") || q.includes("high rep") || q.includes("lots of") || q.includes("accumulation")) && template.tags.includes("volume")) score += 8;

  // Intensity
  if ((q.includes("intensity") || q.includes("intense") || q.includes("high intensity")) && template.tags.includes("intensity")) score += 6;

  // Strength keywords — match any lift focus
  if (q.includes("strength") || q.includes("squat") || q.includes("cycle") || q.includes("programme") || q.includes("program") || q.includes("block")) score += 3;

  // Powerlifting / SBD / multi-lift
  if ((q.includes("powerlifting") || q.includes("sbd") || q.includes("bench") || q.includes("deadlift") || q.includes("competition") || q.includes("meet") || q.includes("total")) && template.id === "smolov-powerlifting-split") score += 16;
  if ((q.includes("11 week") || q.includes("eleven week")) && template.durationWeeks === 11) score += 8;
  if (q.includes("all three") && template.id === "smolov-powerlifting-split") score += 8;

  // Any match at all gets a baseline
  const nameMatch = template.name.toLowerCase().split(" ").some(w => w.length > 3 && q.includes(w));
  if (nameMatch) score += 6;
  const tagMatch = template.tags.some(t => q.includes(t.replace(/-/g, " ")));
  if (tagMatch) score += 4;

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: generate sessions from template + start date
// ─────────────────────────────────────────────────────────────────────────────

function generateSessions(template: StrengthBlockTemplate, startDateStr: string) {
  // Snap to Monday of the provided start date week
  const startDate = startOfWeek(parseISO(startDateStr), { weekStartsOn: 1 });
  const sessions: any[] = [];

  for (const week of template.weeks) {
    const weekStart = addWeeks(startDate, week.week - 1);
    for (const session of week.sessions) {
      // dayOfWeek: 1=Mon (+0), 2=Tue (+1), ... 7=Sun (+6)
      const sessionDate = addDays(weekStart, session.dayOfWeek - 1);
      const exercises = session.exercises.map((ex) => ({
        id: `ex-${randomUUID().slice(0, 8)}`,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        notes: ex.notes ? `@ ${ex.percentage} — ${ex.notes}` : `@ ${ex.percentage}`,
        rawText: `${ex.sets}×${ex.reps} @ ${ex.percentage}`,
        rpe: null,
        rest: null,
        tempo: null,
        weekProgression: [],
      }));

      sessions.push({
        id: `session-${randomUUID().slice(0, 8)}`,
        date: format(sessionDate, "yyyy-MM-dd"),
        name: session.name,
        source: "strength_block" as any,
        structure: `${template.name} — ${week.label}`,
        exercises,
      });
    }
  }

  return sessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/strength-blocks/templates", (_req, res): void => {
  const summary = templates.map(({ weeks: _w, ...t }) => ({
    ...t,
    totalSessions: t.durationWeeks * t.sessionsPerWeek,
  }));
  res.json({ templates: summary });
});

router.get("/strength-blocks/templates/:id", (req, res): void => {
  const template = templates.find(t => t.id === req.params.id);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  res.json({ template });
});

router.post("/strength-blocks/preview", (req, res): void => {
  const { templateId, startDate } = req.body as { templateId: string; startDate: string };
  const template = templates.find(t => t.id === templateId);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!startDate) { res.status(400).json({ error: "startDate is required" }); return; }
  const sessions = generateSessions(template, startDate);
  res.json({ sessions, template: { id: template.id, name: template.name, durationWeeks: template.durationWeeks } });
});

router.post("/strength-blocks/insert", async (req, res): Promise<void> => {
  const { templateId, clientId, startDate } = req.body as {
    templateId: string;
    clientId: number;
    startDate: string;
  };

  const template = templates.find(t => t.id === templateId);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!clientId || !startDate) { res.status(400).json({ error: "clientId and startDate are required" }); return; }

  const sessions = generateSessions(template, startDate);

  const [programme] = await db
    .insert(programmesTable)
    .values({
      title: `${template.name} — ${format(startOfWeek(parseISO(startDate), { weekStartsOn: 1 }), "d MMM yyyy")}`,
      clientId,
      sessions,
    })
    .returning();

  res.status(201).json({ programme, sessionCount: sessions.length });
});

router.post("/strength-blocks/search", (req, res): void => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  const results = templates
    .map(t => ({ ...t, score: scoreTemplate(t, query), weeks: undefined }))
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // If nothing scored above 0, return all sorted by level
  const final = results.length > 0 ? results : templates.slice(0, 3).map(t => ({ ...t, score: 1, weeks: undefined }));

  res.json({ results: final });
});

// ── Exported for unified Brain search ──────────────────────────────────────
export function searchStrengthSync(query: string, limit = 2) {
  const scored = templates
    .map(t => ({ ...t, score: scoreTemplate(t, query), weeks: undefined }))
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return (scored.length > 0 ? scored : templates.slice(0, limit).map(t => ({ ...t, score: 1, weeks: undefined })));
}

// NLP endpoint: parse natural language → suggest which template + extract params
router.post("/strength-blocks/nlp", async (req, res): Promise<void> => {
  const { command, clients } = req.body as { command: string; clients?: { id: number; name: string }[] };

  const templateList = templates.map(t => `- id: "${t.id}", name: "${t.name}", level: ${t.level}, weeks: ${t.durationWeeks}, daysPerWeek: ${t.sessionsPerWeek}, tags: ${t.tags.join(", ")}`).join("\n");
  const clientList = (clients ?? []).map(c => `- id: ${c.id}, name: "${c.name}"`).join("\n") || "No clients provided";

  const systemPrompt = `You are a fitness programme assistant. A coach has typed a natural language command to insert a strength block into a client's calendar.

Available programme templates:
${templateList}

Known clients:
${clientList}

Today's date: ${format(new Date(), "yyyy-MM-dd")}

Your job is to extract:
1. templateId: which template to use (must match one of the ids above). Choose the best match based on the command.
2. clientId: which client (match by name, case-insensitive partial match). null if not specified.
3. clientName: the client name as mentioned in the command. null if not specified.
4. startDate: in yyyy-MM-dd format. Resolve relative dates ("next Monday", "March 30") using today as reference. null if not specified.
5. confidence: "high" | "medium" | "low" — how confident you are in your interpretation
6. summary: a one-sentence human-readable summary of what you're about to do (e.g. "Insert Smolov Jr into Keeley's calendar starting 30 March 2026")
7. missingInfo: array of strings for any missing required info (e.g. ["client not specified", "start date not specified"])

Return ONLY valid JSON:
{"templateId": "...", "clientId": ..., "clientName": "...", "startDate": "...", "confidence": "...", "summary": "...", "missingInfo": [...]}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 512,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: command },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    // Validate templateId
    const template = templates.find(t => t.id === parsed.templateId);
    if (!template) parsed.templateId = null;

    res.json({ ...parsed, template: template ? { id: template.id, name: template.name, durationWeeks: template.durationWeeks, sessionsPerWeek: template.sessionsPerWeek } : null });
  } catch (err) {
    res.status(500).json({ error: "Failed to parse command" });
  }
});

export default router;
