import { Resend } from "resend";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "hello@mikeyglenncoaching.com";
const MIKEY_EMAIL = "mikeyglenn94@gmail.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface CoachMessageContext {
  sessionName?: string | null;
  sessionDate?: string | null;
  sessionType?: string | null;
  exercisesLogged?: { name: string; sets?: { weight?: number | null; reps?: number | null }[] }[];
  sessionComment?: string | null;
}

export async function sendCoachMessage(params: {
  fromName: string;
  fromEmail?: string | null;
  message: string;
  context?: CoachMessageContext;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — coach message from ${params.fromName} not sent`);
    return { ok: false, reason: "email_not_configured" };
  }

  const { fromName, fromEmail, message, context } = params;
  const subjectBase = context?.sessionName?.trim()
    ? `Message from ${fromName} re: ${context.sessionName}`
    : `Message from ${fromName}`;

  const ctxLines: string[] = [];
  if (context?.sessionName) ctxLines.push(`<tr><td style="padding:6px 0;color:#666;width:140px;">Session</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(context.sessionName)}</td></tr>`);
  if (context?.sessionDate) ctxLines.push(`<tr><td style="padding:6px 0;color:#666;">Date</td><td style="padding:6px 0;">${escapeHtml(context.sessionDate)}</td></tr>`);
  if (context?.sessionType) ctxLines.push(`<tr><td style="padding:6px 0;color:#666;">Type</td><td style="padding:6px 0;">${escapeHtml(context.sessionType)}</td></tr>`);
  if (fromEmail) ctxLines.push(`<tr><td style="padding:6px 0;color:#666;">Athlete email</td><td style="padding:6px 0;">${escapeHtml(fromEmail)}</td></tr>`);

  let exercisesHtml = "";
  if (context?.exercisesLogged?.length) {
    const rows = context.exercisesLogged.map(ex => {
      const setsTxt = (ex.sets ?? [])
        .map((s, i) => {
          const w = s.weight != null ? `${s.weight}kg` : "—";
          const r = s.reps != null ? `${s.reps}` : "—";
          return `Set ${i + 1}: ${w} × ${r}`;
        })
        .join(" · ");
      return `<li style="margin:6px 0;"><strong>${escapeHtml(ex.name)}</strong>${setsTxt ? `<br/><span style="color:#666;font-size:13px;">${escapeHtml(setsTxt)}</span>` : ""}</li>`;
    }).join("");
    exercisesHtml = `
      <h3 style="font-size:14px;margin:20px 0 6px;color:#0a0a0a;">Exercises logged</h3>
      <ul style="padding-left:18px;margin:0;font-size:14px;color:#333;">${rows}</ul>`;
  }

  const commentHtml = context?.sessionComment?.trim()
    ? `<h3 style="font-size:14px;margin:20px 0 6px;color:#0a0a0a;">Athlete's session note</h3>
       <p style="font-size:14px;color:#333;white-space:pre-wrap;margin:0;">${escapeHtml(context.sessionComment.trim())}</p>`
    : "";

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: "MG Coaching <noreply@mikeyglenncoaching.com>",
      to: MIKEY_EMAIL,
      ...(fromEmail ? { replyTo: fromEmail } : {}),
      subject: subjectBase,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0a0a0a;">
          <h2 style="margin:0 0 12px;font-size:18px;">${escapeHtml(subjectBase)}</h2>
          <p style="font-size:14px;color:#333;white-space:pre-wrap;margin:0 0 20px;">${escapeHtml(message)}</p>
          ${ctxLines.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;border-top:1px solid #eee;padding-top:8px;">${ctxLines.join("")}</table>` : ""}
          ${exercisesHtml}
          ${commentHtml}
          <p style="margin-top:24px;font-size:12px;color:#888;">Sent from the MG Coaching app · "Message Mikey"</p>
        </div>
      `,
    });
    return { ok: true };
  } catch (err) {
    console.error("[email] Failed to send coach message:", err);
    return { ok: false, reason: "send_failed" };
  }
}

export async function sendAdminSignupAlert(params: {
  email: string;
  role: string;
  timestamp: Date;
}) {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — skipping signup alert for ${params.email}`);
    return;
  }
  try {
    const resend = new Resend(RESEND_API_KEY);
    const when = params.timestamp.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "full", timeStyle: "short" });
    await resend.emails.send({
      from: "MG Coaching <noreply@mikeyglenncoaching.com>",
      to: ADMIN_EMAIL,
      subject: `New user signup: ${params.email}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 16px; font-size: 18px; color: #0a0a0a;">New user signed up</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #333;">
            <tr><td style="padding: 6px 0; color: #666; width: 120px;">Email</td><td style="padding: 6px 0; font-weight: 600;">${params.email}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Role</td><td style="padding: 6px 0; text-transform: capitalize;">${params.role}</td></tr>
            <tr><td style="padding: 6px 0; color: #666;">Signed up</td><td style="padding: 6px 0;">${when} UTC</td></tr>
          </table>
        </div>
      `,
    });
    console.log(`[email] Signup alert sent for ${params.email}`);
  } catch (err) {
    console.error("[email] Failed to send signup alert:", err);
  }
}
