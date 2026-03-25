import { Router, type IRouter } from "express";
import { db, wodLibraryTable } from "@workspace/db";

interface Block {
  movement: string;
  amount: number;
  unit: string;
  minute?: number;
}

interface WOD {
  id: string;
  name: string;
  format: string;
  duration: number;
  structure: string;
  blocks: Block[];
  equipment: string[];
  tags: string[];
  rounds?: number;
  restSeconds?: number;
  intervalStyle?: string;
}

const builtinWorkouts: WOD[] = [
  { id: "wod_001", name: "10 Min Engine Push", format: "amrap", duration: 10, structure: "AMRAP 10: 200m run, 15 wall balls, 10 burpees", blocks: [{movement:"running",amount:200,unit:"m"},{movement:"wall balls",amount:15,unit:"reps"},{movement:"burpees",amount:10,unit:"reps"}], equipment: ["wall ball"], tags: ["engine","short"] },
  { id: "wod_002", name: "DB Sweat 12", format: "amrap", duration: 12, structure: "AMRAP 12: 20 dumbbell lunges, 12 dumbbell push press, 20 sit-ups", blocks: [{movement:"dumbbell lunges",amount:20,unit:"reps"},{movement:"dumbbell push press",amount:12,unit:"reps"},{movement:"sit-ups",amount:20,unit:"reps"}], equipment: ["dumbbells"], tags: ["dumbbell"] },
  { id: "wod_003", name: "Row Intervals", format: "interval", duration: 12, structure: "6 rounds: 250m row hard, 60s rest", rounds: 6, restSeconds: 60, blocks: [{movement:"rowing",amount:250,unit:"m"}], equipment: ["rower"], tags: ["engine"] },
  { id: "wod_004", name: "Hybrid 15", format: "for_time", duration: 15, structure: "4 rounds: 400m run, 15 dumbbell thrusters, 12 burpees", rounds: 4, blocks: [{movement:"running",amount:400,unit:"m"},{movement:"dumbbell thrusters",amount:15,unit:"reps"},{movement:"burpees",amount:12,unit:"reps"}], equipment: ["dumbbells"], tags: ["hyrox"] },
  { id: "wod_005", name: "EMOM Builder", format: "emom", duration: 12, structure: "EMOM 12: Min1 12 cal ski, Min2 15 goblet squats, Min3 30s plank", intervalStyle: "rotating", blocks: [{minute:1,movement:"ski erg",amount:12,unit:"cal"},{minute:2,movement:"goblet squats",amount:15,unit:"reps"},{minute:3,movement:"plank",amount:30,unit:"seconds"}], equipment: ["kettlebell","ski erg"], tags: ["simple"] },
  { id: "wod_006", name: "20 Min Engine", format: "amrap", duration: 20, structure: "AMRAP 20: 400m run, 20 wall balls, 20 lunges", blocks: [{movement:"running",amount:400,unit:"m"},{movement:"wall balls",amount:20,unit:"reps"},{movement:"lunges",amount:20,unit:"reps"}], equipment: ["wall ball"], tags: ["engine"] },
  { id: "wod_007", name: "Sled Grind", format: "for_time", duration: 18, structure: "5 rounds: 20m sled push, 200m run", rounds: 5, blocks: [{movement:"sled push",amount:20,unit:"m"},{movement:"running",amount:200,unit:"m"}], equipment: ["sled"], tags: ["hyrox"] },
  { id: "wod_008", name: "DB Conditioning", format: "amrap", duration: 15, structure: "AMRAP 15: 15 dumbbell snatch, 12 burpees, 20 sit-ups", blocks: [{movement:"dumbbell snatch",amount:15,unit:"reps"},{movement:"burpees",amount:12,unit:"reps"},{movement:"sit-ups",amount:20,unit:"reps"}], equipment: ["dumbbells"], tags: ["mixed"] },
  { id: "wod_009", name: "Long Aerobic", format: "amrap", duration: 30, structure: "AMRAP 30: 800m run, 500m row", blocks: [{movement:"running",amount:800,unit:"m"},{movement:"rowing",amount:500,unit:"m"}], equipment: ["rower"], tags: ["aerobic"] },
  { id: "wod_010", name: "Wall Ball Ladder", format: "ladder", duration: 20, structure: "10-20-30-40 wall balls, 10 burpees after each set", blocks: [{movement:"wall balls",amount:10,unit:"reps"},{movement:"burpees",amount:10,unit:"reps"}], equipment: ["wall ball"], tags: ["hyrox"] },
  { id: "wod_011", name: "Burpee Engine", format: "amrap", duration: 10, structure: "AMRAP 10: 12 burpees, 200m run", blocks: [{movement:"burpees",amount:12,unit:"reps"},{movement:"running",amount:200,unit:"m"}], equipment: [], tags: ["engine"] },
  { id: "wod_012", name: "DB Ladder 15", format: "ladder", duration: 15, structure: "10-20-30 dumbbell thrusters + lunges", blocks: [{movement:"dumbbell thrusters",amount:10,unit:"reps"},{movement:"dumbbell lunges",amount:10,unit:"reps"}], equipment: ["dumbbells"], tags: ["dumbbell"] },
  { id: "wod_013", name: "Row Wall Ball", format: "amrap", duration: 12, structure: "AMRAP 12: 250m row, 20 wall balls", blocks: [{movement:"rowing",amount:250,unit:"m"},{movement:"wall balls",amount:20,unit:"reps"}], equipment: ["rower","wall ball"], tags: ["hyrox"] },
  { id: "wod_014", name: "Bodyweight 15", format: "amrap", duration: 15, structure: "AMRAP 15: 20 air squats, 15 push-ups, 20 sit-ups", blocks: [{movement:"air squats",amount:20,unit:"reps"},{movement:"push-ups",amount:15,unit:"reps"},{movement:"sit-ups",amount:20,unit:"reps"}], equipment: [], tags: ["bodyweight"] },
  { id: "wod_015", name: "Sled Burpee", format: "for_time", duration: 20, structure: "4 rounds: 30m sled push, 15 burpees", rounds: 4, blocks: [{movement:"sled push",amount:30,unit:"m"},{movement:"burpees",amount:15,unit:"reps"}], equipment: ["sled"], tags: ["hyrox"] },
  { id: "wod_016", name: "Bike Intervals", format: "interval", duration: 12, structure: "6 rounds: 15 cal bike, 60s rest", rounds: 6, restSeconds: 60, blocks: [{movement:"bike",amount:15,unit:"cal"}], equipment: ["bike"], tags: ["engine"] },
  { id: "wod_017", name: "Run Lunge", format: "amrap", duration: 20, structure: "AMRAP 20: 400m run, 20 lunges", blocks: [{movement:"running",amount:400,unit:"m"},{movement:"lunges",amount:20,unit:"reps"}], equipment: [], tags: ["engine"] },
  { id: "wod_018", name: "Core Burner", format: "amrap", duration: 15, structure: "AMRAP 15: 20 sit-ups, 30s plank, 10 burpees", blocks: [{movement:"sit-ups",amount:20,unit:"reps"},{movement:"plank",amount:30,unit:"seconds"},{movement:"burpees",amount:10,unit:"reps"}], equipment: [], tags: ["core"] },
  { id: "wod_019", name: "Long Grind", format: "amrap", duration: 30, structure: "AMRAP 30: 400m run, 20 wall balls, 15 burpees", blocks: [{movement:"running",amount:400,unit:"m"},{movement:"wall balls",amount:20,unit:"reps"},{movement:"burpees",amount:15,unit:"reps"}], equipment: ["wall ball"], tags: ["long"] },
  { id: "wod_020", name: "Row Run", format: "for_time", duration: 18, structure: "5 rounds: 300m row, 300m run", rounds: 5, blocks: [{movement:"rowing",amount:300,unit:"m"},{movement:"running",amount:300,unit:"m"}], equipment: ["rower"], tags: ["engine"] },
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
  "snatch", "goblet squat", "push press", "pull-up", "box jump", "air squats", "push-ups",
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
  if (minMatch) duration = parseInt(minMatch[1]);
  else {
    const numMatch = text.match(/\d+/);
    if (numMatch) duration = parseInt(numMatch[0]);
  }
  if (duration === null) {
    if (text.includes("short") || text.includes("quick")) duration = 10;
    if (text.includes("long") || text.includes("grind")) duration = 25;
    if (text.includes("medium")) duration = 15;
  }

  const tags: string[] = [];
  if (text.includes("engine")) tags.push("engine");
  if (text.includes("hyrox")) tags.push("hyrox");
  if (text.includes("aerobic")) tags.push("aerobic");
  if (text.includes("mixed")) tags.push("mixed");
  if (text.includes("core")) tags.push("core");
  if (text.includes("bodyweight")) tags.push("bodyweight");

  return { include, exclude, format, duration, tags };
}

