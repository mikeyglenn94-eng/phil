import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, clientsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { requireRole, signToken } from "../middlewares/require-auth";
import type { Role } from "@workspace/db";

const SALT_ROUNDS = 10;
const router: IRouter = Router();
const adminOnly = requireRole("admin");

// ── Users ──────────────────────────────────────────────────────────────────

// GET /api/admin/users
router.get("/admin/users", adminOnly, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    roles: u.roles,
    clientId: u.clientId,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    status: !u.lastLoginAt ? "login_created" : "active",
  })));
});

// POST /api/admin/users — create new user
router.post("/admin/users", adminOnly, async (req, res): Promise<void> => {
  const { email, password, roles } = req.body as { email?: string; password?: string; roles?: Role[] };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      roles: roles ?? ["athlete"],
    }).returning();
    res.status(201).json({ id: user.id, email: user.email, roles: user.roles, clientId: user.clientId, status: "login_created" });
  } catch (e: any) {
    if (e.code === "23505") {
      res.status(409).json({ error: "A user with this email already exists" });
    } else {
      throw e;
    }
  }
});

// PATCH /api/admin/users/:userId — update email, roles, clientId
router.patch("/admin/users/:userId", adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { email, roles, clientId } = req.body as { email?: string; roles?: Role[]; clientId?: number | null };
  const updates: Record<string, any> = { updatedAt: new Date() };
  if (email !== undefined) updates.email = email.toLowerCase().trim();
  if (roles !== undefined) updates.roles = roles;
  if (clientId !== undefined) updates.clientId = clientId;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: user.id, email: user.email, roles: user.roles, clientId: user.clientId });
});

// POST /api/admin/users/:userId/reset-password
router.post("/admin/users/:userId/reset-password", adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { password } = req.body as { password?: string };
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const [user] = await db.update(usersTable).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ ok: true });
});

// DELETE /api/admin/users/:userId
router.delete("/admin/users/:userId", adminOnly, async (req, res): Promise<void> => {
  const id = parseInt(req.params.userId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

// ── Athlete Linking ────────────────────────────────────────────────────────

// GET /api/admin/athlete-linking — all clients with linked user info
router.get("/admin/athlete-linking", adminOnly, async (_req, res): Promise<void> => {
  const clients = await db.select().from(clientsTable).orderBy(clientsTable.name);
  const users = await db.select().from(usersTable);
  const userByClientId = new Map(users.filter(u => u.clientId).map(u => [u.clientId!, u]));

  const result = clients.map(c => {
    const user = userByClientId.get(c.id) ?? null;
    return {
      clientId: c.id,
      clientName: c.name,
      loginEmail: user?.email ?? null,
      userId: user?.id ?? null,
      status: user ? (user.lastLoginAt ? "active" : "login_created") : "no_login",
    };
  });
  res.json(result);
});

// POST /api/admin/athlete-linking/:clientId/create-login — create user and link to client
router.post("/admin/athlete-linking/:clientId/create-login", adminOnly, async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    const [user] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      passwordHash: hash,
      roles: ["athlete"],
      clientId,
    }).returning();
    res.status(201).json({ userId: user.id, email: user.email, clientId, status: "login_created" });
  } catch (e: any) {
    if (e.code === "23505") {
      res.status(409).json({ error: "A user with this email already exists" });
    } else {
      throw e;
    }
  }
});

// PATCH /api/admin/athlete-linking/:clientId/update-login — update email or password for linked user
router.patch("/admin/athlete-linking/:clientId/update-login", adminOnly, async (req, res): Promise<void> => {
  const clientId = parseInt(req.params.clientId, 10);
  if (isNaN(clientId)) { res.status(400).json({ error: "Invalid clientId" }); return; }
  const { email, password } = req.body as { email?: string; password?: string };
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clientId, clientId));
  if (!user) { res.status(404).json({ error: "No login found for this athlete" }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (email) updates.email = email.toLowerCase().trim();
  if (password) {
    if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
    updates.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  }
  await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

export default router;
