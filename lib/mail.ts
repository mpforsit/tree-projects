/**
 * Mail delivery: SMTP relay (mailpit locally, transactional provider in
 * production — spec §12). Without SMTP_HOST, or in APP_ENV=test, mails
 * are written as JSON files to .test-mail/ so tests (and dev without
 * docker) can read them deterministically.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { log } from "./log.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const FILE_DIR = join(process.cwd(), ".test-mail");

function useFileTransport(): boolean {
  return process.env.APP_ENV === "test" || !process.env.SMTP_HOST;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (useFileTransport()) {
    await mkdir(FILE_DIR, { recursive: true });
    const file = join(
      FILE_DIR,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    await writeFile(file, JSON.stringify({ ...mail, sentAt: new Date().toISOString() }));
    log.info("mail written to file transport", { to: mail.to, subject: mail.subject });
    return;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "treeops@example.com",
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}
