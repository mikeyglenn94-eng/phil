import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const irlAvailabilitySlotsTable = pgTable("irl_availability_slots", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  location: text("location"),
  coachNote: text("coach_note"),
  status: text("status").notNull().default("open"),
  batchId: text("batch_id"),
  googleCalendarEventId: text("google_calendar_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const irlBookingsTable = pgTable("irl_bookings", {
  id: serial("id").primaryKey(),
  slotId: integer("slot_id").notNull().references(() => irlAvailabilitySlotsTable.id),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  creditsUsed: integer("credits_used").notNull().default(1),
  status: text("status").notNull().default("confirmed"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationNote: text("cancellation_note"),
  creditRefunded: boolean("credit_refunded").notNull().default(false),
  googleCalendarEventId: text("google_calendar_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const irlCreditLedgerTable = pgTable("irl_credit_ledger", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  type: text("type").notNull(),
  note: text("note"),
  bookingId: integer("booking_id").references(() => irlBookingsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
});

export const insertIrlSlotSchema = createInsertSchema(irlAvailabilitySlotsTable).omit({ id: true, createdAt: true });
export type InsertIrlSlot = z.infer<typeof insertIrlSlotSchema>;
export type IrlSlot = typeof irlAvailabilitySlotsTable.$inferSelect;

export const insertIrlBookingSchema = createInsertSchema(irlBookingsTable).omit({ id: true, createdAt: true });
export type InsertIrlBooking = z.infer<typeof insertIrlBookingSchema>;
export type IrlBooking = typeof irlBookingsTable.$inferSelect;

export const insertIrlCreditLedgerSchema = createInsertSchema(irlCreditLedgerTable).omit({ id: true, createdAt: true });
export type InsertIrlCreditLedger = z.infer<typeof insertIrlCreditLedgerSchema>;
export type IrlCreditLedger = typeof irlCreditLedgerTable.$inferSelect;
