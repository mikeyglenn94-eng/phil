import { Router, type IRouter } from "express";

export interface SwimWorkout {
  id: string;
  name: string;
  type: "endurance" | "css" | "technique" | "sprint" | "open_water";
  totalMeters: number | null;
  durationMin: number | null;
  structure: string;
  tags: string[];
  intensity: "easy" | "moderate" | "moderate_hard" | "hard";
  cssReference: string | null;
}

export const swimWorkouts: SwimWorkout[] = [
  { id: "swim_001", name: "1500m Endurance Swim", type: "endurance", totalMeters: 1500, durationMin: null, structure: "400m easy warm-up, 1100m steady continuous swim at aerobic pace, 200m cool-down. Focus on even pace throughout.", tags: ["endurance", "base", "continuous"], intensity: "moderate", cssReference: null },
  { id: "swim_002", name: "2000m Endurance Swim", type: "endurance", totalMeters: 2000, durationMin: null, structure: "400m warm-up, 1400m steady continuous swim, 200m easy cool-down. Aerobic base pace throughout.", tags: ["endurance", "base", "continuous", "long"], intensity: "moderate", cssReference: null },
  { id: "swim_003", name: "3000m Endurance Swim", type: "endurance", totalMeters: 3000, durationMin: null, structure: "400m warm-up, 2400m steady continuous swim, 200m cool-down. Long aerobic base session.", tags: ["endurance", "base", "long"], intensity: "moderate", cssReference: null },
  { id: "swim_004", name: "1000m Endurance Swim", type: "endurance", totalMeters: 1000, durationMin: null, structure: "200m easy warm-up, 600m steady continuous swim at aerobic pace, 200m cool-down.", tags: ["endurance", "base", "short"], intensity: "moderate", cssReference: null },
  { id: "swim_005", name: "10×100m CSS Set", type: "css", totalMeters: 1600, durationMin: null, structure: "300m warm-up, 10×100m on CSS+5s interval (e.g. CSS 1:45/100m → set on 1:50), 15s rest between, 300m cool-down.", tags: ["css", "intervals", "fitness"], intensity: "moderate_hard", cssReference: "CSS pace" },
  { id: "swim_006", name: "8×200m CSS Set", type: "css", totalMeters: 2000, durationMin: null, structure: "400m warm-up, 8×200m on CSS+8s per 100m interval, 20s rest between, 400m cool-down.", tags: ["css", "intervals", "fitness", "long"], intensity: "moderate_hard", cssReference: "CSS pace" },
  { id: "swim_007", name: "CSS 5×400m", type: "css", totalMeters: 2600, durationMin: null, structure: "400m warm-up, 5×400m at CSS pace on CSS+10s/100m interval, 30s rest between, 400m cool-down.", tags: ["css", "intervals", "fitness", "long"], intensity: "moderate_hard", cssReference: "CSS pace" },
  { id: "swim_008", name: "CSS Ladder Set", type: "css", totalMeters: 1800, durationMin: null, structure: "400m warm-up, 100/200/300/200/100m CSS ladder set with 20s rest between, 400m cool-down.", tags: ["css", "intervals", "ladder"], intensity: "moderate_hard", cssReference: "CSS pace" },
  { id: "swim_009", name: "Technique Drill Session", type: "technique", totalMeters: 1200, durationMin: null, structure: "200m easy swim, 6×50m catch-up drill, 6×50m fingertip drag, 6×50m side kick drill, 4×50m build, 200m easy cool-down.", tags: ["technique", "drills", "form"], intensity: "easy", cssReference: null },
  { id: "swim_010", name: "Technique Focus — Pull", type: "technique", totalMeters: 1400, durationMin: null, structure: "300m easy warm-up, 8×50m catch drill on 90s, 8×50m pull with buoy on 90s, 4×100m build from technique focus, 200m cool-down.", tags: ["technique", "pull", "drills"], intensity: "easy", cssReference: null },
  { id: "swim_011", name: "Technique — Kick Set", type: "technique", totalMeters: 1200, durationMin: null, structure: "200m easy swim, 10×50m kick with board, alternating easy/build, 200m pull, 200m cool-down.", tags: ["technique", "kick", "drills"], intensity: "easy", cssReference: null },
  { id: "swim_012", name: "Sprint Set 8×25m", type: "sprint", totalMeters: 1000, durationMin: null, structure: "400m warm-up, 8×25m max sprint with 60s full recovery, 8×50m easy swim-down. Full recovery between sprints — speed over fitness here.", tags: ["sprint", "speed", "max_effort"], intensity: "hard", cssReference: null },
  { id: "swim_013", name: "Sprint Set 12×25m", type: "sprint", totalMeters: 1200, durationMin: null, structure: "400m warm-up, 12×25m max sprint with 60s full recovery, 8×50m easy swim-down.", tags: ["sprint", "speed", "max_effort"], intensity: "hard", cssReference: null },
  { id: "swim_014", name: "Sprint Set 6×50m", type: "sprint", totalMeters: 1200, durationMin: null, structure: "400m warm-up, 6×50m near-max effort with 2 min full recovery between, 400m easy cool-down.", tags: ["sprint", "speed", "max_effort"], intensity: "hard", cssReference: null },
  { id: "swim_015", name: "Open Water Sighting Set", type: "open_water", totalMeters: 2000, durationMin: null, structure: "Pool simulation: 400m warm-up, 8×100m with sighting every 10 strokes, 4×200m buoy turn practice (touch-turn at wall), 400m cool-down.", tags: ["open_water", "sighting", "navigation"], intensity: "moderate", cssReference: null },
  { id: "swim_016", name: "CSS Descend Set", type: "css", totalMeters: 1600, durationMin: null, structure: "400m warm-up, 4×300m descending pace (start at CSS+10s, end at CSS per 100m), 30s between reps, 400m cool-down.", tags: ["css", "descend", "pacing"], intensity: "moderate_hard", cssReference: "CSS pace" },
  { id: "swim_017", name: "Mixed CSS+Technique", type: "css", totalMeters: 1800, durationMin: null, structure: "400m warm-up, [50m drill + 100m CSS] × 6, 10s rest between pairs, 400m cool-down.", tags: ["css", "technique", "mixed"], intensity: "moderate", cssReference: "CSS pace" },
  { id: "swim_018", name: "2000m Threshold Set", type: "css", totalMeters: 2600, durationMin: null, structure: "400m warm-up, 4×500m at CSS with 30s rest, 400m cool-down. Main set at critical swim speed — sustainable but hard.", tags: ["css", "threshold", "long"], intensity: "moderate_hard", cssReference: "CSS pace" },
];

