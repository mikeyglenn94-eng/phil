import { pgTable, serial, integer, varchar, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const apiCostsTable = pgTable("api_costs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  endpoint: varchar("endpoint", { length: 100 }).notNull(),
  model: varchar("model", { length: 50 }).notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const philInteractionsTable = pgTable("phil_interactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  interactionType: varchar("interaction_type", { length: 50 }).notNull().default("conversational"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionEventsTable = pgTable("session_events", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  clientId: integer("client_id").notNull(),
  sessionId: varchar("session_id", { length: 100 }).notNull(),
  programmeId: integer("programme_id"),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
