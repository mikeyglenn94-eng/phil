import { Router, type IRouter } from "express";

interface WOD {
  id: string;
  name: string;
  format: string;
  duration: number;
  exercises: string[];
  equipment: string[];
  tags: string[];
}

const workouts: WOD[] = [
  { id: "wod_001", name: "10 Min Engine Push", format: "amrap", duration: 10, exercises: ["running", "wall balls", "burpees"], equipment: ["wall ball"], tags: ["engine", "short"] },
  { id: "wod_002", name: "DB Sweat 12", format: "amrap", duration: 12, exercises: ["dumbbell lunges", "dumbbell push press", "sit-ups"], equipment: ["dumbbells"], tags: ["dumbbell", "mixed"] },
  { id: "wod_003", name: "Row Intervals", format: "interval", duration: 10, exercises: ["rowing"], equipment: ["rower"], tags: ["engine"] },
  { id: "wod_004", name: "Hybrid 15", format: "for_time", duration: 15, exercises: ["running", "dumbbell thrusters", "burpees"], equipment: ["dumbbells"], tags: ["hyrox"] },
  { id: "wod_005", name: "EMOM Builder", format: "emom", duration: 12, exercises: ["ski erg", "goblet squats", "plank"], equipment: ["kettlebell", "ski erg"], tags: ["simple"] },
  { id: "wod_006", name: "20 Min Engine", format: "amrap", duration: 20, exercises: ["running", "wall balls", "lunges"], equipment: ["wall ball"], tags: ["engine"] },
  { id: "wod_007", name: "Sled Grind", format: "for_time", duration: 18, exercises: ["sled push", "running"], equipment: ["sled"], tags: ["hyrox"] },
  { id: "wod_008", name: "DB Conditioning", format: "amrap", duration: 15, exercises: ["dumbbell snatch", "burpees", "sit-ups"], equipment: ["dumbbells"], tags: ["mixed"] },
  { id: "wod_009", name: "Long Aerobic", format: "amrap", duration: 30, exercises: ["running", "rowing"], equipment: ["rower"], tags: ["aerobic"] },
  { id: "wod_010", name: "Wall Ball Ladder", format: "ladder", duration: 20, exercises: ["wall balls", "burpees", "running"], equipment: ["wall ball"], tags: ["hyrox"] },
];

const FORMAT_LABELS: Record<string, string> = {
  amrap: "AMRAP",
  emom: "EMOM",
  for_time: "For Time",
  interval: "Intervals",
  ladder: "Ladder",
};

const MOVEMENTS = [
  "running", "rowing", "ski erg", "bike", "wall balls", "burpees", "lunges",
  "dumbbell", "sled", "sit-ups", "plank", "kettlebell", "thruster",
  "snatch", "goblet squat", "push press", "pull-up", "box jump",
];

function parseInput(input: string) {
  const text = input.toLowerCase();
  const include: string[] = [];
  const exclude: string[] = [];

  MOVEMENTS.forEach(m => {
    if (text.includes(m)) {
      if (text.includes("no " + m)) exclude.push(m);
      else include.push(m);
    }
  });

  let format: string | null = null;
  if (text.includes("emom")) format = "emom";
  else if (text.includes("amrap")) format = "amrap";
  else if (text.includes("for time") || text.includes("fortime")) format = "for_time";
  else if (text.includes("interval")) format = "interval";
  else if (text.includes("ladder")) format = "ladder";

  let duration: number | null = null;
  const minMatch = text.match(/(\d+)\s*min/);
  if (minMatch) {
    duration = parseInt(minMatch[1]);
  } else {
    const numMatch = text.match(/\d+/);
    if (numMatch) duration = parseInt(numMatch[0]);
  }

  if (duration === null) {
    if (text.includes("short") || text.includes("quick") || text.includes("snappy")) duration = 10;
    if (text.includes("long") || text.includes("grind") || text.includes("aerobic") || text.includes("endurance")) duration = 25;
    if (text.includes("medium")) duration = 15;
  }

  const tags: string[] = [];
  if (text.includes("engine")) tags.push("engine");
  if (text.includes("hyrox")) tags.push("hyrox");
  if (text.includes("aerobic")) tags.push("aerobic");
  if (text.includes("mixed")) tags.push("mixed");

  return { include, exclude, format, duration, tags };
}

function scoreWorkout(wod: WOD, filters: ReturnType<typeof parseInput>): number {
  let score = 0;

  for (const inc of filters.include) {
    if (wod.exercises.some(e => e.includes(inc)) || wod.equipment.some(e => e.includes(inc))) score += 5;
  }

  for (const exc of filters.exclude) {
    if (wod.exercises.some(e => e.includes(exc))) return -1;
  }

  if (filters.format && wod.format === filters.format) score += 8;

  if (filters.duration !== null) {
    const diff = Math.abs(wod.duration - filters.duration);
    if (diff === 0) score += 5;
    else if (diff <= 2) score += 3;
    else if (diff <= 5) score += 1;
  }

  for (const tag of filters.tags) {
    if (wod.tags.includes(tag)) score += 3;
  }

  return score;
}

const router: IRouter = Router();

router.post("/wod-brain/search", (req, res): void => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) {
    res.status(400).json({ error: "Query is required" });
    return;
  }

  const filters = parseInput(query);

  const results = workouts
    .map(w => ({ ...w, score: scoreWorkout(w, filters), formatLabel: FORMAT_LABELS[w.format] ?? w.format }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  res.json({ results, filters });
});

export default router;
