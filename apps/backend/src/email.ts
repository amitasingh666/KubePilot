// Pluggable email sender (same pattern as the auth provider, mirrors apps/worker/src/email.ts).
// Dev logs the message; production sends via Resend when RESEND_API_KEY is set. Swap in
// SES/etc. behind this interface without touching callers.
export type Email = { to: string; subject: string; html: string; text: string };

export interface EmailSender {
  send(email: Email): Promise<void>;
}

/** Dev sender — logs the email to the console. No API key required. */
export class DevEmailSender implements EmailSender {
  async send(email: Email): Promise<void> {
    console.log(`📧 [dev-email] to=${email.to} subject="${email.subject}"`);
    console.log(email.text);
  }
}

/** Production sender via Resend's HTTP API (uses global fetch — no SDK dependency). */
export class ResendEmailSender implements EmailSender {
  constructor(
    private apiKey: string,
    private from = process.env.EMAIL_FROM ?? "KubePilot <no-reply@kubepilot.dev>",
  ) {}

  async send(email: Email): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: email.to, subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}

// Pick the sender from env: Resend when RESEND_API_KEY is set, else the dev logger.
// Same interface either way, so nothing downstream changes.
export const emailSender: EmailSender = process.env.RESEND_API_KEY
  ? new ResendEmailSender(process.env.RESEND_API_KEY)
  : new DevEmailSender();

/** Render the "you've been invited" email. `inviteUrl` is the accept link with the token. */
export function renderInviteEmail(opts: {
  companyName: string;
  role: string;
  inviteUrl: string;
  invitedByEmail?: string | null;
}): Email {
  const { companyName, role, inviteUrl, invitedByEmail } = opts;
  const inviter = invitedByEmail ? `${invitedByEmail} has invited you` : "You've been invited";
  const subject = `You're invited to join ${companyName} on KubePilot`;

  const text = [
    `${inviter} to join ${companyName} on KubePilot as ${role}.`,
    ``,
    `Accept your invite and set a password here:`,
    inviteUrl,
    ``,
    `This link expires in 7 days. If you weren't expecting this, you can ignore this email.`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 12px">Join ${escapeHtml(companyName)} on KubePilot</h2>
      <p style="margin:0 0 16px;color:#444">${escapeHtml(inviter)} to join <strong>${escapeHtml(companyName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Accept invite</a>
      </p>
      <p style="margin:0 0 8px;color:#666;font-size:13px">Or paste this link into your browser:</p>
      <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
      <p style="margin:0;color:#999;font-size:12px">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
    </div>
  `.trim();

  return { to: "", subject, html, text };
}

/** Render the registration verification-code email. */
export function renderOtpEmail(opts: { otp: string; companyName: string }): Email {
  const { otp, companyName } = opts;
  const subject = `Your KubePilot verification code: ${otp}`;

  const text = [
    `Welcome to KubePilot!`,
    ``,
    `Your verification code for ${companyName} is:`,
    ``,
    `    ${otp}`,
    ``,
    `Enter it to finish creating your account. This code expires in 10 minutes.`,
    `If you didn't request this, you can ignore this email.`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 12px">Verify your email</h2>
      <p style="margin:0 0 16px;color:#444">Enter this code to finish creating <strong>${escapeHtml(companyName)}</strong> on KubePilot:</p>
      <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;color:#4f46e5">${escapeHtml(otp)}</p>
      <p style="margin:0;color:#999;font-size:12px">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  `.trim();

  return { to: "", subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
