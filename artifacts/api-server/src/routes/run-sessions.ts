import { Router, type IRouter } from "express";
import { db, runSessionsTable, enduranceRunTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  PACE_LEXICON,
  EFFORT_LEXICON,
  RUN_SESSION_TYPES,
  RECOVERY_TYPES,
  formatRunBlock,
  formatRunSession,
  type RunBlock,
} from "../run-lexicon";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Lexicon — expose all fixed vocabulary to the frontend
// ─────────────────────────────────────────────────────────────────────────────

router.get("/run-sessions/lexicon", (_req, res): void => {
  res.json({
    paceLexicon: PACE_LEXICON,
    effortLexicon: EFFORT_LEXICON,
    sessionTypes: RUN_SESSION_TYPES,
    recoveryTypes: RECOVERY_TYPES,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Run sessions — CRUD
// ─────────────────────────────────────────────────────────────────────────────

router.get("/run-sessions", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(runSessionsTable).orderBy(runSessionsTable.createdAt);
    const result = rows.map(r => ({
      ...r,
      blocks: r.blocks as RunBlock[],
      display: formatRunSession({
        blocks: r.blocks as RunBlock[],
        warmUp: r.warmUp as RunBlock | null,
        coolDown: r.coolDown as RunBlock | null,
        notes: r.notes,
      }),
    }));
    res.json({ sessions: result });
  } catch (err) {
    res.status(500).json({ error: "Failed to load run sessions" });
  }
});

router.get("/run-sessions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(runSessionsTable).where(eq(runSessionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Session not found" }); return; }
    res.json({
      session: {
        ...row,
        blocks: row.blocks as RunBlock[],
        display: formatRunSession({
          blocks: row.blocks as RunBlock[],
          warmUp: row.warmUp as RunBlock | null,
          coolDown: row.coolDown as RunBlock | null,
          notes: row.notes,
        }),
      },
    });
  } catch {
    res.status(500).json({ error: "Failed to load session" });
  }
});

router.post("/run-sessions", async (req, res): Promise<void> => {
  const { name, sessionType, notes, blocks, warmUp, coolDown, tags } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!sessionType || !(RUN_SESSION_TYPES as readonly string[]).includes(sessionType)) {
    res.status(400).json({ error: `sessionType must be one of: ${RUN_SESSION_TYPES.join(", ")}` });
    return;
  }
  if (!Array.isArray(blocks) || blocks.length === 0) {
    res.status(400).json({ error: "blocks must be a non-empty array of run blocks" });
    return;
  }
  try {
    const [row] = await db.insert(runSessionsTable).values({
      name: name.trim(),
      sessionType,
      notes: notes ?? null,
      blocks,
      warmUp: warmUp ?? null,
      coolDown: coolDown ?? null,
      tags: tags ?? [],
    }).returning();
    res.status(201).json({ session: row });
  } catch (err) {
    res.status(500).json({ error: "Failed to create run session" });
  }
});

router.put("/run-sessions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, sessionType, notes, blocks, warmUp, coolDown, tags } = req.body;
  if (sessionType && !(RUN_SESSION_TYPES as readonly string[]).includes(sessionType)) {
    res.status(400).json({ error: `sessionType must be one of: ${RUN_SESSION_TYPES.join(", ")}` });
    return;
  }
  try {
    const [existing] = await db.select().from(runSessionsTable).where(eq(runSessionsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
    const [updated] = await db.update(runSessionsTable)
      .set({
        ...(name && { name: name.trim() }),
        ...(sessionType && { sessionType }),
        ...(notes !== undefined && { notes }),
        ...(blocks && { blocks }),
        ...(warmUp !== undefined && { warmUp }),
        ...(coolDown !== undefined && { coolDown }),
        ...(tags && { tags }),
        updatedAt: new Date(),
      })
      .where(eq(runSessionsTable.id, id))
      .returning();
    res.json({ session: updated });
  } catch {
    res.status(500).json({ error: "Failed to update session" });
  }
});

router.delete("/run-sessions/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(runSessionsTable).where(eq(runSessionsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete session" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Run session display utility (GET a formatted display of a stored session)
// ─────────────────────────────────────────────────────────────────────────────

router.get("/run-sessions/:id/display", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(runSessionsTable).where(eq(runSessionsTable.id, id));
    if (!row) { res.status(404).json({ error: "Session not found" }); return; }
    const lines = formatRunSession({
      blocks: row.blocks as RunBlock[],
      warmUp: row.warmUp as RunBlock | null,
      coolDown: row.coolDown as RunBlock | null,
      notes: row.notes,
    });
    res.json({ id, name: row.name, display: lines });
  } catch {
    res.status(500).json({ error: "Failed to render session" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility: format/preview a run block or full session without saving
// ─────────────────────────────────────────────────────────────────────────────

router.post("/run-sessions/preview", (req, res): void => {
  const { blocks, warmUp, coolDown, notes } = req.body;
  if (!Array.isArray(blocks)) { res.status(400).json({ error: "blocks must be an array" }); return; }
  try {
    const display = formatRunSession({ blocks, warmUp, coolDown, notes });
    const blockDisplays = (blocks as RunBlock[]).map(b => formatRunBlock(b));
    res.json({ display, blockDisplays });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "Preview failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Endurance run templates — CRUD
// ─────────────────────────────────────────────────────────────────────────────

router.get("/endurance-run-templates", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(enduranceRunTemplatesTable).orderBy(enduranceRunTemplatesTable.createdAt);
    res.json({ templates: rows });
  } catch {
    res.status(500).json({ error: "Failed to load templates" });
  }
});

router.get("/endurance-run-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [row] = await db.select().from(enduranceRunTemplatesTable).where(eq(enduranceRunTemplatesTable.id, id));
    if (!row) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ template: row });
  } catch {
    res.status(500).json({ error: "Failed to load template" });
  }
});

router.post("/endurance-run-templates", async (req, res): Promise<void> => {
  const { name, description, sessions, tags } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!Array.isArray(sessions)) { res.status(400).json({ error: "sessions must be an array" }); return; }
  try {
    const [row] = await db.insert(enduranceRunTemplatesTable).values({
      name: name.trim(),
      description: description ?? null,
      sessions,
      tags: tags ?? [],
    }).returning();
    res.status(201).json({ template: row });
  } catch {
    res.status(500).json({ error: "Failed to create template" });
  }
});

router.put("/endurance-run-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, sessions, tags } = req.body;
  try {
    const [existing] = await db.select().from(enduranceRunTemplatesTable).where(eq(enduranceRunTemplatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }
    const [updated] = await db.update(enduranceRunTemplatesTable)
      .set({
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(sessions && { sessions }),
        ...(tags && { tags }),
        updatedAt: new Date(),
      })
      .where(eq(enduranceRunTemplatesTable.id, id))
      .returning();
    res.json({ template: updated });
  } catch {
    res.status(500).json({ error: "Failed to update template" });
  }
});

router.delete("/endurance-run-templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(enduranceRunTemplatesTable).where(eq(enduranceRunTemplatesTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
