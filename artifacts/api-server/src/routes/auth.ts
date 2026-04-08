import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, clientsTable } from "@workspace/db";
import bcrypt from "bcryptjs";
import { signToken, verifyToken, extractAuth } from "../middlewares/require-auth";

const SALT_ROUNDS = 10;
const router: IRouter = Router();

// GET /api/auth/me — validate token and return current user
router.get("/auth/me", (req, res): void => {
  extractAuth(req);
  if (!req.auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.auth);
});

// POST /api/auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  await db.update(usersTable)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));

  const token = signToken({
    userId: user.id,
    email: user.email,
    roles: user.roles as any,
    clientId: user.clientId ?? null,
  });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      roles: user.roles,
      clientId: user.clientId ?? null,
    },
  });
});

// POST /api/auth/logout — stateless JWT; just acknowledge
router.post("/auth/logout", (_req, res): void => {
  res.json({ ok: true });
});

// POST /api/auth/bootstrap — create first admin if none exists
router.post("/auth/bootstrap", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const existing = await db.select().from(usersTable);
  if (existing.length > 0) {
    res.status(409).json({ error: "Users already exist. Use the admin console to manage accounts." });
    return;
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase().trim(),
    passwordHash: hash,
    roles: ["admin", "coach"],
  }).returning();
  const token = signToken({
    userId: user.id,
    email: user.email,
    roles: user.roles as any,
    clientId: null,
  });
  res.status(201).json({ token, user: { id: user.id, email: user.email, roles: user.roles, clientId: null } });
});

// POST /api/auth/change-password — change own password
router.post("/auth/change-password", async (req, res): Promise<void> => {
  extractAuth(req);
  if (!req.auth) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.auth.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.update(usersTable).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

export default router;
