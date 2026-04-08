import { Router, type IRouter } from "express";
import { eq, desc, and, sum, sql } from "drizzle-orm";
import {
  db, clientsTable,
  irlAvailabilitySlotsTable, irlBookingsTable, irlCreditLedgerTable,
} from "@workspace/db";
import { requireRole } from "../middlewares/require-auth";
import type { Request } from "express";

const router: IRouter = Router();
const adminOrCoach = requireRole("coach");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getIrlBalance(clientId: number): Promise<number> {
  const [row] = await db
    .select({ total: sum(irlCreditLedgerTable.delta) })
    .from(irlCreditLedgerTable)
    .where(eq(irlCreditLedgerTable.clientId, clientId));
  return Number(row?.total ?? 0);
}

// ── Admin: IRL client flag ─────────────────────────────────────────────────────

// PATCH /api/admin/clients/:clientId/irl-settings
router.patch("/admin/clients/:clientId/irl-settings", adminOrCoach, async (req: Request, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { irlClient } = req.body as { irlClient?: boolean };
  if (typeof irlClient !== "boolean") { res.status(400).json({ error: "irlClient must be boolean" }); return; }
  const [updated] = await db.update(clientsTable).set({ irlClient }).where(eq(clientsTable.id, clientId)).returning();
  if (!updated) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ id: updated.id, irlClient: updated.irlClient });
});

// ── Admin: IRL credits ────────────────────────────────────────────────────────

// GET /api/admin/clients/:clientId/irl-credits
router.get("/admin/clients/:clientId/irl-credits", adminOrCoach, async (req: Request, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const ledger = await db
    .select()
    .from(irlCreditLedgerTable)
    .where(eq(irlCreditLedgerTable.clientId, clientId))
    .orderBy(desc(irlCreditLedgerTable.createdAt));
  const balance = await getIrlBalance(clientId);
  res.json({ balance, ledger });
});

// POST /api/admin/clients/:clientId/irl-credits
router.post("/admin/clients/:clientId/irl-credits", adminOrCoach, async (req: Request, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { delta, type, note } = req.body as { delta?: number; type?: string; note?: string };
  if (!delta || typeof delta !== "number") { res.status(400).json({ error: "delta must be a non-zero number" }); return; }
  const validTypes = ["manual_add", "manual_adjustment", "cancellation_refund"];
  const entryType = validTypes.includes(type ?? "") ? type! : "manual_add";
  const adminEmail = req.auth?.email ?? "admin";
  const [entry] = await db.insert(irlCreditLedgerTable).values({
    clientId,
    delta,
    type: entryType,
    note: note ?? null,
    createdBy: adminEmail,
  }).returning();
  const balance = await getIrlBalance(clientId);
  res.status(201).json({ entry, balance });
});

// ── Admin: Availability slots ─────────────────────────────────────────────────

// GET /api/admin/irl-slots
router.get("/admin/irl-slots", adminOrCoach, async (_req: Request, res): Promise<void> => {
  const slots = await db
    .select()
    .from(irlAvailabilitySlotsTable)
    .orderBy(irlAvailabilitySlotsTable.date, irlAvailabilitySlotsTable.startTime);
  res.json(slots);
});

