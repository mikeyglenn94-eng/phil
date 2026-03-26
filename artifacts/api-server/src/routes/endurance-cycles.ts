import { Router, type IRouter } from "express";
import { db, programmesTable } from "@workspace/db";
import { addWeeks, format, parseISO } from "date-fns";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CycleWeek {
  week: number;
  durationMin: number;
  note: string;
}

interface EnduranceCycle {
  id: string;
  name: string;
  progressionType: string;
  equipment: string[];
  tags: string[];
  description: string;
  guidance?: string;
  intervals: string[];
  weeks: CycleWeek[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Data  (only coach-uploaded cycles go here — never invented)
// ─────────────────────────────────────────────────────────────────────────────

const cycles: EnduranceCycle[] = [
  {
    id: "engine-emom-ergs-6-week",
    name: "Mikko's Triangle Cycle",
    progressionType: "density_duration",
    equipment: ["rower", "ski erg", "bike"],
    tags: ["emom", "ergs", "engine", "endurance", "6-week"],
    description:
      "6-week EMOM progression on the ergs. Duration builds from 24 min up to 39 min in week 5 (target session), then a deload week at 30 min. Use any erg combination — rower, ski, bike. Keep output consistent each round.",
    guidance:
      "Set a target number of calories and complete that number of calories each minute through the entire workout. A common target for Rx-level athletes is 20 calories per minute for each station.\n\nScore is the total number of calories completed (for example, if athlete does 20 calories per minute, they will complete 600 total calories for the entire workout).\n\nScaling: Reduce the number of calories per minute to a number which will be challenging to hold each minute for the entire workout.",
    intervals: [
      "1 minute Row",
      "1 minute SkiErg",
      "1 minute Assault Bike",
      "1 minute Rest",
    ],
    weeks: [
      { week: 1, durationMin: 24, note: "6 rounds" },
      { week: 2, durationMin: 28, note: "7 rounds" },
      { week: 3, durationMin: 32, note: "8 rounds" },
      { week: 4, durationMin: 36, note: "9 rounds" },
      { week: 5, durationMin: 39, note: "target session" },
      { week: 6, durationMin: 30, note: "deload" },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

function scoreCycle(c: EnduranceCycle, query: string): number {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  let score = 0;
  const corpus = [
    c.name, c.progressionType, c.description,
    ...c.tags, ...c.equipment,
  ].join(" ").toLowerCase();
  for (const token of tokens) {
    if (corpus.includes(token)) score += 2;
  }
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session generation — one session per week, anchored to startDate weekday
// ─────────────────────────────────────────────────────────────────────────────

function generateCycleSessions(cycle: EnduranceCycle, startDate: string) {
  const base = parseISO(startDate);
  return cycle.weeks.map((w) => {
    const sessionDate = addWeeks(base, w.week - 1);
    const dateStr = format(sessionDate, "yyyy-MM-dd");
    const isDeload = w.note === "deload";
    const isTarget = w.note === "target session";
    const label = isDeload
      ? "Deload"
      : isTarget
        ? "Target Session"
        : `Week ${w.week}`;
    const intervals = cycle.intervals ?? [];
    const exercises = intervals.length > 0
      ? intervals.map((interval) => ({
          id: `ex-${randomUUID()}`,
          name: interval,
          sets: null,
          reps: null,
          rpe: null,
          notes: null,
          rawText: interval,
        }))
      : [
          {
            id: `ex-${randomUUID()}`,
            name: "EMOM on Ergs",
            sets: null,
            reps: null,
            rpe: null,
            notes: `${w.durationMin} min · ${w.note}`,
            rawText: `EMOM ${w.durationMin} min — ${w.note}`,
          },
        ];
    return {
      id: `ec-${randomUUID()}`,
      date: dateStr,
      name: `${cycle.name} — ${label} (${w.durationMin} min)`,
      source: "endurance_cycle",
      structure: `EMOM ${w.durationMin} min · ${w.note}`,
      ...(cycle.guidance ? { guidance: cycle.guidance } : {}),
      exercises,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get("/endurance-cycles/templates", (_req, res): void => {
  res.json({
    cycles: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      progressionType: c.progressionType,
      equipment: c.equipment,
      tags: c.tags,
      description: c.description,
      totalWeeks: c.weeks.length,
      durationRange: {
        min: Math.min(...c.weeks.map((w) => w.durationMin)),
        max: Math.max(...c.weeks.map((w) => w.durationMin)),
      },
    })),
  });
});

router.get("/endurance-cycles/templates/:id", (req, res): void => {
  const cycle = cycles.find((c) => c.id === req.params.id);
  if (!cycle) { res.status(404).json({ error: "Cycle not found" }); return; }
  res.json({ cycle });
});

router.post("/endurance-cycles/search", (req, res): void => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  const results = cycles
    .map((c) => ({ ...c, score: scoreCycle(c, query) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const final =
    results.length > 0
      ? results
      : cycles.map((c) => ({ ...c, score: 1 }));

  res.json({
    results: final.map((c) => ({
      id: c.id,
      name: c.name,
      progressionType: c.progressionType,
      equipment: c.equipment,
      tags: c.tags,
      description: c.description,
      totalWeeks: c.weeks.length,
      weeks: c.weeks,
      durationRange: {
        min: Math.min(...c.weeks.map((w) => w.durationMin)),
        max: Math.max(...c.weeks.map((w) => w.durationMin)),
      },
      score: c.score,
    })),
  });
});

router.post("/endurance-cycles/insert", async (req, res): Promise<void> => {
  const { cycleId, clientId, startDate } = req.body as {
    cycleId: string;
    clientId: number;
    startDate: string;
  };

  const cycle = cycles.find((c) => c.id === cycleId);
  if (!cycle) { res.status(404).json({ error: "Cycle not found" }); return; }
  if (!clientId || !startDate) {
    res.status(400).json({ error: "clientId and startDate are required" });
    return;
  }

  const sessions = generateCycleSessions(cycle, startDate);

  const [programme] = await db
    .insert(programmesTable)
    .values({
      title: `${cycle.name} — from ${format(parseISO(startDate), "d MMM yyyy")}`,
      clientId,
      sessions,
    })
    .returning();

  res.status(201).json({ programme, sessionCount: sessions.length });
});

// ── Exported for unified Brain search ──────────────────────────────────────
export function searchCyclesSync(query: string, limit = 3) {
  const scored = cycles
    .map(c => ({ ...c, score: scoreCycle(c, query) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return (scored.length > 0 ? scored : cycles.slice(0, limit).map(c => ({ ...c, score: 1 })));
}

export default router;
