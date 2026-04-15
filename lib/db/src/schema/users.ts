import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const ROLES = ["athlete", "coach", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  roles: text("roles").array().notNull().default(["athlete"]),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  hasSeenWelcome: boolean("has_seen_welcome").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export function userAccountStatus(user: User | null): "no_login" | "login_created" | "active" {
  if (!user) return "no_login";
  if (!user.lastLoginAt) return "login_created";
  return "active";
}
