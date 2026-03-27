import { Router, type IRouter } from "express";
import { db, programmesTable } from "@workspace/db";
import { addWeeks, addDays, startOfWeek, format, parseISO } from "date-fns";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EngineProgrammeSession {
  day: number;
  type: "threshold" | "vo2" | "aerobic";
  structure: string;
  target: string;
  notes: string;
  modalityOptions: string[];
}

interface EngineProgrammeWeek {
  week: number;
  theme: string;
  sessions: EngineProgrammeSession[];
}

interface EngineProgramme {
  id: string;
  name: string;
  author: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  goal: string;
  tags: string[];
  globalRules: string[];
  intensityGuide: Record<string, { effort: string; description: string }>;
  progressionRules: string[];
  weeks: EngineProgrammeWeek[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates — only coach-uploaded programmes go here, never invented
// ─────────────────────────────────────────────────────────────────────────────

const engineProgrammes: EngineProgramme[] = [
  {
    id: "engine-builder-6-week",
    name: "Engine Builder 6 Week Block",
    author: "Custom Hinshaw-Style Framework",
    durationWeeks: 6,
    sessionsPerWeek: 3,
    goal: "Build aerobic base, threshold, and VO2 max using interchangeable cyclical modalities",
    tags: [
      "engine", "aerobic", "threshold", "vo2", "endurance", "6-week",
      "hinshaw", "multi-modal", "row", "run", "ski", "bike", "cardio",
      "assault bike", "echo bike", "bike erg",
    ],
    globalRules: [
      "Prioritise repeatable output across all intervals",
      "Do not sprint the first rep",
      "Pacing should allow all reps to be completed at similar output",
      "If output drops significantly, reduce intensity next round",
      "Choose one modality per session unless mixed modality is explicitly programmed",
      "Threshold work should feel controlled hard",
      "VO2 work should feel very hard but still repeatable",
      "Aerobic work should feel sustainable and conversational",
      "Rest is fixed and part of the session design",
    ],
    intensityGuide: {
      aerobic: {
        effort: "easy to moderate",
        description: "Conversational pace. You should feel like you could keep going beyond the prescribed duration.",
      },
      threshold: {
        effort: "moderately hard to hard",
        description: "Controlled discomfort. You should be working hard but never blowing up.",
      },
      vo2: {
        effort: "hard to very hard",
        description: "High output with repeatability. You should still be able to match output across rounds.",
      },
    },
    progressionRules: [
      "Weeks 1 to 2 build baseline volume and pacing discipline",
      "Weeks 3 to 4 increase density or total work",
      "Week 5 is the hardest week",
      "Week 6 is a consolidation week with slightly reduced volume but strong execution",
      "Athlete may swap modality session to session",
      "Keep the stimulus the same when changing modality",
      "If recovery is poor, hold the previous week's structure rather than forcing progression",
    ],
    weeks: [
      {
        week: 1,
        theme: "Establish pacing and control",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "5 × 5 min work / 90s rest",
            target: "Controlled hard pace, even output across all reps",
            notes: "First rep should feel conservative. Build confidence in pacing.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "10 × 1 min work / 1 min rest",
            target: "Hard but repeatable effort",
            notes: "Do not chase a huge first rep. Aim for minimal drop-off.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "40 min continuous",
            target: "Steady conversational effort",
            notes: "Smooth, relaxed rhythm. This should not turn into threshold work.",
          },
        ],
      },
      {
        week: 2,
        theme: "Add a little more work",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "6 × 5 min work / 90s rest",
            target: "Controlled hard pace, even output across all reps",
            notes: "Slight increase in volume. Hold the same discipline.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "12 × 1 min work / 1 min rest",
            target: "Hard but repeatable effort",
            notes: "Stay smooth. The goal is repeatability, not heroics.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "45 min continuous",
            target: "Steady conversational effort",
            notes: "You should finish feeling like you had more.",
          },
        ],
      },
      {
        week: 3,
        theme: "Increase density",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "5 × 6 min work / 90s rest",
            target: "Controlled hard pace, even output across all reps",
            notes: "Longer reps now. Keep control and avoid surging.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "8 × 90s work / 75s rest",
            target: "Hard but repeatable effort",
            notes: "This should bite a little more than week 2, but still be sustainable.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "50 min continuous",
            target: "Steady conversational effort",
            notes: "Stay efficient. No drifting into moderate-hard work.",
          },
        ],
      },
      {
        week: 4,
        theme: "Push total quality work",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "4 × 8 min work / 2 min rest",
            target: "Controlled hard pace, even output across all reps",
            notes: "Long threshold intervals. Very honest pacing needed.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "10 × 90s work / 75s rest",
            target: "Hard but repeatable effort",
            notes: "Output should stay stable from first rep to last.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "55 min continuous",
            target: "Steady conversational effort",
            notes: "Think smooth mechanics and low emotional effort.",
          },
        ],
      },
      {
        week: 5,
        theme: "Peak workload",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "5 × 8 min work / 2 min rest",
            target: "Controlled hard pace, even output across all reps",
            notes: "This is the biggest threshold session of the block.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "12 × 90s work / 60s rest",
            target: "Hard but repeatable effort",
            notes: "This is the hardest VO2 session. Only keep it if quality remains high.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "60 min continuous",
            target: "Steady conversational effort",
            notes: "Long and controlled. This supports recovery as much as adaptation.",
          },
        ],
      },
      {
        week: 6,
        theme: "Consolidate and express fitness",
        sessions: [
          {
            day: 1,
            type: "threshold",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "4 × 6 min work / 90s rest",
            target: "Controlled hard pace, slightly stronger than week 3 if fitness has improved",
            notes: "Less volume. Aim for your best execution of the block.",
          },
          {
            day: 2,
            type: "vo2",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "8 × 1 min work / 1 min rest",
            target: "Hard but crisp effort",
            notes: "This should feel powerful, not desperate.",
          },
          {
            day: 3,
            type: "aerobic",
            modalityOptions: ["run", "row", "ski", "assault_bike", "echo_bike", "bike_erg"],
            structure: "45 min continuous",
            target: "Steady conversational effort",
            notes: "Finish the block feeling in rhythm, not buried.",
          },
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

function scoreEngine(p: EngineProgramme, query: string): number {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const corpus = [p.name, p.author, p.goal, ...p.tags].join(" ").toLowerCase();
  for (const token of tokens) {
    if (corpus.includes(token)) score += 2;
  }
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session generation
// Day mapping: day 1 → Mon, day 2 → Wed, day 3 → Fri (48h between sessions)
// ─────────────────────────────────────────────────────────────────────────────

const DAY_OFFSETS: Record<number, number> = { 1: 0, 2: 2, 3: 4 };

const TYPE_CONFIG: Record<string, { name: string; color: string }> = {
  threshold: { name: "Threshold", color: "#f59e0b" },
  vo2: { name: "VO2 Max", color: "#ef4444" },
  aerobic: { name: "Aerobic Base", color: "#16a34a" },
};

function buildExercise(session: EngineProgrammeSession): object {
  const { type, structure, target, notes, modalityOptions } = session;
  const modalities = modalityOptions.map(m => m.replace(/_/g, " ")).join(" / ");
  const repsMatch = structure.match(/^(\d+)\s*[×x]/);
  const sets = repsMatch ? parseInt(repsMatch[1], 10) : null;
  const repMatch = structure.match(/[×x]\s*(.+?)\s*(work|\/|$)/i);
  const reps = repMatch ? repMatch[1].trim() : null;
  return {
    id: `ex-${randomUUID().slice(0, 8)}`,
    name: TYPE_CONFIG[type]?.name ?? type,
    sets,
    reps,
    notes: `${structure} — ${target}`,
    rawText: structure,
    rpe: null,
    rest: null,
    tempo: null,
    weekProgression: [],
    clientComment: null,
  };
}

function generateEngineSessions(programme: EngineProgramme, startDateStr: string) {
  const weekStart = startOfWeek(parseISO(startDateStr), { weekStartsOn: 1 });
  const sessions: object[] = [];

  for (const week of programme.weeks) {
    const weekBase = addWeeks(weekStart, week.week - 1);
    for (const s of week.sessions) {
      const offset = DAY_OFFSETS[s.day] ?? (s.day - 1) * 2;
      const date = format(addDays(weekBase, offset), "yyyy-MM-dd");
      const config = TYPE_CONFIG[s.type] ?? { name: s.type, color: "#6366f1" };
      const guidanceLines = [
        `📍 ${s.structure}`,
        `🎯 ${s.target}`,
        `💬 ${s.notes}`,
        ``,
        `Modalities: ${s.modalityOptions.map(m => m.replace(/_/g, " ")).join(" · ")}`,
        ``,
        `Intensity guide: ${programme.intensityGuide[s.type]?.description ?? ""}`,
        ``,
        `Week ${week.week} theme: ${week.theme}`,
        ``,
        `Rules: ${programme.globalRules.slice(0, 4).join(" · ")}`,
      ].join("\n");

      sessions.push({
        id: `eng-${randomUUID().slice(0, 8)}`,
        date,
        name: config.name,
        color: config.color,
        source: "endurance_cycle",
        structure: s.structure,
        guidance: guidanceLines,
        exercises: [buildExercise(s)],
      });
    }
  }

  return sessions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/engine-builder/templates", (_req, res): void => {
  res.json({
    programmes: engineProgrammes.map(p => ({
      id: p.id,
      name: p.name,
      author: p.author,
      durationWeeks: p.durationWeeks,
      sessionsPerWeek: p.sessionsPerWeek,
      goal: p.goal,
      tags: p.tags,
    })),
  });
});

router.post("/engine-builder/insert", async (req, res): Promise<void> => {
  const { programmeId, clientId, startDate } = req.body as {
    programmeId: string;
    clientId: number;
    startDate: string;
  };

  const programme = engineProgrammes.find(p => p.id === programmeId);
  if (!programme) { res.status(404).json({ error: "Engine programme not found" }); return; }
  if (!clientId || !startDate) {
    res.status(400).json({ error: "clientId and startDate are required" });
    return;
  }

  const sessions = generateEngineSessions(programme, startDate);

  const [created] = await db
    .insert(programmesTable)
    .values({
      title: `${programme.name} — from ${format(parseISO(startDate), "d MMM yyyy")}`,
      clientId,
      sessions,
    })
    .returning();

  res.status(201).json({ programme: created, sessionCount: sessions.length });
});

// ── Exported for unified Brain search ──────────────────────────────────────
export function searchEngineSync(query: string, limit = 2) {
  const scored = engineProgrammes
    .map(p => ({ ...p, score: scoreEngine(p, query) }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.length > 0 ? scored : engineProgrammes.slice(0, limit).map(p => ({ ...p, score: 1 }));
}

export function generateEngineSessionsForBrain(programmeId: string, startDate: string) {
  const programme = engineProgrammes.find(p => p.id === programmeId);
  if (!programme) return null;
  return { programme, sessions: generateEngineSessions(programme, startDate) };
}

export default router;
