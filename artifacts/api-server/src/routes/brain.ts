import { Router, type IRouter } from "express";
import { db, enduranceRunTemplatesTable, programmesTable } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { searchWodsSync } from "./wod-brain";
import { searchRunsSync } from "./run-brain";
import { searchCyclesSync } from "./endurance-cycles";
import { searchStrengthSync } from "./strength-blocks";
import { searchEngineSync } from "./engine-builder";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection — keyword-based routing across all libraries
// ─────────────────────────────────────────────────────────────────────────────

type Intent = "wod" | "run" | "cycle" | "strength" | "all";

const STRENGTH_KW = ["strength", "squat", "bench", "deadlift", "powerlifting", "barbell", "sbd", "smolov", "lift", "1rm", "heavy", "olympic"];
const CYCLE_KW = ["cycle", "programme", "progressive", "weeks", "endurance cycle", "ergs", "mikko", "triangle", "emom ergs", "6 week", "engine", "vo2", "aerobic base", "threshold", "hinshaw"];
// hyrox appears in both RUN and WOD to trigger "all" intent — catches both WODs and run blocks
const RUN_KW = ["run", "running", "tempo", "easy run", "jog", "pace", "km", "miles", "aerobic", "threshold", "hills", "fartlek", "long run", "recovery run", "track", "intervals running", "hyrox", "run block", "run programme"];
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
// Score a DB endurance_run_template against a query
// ─────────────────────────────────────────────────────────────────────────────

function scoreRunTemplate(template: any, query: string): number {
  const q = query.toLowerCase();
  const name = (template.name ?? "").toLowerCase();
  const desc = (template.description ?? "").toLowerCase();
  const tags: string[] = (template.tags ?? []).map((t: string) => t.toLowerCase());

  let score = 0;

  // Exact phrase in name — highest weight
  if (name.includes(q)) score += 20;

  // Individual meaningful words
  const words = q.split(/\s+/).filter(w => w.length > 2);
  words.forEach(word => {
    if (name.includes(word)) score += 10;
    if (desc.includes(word)) score += 4;
    if (tags.some(t => t.includes(word))) score += 7;
  });

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisers
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

function normaliseEngine(p: any) {
  return {
    id: p.id,
    name: p.name,
    category: "engine" as const,
    subtitle: `${p.durationWeeks} weeks · ${p.sessionsPerWeek}×/wk · threshold / VO2 / aerobic`,
    tags: p.tags ?? [],
    durationWeeks: p.durationWeeks,
    sessionsPerWeek: p.sessionsPerWeek,
    goal: p.goal,
    score: p.score ?? 1,
    raw: p,
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

function scoreMasterProgramme(prog: any, query: string): number {
  const q = query.toLowerCase();
  const title = (prog.title ?? "").toLowerCase();
  const sessions: any[] = prog.sessions ?? [];
  const sessionNames = sessions.map((s: any) => (s.name ?? "").toLowerCase()).join(" ");

  let score = 0;
  if (title.includes(q)) score += 30;
  const words = q.split(/\s+/).filter((w: string) => w.length > 2);
  words.forEach((word: string) => {
    if (title.includes(word)) score += 15;
    if (sessionNames.includes(word)) score += 3;
  });
  return score;
}

function normaliseMasterProgramme(p: any, score: number) {
  const sessions: any[] = p.sessions ?? [];
  const dates = sessions.map((s: any) => s.date).filter(Boolean).sort();
  const weeks = dates.length >= 2
    ? Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (7 * 86400000)) + 1
    : Math.ceil(sessions.length / 5);
  return {
    id: String(p.id),
    name: p.title,
    category: "master_programme" as const,
    subtitle: `${weeks > 0 ? `${weeks}-week` : ""} strength block · ${sessions.length} sessions`,
    tags: [],
    totalWeeks: weeks,
    sessionCount: sessions.length,
    score,
    raw: p,
  };
}

function normaliseRunTemplate(t: any, score: number) {
  const sessions: any[] = t.sessions ?? [];
  const totalWeeks = sessions.length > 0 ? Math.max(...sessions.map((s: any) => s.week)) : 0;
  const sessionsPerWeek = totalWeeks > 0 ? Math.round(sessions.length / totalWeeks) : sessions.length;
  return {
    id: String(t.id),
    name: t.name,
    category: "run_template" as const,
    subtitle: `${totalWeeks}-week run block · ${sessionsPerWeek} sessions/wk`,
    tags: t.tags ?? [],
    totalWeeks,
    sessionCount: sessions.length,
    score,
    raw: t,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

router.post("/brain/search", async (req, res): Promise<void> => {
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
    searchEngineSync(query, intent === "all" ? 1 : 2).forEach(p => results.push(normaliseEngine(p)));
  }
  if (intent === "strength" || intent === "all") {
    searchStrengthSync(query, intent === "all" ? 1 : 2).forEach(t => results.push(normaliseStrength(t)));
  }

  // Always search endurance run templates from DB (coach-uploaded run programmes)
  try {
    const dbTemplates = await db.select().from(enduranceRunTemplatesTable);
    const runTemplateLimit = intent === "all" ? 2 : intent === "run" ? 3 : 1;
    dbTemplates
      .map(t => ({ t, score: scoreRunTemplate(t, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, runTemplateLimit)
      .forEach(({ t, score }) => results.push(normaliseRunTemplate(t, score)));
  } catch {
    // DB unavailable — skip silently
  }

  // Always search master programmes (library/coach programmes with no clientId)
  try {
    const masterProgs = await db.select().from(programmesTable).where(isNull(programmesTable.clientId));
    masterProgs
      .map(p => ({ p, score: scoreMasterProgramme(p, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .forEach(({ p, score }) => results.push(normaliseMasterProgramme(p, score)));
  } catch {
    // DB unavailable — skip silently
  }

  // Sort by score descending when mixing categories
  results.sort((a, b) => b.score - a.score);

  res.json({ intent, results: results.slice(0, 8) });
});

export default router;
