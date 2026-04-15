import { pgTable, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientBaselinesTable = pgTable("client_baselines", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().unique().references(() => clientsTable.id, { onDelete: "cascade" }),
  benchKg: numeric("bench_kg", { precision: 6, scale: 1 }),
  squatKg: numeric("squat_kg", { precision: 6, scale: 1 }),
  deadliftKg: numeric("deadlift_kg", { precision: 6, scale: 1 }),
  fiveKSeconds: integer("five_k_seconds"),
  tenKSeconds: integer("ten_k_seconds"),
  halfMarathonSeconds: integer("half_marathon_seconds"),
  marathonSeconds: integer("marathon_seconds"),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  setManually: boolean("set_manually").notNull().default(true),
});

export const insertClientBaselineSchema = createInsertSchema(clientBaselinesTable).omit({ id: true, setAt: true });
export type InsertClientBaseline = z.infer<typeof insertClientBaselineSchema>;
export type ClientBaseline = typeof clientBaselinesTable.$inferSelect;
