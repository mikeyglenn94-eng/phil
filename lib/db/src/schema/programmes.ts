import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const weekProgressionSchema = z.object({
  week: z.number().int(),
  sets: z.number().int().nullable().optional(),
  reps: z.string().nullable().optional(),
  rpe: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
});

export const exerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  sets: z.number().int().nullable().optional(),
  reps: z.string().nullable().optional(),
  rpe: z.string().nullable().optional(),
  rest: z.string().nullable().optional(),
  tempo: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  weekProgression: z.array(weekProgressionSchema).optional(),
  clientComment: z.string().nullable().optional(), // client's post-session comment to coach
  perSetReps: z.array(z.string().nullable()).optional(), // coach-prescribed reps per set
  perSetRpe: z.array(z.string().nullable()).optional(), // coach-prescribed RPE per set
  setWeights: z.array(z.number().nullable()).optional(), // kg per set, logged by client
  setReps: z.array(z.number().nullable()).optional(), // actual reps achieved per set, logged by client
});

export const sessionSchema = z.object({
  id: z.string(),
  date: z.string(), // ISO date string e.g. "2026-03-23"
  name: z.string().optional(), // e.g. "Quads", "Upper Body"
  color: z.string().optional(), // hex or named color
  exercises: z.array(exerciseSchema),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type WeekProgression = z.infer<typeof weekProgressionSchema>;
export type Session = z.infer<typeof sessionSchema>;

export const programmesTable = pgTable("programmes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sessions: jsonb("sessions").notNull().$type<Session[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProgrammeSchema = createInsertSchema(programmesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProgramme = z.infer<typeof insertProgrammeSchema>;
export type Programme = typeof programmesTable.$inferSelect;
