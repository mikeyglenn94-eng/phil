import { Router, type IRouter } from "express";

export interface CycleWorkout {
  id: string;
  name: string;
  type: "endurance" | "tempo" | "intervals" | "recovery" | "race_sim";
  durationMin: number | null;
  distanceKm: number | null;
  structure: string;
  tags: string[];
  intensity: "easy" | "moderate" | "moderate_hard" | "hard";
  rpeRange: string;
}

export const cycleWorkouts: CycleWorkout[] = [
  { id: "cycle_001", name: "60 Min Endurance Ride", type: "endurance", durationMin: 60, distanceKm: null, structure: "60 minutes steady endurance ride, RPE 4-5, conversational pace", tags: ["endurance", "base", "steady"], intensity: "moderate", rpeRange: "4-5" },
  { id: "cycle_002", name: "90 Min Endurance Ride", type: "endurance", durationMin: 90, distanceKm: null, structure: "90 minutes steady aerobic endurance ride, RPE 4-5", tags: ["endurance", "base", "long"], intensity: "moderate", rpeRange: "4-5" },
  { id: "cycle_003", name: "2 Hr Endurance Ride", type: "endurance", durationMin: 120, distanceKm: null, structure: "2 hour steady endurance ride at aerobic base pace, RPE 4-5", tags: ["endurance", "base", "long"], intensity: "moderate", rpeRange: "4-5" },
  { id: "cycle_004", name: "45 Min Endurance Ride", type: "endurance", durationMin: 45, distanceKm: null, structure: "45 minutes steady aerobic endurance ride, RPE 4-5", tags: ["endurance", "base"], intensity: "moderate", rpeRange: "4-5" },
  { id: "cycle_005", name: "20 Min Tempo Ride", type: "tempo", durationMin: 20, distanceKm: null, structure: "10 min easy warm-up, 20 min tempo effort (comfortably uncomfortable), 10 min easy cool-down. RPE 7-8", tags: ["tempo", "threshold"], intensity: "moderate_hard", rpeRange: "7-8" },
  { id: "cycle_006", name: "2×20 Min Tempo Blocks", type: "tempo", durationMin: 40, distanceKm: null, structure: "10 min warm-up, 2×20 min tempo with 5 min easy between, 10 min cool-down. RPE 7-8", tags: ["tempo", "threshold", "broken"], intensity: "moderate_hard", rpeRange: "7-8" },
  { id: "cycle_007", name: "40 Min Tempo Ride", type: "tempo", durationMin: 40, distanceKm: null, structure: "10 min warm-up, 40 min sustained tempo effort, 10 min cool-down. RPE 7-8", tags: ["tempo", "threshold", "sustained"], intensity: "moderate_hard", rpeRange: "7-8" },
  { id: "cycle_008", name: "3×10 Min Tempo", type: "tempo", durationMin: 30, distanceKm: null, structure: "10 min warm-up, 3×10 min tempo with 3 min easy recovery between, 10 min cool-down. RPE 7-8", tags: ["tempo", "threshold", "broken"], intensity: "moderate_hard", rpeRange: "7-8" },
  { id: "cycle_009", name: "5×5 Min Intervals", type: "intervals", durationMin: 40, distanceKm: null, structure: "10 min warm-up, 5×5 min hard effort (RPE 9-10) with 3 min easy spinning recovery, 10 min cool-down", tags: ["intervals", "hard", "vo2max"], intensity: "hard", rpeRange: "9-10" },
  { id: "cycle_010", name: "8×3 Min Intervals", type: "intervals", durationMin: 45, distanceKm: null, structure: "10 min warm-up, 8×3 min hard effort with 2 min easy recovery, 10 min cool-down. RPE 9", tags: ["intervals", "hard"], intensity: "hard", rpeRange: "9" },
  { id: "cycle_011", name: "4×8 Min Intervals", type: "intervals", durationMin: 50, distanceKm: null, structure: "10 min warm-up, 4×8 min hard effort with 4 min easy recovery, 10 min cool-down. RPE 8-9", tags: ["intervals", "hard", "threshold"], intensity: "hard", rpeRange: "8-9" },
  { id: "cycle_012", name: "6×5 Min Intervals", type: "intervals", durationMin: 55, distanceKm: null, structure: "10 min warm-up, 6×5 min hard effort with 3 min easy spinning recovery, 10 min cool-down. RPE 9", tags: ["intervals", "hard", "vo2max"], intensity: "hard", rpeRange: "9" },
  { id: "cycle_013", name: "10×1 Min Sprint Intervals", type: "intervals", durationMin: 30, distanceKm: null, structure: "10 min warm-up, 10×1 min max effort with 2 min easy recovery, 10 min cool-down. RPE 9-10", tags: ["intervals", "sprint", "hard"], intensity: "hard", rpeRange: "9-10" },
  { id: "cycle_014", name: "30 Min Recovery Ride", type: "recovery", durationMin: 30, distanceKm: null, structure: "30 minutes very easy spinning, RPE 1-2, active recovery only, no efforts", tags: ["recovery", "easy"], intensity: "easy", rpeRange: "1-2" },
  { id: "cycle_015", name: "45 Min Recovery Ride", type: "recovery", durationMin: 45, distanceKm: null, structure: "45 minutes very easy spinning, RPE 1-2, active recovery, comfortable throughout", tags: ["recovery", "easy"], intensity: "easy", rpeRange: "1-2" },
  { id: "cycle_016", name: "60 Min Race Sim", type: "race_sim", durationMin: 60, distanceKm: null, structure: "10 min warm-up, 40 min at race pace effort (RPE 8-9), 10 min cool-down", tags: ["race_sim", "race", "hard"], intensity: "hard", rpeRange: "8-9" },
  { id: "cycle_017", name: "90 Min Race Sim", type: "race_sim", durationMin: 90, distanceKm: null, structure: "15 min warm-up, 60 min at race pace effort (RPE 8-9), 15 min cool-down", tags: ["race_sim", "race", "hard"], intensity: "hard", rpeRange: "8-9" },
  { id: "cycle_018", name: "Pyramid Intervals", type: "intervals", durationMin: 50, distanceKm: null, structure: "10 min warm-up, 1/2/3/4/3/2/1 min hard with equal easy recovery between, 10 min cool-down. RPE 9-10", tags: ["intervals", "pyramid", "hard"], intensity: "hard", rpeRange: "9-10" },
  { id: "cycle_019", name: "3×15 Min Sweet Spot", type: "tempo", durationMin: 45, distanceKm: null, structure: "10 min warm-up, 3×15 min sweet spot effort (88-93% FTP, RPE 7-8) with 5 min easy between, 10 min cool-down", tags: ["tempo", "sweet_spot", "threshold"], intensity: "moderate_hard", rpeRange: "7-8" },
  { id: "cycle_020", name: "Over-Under Intervals", type: "intervals", durationMin: 50, distanceKm: null, structure: "10 min warm-up, 3 sets of [4 min at threshold, 1 min over-threshold] × 3, 3 min easy between sets, 10 min cool-down. RPE 8-9", tags: ["intervals", "threshold", "over-under"], intensity: "hard", rpeRange: "8-9" },
];

