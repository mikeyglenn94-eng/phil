import { Router } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientNotesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

router.post("/client-notes", async (req, res): Promise<void> => {
  const { clientId, sessionId, exerciseId, noteText, coachId } = req.body as {
    clientId: number;
    sessionId: string;
    exerciseId?: string | null;
    noteText: string;
    coachId?: number | null;
  };

  if (!clientId || !sessionId || typeof noteText !== "string") {
    res.status(400).json({ error: "clientId, sessionId, and noteText are required" });
    return;
  }

  const trimmed = noteText.trim();

  const exerciseIdVal = exerciseId ?? null;

  const existing = await db
    .select({ id: clientNotesTable.id })
    .from(clientNotesTable)
    .where(
      exerciseIdVal
        ? and(
            eq(clientNotesTable.clientId, clientId),
            eq(clientNotesTable.sessionId, sessionId),
            eq(clientNotesTable.exerciseId, exerciseIdVal)
          )
        : and(
            eq(clientNotesTable.clientId, clientId),
            eq(clientNotesTable.sessionId, sessionId),
            isNull(clientNotesTable.exerciseId)
          )
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(clientNotesTable)
      .set({ noteText: trimmed, readByCoach: false, ...(coachId != null ? { coachId } : {}) })
      .where(eq(clientNotesTable.id, existing[0].id));
    res.status(200).json({ id: existing[0].id, updated: true });
  } else {
    const [row] = await db
      .insert(clientNotesTable)
      .values({
        clientId,
        sessionId,
        exerciseId: exerciseIdVal,
        noteText: trimmed,
        readByCoach: false,
        ...(coachId != null ? { coachId } : {}),
      })
      .returning({ id: clientNotesTable.id });
    res.status(201).json({ id: row.id, updated: false });
  }
});

router.get("/client-notes/all", async (_req, res): Promise<void> => {
  const rows = await db.select().from(clientNotesTable);
  res.json(rows);
});

router.get("/client-notes", async (req, res): Promise<void> => {
  const clientId = parseInt(req.query.clientId as string, 10);
  if (!clientId) { res.status(400).json({ error: "clientId required" }); return; }
  const rows = await db
    .select()
    .from(clientNotesTable)
    .where(eq(clientNotesTable.clientId, clientId))
    .orderBy(desc(clientNotesTable.updatedAt));
  res.json(rows);
});

router.patch("/client-notes/mark-read", async (req, res): Promise<void> => {
  const { clientId, sessionId } = req.body as { clientId: number; sessionId: string };
  if (!clientId || !sessionId) { res.status(400).json({ error: "clientId and sessionId required" }); return; }
  await db
    .update(clientNotesTable)
    .set({ readByCoach: true })
    .where(and(eq(clientNotesTable.clientId, clientId), eq(clientNotesTable.sessionId, sessionId)));
  res.json({ ok: true });
});

export default router;
