import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  teamsTable,
  teamMembersTable,
  teamSessionsTable,
  clientTeamSessionsTable,
  clientsTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/require-auth";
import type { Request } from "express";
import type { Session, Exercise } from "@workspace/db";

const router: IRouter = Router();
const coachOnly = requireRole("coach");

// ── Helpers ───────────────────────────────────────────────────────────────────

function clearExerciseResults(ex: Exercise): Exercise {
  return {
    ...ex,
    id: crypto.randomUUID(),
    clientComment: null,
    setWeights: undefined,
    setReps: undefined,
  };
}

function clearSessionResults(session: Session, newId: string): Session {
  return {
    ...session,
    id: newId,
    clientComment: null,
    wodResult: undefined,
    runLog: undefined,
    runSurface: undefined,
    trailDifficulty: undefined,
    exercises: (session.exercises ?? []).map(clearExerciseResults),
  } as Session;
}

type ExerciseDiff = {
  exerciseId: string;
  type: "swapped" | "modified" | "unchanged";
  original: Exercise;
  current: Exercise;
};

function diffExercises(original: Exercise[], current: Exercise[]): ExerciseDiff[] {
  return original.map((orig, i) => {
    const cur = current[i];
    if (!cur) return { exerciseId: orig.id, type: "unchanged", original: orig, current: orig };
    if (cur.name !== orig.name) {
      return { exerciseId: orig.id, type: "swapped", original: orig, current: cur };
    }
    const prescriptionChanged =
      cur.sets !== orig.sets ||
      cur.reps !== orig.reps ||
      cur.rpe !== orig.rpe;
    return {
      exerciseId: orig.id,
      type: prescriptionChanged ? "modified" : "unchanged",
      original: orig,
      current: cur,
    };
  });
}

// ── Teams CRUD ────────────────────────────────────────────────────────────────

// GET /teams
router.get("/teams", coachOnly, async (req: Request, res): Promise<void> => {
  const coachId = req.auth!.userId;
  const teams = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.coachId, coachId));

  const result = await Promise.all(
    teams.map(async (team) => {
      const members = await db
        .select()
        .from(teamMembersTable)
        .where(eq(teamMembersTable.teamId, team.id));
      const sessions = await db
        .select()
        .from(teamSessionsTable)
        .where(eq(teamSessionsTable.teamId, team.id));
      return { ...team, memberCount: members.length, sessionCount: sessions.length };
    })
  );

  res.json(result);
});

// POST /teams
router.post("/teams", coachOnly, async (req: Request, res): Promise<void> => {
  const coachId = req.auth!.userId;
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const [team] = await db
    .insert(teamsTable)
    .values({ name: name.trim(), coachId })
    .returning();

  res.status(201).json(team);
});

// GET /teams/:teamId
router.get("/teams/:teamId", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const members = await db
    .select({
      id: teamMembersTable.id,
      teamId: teamMembersTable.teamId,
      clientId: teamMembersTable.clientId,
      joinedAt: teamMembersTable.joinedAt,
      clientName: clientsTable.name,
    })
    .from(teamMembersTable)
    .innerJoin(clientsTable, eq(teamMembersTable.clientId, clientsTable.id))
    .where(eq(teamMembersTable.teamId, teamId));

  const sessions = await db
    .select()
    .from(teamSessionsTable)
    .where(eq(teamSessionsTable.teamId, teamId));

  res.json({ ...team, members, sessions });
});

// POST /teams/:teamId/members
router.post("/teams/:teamId/members", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const { clientId } = req.body as { clientId?: number };
  if (!clientId) { res.status(400).json({ error: "clientId is required" }); return; }

  const [existing] = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.clientId, clientId)));
  if (existing) { res.status(409).json({ error: "Client already in team" }); return; }

  const [member] = await db
    .insert(teamMembersTable)
    .values({ teamId, clientId })
    .returning();

  res.status(201).json(member);
});

// DELETE /teams/:teamId/members/:clientId
router.delete("/teams/:teamId/members/:clientId", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(teamId) || isNaN(clientId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  await db
    .delete(teamMembersTable)
    .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.clientId, clientId)));

  res.json({ ok: true });
});

// ── Team Sessions ─────────────────────────────────────────────────────────────

// GET /teams/:teamId/sessions
router.get("/teams/:teamId/sessions", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const sessions = await db
    .select()
    .from(teamSessionsTable)
    .where(eq(teamSessionsTable.teamId, teamId));

  res.json(sessions);
});

