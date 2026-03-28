import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, clientsTable, nutritionEntriesTable, programmesTable } from "@workspace/db";
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

  const imageCount = hasImages ? imageBase64Array!.length : 0;
  const systemPrompt = `You are a precise sports nutrition expert helping athletes track their macros accurately.

${hasImages
  ? `The user has photographed ${imageCount === 1 ? "a nutrition label" : `${imageCount} nutrition labels for the same meal`}. Read ${imageCount === 1 ? "the label" : "all labels"} carefully and extract the macronutrient values.
- ${imageCount > 1 ? "Sum the values across all labels to give the total macros for the meal" : "Use the values exactly as shown on the label per serving"}
- If the user's note specifies a quantity (e.g. "2 servings", "half a pack"), multiply accordingly
- If no quantity is specified, assume 1 serving per label
- Set note to describe the serving assumption (e.g. "1 serving per label (230g)")
- If you cannot read a label clearly, do your best estimate and mention it in the note`
  : `The user will describe food or meals they ate. Your job is to estimate macronutrients as accurately as possible and be transparent about any assumptions you make.
- If the user gives a specific quantity (e.g. "200g chicken", "1 cup oats"), use that exact amount
- If no quantity is given, assume a typical single adult male serving and ALWAYS note your assumption
- For branded or restaurant foods, use best available nutritional data
- Protein: lean meats ~25-30g/100g, eggs ~6g each, legumes ~8g/100g cooked
- Always be realistic — do not under- or over-estimate`}

Respond ONLY with a JSON object in this exact format:
{"calories": 450, "protein": 32.5, "carbs": 45.0, "fats": 12.0, "note": "1 serving per label (230g)"}

All macro values must be numbers (never strings or null). note is a string or null.`;

  let calories: number | null = null;
  let protein: string | null = null;
  let carbs: string | null = null;
  let fats: string | null = null;
  let aiNote: string | null = null;

  try {
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } };

    const userContent: string | ContentPart[] = hasImages
      ? [
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
        ]
      : description!.trim();

    const completion = await openai.chat.completions.create({
      model: hasImages ? "gpt-4o-mini" : "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
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
  } catch (err) {
    console.error("Nutrition AI parse error:", err);
  }

  const [entry] = await db
    .insert(nutritionEntriesTable)
    .values({ clientId, date, description: description.trim(), calories, protein, carbs, fats, aiNote })
    .returning();
  res.status(201).json(entry);
});

// Update macros for a nutrition entry
router.patch("/clients/:clientId/nutrition/:entryId", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entryId" }); return; }
  const { calories, protein, carbs, fats } = req.body as {
    calories?: number; protein?: number; carbs?: number; fats?: number;
  };
  const updates: Record<string, unknown> = {};
  if (typeof calories === "number") updates.calories = Math.round(calories);
  if (typeof protein === "number") updates.protein = protein.toFixed(1);
  if (typeof carbs === "number") updates.carbs = carbs.toFixed(1);
  if (typeof fats === "number") updates.fats = fats.toFixed(1);
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

export default router;
