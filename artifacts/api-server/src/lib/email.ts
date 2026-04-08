import { Resend } from "resend";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "hello@mikeyglenncoaching.com";
const RESEND_API_KEY = process.env.RESEND_API_KEY;

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
