import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, programmesTable } from "@workspace/db";
import type { Exercise } from "@workspace/db";

const router: IRouter = Router();

router.get("/programmes", async (_req, res): Promise<void> => {
  const programmes = await db
    .select()
    .from(programmesTable)
    .orderBy(programmesTable.updatedAt);
  res.json(programmes.reverse());
});

router.post("/programmes", async (req, res): Promise<void> => {
  const { title, exercises } = req.body as { title: string; exercises: Exercise[] };
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const [programme] = await db
    .insert(programmesTable)
    .values({ title, exercises: exercises ?? [] })
    .returning();
  res.status(201).json(programme);
});

router.get("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [programme] = await db
    .select()
    .from(programmesTable)
    .where(eq(programmesTable.id, id));
  if (!programme) {
    res.status(404).json({ error: "Programme not found" });
    return;
  }
  res.json(programme);
});

router.put("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { title, exercises } = req.body as { title?: string; exercises?: Exercise[] };
  const updateData: Partial<{ title: string; exercises: Exercise[] }> = {};
  if (title !== undefined) updateData.title = title;
  if (exercises !== undefined) updateData.exercises = exercises;

  const [programme] = await db
    .update(programmesTable)
    .set(updateData)
    .where(eq(programmesTable.id, id))
    .returning();
  if (!programme) {
    res.status(404).json({ error: "Programme not found" });
    return;
  }
  res.json(programme);
});

router.delete("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [programme] = await db
    .delete(programmesTable)
    .where(eq(programmesTable.id, id))
    .returning();
  if (!programme) {
    res.status(404).json({ error: "Programme not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/programmes/:id/duplicate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [original] = await db
    .select()
    .from(programmesTable)
    .where(eq(programmesTable.id, id));
  if (!original) {
    res.status(404).json({ error: "Programme not found" });
    return;
  }
  const [duplicate] = await db
    .insert(programmesTable)
    .values({
      title: `${original.title} (Copy)`,
      exercises: original.exercises as Exercise[],
    })
    .returning();
  res.status(201).json(duplicate);
});

export default router;