function getMovements(wod: WOD | any): string[] {
  if (wod.blocks && Array.isArray(wod.blocks)) {
    return (wod.blocks as Block[]).map(b => b.movement);
  }
  return [];
}

function scoreWorkout(wod: WOD | any, filters: ReturnType<typeof parseInput>): number {
  let score = 0;
  const movements = getMovements(wod);

  for (const inc of filters.include) {
    if (movements.some(m => m.includes(inc)) || (wod.equipment ?? []).some((e: string) => e.includes(inc))) score += 5;
  }
  for (const exc of filters.exclude) {
    if (movements.some(m => m.includes(exc))) return -1;
  }
  if (filters.format && wod.format === filters.format) score += 8;
  if (filters.duration !== null && wod.duration) {
    const diff = Math.abs(wod.duration - filters.duration);
    if (diff === 0) score += 5;
    else if (diff <= 2) score += 3;
    else if (diff <= 5) score += 1;
  }
  for (const tag of filters.tags) {
    if ((wod.tags as string[]).includes(tag)) score += 3;
  }
  return score;
}

const router: IRouter = Router();

router.get("/wod-brain/workouts", async (_req, res): Promise<void> => {
  try {
    const custom = await db.select().from(wodLibraryTable).orderBy(wodLibraryTable.createdAt);
    const customMapped = custom.map(w => ({
      ...w,
      id: `custom_wod_${w.id}`,
      formatLabel: FORMAT_LABELS[w.format] ?? w.format,
      source: "custom" as const,
    }));
    const builtin = builtinWorkouts.map(w => ({ ...w, formatLabel: FORMAT_LABELS[w.format] ?? w.format, source: "builtin" as const }));
    res.json({ workouts: [...builtin, ...customMapped] });
  } catch (err) {
    res.status(500).json({ error: "Failed to load workouts" });
  }
});

