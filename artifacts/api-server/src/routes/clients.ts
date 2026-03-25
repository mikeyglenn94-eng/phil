import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, clientsTable, nutritionEntriesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// List clients
router.get("/clients", async (_req, res): Promise<void> => {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  res.json(clients);
});

// Create client
router.post("/clients", async (req, res): Promise<void> => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const [client] = await db.insert(clientsTable).values({ name: name.trim() }).returning();
  res.status(201).json(client);
});

// Get client
router.get("/clients/:clientId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.clientId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, id));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(client);
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

// Add nutrition entry with AI macro parsing
router.post("/clients/:clientId/nutrition", async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { description, date } = req.body as { description: string; date: string };
  if (!description?.trim()) { res.status(400).json({ error: "Description is required" }); return; }
  if (!date) { res.status(400).json({ error: "Date is required" }); return; }

  let calories: number | null = null;
  let protein: string | null = null;
  let carbs: string | null = null;
  let fats: string | null = null;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. The user will describe a food or meal they ate. 
Estimate the macronutrients and respond ONLY with a JSON object like:
{"calories": 450, "protein": 32.5, "carbs": 45.0, "fats": 12.0}
All values must be numbers. Be reasonable and accurate. Never include units in the numbers.`,
        },
        { role: "user", content: description },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0].message.content || "{}");
    calories = typeof parsed.calories === "number" ? Math.round(parsed.calories) : null;
    protein = typeof parsed.protein === "number" ? parsed.protein.toFixed(1) : null;
    carbs = typeof parsed.carbs === "number" ? parsed.carbs.toFixed(1) : null;
    fats = typeof parsed.fats === "number" ? parsed.fats.toFixed(1) : null;
  } catch (err) {
    console.error("Nutrition AI parse error:", err);
  }

  const [entry] = await db
    .insert(nutritionEntriesTable)
    .values({ clientId, date, description: description.trim(), calories, protein, carbs, fats })
    .returning();
  res.status(201).json(entry);
});

// Delete nutrition entry
router.delete("/clients/:clientId/nutrition/:entryId", async (req, res): Promise<void> => {
  const entryId = parseInt(req.params.entryId, 10);
  if (isNaN(entryId)) { res.status(400).json({ error: "Invalid entryId" }); return; }
  await db.delete(nutritionEntriesTable).where(eq(nutritionEntriesTable.id, entryId));
  res.status(204).send();
});

export default router;
