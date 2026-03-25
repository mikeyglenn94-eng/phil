import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  dailyCalorieGoal: integer("daily_calorie_goal"),
  dailyProteinGoal: integer("daily_protein_goal"),
  dailyCarbGoal: integer("daily_carb_goal"),
  dailyFatGoal: integer("daily_fat_goal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export const nutritionEntriesTable = pgTable("nutrition_entries", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // YYYY-MM-DD
  description: text("description").notNull(),
  calories: integer("calories"),
  protein: numeric("protein", { precision: 6, scale: 1 }),
  carbs: numeric("carbs", { precision: 6, scale: 1 }),
  fats: numeric("fats", { precision: 6, scale: 1 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNutritionEntrySchema = createInsertSchema(nutritionEntriesTable).omit({ id: true, createdAt: true });
export type InsertNutritionEntry = z.infer<typeof insertNutritionEntrySchema>;
export type NutritionEntry = typeof nutritionEntriesTable.$inferSelect;
