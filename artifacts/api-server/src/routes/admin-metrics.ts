import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole, extractAuth } from "../middlewares/require-auth";

const router: IRouter = Router();
const adminOnly = requireRole("admin");

// ── GET /api/admin/metrics ────────────────────────────────────────────────────

router.get("/admin/metrics", adminOnly, async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();

  const [
    apiCostsByUser,
    apiCostsPlatform,
    philByUser,
    philPlatformAvg,
    sessionEventsByUser,
    allUsersRaw,
    activeUsersRaw,
    newUsersRaw,
    churnedUsersRaw,
    programmesRaw,
    lastSessionRaw,
    monthlyActiveRaw,
  ] = await Promise.all([
    // API costs per user per month
    db.execute(sql`
      SELECT
        u.email,
        u.id AS user_id,
        to_char(date_trunc('month', ac.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        COUNT(*)::int AS call_count,
        SUM(ac.total_tokens)::int AS total_tokens,
        ROUND(SUM(ac.estimated_cost_usd)::numeric, 6)::float AS total_cost_usd
      FROM api_costs ac
      JOIN users u ON u.id = ac.user_id
      GROUP BY u.email, u.id, date_trunc('month', ac.created_at AT TIME ZONE 'UTC')
      ORDER BY month DESC, total_cost_usd DESC
    `),

    // Overall platform spend per month
    db.execute(sql`
      SELECT
        to_char(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        COUNT(*)::int AS call_count,
        SUM(total_tokens)::int AS total_tokens,
        ROUND(SUM(estimated_cost_usd)::numeric, 6)::float AS total_cost_usd
      FROM api_costs
      GROUP BY date_trunc('month', created_at AT TIME ZONE 'UTC')
      ORDER BY month DESC
    `),

    // Phil interactions per user per month + type
    db.execute(sql`
      SELECT
        u.email,
        pi.interaction_type,
        to_char(date_trunc('month', pi.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        COUNT(*)::int AS count
      FROM phil_interactions pi
      JOIN users u ON u.id = pi.user_id
      GROUP BY u.email, pi.interaction_type, date_trunc('month', pi.created_at AT TIME ZONE 'UTC')
      ORDER BY month DESC, count DESC
    `),

    // Average Phil interactions per user per month (platform-wide)
    db.execute(sql`
      SELECT
        to_char(date_trunc('month', pi.created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
        COUNT(*)::int AS total_interactions,
        COUNT(DISTINCT pi.user_id)::int AS active_users,
        ROUND((COUNT(*)::numeric / NULLIF(COUNT(DISTINCT pi.user_id), 0)), 1)::float AS avg_per_user
      FROM phil_interactions pi
      GROUP BY date_trunc('month', pi.created_at AT TIME ZONE 'UTC')
      ORDER BY month DESC
    `),

    // Session events per user — started vs completed
    db.execute(sql`
      SELECT
        u.email,
        se.event_type,
        COUNT(*)::int AS count
      FROM session_events se
      JOIN users u ON u.id = se.user_id
      GROUP BY u.email, se.event_type
      ORDER BY u.email, se.event_type
    `),

    // All registered users
    db.execute(sql`
      SELECT id, email, roles, created_at, last_login_at
      FROM users
      ORDER BY created_at DESC
    `),

    // Active users (session event in last 30 days)
    db.execute(sql`
      SELECT COUNT(DISTINCT user_id)::int AS count
      FROM session_events
      WHERE created_at > ${thirtyDaysAgo}::timestamptz
    `),

    // New users this month
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE created_at >= ${startOfMonth}::timestamptz
    `),

    // Churned: no session event in 60 days, registered more than 60 days ago
    db.execute(sql`
      SELECT COUNT(DISTINCT u.id)::int AS count
      FROM users u
      WHERE u.created_at < ${sixtyDaysAgo}::timestamptz
        AND u.id NOT IN (
          SELECT DISTINCT user_id FROM session_events WHERE created_at > ${sixtyDaysAgo}::timestamptz
        )
        AND NOT EXISTS (SELECT 1 FROM unnest(u.roles) r WHERE r = 'admin')
    `),

    // Programmes per user + generated count
    db.execute(sql`
      SELECT
        u.email,
        COUNT(p.id)::int AS programmes_generated,
        SUM(CASE WHEN p.created_at >= ${twentyOneDaysAgo}::timestamptz THEN 0 ELSE 1 END)::int AS old_programmes
      FROM programmes p
      JOIN clients c ON c.id = p.client_id
      JOIN users u ON u.client_id = c.id
      GROUP BY u.email
      ORDER BY programmes_generated DESC
    `),

    // Days since last completed session per user
    db.execute(sql`
      SELECT
        u.email,
        MAX(se.created_at) AS last_session_at,
        EXTRACT(DAY FROM NOW() - MAX(se.created_at))::int AS days_since_last_session
      FROM session_events se
      JOIN users u ON u.id = se.user_id
      WHERE se.event_type = 'completed'
      GROUP BY u.email
      ORDER BY last_session_at DESC
    `),

    // Monthly active users vs registered (last 6 months)
    db.execute(sql`
      SELECT
        to_char(date_trunc('month', m.month), 'YYYY-MM') AS month,
        COUNT(DISTINCT se.user_id)::int AS active_users,
        (SELECT COUNT(*)::int FROM users WHERE created_at <= (date_trunc('month', m.month) + interval '1 month')) AS registered_at_month_end
      FROM generate_series(
        date_trunc('month', NOW() - interval '5 months'),
        date_trunc('month', NOW()),
        interval '1 month'
      ) m(month)
      LEFT JOIN session_events se
        ON date_trunc('month', se.created_at AT TIME ZONE 'UTC') = date_trunc('month', m.month)
      GROUP BY m.month
      ORDER BY m.month DESC
    `),
  ]);

  // Abandoned programmes: >21 days old with no completed session event linked to them
  const abandonedProgrammesRaw = await db.execute(sql`
    SELECT
      u.email,
      COUNT(p.id)::int AS abandoned_count
    FROM programmes p
    JOIN clients c ON c.id = p.client_id
    JOIN users u ON u.client_id = c.id
    WHERE p.created_at < ${twentyOneDaysAgo}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM session_events se
        WHERE se.user_id = u.id
          AND se.programme_id = p.id
          AND se.event_type = 'completed'
          AND se.created_at > ${twentyOneDaysAgo}::timestamptz
      )
    GROUP BY u.email
    ORDER BY abandoned_count DESC
  `);

  res.json({
    apiCosts: {
      byUser: apiCostsByUser.rows,
      platform: apiCostsPlatform.rows,
    },
    philUsage: {
      byUser: philByUser.rows,
      platformAvg: philPlatformAvg.rows,
    },
    sessionActivity: {
      events: sessionEventsByUser.rows,
      lastSession: lastSessionRaw.rows,
    },
    programmes: {
      byUser: programmesRaw.rows,
      abandoned: abandonedProgrammesRaw.rows,
    },
    business: {
      allUsers: (allUsersRaw.rows as any[]).map(u => ({
        id: u.id,
        email: u.email,
        roles: u.roles,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
      })),
      totalRegistered: (allUsersRaw.rows as any[]).filter(u => !(u.roles as string[]).includes("admin")).length,
      activeUsers: (activeUsersRaw.rows[0] as any)?.count ?? 0,
      newUsersThisMonth: (newUsersRaw.rows[0] as any)?.count ?? 0,
      churnedUsers: (churnedUsersRaw.rows[0] as any)?.count ?? 0,
      monthlyComparison: monthlyActiveRaw.rows,
    },
  });
});

// ── POST /api/session-events ──────────────────────────────────────────────────

router.post("/session-events", async (req, res): Promise<void> => {
  extractAuth(req);
  const user = req.auth;
  if (!user?.userId) {
    res.status(401).json({ error: "Unauthorised" });
    return;
  }

  const { sessionId, programmeId, eventType, clientId: bodyClientId } = req.body as {
    sessionId?: string;
    programmeId?: number | null;
    eventType?: string;
    clientId?: number;
  };

  if (!sessionId || !eventType || !["started", "completed"].includes(eventType)) {
    res.status(400).json({ error: "sessionId and eventType (started|completed) are required" });
    return;
  }

  const clientId = bodyClientId ?? user.clientId ?? null;
  if (!clientId) {
    res.status(400).json({ error: "clientId required" });
    return;
  }

  await db.execute(sql`
    INSERT INTO session_events (user_id, client_id, session_id, programme_id, event_type)
    VALUES (${user.userId}, ${clientId}, ${sessionId}, ${programmeId ?? null}, ${eventType})
  `);

  res.json({ ok: true });
});

export default router;
