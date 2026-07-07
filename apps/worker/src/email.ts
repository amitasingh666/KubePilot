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

// The active sender. Swap for a real provider (Resend/SES) in production.
export const emailSender: EmailSender = new DevEmailSender();
