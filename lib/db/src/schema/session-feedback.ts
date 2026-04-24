import { pgTable, text, serial, timestamp, integer, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { programmesTable } from "./programmes";

export const sessionFeedbackRatingEnum = pgEnum("session_feedback_rating", ["smashed", "clean", "grim"]);

export const sessionFeedbackTable = pgTable("session_feedback", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  programmeId: integer("programme_id").references(() => programmesTable.id, { onDelete: "set null" }),
  rating: sessionFeedbackRatingEnum("rating").notNull(),
  notes: text("notes"),
  voiceNoteUrl: text("voice_note_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqClientSession: uniqueIndex("session_feedback_client_session_unique").on(t.clientId, t.sessionId),
}));

export const insertSessionFeedbackSchema = createInsertSchema(sessionFeedbackTable).omit({ id: true, createdAt: true });
export type InsertSessionFeedback = z.infer<typeof insertSessionFeedbackSchema>;
export type SessionFeedback = typeof sessionFeedbackTable.$inferSelect;
