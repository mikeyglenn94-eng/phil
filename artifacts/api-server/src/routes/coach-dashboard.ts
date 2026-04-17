import { Router } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { clientsTable, programmesTable, clientNotesTable, clientOneRMsTable } from "@workspace/db";
import { format, startOfWeek, endOfWeek } from "date-fns";
import type { Session } from "@workspace/db";

const router = Router();

function sessionHasResults(session: Session): boolean {
  return (session.exercises || []).some((ex: any) =>
    (ex.setWeights || []).some((w: any) => w !== null && w !== undefined) ||
    (ex.setReps || []).some((r: any) => r !== null && r !== undefined)
  );
}

router.get("/coach/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const [clients, allProgrammes, unreadNotes, weekOneRMs] = await Promise.all([
    db.select().from(clientsTable).orderBy(clientsTable.name),
    db.select({ id: programmesTable.id, clientId: programmesTable.clientId, title: programmesTable.title, sessions: programmesTable.sessions, createdAt: programmesTable.createdAt })
      .from(programmesTable)
      .orderBy(desc(programmesTable.createdAt)),
    db.select().from(clientNotesTable).where(eq(clientNotesTable.readByCoach, false)),
    db.select().from(clientOneRMsTable).where(
      and(
        gte(clientOneRMsTable.loggedAt, weekStart),
        lte(clientOneRMsTable.loggedAt, weekEnd)
      )
    ),
  ]);

  const latestByClient: Record<number, typeof allProgrammes[0]> = {};
  for (const p of allProgrammes) {
    if (p.clientId && !latestByClient[p.clientId]) {
      latestByClient[p.clientId] = p;
    }
  }

  const unreadByClient: Record<number, typeof unreadNotes> = {};
  for (const n of unreadNotes) {
    if (!unreadByClient[n.clientId]) unreadByClient[n.clientId] = [];
    unreadByClient[n.clientId].push(n);
  }

  const pbsThisWeekByClient: Record<number, Array<{ exerciseName: string; weightKg: string }>> = {};

  if (weekOneRMs.length > 0) {
    const pairs = [...new Set(weekOneRMs.map(r => `${r.clientId}::${r.exerciseName}`))];

    await Promise.all(pairs.map(async pair => {
      const [clientIdStr, exerciseName] = pair.split("::");
      const clientId = parseInt(clientIdStr, 10);

      const allForExercise = await db.select({ weightKg: clientOneRMsTable.weightKg, loggedAt: clientOneRMsTable.loggedAt })
        .from(clientOneRMsTable)
        .where(and(eq(clientOneRMsTable.clientId, clientId), eq(clientOneRMsTable.exerciseName, exerciseName)));

      if (!allForExercise.length) return;

      const maxEver = Math.max(...allForExercise.map(r => parseFloat(r.weightKg)));
      const thisWeekMax = Math.max(
        ...weekOneRMs
          .filter(r => r.clientId === clientId && r.exerciseName === exerciseName)
          .map(r => parseFloat(r.weightKg))
      );

      if (thisWeekMax >= maxEver) {
        if (!pbsThisWeekByClient[clientId]) pbsThisWeekByClient[clientId] = [];
        pbsThisWeekByClient[clientId].push({ exerciseName, weightKg: String(thisWeekMax) });
      }
    }));
  }

  const rows = clients.map(client => {
    const prog = latestByClient[client.id];
    const sessions: Session[] = (prog?.sessions as Session[]) || [];

    const weekSessions = sessions.filter(s => s.date >= weekStartStr && s.date <= weekEndStr);
    const todaySession = weekSessions.find(s => s.date === today);

    const missedCount = weekSessions.filter(s => s.date < today && !sessionHasResults(s)).length;

    let status: "green" | "amber" | "red" | "none" = "none";
    if (missedCount >= 3) {
      status = "red";
    } else if (todaySession) {
      status = sessionHasResults(todaySession) ? "green" : "amber";
    }

    const unread = unreadByClient[client.id] || [];
    const pbs = pbsThisWeekByClient[client.id] || [];

    return {
      clientId: client.id,
      name: client.name,
      status,
      missedCount,
      todaySessionName: todaySession?.name ?? null,
      unreadNotes: unread.map(n => ({
        id: n.id,
        noteText: n.noteText,
        sessionId: n.sessionId,
        updatedAt: n.updatedAt,
      })),
      pbs,
      programmeId: prog?.id ?? null,
      programmeName: prog?.title ?? null,
    };
  });

  rows.sort((a, b) => {
    const score = (r: typeof rows[0]) => {
      let s = 0;
      if (r.status === "red") s += 100;
      if (r.unreadNotes.length > 0) s += 50;
      if (r.status === "amber") s += 10;
      if (r.status === "green") s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  res.json({ today, weekStart: weekStartStr, weekEnd: weekEndStr, clients: rows });
});

export default router;
