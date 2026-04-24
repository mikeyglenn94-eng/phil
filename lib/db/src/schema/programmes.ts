import { pgTable, text, serial, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
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
  setRpe: z.array(z.number().nullable()).optional(), // RPE 1-10 per set, logged by client
  canonicalExerciseKey: z.string().optional(), // internal snake_case movement identity key, never shown to user
});

export const runIntervalSchema = z.object({
  distance: z.number().nullable().optional(), // km
  pace: z.string().nullable().optional(),     // "5:30" = 5 min 30 sec per km
});

export const sessionSchema = z.object({
  id: z.string(),
  date: z.string(), // ISO date string e.g. "2026-03-23" — computed from dayNumber + programme startDate
  dayNumber: z.number().int().optional(), // 1-indexed position in programme (Day 1 = startDate, Day 2 = startDate+1, etc.)
  name: z.string().optional(), // e.g. "Quads", "Upper Body"
  color: z.string().optional(), // hex or named color
  source: z.enum(["wod_brain", "run_brain", "endurance_cycle", "strength_block", "cycle_brain", "swim_brain"]).optional(),
  structure: z.string().optional(),
  guidance: z.string().optional(),
  clientComment: z.string().nullable().optional(),
  runLog: z.array(runIntervalSchema).optional(), // logged intervals for run sessions
  completed: z.boolean().nullable().optional(), // true when athlete taps Finish on the workout logger
  exercises: z.array(exerciseSchema),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type WeekProgression = z.infer<typeof weekProgressionSchema>;
export type Session = z.infer<typeof sessionSchema>;

export const programmesTable = pgTable("programmes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  clientId: integer("client_id"), // null = master programme; set = assigned to a specific client
  sessions: jsonb("sessions").notNull().$type<Session[]>().default([]),
  blockLength: integer("block_length"), // number of weeks in the programme block
  sessionsPerWeek: integer("sessions_per_week"), // training days per week
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProgrammeSchema = createInsertSchema(programmesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProgramme = z.infer<typeof insertProgrammeSchema>;
export type Programme = typeof programmesTable.$inferSelect;
