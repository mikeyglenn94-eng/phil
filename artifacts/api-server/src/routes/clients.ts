import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, clientsTable, nutritionEntriesTable, programmesTable, clientGoalsTable, usersTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { Session } from "@workspace/db";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

function toPublicClient(c: typeof clientsTable.$inferSelect) {
  const { passwordHash, ...rest } = c;
  return { ...rest, hasPassword: !!passwordHash };
}

// Validate macro goal calories don't exceed calorie goal
function macroCalories(protein: number, carbs: number, fats: number) {
  return protein * 4 + carbs * 4 + fats * 9;
}

// ── Shared AI nutrition parsing ───────────────────────────────────────────────
const NUTRITION_SYSTEM_PROMPT = `You are a precise sports nutrition expert helping athletes track their macros accurately.

The user will describe food or meals they ate. Your job is to estimate macronutrients as accurately as possible and be transparent about any assumptions you make.

QUANTITIES: If the user gives a specific quantity (e.g. "200g chicken", "1 cup oats"), use that exact amount. If no quantity is given, assume a realistic adult male portion and ALWAYS state your assumption.

PROTEIN ESTIMATION — critical rules:
- ALWAYS estimate each named protein source separately, then sum. NEVER collapse a multi-protein meal into a single generic restaurant estimate.
- Use these values for cooked / edible portions:
  * Lean beef / beef mince / beef burger (3–5% fat): ~26g protein per 100g cooked
  * Chicken breast: ~31g protein per 100g cooked
  * Chicken thigh (skin-off cooked edible portion): ~25g protein per 100g
  * Duck (cooked, skin removed for eating): ~19g protein per 100g
  * Pork loin / pork chop: ~27g protein per 100g cooked
  * Salmon / trout: ~25g protein per 100g cooked
  * Tuna (tinned in water, drained): ~26g protein per 100g
  * Prawns / shrimp: ~24g protein per 100g cooked
  * Eggs: ~6g per whole egg
  * Greek yoghurt (full fat): ~9g per 100g
  * Chickpeas (cooked / canned): ~9g per 100g (~7g per half-cup)
  * Lentils (cooked): ~9g per 100g
  * Other legumes: ~8g per 100g cooked
- Typical adult male portions when no weight is given:
  * Beef burger (restaurant or homemade): 150–200g per burger → ~39–52g protein per burger
  * Chicken thigh (1 large thigh, cooked): ~150g edible → ~37g protein
  * Duck (restaurant salad portion): ~100–120g meat → ~19–23g protein
  * Salmon fillet: ~150g → ~37g protein
  * Eggs: assume 2–3 per serving unless stated otherwise
- In your note, state the assumed portion AND protein for EACH source, e.g.: "Beef burger (2 × 180g): ~94g | Duck (~110g): ~21g | Chicken thigh (1 large): ~37g | Chickpeas (½ cup): ~7g → total ~159g"

GENERAL:
- For branded or restaurant foods, use best available nutritional data
- Always be realistic — do not under- or over-estimate

Respond ONLY with a JSON object in this exact format:
{"calories": 450, "protein": 32.5, "carbs": 45.0, "fats": 12.0, "note": "assumed 200g chicken breast (62g protein) + 1 cup rice (4g protein)"}

All macro values must be numbers (never strings or null). note is a string or null.`;

async function aiParseNutrition(description: string): Promise<{
  calories: number | null;
  protein: string | null;
  carbs: string | null;
  fats: string | null;
  aiNote: string | null;
}> {
  const completion = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: NUTRITION_SYSTEM_PROMPT },
      { role: "user", content: description.trim() },
    ],
    response_format: { type: "json_object" },
  });
  const parsed = JSON.parse(completion.choices[0].message.content || "{}");
  return {
    calories: typeof parsed.calories === "number" ? Math.round(parsed.calories) : null,
    protein: typeof parsed.protein === "number" ? parsed.protein.toFixed(1) : null,
    carbs: typeof parsed.carbs === "number" ? parsed.carbs.toFixed(1) : null,
    fats: typeof parsed.fats === "number" ? parsed.fats.toFixed(1) : null,
    aiNote: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : null,
  };
}