// POST /teams/:teamId/sessions
router.post("/teams/:teamId/sessions", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  if (isNaN(teamId)) { res.status(400).json({ error: "Invalid teamId" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const { sessionData, date } = req.body as { sessionData?: Session; date?: string };
  if (!sessionData || !date) { res.status(400).json({ error: "sessionData and date are required" }); return; }

  const [session] = await db
    .insert(teamSessionsTable)
    .values({ teamId, sessionData, date, status: "draft" })
    .returning();

  res.status(201).json(session);
});

// PUT /teams/:teamId/sessions/:id
router.put("/teams/:teamId/sessions/:id", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  if (isNaN(teamId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [existing] = await db
    .select()
    .from(teamSessionsTable)
    .where(and(eq(teamSessionsTable.id, id), eq(teamSessionsTable.teamId, teamId)));
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
  if (existing.status === "published") { res.status(400).json({ error: "Published sessions cannot be edited" }); return; }

  const { sessionData, date } = req.body as { sessionData?: Session; date?: string };

  const [updated] = await db
    .update(teamSessionsTable)
    .set({
      ...(sessionData ? { sessionData } : {}),
      ...(date ? { date } : {}),
    })
    .where(eq(teamSessionsTable.id, id))
    .returning();

  res.json(updated);
});

// DELETE /teams/:teamId/sessions/:id
router.delete("/teams/:teamId/sessions/:id", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  if (isNaN(teamId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [existing] = await db
    .select()
    .from(teamSessionsTable)
    .where(and(eq(teamSessionsTable.id, id), eq(teamSessionsTable.teamId, teamId)));
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
  if (existing.status === "published") { res.status(400).json({ error: "Published sessions cannot be deleted" }); return; }

  await db.delete(teamSessionsTable).where(eq(teamSessionsTable.id, id));
  res.json({ ok: true });
});

// POST /teams/:teamId/sessions/:id/publish
router.post("/teams/:teamId/sessions/:id/publish", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  if (isNaN(teamId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const [existing] = await db
    .select()
    .from(teamSessionsTable)
    .where(and(eq(teamSessionsTable.id, id), eq(teamSessionsTable.teamId, teamId)));
  if (!existing) { res.status(404).json({ error: "Session not found" }); return; }
  if (existing.status === "published") { res.status(400).json({ error: "Already published" }); return; }

  const members = await db
    .select()
    .from(teamMembersTable)
    .where(eq(teamMembersTable.teamId, teamId));

  const publishedAt = new Date();

  const [published] = await db
    .update(teamSessionsTable)
    .set({ status: "published", publishedAt })
    .where(eq(teamSessionsTable.id, id))
    .returning();

  if (members.length > 0) {
    const clientCopies = members.map((m) => {
      const clean = clearSessionResults(existing.sessionData, crypto.randomUUID());
      return {
        teamSessionId: id,
        clientId: m.clientId,
        sessionData: clean,
        originalSessionData: clean,
      };
    });
    await db.insert(clientTeamSessionsTable).values(clientCopies);
  }

  res.json({ ...published, distributedTo: members.length });
});

// GET /teams/:teamId/sessions/:id/client-copies
router.get("/teams/:teamId/sessions/:id/client-copies", coachOnly, async (req: Request, res): Promise<void> => {
  const teamId = parseInt(req.params.teamId, 10);
  const id = parseInt(req.params.id, 10);
  if (isNaN(teamId) || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) { res.status(404).json({ error: "Team not found" }); return; }
  if (team.coachId !== req.auth!.userId) { res.status(403).json({ error: "Forbidden" }); return; }

  const copies = await db
    .select({
      id: clientTeamSessionsTable.id,
      teamSessionId: clientTeamSessionsTable.teamSessionId,
      clientId: clientTeamSessionsTable.clientId,
      sessionData: clientTeamSessionsTable.sessionData,
      originalSessionData: clientTeamSessionsTable.originalSessionData,
      createdAt: clientTeamSessionsTable.createdAt,
      updatedAt: clientTeamSessionsTable.updatedAt,
      clientName: clientsTable.name,
    })
    .from(clientTeamSessionsTable)
    .innerJoin(clientsTable, eq(clientTeamSessionsTable.clientId, clientsTable.id))
    .where(eq(clientTeamSessionsTable.teamSessionId, id));

  const result = copies.map((copy) => ({
    ...copy,
    diff: diffExercises(
      copy.originalSessionData.exercises ?? [],
      copy.sessionData.exercises ?? []
    ),
  }));

  res.json(result);
});

// ── Client team sessions ──────────────────────────────────────────────────────

// GET /clients/:clientId/team-sessions
router.get("/clients/:clientId/team-sessions", async (req: Request, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }

  const copies = await db
    .select({
      id: clientTeamSessionsTable.id,
      teamSessionId: clientTeamSessionsTable.teamSessionId,
      clientId: clientTeamSessionsTable.clientId,
      sessionData: clientTeamSessionsTable.sessionData,
      originalSessionData: clientTeamSessionsTable.originalSessionData,
      createdAt: clientTeamSessionsTable.createdAt,
      updatedAt: clientTeamSessionsTable.updatedAt,
      date: teamSessionsTable.date,
      teamId: teamSessionsTable.teamId,
      teamName: teamsTable.name,
    })
    .from(clientTeamSessionsTable)
    .innerJoin(teamSessionsTable, eq(clientTeamSessionsTable.teamSessionId, teamSessionsTable.id))
    .innerJoin(teamsTable, eq(teamSessionsTable.teamId, teamsTable.id))
    .where(eq(clientTeamSessionsTable.clientId, clientId));

  res.json(copies);
});

// PUT /client-team-sessions/:id
router.put("/client-team-sessions/:id", async (req: Request, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { sessionData } = req.body as { sessionData?: Session };
  if (!sessionData) { res.status(400).json({ error: "sessionData is required" }); return; }

  const [updated] = await db
    .update(clientTeamSessionsTable)
    .set({ sessionData })
    .where(eq(clientTeamSessionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

export default router;