const INTENSITY_LABELS: Record<string, string> = {
  easy: "Easy",
  moderate: "Moderate",
  moderate_hard: "Moderate / Hard",
  hard: "Hard",
};

function parseCycleInput(input: string) {
  const text = input.toLowerCase();
  const typeKeywords = ["endurance", "tempo", "intervals", "recovery", "race sim", "race simulation", "sprint"];
  const include: string[] = typeKeywords.filter(k => text.includes(k));
  const exclude: string[] = typeKeywords.filter(k => text.includes(`no ${k}`));

  let duration: number | null = null;
  const minMatch = text.match(/(\d+)\s*(min|mins|minute|minutes)/);
  if (minMatch) duration = parseInt(minMatch[1], 10);

  return { include, exclude, duration };
}

function scoreCycleWorkout(workout: CycleWorkout, filters: ReturnType<typeof parseCycleInput>): number {
  let score = 0;
  for (const ex of filters.exclude) {
    if (workout.type.includes(ex) || workout.tags.some(t => t.includes(ex))) return -1;
  }
  filters.include.forEach(term => {
    if (workout.type.includes(term)) score += 10;
    if (workout.tags.some(t => t.includes(term))) score += 7;
  });
  if (filters.duration && workout.durationMin) {
    const diff = Math.abs(workout.durationMin - filters.duration);
    if (diff <= 5) score += 2;
    else if (diff <= 15) score += 1;
  }
  return score;
}

const router: IRouter = Router();

router.get("/cycle-brain/workouts", async (_req, res): Promise<void> => {
  res.json({ workouts: cycleWorkouts.map(w => ({ ...w, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity })) });
});

router.post("/cycle-brain/search", async (req, res): Promise<void> => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }
  const filters = parseCycleInput(query);
  const results = cycleWorkouts
    .map(w => ({ ...w, score: scoreCycleWorkout(w, filters), intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  res.json({ results, filters });
});

export function searchCycleSync(query: string, limit = 3) {
  const filters = parseCycleInput(query);
  const scored = cycleWorkouts
    .map(w => ({ ...w, score: scoreCycleWorkout(w, filters), intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.length > 0 ? scored : cycleWorkouts.slice(0, limit).map(w => ({ ...w, score: 1, intensityLabel: INTENSITY_LABELS[w.intensity] ?? w.intensity }));
}

export default router;
