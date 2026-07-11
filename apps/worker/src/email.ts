// Pluggable email sender (same pattern as the auth provider). Dev logs the digest
// and relies on the S3 link; swap in ResendSender/SesSender later behind this interface.
export type Email = { to: string; subject: string; html: string; text: string };

export interface EmailSender {
  send(email: Email): Promise<void>;
}

/** Dev sender — logs the digest (the rendered HTML also lands in S3). No API key. */
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
    private from = process.env.EMAIL_FROM ?? "KubePilot <digests@kubepilot.dev>",
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
