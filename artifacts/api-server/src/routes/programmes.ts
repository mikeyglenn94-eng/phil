import { Router, type IRouter } from "express";
import { eq, isNull, gte, and, sql } from "drizzle-orm";
import { db, programmesTable, clientsTable } from "@workspace/db";
import type { Session } from "@workspace/db";

const MONTHLY_LIMIT = 2;

const router: IRouter = Router();

router.get("/programmes", async (req, res): Promise<void> => {
  const clientIdParam = req.query.clientId as string | undefined;
  const all = req.query.all === "true";

  if (all) {
    const programmes = await db.select().from(programmesTable).orderBy(programmesTable.updatedAt);
    res.json(programmes.reverse());
    return;
  }

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
  const { title, sessions, clientId } = req.body as { title: string; sessions?: Session[]; clientId?: number };
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }

  // Safety-net: enforce monthly limit at save time too (respects creditResetAt)
  if (clientId !== undefined && clientId !== null && !isNaN(Number(clientId))) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [clientRow] = await db.select({ creditResetAt: clientsTable.creditResetAt }).from(clientsTable).where(eq(clientsTable.id, Number(clientId)));
    const cutoff = clientRow?.creditResetAt && clientRow.creditResetAt > startOfMonth
      ? clientRow.creditResetAt
      : startOfMonth;
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(programmesTable)
      .where(and(eq(programmesTable.clientId, Number(clientId)), gte(programmesTable.createdAt, cutoff)));
    const count = rows[0]?.count ?? 0;
    if (count >= MONTHLY_LIMIT) {
      res.status(429).json({ error: "monthly_limit_reached" });
      return;
    }
  }

  const values: { title: string; sessions: Session[]; clientId?: number } = { title, sessions: sessions ?? [] };
  if (clientId !== undefined && clientId !== null && !isNaN(Number(clientId))) values.clientId = Number(clientId);
  const [programme] = await db
    .insert(programmesTable)
    .values(values)
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
