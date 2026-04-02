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
// Three buckets: wod | run | strength
// Sessions and blocks both live inside their bucket.
// ─────────────────────────────────────────────────────────────────────────────

type Bucket = "wod" | "run" | "strength" | "all";

// WOD = conditioning sessions/blocks (AMRAP, EMOM, ergs, engine, etc.)
const WOD_KW = [
  "wod", "workout", "amrap", "emom", "for time", "metcon", "conditioning",
  "circuit", "burpee", "wall ball", "dumbbell", "hyrox", "sled", "ski erg",
  "ergs", "rower", "mikko", "triangle", "engine", "vo2", "aerobic base",
  "threshold", "hinshaw", "cycle", "progressive", "6 week",
];

// Run = running sessions/blocks
const RUN_KW = [
  "run", "running", "tempo", "easy run", "jog", "pace", "km", "miles",
  "hills", "fartlek", "long run", "recovery run", "track", "intervals",
  "hyrox run", "run block", "run programme",
];

// Strength = weightlifting sessions/blocks (barbell, olympic, powerlifting)
const STRENGTH_KW = [
  "strength", "squat", "bench", "deadlift", "powerlifting", "barbell",
  "sbd", "smolov", "lift", "1rm", "heavy", "olympic", "weightlifting",
  "snatch", "clean", "jerk", "press", "pull",
];