// POST /api/admin/irl-slots
// Accepts { slots: [{date, startTime, endTime},...], coachNote? }
// Each slot is exactly 60 min. All slots in a batch share a batchId.
router.post("/admin/irl-slots", adminOrCoach, async (req: Request, res): Promise<void> => {
  const body = req.body as {
    slots?: Array<{ date: string; startTime: string; endTime: string }>;
    coachNote?: string;
  };
  if (!body.slots || !Array.isArray(body.slots) || body.slots.length === 0) {
    res.status(400).json({ error: "slots array is required and must be non-empty" }); return;
  }
  for (const s of body.slots) {
    if (!s.date || !s.startTime || !s.endTime) {
      res.status(400).json({ error: "Each slot must have date, startTime, endTime" }); return;
    }
  }
  const batchId = body.slots.length > 1 ? `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
  const rows = body.slots.map(s => ({
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    location: null,
    coachNote: body.coachNote ?? null,
    status: "open" as const,
    batchId,
  }));
  const created = await db.insert(irlAvailabilitySlotsTable).values(rows).returning();
  res.status(201).json(created);
});

// PATCH /api/admin/irl-slots/:slotId
router.patch("/admin/irl-slots/:slotId", adminOrCoach, async (req: Request, res): Promise<void> => {
  const slotId = parseInt(req.params.slotId, 10);
  if (isNaN(slotId)) { res.status(400).json({ error: "Invalid slotId" }); return; }
  const { date, startTime, endTime, location, coachNote, status } = req.body as {
    date?: string; startTime?: string; endTime?: string; location?: string; coachNote?: string; status?: string;
  };
  const updates: Record<string, unknown> = {};
  if (date !== undefined) updates.date = date;
  if (startTime !== undefined) updates.startTime = startTime;
  if (endTime !== undefined) updates.endTime = endTime;
  if (location !== undefined) updates.location = location;
  if (coachNote !== undefined) updates.coachNote = coachNote;
  if (status !== undefined) updates.status = status;
  const [slot] = await db.update(irlAvailabilitySlotsTable).set(updates).where(eq(irlAvailabilitySlotsTable.id, slotId)).returning();
  if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
  res.json(slot);
});

// DELETE /api/admin/irl-slots/:slotId
router.delete("/admin/irl-slots/:slotId", adminOrCoach, async (req: Request, res): Promise<void> => {
  const slotId = parseInt(req.params.slotId, 10);
  if (isNaN(slotId)) { res.status(400).json({ error: "Invalid slotId" }); return; }
  const [existing] = await db.select().from(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, slotId));
  if (!existing) { res.status(404).json({ error: "Slot not found" }); return; }
  if (existing.status === "booked") { res.status(400).json({ error: "Cannot delete a booked slot — cancel the booking first" }); return; }
  await db.delete(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, slotId));
  res.json({ ok: true });
});

// ── Admin: Bookings ───────────────────────────────────────────────────────────

// GET /api/admin/irl-bookings
router.get("/admin/irl-bookings", adminOrCoach, async (_req: Request, res): Promise<void> => {
  const bookings = await db
    .select({
      booking: irlBookingsTable,
      slot: irlAvailabilitySlotsTable,
      client: { id: clientsTable.id, name: clientsTable.name },
    })
    .from(irlBookingsTable)
    .leftJoin(irlAvailabilitySlotsTable, eq(irlBookingsTable.slotId, irlAvailabilitySlotsTable.id))
    .leftJoin(clientsTable, eq(irlBookingsTable.clientId, clientsTable.id))
    .orderBy(desc(irlAvailabilitySlotsTable.date));
  res.json(bookings);
});

// POST /api/admin/irl-bookings — manual booking by admin/coach
router.post("/admin/irl-bookings", adminOrCoach, async (req: Request, res): Promise<void> => {
  const { slotId, clientId, creditsUsed } = req.body as { slotId?: number; clientId?: number; creditsUsed?: number };
  if (!slotId || !clientId) { res.status(400).json({ error: "slotId and clientId are required" }); return; }

  const [slot] = await db.select().from(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, slotId));
  if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
  if (slot.status !== "open") { res.status(409).json({ error: "Slot is not available" }); return; }

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  const credits = creditsUsed ?? 1;

  const [booking] = await db.insert(irlBookingsTable).values({
    slotId, clientId, creditsUsed: credits, status: "confirmed",
  }).returning();

  await db.update(irlAvailabilitySlotsTable).set({ status: "booked" }).where(eq(irlAvailabilitySlotsTable.id, slotId));

  await db.insert(irlCreditLedgerTable).values({
    clientId,
    delta: -credits,
    type: "booking_deduction",
    note: `Booking #${booking.id} — ${slot.date} ${slot.startTime}`,
    bookingId: booking.id,
    createdBy: req.auth?.email ?? "admin",
  });

  res.status(201).json({ booking, slot });
});

