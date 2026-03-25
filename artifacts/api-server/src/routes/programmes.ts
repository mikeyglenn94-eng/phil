import { Router, type IRouter } from "express";
import { eq, isNull } from "drizzle-orm";
import { db, programmesTable } from "@workspace/db";
import type { Session } from "@workspace/db";

const router: IRouter = Router();

router.get("/programmes", async (req, res): Promise<void> => {
  const clientIdParam = req.query.clientId as string | undefined;

  if (clientIdParam !== undefined) {
    const clientId = parseInt(clientIdParam, 10);
    if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
    const programmes = await db
      .select()
      .from(programmesTable)
      .where(eq(programmesTable.clientId, clientId))
      .orderBy(programmesTable.updatedAt);
    res.json(programmes.reverse());
    return;
  }

  // Default: master programmes (no client assigned)
  const programmes = await db
    .select()
    .from(programmesTable)
    .where(isNull(programmesTable.clientId))
    .orderBy(programmesTable.updatedAt);
  res.json(programmes.reverse());
});

router.post("/programmes", async (req, res): Promise<void> => {
  const { title, sessions } = req.body as { title: string; sessions?: Session[] };
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  const [programme] = await db
    .insert(programmesTable)
    .values({ title, sessions: sessions ?? [] })
    .returning();
  res.status(201).json(programme);
});

router.get("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [programme] = await db.select().from(programmesTable).where(eq(programmesTable.id, id));
  if (!programme) { res.status(404).json({ error: "Programme not found" }); return; }
  res.json(programme);
});

router.put("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, sessions } = req.body as { title?: string; sessions?: Session[] };
  const updateData: Partial<{ title: string; sessions: Session[] }> = {};
  if (title !== undefined) updateData.title = title;
  if (sessions !== undefined) updateData.sessions = sessions;
  const [programme] = await db.update(programmesTable).set(updateData).where(eq(programmesTable.id, id)).returning();
  if (!programme) { res.status(404).json({ error: "Programme not found" }); return; }
  res.json(programme);
});

router.delete("/programmes/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [programme] = await db.delete(programmesTable).where(eq(programmesTable.id, id)).returning();
  if (!programme) { res.status(404).json({ error: "Programme not found" }); return; }
  res.sendStatus(204);
});

router.post("/programmes/:id/duplicate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [original] = await db.select().from(programmesTable).where(eq(programmesTable.id, id));
  if (!original) { res.status(404).json({ error: "Programme not found" }); return; }
  const [duplicate] = await db
    .insert(programmesTable)
    .values({ title: `${original.title} (Copy)`, sessions: original.sessions as Session[] })
    .returning();
  res.status(201).json(duplicate);
});

export default router;
