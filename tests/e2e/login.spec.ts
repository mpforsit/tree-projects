/**
 * M4 verify (plan): OTP happy path, wrong-code lockout after 5, and the
 * enforced-SSO domain refusing OTP. Mails are read from the file
 * transport (.test-mail/).
 */
import { expect, test } from "@playwright/test";
import { TENANT_A, loginViaOtp, ownerClient } from "./helpers.ts";
import { latestMailTo, otpFrom } from "./mail.ts";

test("unauthenticated requests are redirected to /login", async ({ page }) => {
  await page.goto("/forsit");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Invitation-only")).toBeVisible();
});

test("OTP happy path: mail → code boxes → success → picker → tenant", async ({ page }) => {
  await loginViaOtp(page, "mpiksa@forsit.de");
  // MB has two tenants → picker
  await expect(page.getByText("Choose a workspace")).toBeVisible();
  await page.getByRole("link", { name: "Forsit", exact: true }).click();
  await expect(page.getByTestId("tenant-name")).toHaveText("Forsit");
  await expect(page.getByTestId("glance-card").filter({ hasText: "myWell" })).toBeVisible();
});

test("wrong code five times kills the code — the correct one no longer works", async ({
  page,
}) => {
  const email = "igor.kraus@forsit.de";
  const before = Date.now();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  const otp = otpFrom(await latestMailTo(email, before));
  const wrong = otp === "111111" ? "222222" : "111111";

  for (let i = 0; i < 5; i++) {
    const response = page.waitForResponse((r) => r.url().includes("/sign-in/email-otp"));
    await page.getByLabel("Digit 1").fill(wrong);
    expect((await response).status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByTestId("otp-error")).toContainText("invalid or has expired");
  }
  const finalResponse = page.waitForResponse((r) => r.url().includes("/sign-in/email-otp"));
  await page.getByLabel("Digit 1").fill(otp);
  expect((await finalResponse).status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByTestId("otp-error")).toContainText("invalid or has expired");
});

test("an SSO-enforced domain cannot use OTP", async ({ page }) => {
  const db = ownerClient();
  await db.connect();
  try {
    await db.query(
      `INSERT INTO domain_claim (domain, tenant_id, sso_enforced)
       VALUES ('lean.forsit.de', $1, true)`,
      [TENANT_A],
    );
    await page.goto("/login");
    await page.getByLabel("Email address").fill("admin@lean.forsit.de");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await expect(page.getByText("This domain uses single sign-on")).toBeVisible();
    // still on the email step — no code entry appears
    await expect(page.getByText("Check your inbox")).not.toBeVisible();
    await expect(
      latestMailTo("admin@lean.forsit.de", Date.now() - 5_000, 2_000),
    ).rejects.toThrow(/no mail/);
  } finally {
    await db.query("DELETE FROM domain_claim WHERE domain = 'lean.forsit.de'");
    await db.end();
  }
});
