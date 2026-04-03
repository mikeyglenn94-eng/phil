import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wodLibraryTable = pgTable("wod_library", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").notNull(),
  duration: integer("duration").notNull(),
  structure: text("structure").notNull(),
  blocks: jsonb("blocks").notNull(),
  equipment: jsonb("equipment").notNull(),
  tags: jsonb("tags").notNull(),
  rounds: integer("rounds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWodLibrarySchema = createInsertSchema(wodLibraryTable).omit({ id: true, createdAt: true });
export type InsertWodLibrary = z.infer<typeof insertWodLibrarySchema>;
export type WodLibraryEntry = typeof wodLibraryTable.$inferSelect;

export const runLibraryTable = pgTable("run_library", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  duration: integer("duration"),
  distanceKm: integer("distance_km"),
  structure: text("structure").notNull(),
  tags: jsonb("tags").notNull(),
  terrain: jsonb("terrain").notNull(),
  intensity: text("intensity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRunLibrarySchema = createInsertSchema(runLibraryTable).omit({ id: true, createdAt: true });
export type InsertRunLibrary = z.infer<typeof insertRunLibrarySchema>;
export type RunLibraryEntry = typeof runLibraryTable.$inferSelect;

// ── Saved Session Library ───────────────────────────────────────────────────
// clientId = null  → public (visible to everyone via Build From Library)
// clientId = <id> → private (visible only to that client)
export const sessionLibraryTable = pgTable("session_library", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // "strength" | "wod" | "run"
  sessionData: jsonb("session_data").notNull(),
  clientId: integer("client_id"),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSessionLibrarySchema = createInsertSchema(sessionLibraryTable).omit({ id: true, createdAt: true });
export type InsertSessionLibrary = z.infer<typeof insertSessionLibrarySchema>;
export type SessionLibraryEntry = typeof sessionLibraryTable.$inferSelect;
