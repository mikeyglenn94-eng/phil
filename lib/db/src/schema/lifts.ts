import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const clientLiftsTable = pgTable("client_lifts", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  exerciseName: text("exercise_name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientLiftSchema = createInsertSchema(clientLiftsTable).omit({ id: true, createdAt: true });
export type InsertClientLift = z.infer<typeof insertClientLiftSchema>;
export type ClientLift = typeof clientLiftsTable.$inferSelect;

export const clientOneRMsTable = pgTable("client_one_rms", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  exerciseName: text("exercise_name").notNull(),
  weightKg: numeric("weight_kg", { precision: 6, scale: 1 }).notNull(),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default("manual"),
});

export const insertClientOneRMSchema = createInsertSchema(clientOneRMsTable).omit({ id: true, loggedAt: true });
export type InsertClientOneRM = z.infer<typeof insertClientOneRMSchema>;
export type ClientOneRM = typeof clientOneRMsTable.$inferSelect;