const router: IRouter = Router();

// List clients
router.get("/clients", async (_req, res): Promise<void> => {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  res.json(clients.map(toPublicClient));
});

// Create client
router.post("/clients", async (req, res): Promise<void> => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const [client] = await db.insert(clientsTable).values({ name: name.trim() }).returning();
  res.status(201).json(toPublicClient(client));
});

// Get client
router.get("/clients/:clientId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// Set password (first time or reset)
router.post("/clients/:clientId/set-password", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { password } = req.body as { password: string };
  if (!password || password.length < 4) {
    res.status(400).json({ error: "Password must be at least 4 characters" }); return;
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const [client] = await db.update(clientsTable).set({ passwordHash: hash }).where(eq(clientsTable.id, id)).returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// Set daily macro/calorie goals for a client
router.put("/clients/:clientId/goals", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { calories, protein, carbs, fats } = req.body as {
    calories: number; protein: number; carbs: number; fats: number;
  };
  if ([calories, protein, carbs, fats].some(v => typeof v !== "number" || v < 0)) {
    res.status(400).json({ error: "All goals must be non-negative numbers" }); return;
  }
  const fromMacros = macroCalories(protein, carbs, fats);
  if (fromMacros > calories) {
    res.status(400).json({
      error: `Macro calories (${fromMacros} kcal) exceed the calorie goal (${calories} kcal). Reduce protein, carbs, or fats.`
    });
    return;
  }
  const [client] = await db.update(clientsTable)
    .set({ dailyCalorieGoal: calories, dailyProteinGoal: protein, dailyCarbGoal: carbs, dailyFatGoal: fats })
    .where(eq(clientsTable.id, id))
    .returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// Reset monthly credit allocation (coach action — stamps now() so the count restarts from this moment)
router.post("/clients/:clientId/reset-credits", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [client] = await db.update(clientsTable).set({ creditResetAt: new Date() }).where(eq(clientsTable.id, id)).returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// Reset password (coach action — clears the hash so client can set a new one)
router.post("/clients/:clientId/reset-password", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [client] = await db.update(clientsTable).set({ passwordHash: null }).where(eq(clientsTable.id, id)).returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// Verify password
router.post("/clients/:clientId/verify-password", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { password } = req.body as { password: string };
  if (!password) { res.status(400).json({ error: "Password is required" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  if (!client.passwordHash) { res.json({ success: false, reason: "no_password" }); return; }
  const ok = await bcrypt.compare(password, client.passwordHash);
  res.json({ success: ok });
});

// Save onboarding quiz answers + mark completed
router.patch("/clients/:clientId/onboarding", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { onboardingData, onboardingCompleted, equipmentList } = req.body as {
    onboardingData?: Record<string, unknown>;
    onboardingCompleted?: boolean;
    equipmentList?: string;
  };
  const update: Record<string, unknown> = {};
  if (onboardingData !== undefined) update.onboardingData = onboardingData;
  if (onboardingCompleted !== undefined) update.onboardingCompleted = onboardingCompleted;
  if (equipmentList !== undefined) update.equipmentList = equipmentList;
  const [client] = await db.update(clientsTable).set(update as any).where(eq(clientsTable.id, id)).returning();
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(toPublicClient(client));
});

// List nutrition entries for a client (optionally filtered by date)
router.get("/clients/:clientId/nutrition", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { date } = req.query as { date?: string };
  const conditions = [eq(nutritionEntriesTable.clientId, clientId)];
  if (date) conditions.push(eq(nutritionEntriesTable.date, date));
  const entries = await db
    .select()
    .from(nutritionEntriesTable)
    .where(and(...conditions))
    .orderBy(nutritionEntriesTable.createdAt);
  res.json(entries);
});

// Add nutrition entry with AI macro parsing (supports optional nutrition label photo)
router.post("/clients/:clientId/nutrition", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { description, date, imageBase64Array, imageMimeTypes } = req.body as {
    description?: string;
    date: string;
    imageBase64Array?: string[];
    imageMimeTypes?: string[];
  };
  const hasImages = Array.isArray(imageBase64Array) && imageBase64Array.length > 0;
  const hasDescription = !!description?.trim();
  if (!hasImages && !hasDescription) { res.status(400).json({ error: "Either a description or a label photo is required" }); return; }
  if (!date) { res.status(400).json({ error: "Date is required" }); return; }

  let calories: number | null = null;
  let protein: string | null = null;
  let carbs: string | null = null;
  let fats: string | null = null;
  let aiNote: string | null = null;

  try {
    if (hasImages) {
      // Image path: custom prompt for nutrition label reading
      const imageCount = imageBase64Array!.length;
      const imageSystemPrompt = `You are a precise sports nutrition expert helping athletes track their macros accurately.

The user has photographed ${imageCount === 1 ? "a nutrition label" : `${imageCount} nutrition labels for the same meal`}. Read ${imageCount === 1 ? "the label" : "all labels"} carefully and extract the macronutrient values.

CRITICAL — many labels have two columns: "per 100g" and "per serving/pack". Choose your calculation method based on how the user specifies their quantity:

RULE A — Count-based quantity (e.g. "4 bags", "2 servings", "1 pack"):
  → Use the per-serving/per-pack column × count
  → Example: 4 bags × 144 kcal per 30g pack = 576 kcal

RULE B — Weight-based quantity (e.g. "120g", "200g"):
  → Use the per-100g column × (user_weight ÷ 100)
  → Example: 120g cheese × (272 kcal ÷ 100) = 326 kcal
  → This avoids rounding errors from dividing by serving size

- If no quantity is specified, assume 1 serving and use the per-serving column
${imageCount > 1 ? "- Apply the appropriate rule for each label, then sum all values" : ""}
- Set note to describe exactly what you calculated (e.g. "4 × 30g packs chips (576 kcal) + 120g cheese (326 kcal)")
- If you cannot read a label clearly, do your best estimate and mention it in the note

Respond ONLY with a JSON object in this exact format:
{"calories": 450, "protein": 32.5, "carbs": 45.0, "fats": 12.0, "note": "1 serving per label (230g)"}

All macro values must be numbers (never strings or null). note is a string or null.`;

      type ContentPart =
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "low" } };

      const userContent: ContentPart[] = [
        ...imageBase64Array!.map((b64, i): ContentPart => ({
          type: "image_url",
          image_url: {
            url: `data:${(imageMimeTypes ?? [])[i] ?? "image/jpeg"};base64,${b64}`,
            detail: "low",
          },
        })),
        ...(hasDescription
          ? [{ type: "text" as const, text: `User note: ${description!.trim()}` }]
          : []),
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: imageSystemPrompt },
          { role: "user", content: userContent as any },
        ],
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(completion.choices[0].message.content || "{}");
      calories = typeof parsed.calories === "number" ? Math.round(parsed.calories) : null;
      protein = typeof parsed.protein === "number" ? parsed.protein.toFixed(1) : null;
      carbs = typeof parsed.carbs === "number" ? parsed.carbs.toFixed(1) : null;
      fats = typeof parsed.fats === "number" ? parsed.fats.toFixed(1) : null;
      aiNote = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : null;
    } else {
      // Text-only path: use the shared helper with the improved protein-aware prompt
      ({ calories, protein, carbs, fats, aiNote } = await aiParseNutrition(description!));
    }
  } catch (err) {
    console.error("Nutrition AI parse error:", err);
  }

  const [entry] = await db
    .insert(nutritionEntriesTable)
    .values({ clientId, date, description: description!.trim(), calories, protein, carbs, fats, aiNote })
    .returning();
  res.status(201).json(entry);
});

// Update macros (and optionally re-parse description) for a nutrition entry
router.patch("/clients/:clientId/nutrition/:entryId", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entryId" }); return; }
  const { description, calories, protein, carbs, fats } = req.body as {
    description?: string;
    calories?: number; protein?: number; carbs?: number; fats?: number;
  };

  const updates: Record<string, unknown> = {};

  if (typeof description === "string" && description.trim()) {
    // Re-parse macros from the new description using AI
    try {
      const parsed = await aiParseNutrition(description);
      updates.description = description.trim();
      if (parsed.calories !== null) updates.calories = parsed.calories;
      if (parsed.protein !== null) updates.protein = parsed.protein;
      if (parsed.carbs !== null) updates.carbs = parsed.carbs;
      if (parsed.fats !== null) updates.fats = parsed.fats;
      updates.aiNote = parsed.aiNote;
    } catch (err) {
      console.error("Nutrition re-parse error:", err);
      updates.description = description.trim();
    }
  } else {
    // Manual macro override only — no AI call
    if (typeof calories === "number") updates.calories = Math.round(calories);
    if (typeof protein === "number") updates.protein = protein.toFixed(1);
    if (typeof carbs === "number") updates.carbs = carbs.toFixed(1);
    if (typeof fats === "number") updates.fats = fats.toFixed(1);
  }

  const [entry] = await db
    .update(nutritionEntriesTable)
    .set(updates)
    .where(eq(nutritionEntriesTable.id, entryId))
    .returning();
  res.json(entry);
});

// Delete nutrition entry
router.delete("/clients/:clientId/nutrition/:entryId", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entryId" }); return; }
  await db.delete(nutritionEntriesTable).where(eq(nutritionEntriesTable.id, entryId));
  res.status(204).send();
});

