import { Router, type IRouter } from "express";
import { db, sessionLibraryTable } from "@workspace/db";
import { or, isNull, eq } from "drizzle-orm";

const router: IRouter = Router();

// ── Save a session to the library ────────────────────────────────────────────
// POST /api/session-library
// body: { name, type, sessionData, clientId? (null = public, id = private) }
router.post("/session-library", async (req, res): Promise<void> => {
  const { name, type, sessionData, clientId } = req.body as {
    name: string;
    type: string;
    sessionData: any;
    clientId?: number | null;
  };

  if (!name?.trim() || !type || !sessionData) {
    res.status(400).json({ error: "name, type, and sessionData are required" });
    return;
  }

  try {
    const [entry] = await db.insert(sessionLibraryTable).values({
      name: name.trim(),
      type,
      sessionData,
      clientId: clientId ?? null,
      tags: [],
    }).returning();
    res.json(entry);
  } catch (err) {
    req.log.error({ err }, "Error saving to session library");
    res.status(500).json({ error: "Failed to save session" });
  }
});

// ── Search the session library ────────────────────────────────────────────────
// POST /api/session-library/search
// body: { query, clientId? }
router.post("/session-library/search", async (req, res): Promise<void> => {
  const { query, clientId } = req.body as { query: string; clientId?: number | null };

  try {
    const rows = await db.select().from(sessionLibraryTable).where(
      clientId != null
        ? or(isNull(sessionLibraryTable.clientId), eq(sessionLibraryTable.clientId, clientId))
        : isNull(sessionLibraryTable.clientId)
    );

    const q = (query ?? "").toLowerCase().trim();
    const scored = rows
      .map(row => {
        const sd = row.sessionData as any;
        const corpus = [
          row.name,
          row.type,
          sd?.name ?? "",
          ...(sd?.exercises ?? []).map((e: any) => `${e.name ?? ""} ${e.rawText ?? ""}`),
          sd?.structure ?? "",
        ].join(" ").toLowerCase();

        let score = 0;
        if (!q) { score = 1; }
        else {
          if (corpus.includes(q)) score += 20;
          q.split(/\s+/).filter((w: string) => w.length > 2).forEach((word: string) => {
            if (corpus.includes(word)) score += 8;
          });
        }
        return { row, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ row }) => ({
        id: `sl-${row.id}`,
        name: row.name,
        type: row.type,
        isPrivate: row.clientId != null,
        subtitle: row.type.charAt(0).toUpperCase() + row.type.slice(1) + " session",
        score: 1,
        source: "saved_session" as const,
        bucket: row.type === "wod" ? "wod" : row.type === "run" ? "run" : "strength",
        isBlock: false,
        tags: (row.tags as string[]) ?? [],
        raw: { ...row.sessionData, _libraryId: row.id, _libraryName: row.name },
      }));

    res.json({ results: scored });
  } catch (err) {
    req.log.error({ err }, "Error searching session library");
    res.status(500).json({ error: "Search failed" });
  }
});

// ── Export the sync search helper for brain.ts ─────────────────────────────
export function searchSessionLibrarySync(
  allRows: any[],
  query: string,
  clientId: number | null | undefined,
  limit: number
): any[] {
  const accessible = allRows.filter(r =>
    r.clientId == null || r.clientId === clientId
  );
  const q = (query ?? "").toLowerCase().trim();
  return accessible
    .map((row: any) => {
      const sd = row.sessionData as any;
      const corpus = [
        row.name,
        row.type,
        sd?.name ?? "",
        ...(sd?.exercises ?? []).map((e: any) => `${e.name ?? ""} ${e.rawText ?? ""}`),
        sd?.structure ?? "",
      ].join(" ").toLowerCase();

      let score = 0;
      if (!q) score = 1;
      else {
        if (corpus.includes(q)) score += 20;
        q.split(/\s+/).filter((w: string) => w.length > 2).forEach((word: string) => {
          if (corpus.includes(word)) score += 8;
        });
      }
      return { row, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }: any) => ({
      id: `sl-${row.id}`,
      name: row.name,
      type: row.type,
      isPrivate: row.clientId != null,
      subtitle: (row.clientId != null ? "My Session · " : "Library · ") +
        row.type.charAt(0).toUpperCase() + row.type.slice(1),
      score: 1,
      source: "saved_session" as const,
      bucket: row.type === "wod" ? "wod" : row.type === "run" ? "run" : "strength",
      isBlock: false,
      tags: (row.tags as string[]) ?? [],
      raw: { ...row.sessionData, _libraryId: row.id, _libraryName: row.name },
    }));
}

export default router;
