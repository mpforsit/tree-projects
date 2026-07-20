import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import pg from "pg";
import { latestMailTo, otpFrom } from "./mail.ts";

/** Owner connection for test setup (domain claims etc.). */
export function ownerClient(): pg.Client {
  return new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
}

export const TENANT_A = "11111111-1111-4111-8111-111111111111";

/** Storage-state file for a seed user (written by auth.setup.ts). */
export function authState(shortName: "mb" | "ik" | "ms" | "ad" | "jt"): string {
  return `.test-auth/${shortName}.json`;
}

/** Full OTP login: email step → mail → 6-box entry → success step. */
export async function loginViaOtp(page: Page, email: string): Promise<void> {
  const before = Date.now();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByText("Check your inbox")).toBeVisible();
  const mail = await latestMailTo(email, before);
  await page.getByLabel("Digit 1").fill(otpFrom(mail));
  await expect(page.getByText("You're in.")).toBeVisible();
  await page.getByRole("button", { name: "Open Lean" }).click();
}