router.post("/wod-brain/workouts", async (req, res): Promise<void> => {
  const { name, format, duration, structure, blocks, equipment, tags, rounds } = req.body;
  if (!name?.trim() || !format || !duration || !structure || !blocks?.length) {
    res.status(400).json({ error: "name, format, duration, structure and blocks are required" });
    return;
  }
  try {
    const [row] = await db.insert(wodLibraryTable).values({
      name: name.trim(), format, duration: Number(duration), structure: structure.trim(),
      blocks, equipment: equipment ?? [], tags: tags ?? [], rounds: rounds ?? null,
    }).returning();
    res.json({ workout: { ...row, id: `custom_wod_${row.id}`, formatLabel: FORMAT_LABELS[row.format] ?? row.format, source: "custom" } });
  } catch (err) {
    res.status(500).json({ error: "Failed to save workout" });
  }
});

router.post("/wod-brain/search", async (req, res): Promise<void> => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: "Query is required" }); return; }

  let custom: any[] = [];
  try {
    const rows = await db.select().from(wodLibraryTable);
    custom = rows.map(w => ({ ...w, id: `custom_wod_${w.id}`, source: "custom" }));
  } catch {}

  const all = [...builtinWorkouts, ...custom];
  const filters = parseInput(query);

  const results = all
    .map(w => ({ ...w, score: scoreWorkout(w, filters), formatLabel: FORMAT_LABELS[w.format] ?? w.format }))
    .filter(w => w.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  res.json({ results, filters });
});

export default router;