// Assign a programme to a client, re-dated from a given startDate
router.post("/clients/:clientId/assign-programme", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }

  const { sourceProgrammeId, startDate } = req.body as { sourceProgrammeId: number; startDate: string };
  if (!sourceProgrammeId || !startDate) {
    res.status(400).json({ error: "sourceProgrammeId and startDate are required" });
    return;
  }

  const [source] = await db.select().from(programmesTable).where(eq(programmesTable.id, sourceProgrammeId));
  if (!source) { res.status(404).json({ error: "Source programme not found" }); return; }

  const sessions = (source.sessions as Session[]) ?? [];

  // Strip client-logged result data so each client starts with a blank canvas
  const stripResults = (s: Session): Session => ({
    ...s,
    clientComment: undefined,
    exercises: s.exercises.map(({ setReps: _sr, setWeights: _sw, clientComment: _cc, ...rest }) => rest),
  });

  // Calculate day offset from the earliest session date to the requested startDate
  let redatedSessions = sessions.map(stripResults);
  if (sessions.length > 0) {
    const sortedDates = sessions.map(s => new Date(s.date)).sort((a, b) => a.getTime() - b.getTime());
    const earliest = sortedDates[0];
    const newStart = new Date(startDate);
    const offsetDays = Math.round((newStart.getTime() - earliest.getTime()) / 86400000);

    redatedSessions = redatedSessions.map(s => {
      const orig = new Date(s.date);
      const shifted = new Date(orig.getTime() + offsetDays * 86400000);
      return {
        ...s,
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        date: shifted.toISOString().slice(0, 10),
      };
    });
  }

  const [assigned] = await db
    .insert(programmesTable)
    .values({
      title: source.title,
      clientId,
      sessions: redatedSessions,
    })
    .returning();

  res.status(201).json(assigned);
});

