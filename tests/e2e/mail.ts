/** Read the file-transport outbox (.test-mail/) — see lib/mail.ts. */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const FILE_DIR = join(process.cwd(), ".test-mail");

interface StoredMail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

/** Latest mail sent to the address, waiting up to timeoutMs. */
export async function latestMailTo(
  to: string,
  after: number,
  timeoutMs = 10_000,
): Promise<StoredMail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const files = await readdir(FILE_DIR).catch(() => [] as string[]);
    const candidates = files
      .filter((f) => f.endsWith(".json") && Number(f.split("-")[0]) >= after)
      .sort()
      .reverse();
    for (const f of candidates) {
      const mail = JSON.parse(await readFile(join(FILE_DIR, f), "utf8")) as StoredMail;
      if (mail.to === to) return mail;
    }
    if (Date.now() > deadline) {
      throw new Error(`no mail to ${to} arrived within ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export function otpFrom(mail: StoredMail): string {
  const match = mail.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`no 6-digit code in mail: ${mail.text}`);
  return match[1]!;
}