const INTENSITY_LABELS: Record<string, string> = {
  easy: "Easy",
  moderate: "Moderate",
  moderate_hard: "Moderate / Hard",
  hard: "Hard",
};

function parseSwimInput(input: string) {
  const text = input.toLowerCase();
  const typeKeywords = ["endurance", "css", "critical swim speed", "technique", "drill", "sprint", "open water", "sighting"];
  const include: string[] = typeKeywords.filter(k => text.includes(k));
  const exclude: string[] = typeKeywords.filter(k => text.includes(`no ${k}`));

  let meters: number | null = null;
  const mMatch = text.match(/(\d+)\s*(m\b|metres|meters)/);
  if (mMatch) meters = parseInt(mMatch[1], 10);

  return { include, exclude, meters };
}

function scoreSwimWorkout(workout: SwimWorkout, filters: ReturnType<typeof parseSwimInput>): number {
  let score = 0;
  for (const ex of filters.exclude) {
    if (workout.type.includes(ex) || workout.tags.some(t => t.includes(ex))) return -1;
  }
  filters.include.forEach(term => {
    if (workout.type.includes(term)) score += 10;
    if (workout.tags.some(t => t.includes(term))) score += 7;
    if (term === "drill" && workout.type === "technique") score += 8;
    if ((term === "critical swim speed" || term === "css") && workout.type === "css") score += 8;
  });
  if (filters.meters && workout.totalMeters) {
    const diff = Math.abs(workout.totalMeters - filters.meters);
    if (diff <= 200) score += 2;
    else if (diff <= 500) score += 1;
  }
  return score;
}

const router: IRouter = Router();

router.get("/swim-brain/workouts", async (_req, res): Promise<void> => {
  res.json({ workouts: swimWorkouts.map(w => ({ ...w, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity })) });
});

router.post("/swim-brain/search", async (req, res): Promise<void> => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }
  const filters = parseSwimInput(query);
  const results = swimWorkouts
    .map(w => ({ ...w, score: scoreSwimWorkout(w, filters), intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  res.json({ results, filters });
});

export function searchSwimSync(query: string, limit = 3) {
  const filters = parseSwimInput(query);
  const scored = swimWorkouts
    .map(w => ({ ...w, score: scoreSwimWorkout(w, filters), intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.length > 0 ? scored : swimWorkouts.slice(0, limit).map(w => ({ ...w, score: 1, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }));
}

export default router;
