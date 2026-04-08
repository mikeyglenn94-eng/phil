import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@workspace/db";

const JWT_SECRET = process.env.JWT_SECRET || "axis-dev-secret-change-in-prod";

export interface AuthPayload {
  userId: number;
  email: string;
  roles: Role[];
  clientId: number | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function extractAuth(req: Request): void {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const payload = verifyToken(header.slice(7));
    if (payload) req.auth = payload;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  extractAuth(req);
  if (!req.auth) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    extractAuth(req);
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const hasRole = roles.some(r => req.auth!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export { JWT_SECRET };
