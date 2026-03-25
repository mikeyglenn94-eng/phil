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
  { id: "wod_011", name: "10 Min Burpee Engine", format: "amrap", duration: 10, exercises: ["burpees", "running"], equipment: [], tags: ["engine", "short"] },
  { id: "wod_012", name: "DB Ladder 15", format: "ladder", duration: 15, exercises: ["dumbbell thrusters", "dumbbell lunges"], equipment: ["dumbbells"], tags: ["dumbbell"] },
  { id: "wod_013", name: "Row + Wall Ball 12", format: "amrap", duration: 12, exercises: ["rowing", "wall balls"], equipment: ["rower", "wall ball"], tags: ["hyrox"] },
  { id: "wod_014", name: "Simple Bodyweight 15", format: "amrap", duration: 15, exercises: ["air squats", "push-ups", "sit-ups"], equipment: [], tags: ["bodyweight"] },
  { id: "wod_015", name: "Sled + Burpee 20", format: "for_time", duration: 20, exercises: ["sled push", "burpees"], equipment: ["sled"], tags: ["hyrox"] },
  { id: "wod_016", name: "Bike Intervals 12", format: "interval", duration: 12, exercises: ["bike"], equipment: ["bike"], tags: ["engine"] },
  { id: "wod_017", name: "Run + Lunge 20", format: "amrap", duration: 20, exercises: ["running", "lunges"], equipment: [], tags: ["engine"] },
  { id: "wod_018", name: "DB Core Burner", format: "amrap", duration: 15, exercises: ["dumbbell sit-ups", "plank", "burpees"], equipment: ["dumbbells"], tags: ["core"] },
  { id: "wod_019", name: "Long Grind 30", format: "amrap", duration: 30, exercises: ["running", "wall balls", "burpees"], equipment: ["wall ball"], tags: ["long"] },
  { id: "wod_020", name: "Row Run Combo", format: "for_time", duration: 18, exercises: ["rowing", "running"], equipment: ["rower"], tags: ["engine"] },
  { id: "wod_021", name: "DB Push Engine", format: "amrap", duration: 12, exercises: ["dumbbell push press", "burpees"], equipment: ["dumbbells"], tags: ["mixed"] },
  { id: "wod_022", name: "Wall Ball Sprint", format: "interval", duration: 10, exercises: ["wall balls"], equipment: ["wall ball"], tags: ["engine"] },
  { id: "wod_023", name: "Lunge + Run Ladder", format: "ladder", duration: 20, exercises: ["lunges", "running"], equipment: [], tags: ["hyrox"] },
  { id: "wod_024", name: "Ski + Burpee 15", format: "amrap", duration: 15, exercises: ["ski erg", "burpees"], equipment: ["ski erg"], tags: ["engine"] },
  { id: "wod_025", name: "DB Full Body 20", format: "amrap", duration: 20, exercises: ["dumbbell snatch", "dumbbell lunges", "burpees"], equipment: ["dumbbells"], tags: ["dumbbell"] },
  { id: "wod_026", name: "Simple EMOM 12", format: "emom", duration: 12, exercises: ["air squats", "push-ups"], equipment: [], tags: ["simple"] },
  { id: "wod_027", name: "Run Only Builder", format: "interval", duration: 20, exercises: ["running"], equipment: [], tags: ["aerobic"] },
  { id: "wod_028", name: "Bike + Sit-Up", format: "amrap", duration: 15, exercises: ["bike", "sit-ups"], equipment: ["bike"], tags: ["engine"] },
  { id: "wod_029", name: "DB + Wall Ball 18", format: "for_time", duration: 18, exercises: ["dumbbell thrusters", "wall balls"], equipment: ["dumbbells", "wall ball"], tags: ["mixed"] },
  { id: "wod_030", name: "Burpee Ladder 12", format: "ladder", duration: 12, exercises: ["burpees"], equipment: [], tags: ["engine"] },
  { id: "wod_031", name: "Sled + Run Intervals", format: "interval", duration: 20, exercises: ["sled push", "running"], equipment: ["sled"], tags: ["hyrox"] },
  { id: "wod_032", name: "DB Complex 15", format: "amrap", duration: 15, exercises: ["dumbbell clean", "dumbbell push press", "lunges"], equipment: ["dumbbells"], tags: ["strength endurance"] },
  { id: "wod_033", name: "Wall Ball + Run 25", format: "amrap", duration: 25, exercises: ["wall balls", "running"], equipment: ["wall ball"], tags: ["hyrox"] },
  { id: "wod_034", name: "Row + Burpee 15", format: "amrap", duration: 15, exercises: ["rowing", "burpees"], equipment: ["rower"], tags: ["engine"] },
  { id: "wod_035", name: "Bodyweight Grinder", format: "amrap", duration: 20, exercises: ["air squats", "push-ups", "burpees"], equipment: [], tags: ["bodyweight"] },
  { id: "wod_036", name: "DB + Run 20", format: "amrap", duration: 20, exercises: ["dumbbell lunges", "running"], equipment: ["dumbbells"], tags: ["hyrox"] },
  { id: "wod_037", name: "Ski Erg Only", format: "interval", duration: 15, exercises: ["ski erg"], equipment: ["ski erg"], tags: ["engine"] },
  { id: "wod_038", name: "Wall Ball + Sit-Up", format: "amrap", duration: 15, exercises: ["wall balls", "sit-ups"], equipment: ["wall ball"], tags: ["mixed"] },
  { id: "wod_039", name: "Run + Burpee 30", format: "amrap", duration: 30, exercises: ["running", "burpees"], equipment: [], tags: ["long"] },
  { id: "wod_040", name: "DB Push + Core", format: "amrap", duration: 12, exercises: ["dumbbell push press", "sit-ups"], equipment: ["dumbbells"], tags: ["mixed"] },
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
