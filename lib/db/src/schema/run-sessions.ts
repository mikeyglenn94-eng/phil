import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// run_sessions — stores individual structured run sessions
// ─────────────────────────────────────────────────────────────────────────────

export const runSessionsTable = pgTable("run_sessions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sessionType: text("session_type").notNull(),
  notes: text("notes"),
  blocks: jsonb("blocks").notNull().default([]),
  warmUp: jsonb("warm_up"),
  coolDown: jsonb("cool_down"),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRunSessionSchema = createInsertSchema(runSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRunSession = z.infer<typeof insertRunSessionSchema>;
export type RunSession = typeof runSessionsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// endurance_run_templates — named sequences of run sessions (coach uploads only)
// ─────────────────────────────────────────────────────────────────────────────

export const enduranceRunTemplatesTable = pgTable("endurance_run_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sessions: jsonb("sessions").notNull().default([]),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEnduranceRunTemplateSchema = createInsertSchema(enduranceRunTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnduranceRunTemplate = z.infer<typeof insertEnduranceRunTemplateSchema>;
export type EnduranceRunTemplate = typeof enduranceRunTemplatesTable.$inferSelect;
