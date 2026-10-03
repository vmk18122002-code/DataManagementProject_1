import { Injectable, Logger } from "@nestjs/common";
import { Transporter, createTransport } from "nodemailer";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/*
  Outgoing email through SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
  When SMTP_HOST is not set nothing is sent and the caller is told so, so the API still works on a laptop.
*/
@Injectable()
export class MailService {
  private readonly log = new Logger("Mail");
  private readonly transport?: Transporter;

  constructor() {
    const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = process.env;
    if (!host) {
      this.log.warn("SMTP_HOST is not set: emails are not sent");
      return;
    }
    const port = Number(process.env.SMTP_PORT ?? 587);
    this.transport = createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined });
  }

  /** Returns true when the mail server accepted the message. */
  private async send(to: string, subject: string, text: string, html: string): Promise<boolean> {
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to, subject, text, html });
      return true;
    } catch (e) {
      this.log.error(`could not send "${subject}" to ${to}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Welcome email for a new collector: where to sign in and their temporary password. */
  collectorInvite(c: { name: string; email: string; district: string; org: string; dropoff: string }, tempPassword: string, hours: number) {
    const link = `${(process.env.PORTAL_URL ?? "http://localhost:3000").replace(/\/$/, "")}/collector/login`;
    const text = [
      `Hello ${c.name},`,
      "",
      `${c.org || "ReliefHub"} has added you as a collector for ${c.district} district.`,
      `You collect donations from donors in ${c.district} and bring them to ${c.dropoff}.`,
      "",
      `Sign in: ${link}`,
      `Email: ${c.email}`,
      `Temporary password: ${tempPassword}`,
      "",
      `The temporary password works for ${hours} hours. You will be asked to choose your own password when you sign in.`,
      "If you did not expect this email, you can ignore it.",
    ].join("\n");
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
  <h2 style="color:#047857;margin:0 0 16px">ReliefHub</h2>
  <p>Hello ${esc(c.name)},</p>
  <p><b>${esc(c.org || "ReliefHub")}</b> has added you as a collector for <b>${esc(c.district)}</b> district.
     You collect donations from donors in ${esc(c.district)} and bring them to <b>${esc(c.dropoff)}</b>.</p>
  <table style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td><b>${esc(c.email)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Temporary password</td>
        <td><b style="font-family:Consolas,monospace;font-size:16px">${esc(tempPassword)}</b></td></tr>
  </table>
  <p><a href="${esc(link)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;
     padding:12px 20px;border-radius:8px;font-weight:bold">Sign in to the Collector Portal</a></p>
  <p style="color:#6b7280;font-size:13px">The temporary password works for ${hours} hours. You will be asked to choose your own password when you sign in.
     If the button does not work, open ${esc(link)}<br>If you did not expect this email, you can ignore it.</p>
</div>`;
    return this.send(c.email, "Your ReliefHub collector account", text, html);
  }

  /** "Forgot password?": a temporary password to get back in. */
  passwordReset(a: { name: string; email: string; kind: "donor" | "org"; collector?: boolean }, tempPassword: string, hours: number) {
    const base = (process.env.PORTAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const link = a.kind === "donor" ? `${base}/donor/login` : a.collector ? `${base}/collector/login` : `${base}/`;
    const text = [
      `Hello ${a.name},`,
      "",
      "Someone asked to reset the password of your ReliefHub account.",
      "",
      `Sign in: ${link}`,
      `Email: ${a.email}`,
      `Temporary password: ${tempPassword}`,
      "",
      `It works for ${hours} hours. After signing in with it you choose a new password.`,
      "If this was not you, ignore this email: your current password still works.",
    ].join("\n");
    const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
  <h2 style="color:#047857;margin:0 0 16px">ReliefHub</h2>
  <p>Hello ${esc(a.name)},</p>
  <p>Someone asked to reset the password of your ReliefHub account.</p>
  <table style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 16px;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td><b>${esc(a.email)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Temporary password</td>
        <td><b style="font-family:Consolas,monospace;font-size:16px">${esc(tempPassword)}</b></td></tr>
  </table>
  <p><a href="${esc(link)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;
     padding:12px 20px;border-radius:8px;font-weight:bold">Sign in to ReliefHub</a></p>
  <p style="color:#6b7280;font-size:13px">It works for ${hours} hours. After signing in with it you choose a new password.
     If the button does not work, open ${esc(link)}<br>If this was not you, ignore this email: your current password still works.</p>
</div>`;
    return this.send(a.email, "Reset your ReliefHub password", text, html);
  }
}