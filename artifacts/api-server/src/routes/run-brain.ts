import { Router, type IRouter } from "express";
import { db, runLibraryTable } from "@workspace/db";

interface RunWorkout {
  id: string;
  name: string;
  type: string;
  duration: number | null;
  distanceKm: number | null;
  structure: string;
  tags: string[];
  terrain: string[];
  intensity: string;
}

const runWorkouts: RunWorkout[] = [
  { id: "run_001", name: "30 Min Recovery Run", type: "easy", duration: 30, distanceKm: null, structure: "30 minutes easy continuous recovery running", tags: ["recovery", "aerobic", "continuous"], terrain: ["flat"], intensity: "easy" },
  { id: "run_002", name: "45 Min Recovery Run", type: "easy", duration: 45, distanceKm: null, structure: "45 minutes easy continuous recovery running", tags: ["recovery", "aerobic", "continuous"], terrain: ["flat"], intensity: "easy" },
  { id: "run_003", name: "60 Min Recovery Run", type: "easy", duration: 60, distanceKm: null, structure: "60 minutes easy continuous recovery running", tags: ["recovery", "aerobic", "continuous", "long"], terrain: ["flat"], intensity: "easy" },
  { id: "run_004", name: "5 km Recovery Run", type: "easy", duration: null, distanceKm: 5, structure: "5 km easy continuous recovery running", tags: ["recovery", "distance", "aerobic"], terrain: ["flat"], intensity: "easy" },
  { id: "run_005", name: "8 km Recovery Run", type: "easy", duration: null, distanceKm: 8, structure: "8 km easy continuous recovery running", tags: ["recovery", "distance", "aerobic"], terrain: ["flat"], intensity: "easy" },
  { id: "run_006", name: "10 km Recovery Run", type: "easy", duration: null, distanceKm: 10, structure: "10 km easy continuous recovery running", tags: ["recovery", "distance", "aerobic", "long"], terrain: ["flat"], intensity: "easy" },
  { id: "run_007", name: "6 x 400 m Intervals", type: "intervals", duration: null, distanceKm: null, structure: "6 x 400 m hard with 200 m easy jog recovery", tags: ["intervals", "speed", "track"], terrain: ["flat", "track"], intensity: "hard" },
  { id: "run_008", name: "8 x 400 m Intervals", type: "intervals", duration: null, distanceKm: null, structure: "8 x 400 m hard with 200 m easy jog recovery", tags: ["intervals", "speed", "track"], terrain: ["flat", "track"], intensity: "hard" },
  { id: "run_009", name: "5 x 800 m Intervals", type: "intervals", duration: null, distanceKm: null, structure: "5 x 800 m at 5k effort with 2 minute jog recovery", tags: ["intervals", "speed", "track"], terrain: ["flat", "track"], intensity: "hard" },
  { id: "run_010", name: "4 x 1 km Intervals", type: "intervals", duration: null, distanceKm: null, structure: "4 x 1 km at 10k effort with 2 minute easy jog recovery", tags: ["intervals", "speed", "threshold"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_011", name: "6 x 1 km Intervals", type: "intervals", duration: null, distanceKm: null, structure: "6 x 1 km at 10k effort with 90 second jog recovery", tags: ["intervals", "speed", "threshold"], terrain: ["flat"], intensity: "hard" },
  { id: "run_012", name: "10 x 1 Min On Off", type: "intervals", duration: 20, distanceKm: null, structure: "10 x 1 minute hard, 1 minute easy", tags: ["intervals", "speed", "time_based"], terrain: ["flat"], intensity: "hard" },
  { id: "run_013", name: "12 x 1 Min On Off", type: "intervals", duration: 24, distanceKm: null, structure: "12 x 1 minute hard, 1 minute easy", tags: ["intervals", "speed", "time_based"], terrain: ["flat"], intensity: "hard" },
  { id: "run_014", name: "8 x 2 Min On Off", type: "intervals", duration: 32, distanceKm: null, structure: "8 x 2 minutes at hard controlled effort, 2 minutes easy", tags: ["intervals", "speed", "time_based"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_015", name: "6 x 3 Min On Off", type: "intervals", duration: 36, distanceKm: null, structure: "6 x 3 minutes at 5k to 10k effort, 2 minutes easy jog", tags: ["intervals", "speed", "time_based"], terrain: ["flat"], intensity: "hard" },
  { id: "run_016", name: "20 Min Threshold", type: "threshold", duration: 20, distanceKm: null, structure: "10 min easy, 20 min threshold, 10 min easy", tags: ["threshold", "tempo", "continuous"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_017", name: "25 Min Threshold", type: "threshold", duration: 25, distanceKm: null, structure: "10 min easy, 25 min threshold, 10 min easy", tags: ["threshold", "tempo", "continuous"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_018", name: "2 x 10 Min Threshold", type: "threshold", duration: 20, distanceKm: null, structure: "2 x 10 minutes threshold with 3 minutes easy jog between reps", tags: ["threshold", "tempo", "broken"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_019", name: "3 x 8 Min Threshold", type: "threshold", duration: 24, distanceKm: null, structure: "3 x 8 minutes threshold with 2 minutes easy jog recovery", tags: ["threshold", "tempo", "broken"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_020", name: "4 x 6 Min Threshold", type: "threshold", duration: 24, distanceKm: null, structure: "4 x 6 minutes threshold with 90 second easy jog recovery", tags: ["threshold", "tempo", "broken"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_021", name: "Hill Sprints 10 x 20 Sec", type: "hills", duration: null, distanceKm: null, structure: "10 x 20 second steep hill sprints with walk back recovery", tags: ["hills", "power", "speed"], terrain: ["hill"], intensity: "hard" },
  { id: "run_022", name: "Hill Reps 8 x 45 Sec", type: "hills", duration: null, distanceKm: null, structure: "8 x 45 second uphill reps with jog down recovery", tags: ["hills", "strength", "speed"], terrain: ["hill"], intensity: "hard" },
  { id: "run_023", name: "Hill Repeats 6 x 2 Min", type: "hills", duration: null, distanceKm: null, structure: "6 x 2 minutes uphill at strong effort with easy jog down", tags: ["hills", "strength", "threshold"], terrain: ["hill"], intensity: "hard" },
  { id: "run_024", name: "Progression 30", type: "progression", duration: 30, distanceKm: null, structure: "30 minutes continuous, starting easy and building every 10 minutes", tags: ["progression", "negative_split", "continuous"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_025", name: "Progression 45", type: "progression", duration: 45, distanceKm: null, structure: "45 minutes continuous, last 15 minutes at steady to strong effort", tags: ["progression", "negative_split", "continuous"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_026", name: "Negative Split 10 km", type: "progression", duration: null, distanceKm: 10, structure: "10 km with second half faster than the first half", tags: ["progression", "negative_split", "distance"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_027", name: "Steady 40", type: "steady", duration: 40, distanceKm: null, structure: "40 minutes steady running, comfortably harder than easy", tags: ["steady", "aerobic", "continuous"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_028", name: "Steady 60", type: "steady", duration: 60, distanceKm: null, structure: "60 minutes steady aerobic running", tags: ["steady", "aerobic", "continuous", "long"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_029", name: "Long Run 75", type: "long_run", duration: 75, distanceKm: null, structure: "75 minutes easy continuous running", tags: ["long_run", "easy", "aerobic", "long"], terrain: ["flat"], intensity: "easy" },
  { id: "run_030", name: "Long Run 90", type: "long_run", duration: 90, distanceKm: null, structure: "90 minutes easy continuous running", tags: ["long_run", "easy", "aerobic", "long"], terrain: ["flat"], intensity: "easy" },
  { id: "run_031", name: "Long Run 105", type: "long_run", duration: 105, distanceKm: null, structure: "105 minutes easy continuous running", tags: ["long_run", "easy", "aerobic", "long"], terrain: ["flat"], intensity: "easy" },
  { id: "run_032", name: "Long Run with Fast Finish", type: "long_run", duration: 90, distanceKm: null, structure: "70 minutes easy then 20 minutes steady strong finish", tags: ["long_run", "progression", "fast_finish"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_033", name: "Fartlek 30", type: "fartlek", duration: 30, distanceKm: null, structure: "10 min easy then 10 x 1 min on 1 min off", tags: ["fartlek", "speed", "time_based"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_034", name: "Fartlek 40", type: "fartlek", duration: 40, distanceKm: null, structure: "10 min easy then 6 x 2 min on 2 min off then easy to finish", tags: ["fartlek", "speed", "time_based"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_035", name: "Pyramid Session", type: "intervals", duration: null, distanceKm: null, structure: "1 min hard, 2 min hard, 3 min hard, 4 min hard, 3 min hard, 2 min hard, 1 min hard with equal easy recoveries", tags: ["intervals", "pyramid", "speed"], terrain: ["flat"], intensity: "hard" },
  { id: "run_036", name: "Track 200s", type: "intervals", duration: null, distanceKm: null, structure: "12 x 200 m fast with 200 m walk or jog recovery", tags: ["intervals", "track", "speed"], terrain: ["track", "flat"], intensity: "hard" },
  { id: "run_037", name: "Track 600s", type: "intervals", duration: null, distanceKm: null, structure: "6 x 600 m at 3k to 5k effort with 200 m jog recovery", tags: ["intervals", "track", "speed"], terrain: ["track", "flat"], intensity: "hard" },
  { id: "run_038", name: "Marathon Tempo Blocks", type: "tempo", duration: null, distanceKm: null, structure: "3 x 15 minutes at marathon effort with 5 minutes easy between", tags: ["tempo", "steady", "broken"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_039", name: "20 Min Steady Hills", type: "hills", duration: 20, distanceKm: null, structure: "20 minutes continuous rolling hills at steady effort", tags: ["hills", "steady", "continuous"], terrain: ["hill", "rolling"], intensity: "moderate" },
  { id: "run_040", name: "Recovery Run with Strides", type: "easy", duration: 40, distanceKm: null, structure: "40 minutes easy recovery running plus 6 x 20 second strides with full walk recovery", tags: ["recovery", "strides", "aerobic"], terrain: ["flat"], intensity: "easy" },
  { id: "run_041", name: "Recovery 25", type: "recovery", duration: 25, distanceKm: null, structure: "25 minutes very easy recovery run", tags: ["recovery", "easy", "continuous"], terrain: ["flat"], intensity: "easy" },
  { id: "run_042", name: "Recovery 35", type: "recovery", duration: 35, distanceKm: null, structure: "35 minutes very easy recovery run", tags: ["recovery", "easy", "continuous"], terrain: ["flat"], intensity: "easy" },
  { id: "run_043", name: "Tempo 5 km", type: "tempo", duration: null, distanceKm: 5, structure: "5 km continuous at comfortably hard tempo effort", tags: ["tempo", "distance", "continuous"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_044", name: "Tempo 8 km", type: "tempo", duration: null, distanceKm: 8, structure: "8 km continuous at steady strong tempo effort", tags: ["tempo", "distance", "continuous"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_045", name: "Cruise Intervals", type: "threshold", duration: null, distanceKm: null, structure: "5 x 1 mile at threshold effort with 1 minute easy jog between", tags: ["threshold", "tempo", "intervals"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_046", name: "3-2-1 Threshold Set", type: "threshold", duration: null, distanceKm: null, structure: "3 km threshold, 2 km threshold, 1 km threshold with 2 minutes easy between", tags: ["threshold", "distance", "broken"], terrain: ["flat"], intensity: "moderate_hard" },
  { id: "run_047", name: "Rolling Hill Long Run", type: "long_run", duration: 80, distanceKm: null, structure: "80 minutes easy on rolling terrain", tags: ["long_run", "easy", "hills"], terrain: ["rolling", "hill"], intensity: "easy" },
  { id: "run_048", name: "Hill Fartlek", type: "hills", duration: 35, distanceKm: null, structure: "35 minutes with every uphill segment run strong and flats easy", tags: ["hills", "fartlek", "strength"], terrain: ["hill", "rolling"], intensity: "moderate_hard" },
  { id: "run_049", name: "60 Min Negative Split", type: "progression", duration: 60, distanceKm: null, structure: "30 minutes easy then 20 minutes steady then 10 minutes strong", tags: ["progression", "negative_split", "continuous"], terrain: ["flat"], intensity: "moderate" },
  { id: "run_050", name: "90 Min Easy to Steady", type: "long_run", duration: 90, distanceKm: null, structure: "60 minutes easy then 30 minutes steady", tags: ["long_run", "progression", "fast_finish"], terrain: ["flat"], intensity: "moderate" },
];

const TYPE_KEYWORDS = [
  "easy", "recovery", "intervals", "threshold", "tempo", "steady",
  "hills", "hill", "progression", "negative split", "negative splits",
  "fartlek", "long run", "track",
];

const INTENSITY_LABELS: Record<string, string> = {
  easy: "Easy",
  moderate: "Moderate",
  moderate_hard: "Moderate / Hard",
  hard: "Hard",
};

function parseRunInput(input: string) {
  const text = input.toLowerCase();
  const include: string[] = [];
  const exclude: string[] = [];

  TYPE_KEYWORDS.forEach(keyword => {
    if (text.includes(`no ${keyword}`)) exclude.push(keyword);
    else if (text.includes(keyword)) include.push(keyword);
  });

  let duration: number | null = null;
  let distanceKm: number | null = null;

  const minMatch = text.match(/(\d+)\s*(min|mins|minute|minutes)/);
  if (minMatch) duration = parseInt(minMatch[1], 10);

  const kmMatch = text.match(/(\d+)\s*(k|km)/);
  if (kmMatch) distanceKm = parseInt(kmMatch[1], 10);

  return { include, exclude, duration, distanceKm };
}

function scoreRunWorkout(workout: RunWorkout, filters: ReturnType<typeof parseRunInput>): number {
  let score = 0;

  for (const ex of filters.exclude) {
    if (
      workout.type.includes(ex) ||
      workout.tags.some(tag => tag.includes(ex)) ||
      workout.terrain.some(t => t.includes(ex))
    ) return -1;
  }

  filters.include.forEach(term => {
    if (workout.type.includes(term)) score += 10;
    if (workout.tags.some(tag => tag.includes(term))) score += 7;
    if (workout.terrain.some(t => t.includes(term))) score += 5;

    if (term === "hill" && workout.terrain.includes("hill")) score += 6;
    if ((term === "negative split" || term === "negative splits") && workout.tags.includes("negative_split")) score += 8;
    if (term === "long run" && workout.type === "long_run") score += 8;
    if (term === "track" && workout.terrain.includes("track")) score += 8;
  });

  if (filters.duration && workout.duration) {
    const diff = Math.abs(workout.duration - filters.duration);
    if (diff <= 5) score += 2;
    else if (diff <= 10) score += 1;
  }

  if (filters.distanceKm && workout.distanceKm) {
    const diff = Math.abs(workout.distanceKm - filters.distanceKm);
    if (diff <= 1) score += 2;
    else if (diff <= 2) score += 1;
  }

  return score;
}

const router: IRouter = Router();

router.get("/run-brain/workouts", async (_req, res): Promise<void> => {
  try {
    const custom = await db.select().from(runLibraryTable).orderBy(runLibraryTable.createdAt);
    const customMapped = custom.map(w => ({
      ...w,
      id: `custom_run_${w.id}`,
      intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity,
      source: "custom" as const,
    }));
    const builtin = runWorkouts.map(w => ({ ...w, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity, source: "builtin" as const }));
    res.json({ workouts: [...builtin, ...customMapped] });
  } catch (err) {
    res.status(500).json({ error: "Failed to load workouts" });
  }
});

router.post("/run-brain/workouts", async (req, res): Promise<void> => {
  const { name, type, duration, distanceKm, structure, tags, terrain, intensity } = req.body;
  if (!name?.trim() || !type || !structure || !intensity) {
    res.status(400).json({ error: "name, type, structure and intensity are required" });
    return;
  }
  try {
    const [row] = await db.insert(runLibraryTable).values({
      name: name.trim(), type, duration: duration ? Number(duration) : null,
      distanceKm: distanceKm ? Number(distanceKm) : null,
      structure: structure.trim(), tags: tags ?? [], terrain: terrain ?? [], intensity,
    }).returning();
    res.json({ workout: { ...row, id: `custom_run_${row.id}`, intensityLabel: INTENSITY_LABELS[row.intensity] ?? row.intensity, source: "custom" } });
  } catch (err) {
    res.status(500).json({ error: "Failed to save workout" });
  }
});

router.post("/run-brain/search", async (req, res): Promise<void> => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  let custom: any[] = [];
  try {
    const rows = await db.select().from(runLibraryTable);
    custom = rows.map(w => ({ ...w, id: `custom_run_${w.id}`, source: "custom" }));
  } catch {}

  const all = [...runWorkouts, ...custom];
  const filters = parseRunInput(query);

  const results = all
    .map(w => ({
      ...w,
      score: scoreRunWorkout(w as RunWorkout, filters),
      intensityLabel: INTENSITY_LABELS[(w as RunWorkout).intensity] ?? (w as RunWorkout).intensity,
    }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  res.json({ results, filters });
});

// ── Exported for unified Brain search ──────────────────────────────────────
export function searchRunsSync(query: string, limit = 3) {
  const filters = parseRunInput(query);
  const scored = runWorkouts
    .map(w => ({ ...w, score: scoreRunWorkout(w, filters), intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return (scored.length > 0 ? scored : runWorkouts.slice(0, limit).map(w => ({ ...w, score: 1, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity })));
}

// ── Run session prompt doctrine ─────────────────────────────────────────────
// Interpolated into parse.ts programme-generation prompt. Single source of
// truth for how Phil generates hard run sessions: pace-driven (5k/10k
// anchored, never RPE), variety-first intervals, and the 10 canonical
// structures. Update here, it propagates to parse.ts on next request.
export const RUN_SESSION_DOCTRINE = `
## Run sessions — pace-driven generation rules

**Runs are pace-driven, not RPE-driven.** Do NOT output an rpe value on run session exercises — leave rpe null on every run exercise. Paces anchor to the athlete's 5k and 10k times:
- **5k pace** anchors VO2 work (short-to-mid intervals)
- **10k pace** anchors threshold work (cruise intervals, tempo)
- **10k + 15–30s/km** anchors long steady and marathon tempo
- **5k − 5 to 10s/km** anchors speed endurance
- **Strides and hill sprints** are effort-cued ("strong", "hard controlled", "95%") — the one exception to the pace-driven rule.

**If the athlete's 5k or 10k time is not present in the brief or context when a run session is requested, do NOT guess paces and do NOT substitute RPE.** Ask exactly one inline question before generating any run session:

> "Before I lock the run sessions in — what is your current 5k or 10k time? A recent race or a rough time-trial estimate is fine. I will anchor every run pace off it."

One question, then proceed. Non-run sessions (strength, WOD, cycling, swimming) can still be generated in the same turn; only run sessions wait for the pace answer.

## The 10 canonical hard-running structures

These are the default vocabulary for every hard running session. Pick from this list first. Scale each by rep count, distance, and intensity based on athlete level, session goal, and weekly context. Only invent outside this library when there is a specific justification (race-specific long intervals for marathon work, a named test set, niche goals, or explicit athlete request).

**Variety-first principle:** when two structures deliver the same total work and pace target, prefer the mixed or varied structure over flat repetitive sets. "1k / 800 / 800 / 600 / 400 / 1k" beats "5×1k". Flat sets are acceptable only for race simulation, a named test set, or pure beginners — state the reason when you use them.

1. **Pyramid intervals** — ascending-descending distances at 5k–10k pace. Example: 400 / 600 / 800 / 1000 / 800 / 600 / 400 with equal jog recovery, 5k pace on the short rungs, 10k pace on the long rungs. Scales by number of rungs and top distance.

2. **Reverse pyramid** — inverted pyramid, long rung first. Example: 1000 / 800 / 600 / 400 / 600 / 800 / 1000. Same pace rules as the pyramid. Use when front-loading quality is the goal.

3. **Mixed-distance intervals** — non-symmetric distance mix at 5k–10k pace. Example: 1k / 800 / 800 / 600 / 400 / 1k with 2 min jog recovery. Scales by rep count and distance mix. Default shape when no other structure is specifically justified.

4. **Over-unders** — continuous blocks alternating just-under LT and just-over LT pace. Example: 5–8 blocks of [2 min at 10k + 5s/km / 1 min at 10k − 5s/km], no rest between blocks. Scales by block length and total block count.

5. **Long run with hot spot** — steady long run with a quality block embedded. Example: 60 min steady with 15 min at 10k pace starting at minute 30. Scales by total duration, hot-spot length, and placement (middle or finish). Hot-spot pace is 10k or marathon tempo, never faster.

6. **Cruise intervals (threshold)** — 4–6 × 1 mile (or 1500m / 2000m) at 10k pace, 60–90s jog recovery. Scales by rep distance and rep count. Primary vehicle for threshold development.

7. **VO2 classics** — 5 × 1000m or 4 × 1200m at 5k pace, equal or near-equal jog recovery. Scales by rep distance and count. Use when a clean anchored VO2 stimulus is the goal.

8. **Short VO2 / 30-30s** — continuous 10–20 × 30s hard / 30s easy, no walk recovery. Variants: 40-20, 20-10. "Hard" is ~5k pace or slightly faster. Scales by total rep count. Use for aerobic power under continuous load.

9. **Progression run** — continuous run starting easy and finishing at threshold. Example: 10k starting at 10k + 30s/km, dropping 5–10s/km per kilometre, finishing at 10k pace. Scales by total distance and aggressiveness of progression.

10. **Strides + hills combo** — steady run with 6–8 × 20s hill sprints embedded in the middle or end. Hills are strong / 95% effort (not paced — the one exception). Example: 30 min steady, 8 × 20s hill sprints on a 6–8% grade with walk-back recovery, 10 min steady cool-down. Scales by effort count, length (10–30s), and gradient.

## How to render these in the session JSON
- Name the structure explicitly in the session name: "Pyramid Intervals — 5k/10k pace", "Mixed-Distance Intervals", "Cruise Intervals", "Over-Unders", "Long Run with 15 min Hot Spot", etc.
- Reflect the structure in the "structure" field with specific paces derived from the athlete's 5k/10k times.
- Break the session into exercise entries that reflect the segments (warm-up, work intervals, recoveries, cool-down).
- The "rpe" field on every run exercise stays null. Intensity is carried by pace language in the name, structure, and notes.
`;

export default router;
