import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const clientNotesTable = pgTable("client_notes", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  coachId: integer("coach_id"),
  sessionId: text("session_id").notNull(),
  exerciseId: text("exercise_id"),
  noteText: text("note_text").notNull(),
  readByCoach: boolean("read_by_coach").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientNoteSchema = createInsertSchema(clientNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type ClientNote = typeof clientNotesTable.$inferSelect;