// PATCH /api/admin/irl-bookings/:bookingId — update status
router.patch("/admin/irl-bookings/:bookingId", adminOrCoach, async (req: Request, res): Promise<void> => {
  const bookingId = parseInt(req.params.bookingId, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid bookingId" }); return; }

  const [booking] = await db.select().from(irlBookingsTable).where(eq(irlBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const { status, cancellationNote, refundCredits } = req.body as {
    status?: string; cancellationNote?: string; refundCredits?: boolean;
  };

  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (status === "cancelled") {
    updates.cancelledAt = new Date();
    if (cancellationNote) updates.cancellationNote = cancellationNote;
    await db.update(irlAvailabilitySlotsTable).set({ status: "open" }).where(eq(irlAvailabilitySlotsTable.id, booking.slotId));
  }

  if (refundCredits && !booking.creditRefunded) {
    updates.creditRefunded = true;
    const [slot] = await db.select().from(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, booking.slotId));
    await db.insert(irlCreditLedgerTable).values({
      clientId: booking.clientId,
      delta: booking.creditsUsed,
      type: "cancellation_refund",
      note: `Refund for booking #${booking.id}${slot ? ` — ${slot.date} ${slot.startTime}` : ""}`,
      bookingId: booking.id,
      createdBy: req.auth?.email ?? "admin",
    });
  }

  const [updated] = await db.update(irlBookingsTable).set(updates).where(eq(irlBookingsTable.id, bookingId)).returning();
  res.json(updated);
});

// ── Athlete routes ────────────────────────────────────────────────────────────

const athleteAuth = requireRole("athlete");

// GET /api/irl-slots — open slots for IRL-eligible athletes
router.get("/irl-slots", athleteAuth, async (req: Request, res): Promise<void> => {
  if (!req.auth?.clientId) { res.status(403).json({ error: "No linked client" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, req.auth.clientId));
  if (!client?.irlClient) { res.status(403).json({ error: "IRL booking not available for this account" }); return; }
  const today = new Date().toISOString().slice(0, 10);
  const slots = await db
    .select()
    .from(irlAvailabilitySlotsTable)
    .where(and(
      eq(irlAvailabilitySlotsTable.status, "open"),
      sql`${irlAvailabilitySlotsTable.date} >= ${today}`,
    ))
    .orderBy(irlAvailabilitySlotsTable.date, irlAvailabilitySlotsTable.startTime);
  res.json(slots);
});

// GET /api/irl-credits
router.get("/irl-credits", athleteAuth, async (req: Request, res): Promise<void> => {
  if (!req.auth?.clientId) { res.status(403).json({ error: "No linked client" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, req.auth.clientId));
  if (!client?.irlClient) { res.status(403).json({ error: "IRL booking not available" }); return; }
  const balance = await getIrlBalance(req.auth.clientId);
  const ledger = await db
    .select()
    .from(irlCreditLedgerTable)
    .where(eq(irlCreditLedgerTable.clientId, req.auth.clientId))
    .orderBy(desc(irlCreditLedgerTable.createdAt))
    .limit(20);
  res.json({ balance, ledger });
});

// GET /api/irl-bookings — athlete's own bookings
router.get("/irl-bookings", athleteAuth, async (req: Request, res): Promise<void> => {
  if (!req.auth?.clientId) { res.status(403).json({ error: "No linked client" }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, req.auth.clientId));
  if (!client?.irlClient) { res.status(403).json({ error: "IRL booking not available" }); return; }
  const bookings = await db
    .select({ booking: irlBookingsTable, slot: irlAvailabilitySlotsTable })
    .from(irlBookingsTable)
    .leftJoin(irlAvailabilitySlotsTable, eq(irlBookingsTable.slotId, irlAvailabilitySlotsTable.id))
    .where(eq(irlBookingsTable.clientId, req.auth.clientId))
    .orderBy(desc(irlAvailabilitySlotsTable.date));
  res.json(bookings);
});

// POST /api/irl-bookings — athlete books a slot
router.post("/irl-bookings", athleteAuth, async (req: Request, res): Promise<void> => {
  if (!req.auth?.clientId) { res.status(403).json({ error: "No linked client" }); return; }
  const clientId = req.auth.clientId;

  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client?.irlClient) { res.status(403).json({ error: "IRL booking not available for this account" }); return; }

  const { slotId } = req.body as { slotId?: number };
  if (!slotId) { res.status(400).json({ error: "slotId is required" }); return; }

  const [slot] = await db.select().from(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, slotId));
  if (!slot) { res.status(404).json({ error: "Slot not found" }); return; }
  if (slot.status !== "open") { res.status(409).json({ error: "This slot is no longer available" }); return; }

  const balance = await getIrlBalance(clientId);
  if (balance < 1) { res.status(402).json({ error: "Insufficient IRL credits" }); return; }

  const [booking] = await db.insert(irlBookingsTable).values({
    slotId, clientId, creditsUsed: 1, status: "confirmed",
  }).returning();

  await db.update(irlAvailabilitySlotsTable).set({ status: "booked" }).where(eq(irlAvailabilitySlotsTable.id, slotId));

  await db.insert(irlCreditLedgerTable).values({
    clientId,
    delta: -1,
    type: "booking_deduction",
    note: `Booking #${booking.id} — ${slot.date} ${slot.startTime}`,
    bookingId: booking.id,
    createdBy: client.name,
  });

  res.status(201).json({ booking, slot });
});

// POST /api/irl-bookings/:bookingId/cancel
router.post("/irl-bookings/:bookingId/cancel", athleteAuth, async (req: Request, res): Promise<void> => {
  if (!req.auth?.clientId) { res.status(403).json({ error: "No linked client" }); return; }
  const bookingId = parseInt(req.params.bookingId, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid bookingId" }); return; }

  const [booking] = await db.select().from(irlBookingsTable).where(
    and(eq(irlBookingsTable.id, bookingId), eq(irlBookingsTable.clientId, req.auth.clientId))
  );
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status === "cancelled") { res.status(400).json({ error: "Already cancelled" }); return; }

  const [slot] = await db.select().from(irlAvailabilitySlotsTable).where(eq(irlAvailabilitySlotsTable.id, booking.slotId));

  const now = new Date();
  const slotDateTime = slot ? new Date(`${slot.date}T${slot.startTime}:00`) : null;
  const hoursUntilSlot = slotDateTime ? (slotDateTime.getTime() - now.getTime()) / 3600000 : 0;
  const withinPolicy = hoursUntilSlot >= 24;

  await db.update(irlBookingsTable).set({
    status: "cancelled",
    cancelledAt: now,
    creditRefunded: withinPolicy,
  }).where(eq(irlBookingsTable.id, bookingId));

  await db.update(irlAvailabilitySlotsTable).set({ status: "open" }).where(eq(irlAvailabilitySlotsTable.id, booking.slotId));

  if (withinPolicy) {
    await db.insert(irlCreditLedgerTable).values({
      clientId: req.auth.clientId,
      delta: booking.creditsUsed,
      type: "cancellation_refund",
      note: `Refund for booking #${booking.id} (cancelled ${hoursUntilSlot.toFixed(0)}h before)`,
      bookingId: booking.id,
      createdBy: "athlete",
    });
  }

  res.json({ ok: true, creditRefunded: withinPolicy, hoursBeforeSlot: Number(hoursUntilSlot.toFixed(1)) });
});

export default router;
