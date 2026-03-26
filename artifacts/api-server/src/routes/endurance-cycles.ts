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
    return {
      id: `ec-${randomUUID()}`,
      date: dateStr,
      name: `${cycle.name} — ${label} (${w.durationMin} min)`,
      source: "endurance_cycle",
      structure: `EMOM ${w.durationMin}: ${w.note}`,
      exercises: [
        {
          id: `ex-${randomUUID()}`,
          name: "EMOM on Ergs",
          sets: null,
          reps: null,
          rpe: null,
          notes: `${w.durationMin} min · ${w.note}`,
          rawText: `EMOM ${w.durationMin} min — ${w.note}`,
        },
      ],
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

export default router;