function detectBucket(query: string): Bucket {
  const q = query.toLowerCase();
  const scores: Record<Bucket, number> = {
    wod:      WOD_KW.filter(k => q.includes(k)).length,
    run:      RUN_KW.filter(k => q.includes(k)).length,
    strength: STRENGTH_KW.filter(k => q.includes(k)).length,
    all:      0,
  };
  const max = Math.max(scores.wod, scores.run, scores.strength);
  if (max === 0) return "all";
  const winners = (["wod", "run", "strength"] as Bucket[]).filter(k => scores[k] === max);
  return winners.length === 1 ? winners[0] : "all";
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

function scoreText(query: string, ...fields: string[]): number {
  const q = query.toLowerCase();
  const corpus = fields.join(" ").toLowerCase();
  let score = 0;
  if (corpus.includes(q)) score += 20;
  q.split(/\s+/).filter(w => w.length > 2).forEach(word => {
    if (corpus.includes(word)) score += 8;
  });
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Olympic lifting detection for master programmes
// ─────────────────────────────────────────────────────────────────────────────

const OLYMPIC_KW = [
  "snatch", "clean", "jerk", "overhead squat", "ohs", "power clean",
  "power snatch", "hang clean", "hang snatch", "split jerk",
];

function inferProgrammeType(sessions: any[]): string {
  const corpus = sessions.flatMap((s: any) => {
    const exs: any[] = s.exercises ?? [];
    return [s.name ?? "", ...exs.map((e: any) => `${e.name ?? ""} ${e.rawText ?? ""}`)];
  }).join(" ").toLowerCase();
  const olympicHits = OLYMPIC_KW.filter(k => corpus.includes(k)).length;
  return olympicHits >= 2 ? "olympic weightlifting" : "strength";
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisers — all return bucket + source for insertion routing
// ─────────────────────────────────────────────────────────────────────────────

function normaliseWodSession(w: any) {
  return {
    id: w.id,
    name: w.name,
    bucket: "wod" as const,
    source: "wod_session" as const,
    isBlock: false,
    subtitle: `${w.formatLabel ?? w.format} · ${w.duration} min`,
    tags: w.tags ?? [],
    score: w.score ?? 1,
    raw: w,
  };
}

function normaliseRunSession(r: any) {
  const dur = r.duration ? `${r.duration} min` : r.distanceKm ? `${r.distanceKm} km` : "";
  return {
    id: r.id,
    name: r.name,
    bucket: "run" as const,
    source: "run_session" as const,
    isBlock: false,
    subtitle: `${r.type} · ${dur} · ${r.intensity}`,
    tags: r.tags ?? [],
    score: r.score ?? 1,
    raw: r,
  };
}

function normaliseWodBlock_Cycle(c: any) {
  const dMin = c.weeks ? Math.min(...c.weeks.map((w: any) => w.durationMin)) : 0;
  const dMax = c.weeks ? Math.max(...c.weeks.map((w: any) => w.durationMin)) : 0;
  return {
    id: c.id,
    name: c.name,
    bucket: "wod" as const,
    source: "wod_cycle" as const,
    isBlock: true,
    subtitle: `${c.weeks?.length ?? "?"}w · ${dMin}–${dMax} min · EMOM block`,
    tags: c.tags ?? [],
    totalWeeks: c.weeks?.length,
    durationRange: { min: dMin, max: dMax },
    weeks: c.weeks,
    score: c.score ?? 1,
    raw: c,
  };
}

function normaliseWodBlock_Engine(p: any) {
  return {
    id: p.id,
    name: p.name,
    bucket: "wod" as const,
    source: "wod_engine" as const,
    isBlock: true,
    subtitle: `${p.durationWeeks}w · ${p.sessionsPerWeek}×/wk · aerobic engine`,
    tags: p.tags ?? [],
    durationWeeks: p.durationWeeks,
    sessionsPerWeek: p.sessionsPerWeek,
    score: p.score ?? 1,
    raw: p,
  };
}

function normaliseStrengthBlock_Template(t: any) {
  return {
    id: t.id,
    name: t.name,
    bucket: "strength" as const,
    source: "strength_template" as const,
    isBlock: true,
    subtitle: `${t.durationWeeks}w · ${t.sessionsPerWeek}×/wk · ${t.liftFocus}`,
    tags: t.tags ?? [],
    durationWeeks: t.durationWeeks,
    score: t.score ?? 1,
    raw: t,
  };
}

function normaliseRunBlock(t: any, score: number) {
  const sessions: any[] = t.sessions ?? [];
  const totalWeeks = sessions.length > 0 ? Math.max(...sessions.map((s: any) => s.week ?? 0)) : 0;
  const sessionsPerWeek = totalWeeks > 0 ? Math.round(sessions.length / totalWeeks) : sessions.length;
  return {
    id: String(t.id),
    name: t.name,
    bucket: "run" as const,
    source: "run_block" as const,
    isBlock: true,
    subtitle: `${totalWeeks}w · ${sessionsPerWeek} sessions/wk · run block`,
    tags: t.tags ?? [],
    totalWeeks,
    sessionCount: sessions.length,
    score,
    raw: t,
  };
}

function normaliseStrengthBlock_Programme(p: any, score: number) {
  const sessions: any[] = p.sessions ?? [];
  const dates = sessions.map((s: any) => s.date).filter(Boolean).sort();
  const weeks = dates.length >= 2
    ? Math.ceil((new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime()) / (7 * 86400000)) + 1
    : Math.ceil(sessions.length / 5);
  const programmeType = inferProgrammeType(sessions);
  return {
    id: String(p.id),
    name: p.title,
    bucket: "strength" as const,
    source: "strength_programme" as const,
    isBlock: true,
    subtitle: `${weeks > 0 ? `${weeks}w` : ""} · ${sessions.length} sessions · ${programmeType}`,
    tags: [],
    totalWeeks: weeks,
    sessionCount: sessions.length,
    score,
    raw: p,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

router.post("/brain/search", async (req, res): Promise<void> => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  const bucket = detectBucket(query);
  const results: any[] = [];

  // ── WOD bucket ──────────────────────────────────────────────────
  if (bucket === "wod" || bucket === "all") {
    const limit = bucket === "all" ? 2 : 4;
    searchWodsSync(query, limit).forEach(w => results.push(normaliseWodSession(w)));
    searchCyclesSync(query, bucket === "all" ? 1 : 2).forEach(c => results.push(normaliseWodBlock_Cycle(c)));
    searchEngineSync(query, 1).forEach(p => results.push(normaliseWodBlock_Engine(p)));
  }

  // ── Run bucket ──────────────────────────────────────────────────
  if (bucket === "run" || bucket === "all") {
    const limit = bucket === "all" ? 2 : 4;
    searchRunsSync(query, limit).forEach(r => results.push(normaliseRunSession(r)));
  }

  // ── Strength bucket ──────────────────────────────────────────────
  if (bucket === "strength" || bucket === "all") {
    const limit = bucket === "all" ? 1 : 3;
    searchStrengthSync(query, limit).forEach(t => results.push(normaliseStrengthBlock_Template(t)));
  }

  // ── DB: run blocks (always searched) ────────────────────────────
  try {
    const dbTemplates = await db.select().from(enduranceRunTemplatesTable);
    const limit = bucket === "run" ? 3 : bucket === "all" ? 2 : 1;
    dbTemplates
      .map(t => ({ t, score: scoreText(query, t.name ?? "", t.description ?? "", (t.tags ?? []).join(" ")) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .forEach(({ t, score }) => results.push(normaliseRunBlock(t, score)));
  } catch { /* skip */ }

  // ── DB: master programmes / library blocks (always searched) ────
  try {
    const masterProgs = await db.select().from(programmesTable).where(isNull(programmesTable.clientId));
    const q = query.toLowerCase();
    masterProgs
      .map(p => {
        const sessions: any[] = p.sessions ?? [];
        const title = (p.title ?? "").toLowerCase();
        const sessionNames = sessions.map((s: any) => (s.name ?? "").toLowerCase()).join(" ");
        const exerciseCorpus = sessions.flatMap((s: any) =>
          (s.exercises ?? []).map((e: any) => `${e.name ?? ""} ${e.rawText ?? ""}`.toLowerCase())
        ).join(" ");
        const programmeType = inferProgrammeType(sessions);
        let score = 0;
        if (title.includes(q)) score += 30;
        q.split(/\s+/).filter((w: string) => w.length > 2).forEach((word: string) => {
          if (title.includes(word)) score += 15;
          if (sessionNames.includes(word)) score += 5;
          if (exerciseCorpus.includes(word)) score += 3;
          if (programmeType.includes(word)) score += 8;
        });
        return { p, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .forEach(({ p, score }) => results.push(normaliseStrengthBlock_Programme(p, score)));
  } catch { /* skip */ }

  results.sort((a, b) => b.score - a.score);
  res.json({ bucket, results: results.slice(0, 8) });
});

export default router;