// ── Training Goals ────────────────────────────────────────────────────────────

async function parseGoalWithPhil(description: string): Promise<any[]> {
  try {
    const prompt = `You are Phil, a fitness coach. A client has entered this goal:
"${description}"

Extract any structured fitness targets from this text. Recognise:
- Lift targets: squat, bench, deadlift (e.g. "130kg bench" → metric: "bench_e1rm", target: 130, unit: "kg")
- Run time targets: 5k, 10k, half marathon, marathon in minutes (e.g. "sub 1:30 half marathon" → metric: "half_marathon", target: 90, unit: "minutes")
- Weight targets: body weight changes (e.g. "lose 5kg", "get to 80kg" → metric: "bodyweight", target: value, unit: "kg", direction: "lose" | "gain" | "reach")
- Volume targets: training frequency (e.g. "train 4 days a week" → metric: "sessions_per_week", target: 4, unit: "days")

If you cannot confidently extract a structured target, return an empty array.
Return JSON: {"targets": [{"metric": "...", "target": ..., "unit": "..."}]}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.1,
    });
    const raw = completion.choices[0]?.message?.content ?? '{"targets":[]}';
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.targets) ? parsed.targets : [];
  } catch {
    return [];
  }
}

router.get("/clients/:clientId/training-goals", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const goals = await db.select().from(clientGoalsTable).where(eq(clientGoalsTable.clientId, clientId));
  res.json(goals);
});

router.post("/clients/:clientId/training-goals", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }

  const existing = await db.select().from(clientGoalsTable).where(eq(clientGoalsTable.clientId, clientId));
  if (existing.length >= 3) {
    res.status(400).json({ error: "Maximum of 3 goals allowed" }); return;
  }

  const { description, targetDate, priority = "equal" } = req.body as {
    description: string; targetDate?: string; priority?: string;
  };
  if (!description?.trim()) { res.status(400).json({ error: "description is required" }); return; }

  const parsedTargets = await parseGoalWithPhil(description);

  const [goal] = await db.insert(clientGoalsTable).values({
    clientId, description, targetDate: targetDate || null,
    priority: ["primary", "secondary", "equal"].includes(priority) ? priority : "equal",
    parsedTargets: parsedTargets.length ? parsedTargets : null,
  }).returning();
  res.status(201).json(goal);
});

router.put("/clients/:clientId/training-goals/:id", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  const id       = parseInt(req.params.id, 10);
  if (isNaN(clientId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { description, targetDate, priority } = req.body as {
    description?: string; targetDate?: string; priority?: string;
  };

  const updates: Partial<{ description: string; targetDate: string | null; priority: string; parsedTargets: any }> = {};
  if (description !== undefined) {
    updates.description = description;
    updates.parsedTargets = await parseGoalWithPhil(description);
  }
  if (targetDate !== undefined) updates.targetDate = targetDate || null;
  if (priority !== undefined && ["primary", "secondary", "equal"].includes(priority)) updates.priority = priority;

  const [updated] = await db.update(clientGoalsTable)
    .set(updates)
    .where(and(eq(clientGoalsTable.id, id), eq(clientGoalsTable.clientId, clientId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Goal not found" }); return; }
  res.json(updated);
});

router.delete("/clients/:clientId/training-goals/:id", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  const id       = parseInt(req.params.id, 10);
  if (isNaN(clientId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(clientGoalsTable).where(and(eq(clientGoalsTable.id, id), eq(clientGoalsTable.clientId, clientId)));
  res.status(204).send();
});

// ── GET /clients/:clientId/welcome-status ─────────────────────────
// Returns { hasSeenWelcome } for the user linked to this client.

router.get("/clients/:clientId/welcome-status", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const [user] = await db.select({ hasSeenWelcome: usersTable.hasSeenWelcome })
    .from(usersTable)
    .where(eq(usersTable.clientId, clientId))
    .limit(1);
  res.json({ hasSeenWelcome: user?.hasSeenWelcome ?? false });
});

// ── PATCH /clients/:clientId/mark-welcome-seen ────────────────────
// Marks the user's hasSeenWelcome flag as true. Idempotent.

router.patch("/clients/:clientId/mark-welcome-seen", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  await db.update(usersTable)
    .set({ hasSeenWelcome: true })
    .where(eq(usersTable.clientId, clientId));
  res.json({ ok: true });
});

export default router;
