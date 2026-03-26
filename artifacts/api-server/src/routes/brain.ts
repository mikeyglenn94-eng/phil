import { Router, type IRouter } from "express";
import { searchWodsSync } from "./wod-brain";
import { searchRunsSync } from "./run-brain";
import { searchCyclesSync } from "./endurance-cycles";
import { searchStrengthSync } from "./strength-blocks";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection — keyword-based routing across all four libraries
// ─────────────────────────────────────────────────────────────────────────────

type Intent = "wod" | "run" | "cycle" | "strength" | "all";

const STRENGTH_KW = ["strength", "squat", "bench", "deadlift", "powerlifting", "barbell", "sbd", "smolov", "lift", "1rm", "heavy", "olympic"];
const CYCLE_KW = ["cycle", "programme", "progressive", "weeks", "endurance cycle", "ergs", "mikko", "triangle", "emom ergs", "6 week"];
const RUN_KW = ["run", "running", "tempo", "easy run", "jog", "pace", "km", "miles", "aerobic", "threshold", "hills", "fartlek", "long run", "recovery run", "track", "intervals running"];
const WOD_KW = ["wod", "workout", "amrap", "emom", "for time", "metcon", "conditioning", "circuit", "burpee", "wall ball", "dumbbell", "hyrox", "sled", "ski erg"];

function detectIntent(query: string): Intent {
  const q = query.toLowerCase();
  const scores: Record<Intent, number> = {
    strength: STRENGTH_KW.filter(k => q.includes(k)).length,
    cycle:    CYCLE_KW.filter(k => q.includes(k)).length,
    run:      RUN_KW.filter(k => q.includes(k)).length,
    wod:      WOD_KW.filter(k => q.includes(k)).length,
    all:      0,
  };
  const max = Math.max(scores.strength, scores.cycle, scores.run, scores.wod);
  if (max === 0) return "all";
  const winners = (["strength", "cycle", "run", "wod"] as Intent[]).filter(k => scores[k] === max);
  return winners.length === 1 ? winners[0] : "all";
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalise results to a common shape for the frontend
// ─────────────────────────────────────────────────────────────────────────────

function normaliseWod(w: any) {
  return {
    id: w.id,
    name: w.name,
    category: "wod" as const,
    subtitle: `${w.formatLabel ?? w.format} · ${w.duration} min`,
    tags: w.tags ?? [],
    score: w.score ?? 1,
    raw: w,
  };
}

function normaliseRun(r: any) {
  const dur = r.duration ? `${r.duration} min` : r.distanceKm ? `${r.distanceKm} km` : "";
  return {
    id: r.id,
    name: r.name,
    category: "run" as const,
    subtitle: `${r.type} · ${dur} · ${r.intensity}`,
    tags: r.tags ?? [],
    score: r.score ?? 1,
    raw: r,
  };
}

function normaliseCycle(c: any) {
  const dMin = c.weeks ? Math.min(...c.weeks.map((w: any) => w.durationMin)) : 0;
  const dMax = c.weeks ? Math.max(...c.weeks.map((w: any) => w.durationMin)) : 0;
  return {
    id: c.id,
    name: c.name,
    category: "cycle" as const,
    subtitle: `${c.weeks?.length ?? "?"} weeks · ${dMin}–${dMax} min · progressive`,
    tags: c.tags ?? [],
    totalWeeks: c.weeks?.length,
    durationRange: { min: dMin, max: dMax },
    weeks: c.weeks,
    score: c.score ?? 1,
    raw: c,
  };
}

function normaliseStrength(t: any) {
  return {
    id: t.id,
    name: t.name,
    category: "strength" as const,
    subtitle: `${t.durationWeeks} weeks · ${t.sessionsPerWeek}×/wk · ${t.liftFocus}`,
    tags: t.tags ?? [],
    durationWeeks: t.durationWeeks,
    score: t.score ?? 1,
    raw: t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

router.post("/brain/search", (req, res): void => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  const intent = detectIntent(query);
  const results: any[] = [];

  if (intent === "wod" || intent === "all") {
    searchWodsSync(query, intent === "all" ? 2 : 4).forEach(w => results.push(normaliseWod(w)));
  }
  if (intent === "run" || intent === "all") {
    searchRunsSync(query, intent === "all" ? 2 : 4).forEach(r => results.push(normaliseRun(r)));
  }
  if (intent === "cycle" || intent === "all") {
    searchCyclesSync(query, intent === "all" ? 2 : 3).forEach(c => results.push(normaliseCycle(c)));
  }
  if (intent === "strength" || intent === "all") {
    searchStrengthSync(query, intent === "all" ? 1 : 2).forEach(t => results.push(normaliseStrength(t)));
  }

  // Sort by score descending when mixing categories
  if (intent === "all") results.sort((a, b) => b.score - a.score);

  res.json({ intent, results: results.slice(0, 8) });
});

export default router;
