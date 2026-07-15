/**
 * M9 security pass (plan): OTP throttling under a scripted parallel
 * burst, and tenant-slug bypass attempts against the middleware/layout
 * validation — every variant must 404 (never 403) or redirect to login.
 */
import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { authState } from "./helpers.ts";

const B_TENANT = {
  root: "b1000000-0000-4000-8000-000000000001",
  task: "b2000000-0000-4000-8000-000000000001",
};

test("a parallel OTP burst never yields more than 5 codes per email", async ({
  request,
}) => {
  const email = "burst.target@forsit.example";
  const responses = await Promise.all(
    Array.from({ length: 12 }, () =>
      request.post("/api/login/request-otp", { data: { email } }),
    ),
  );
  for (const r of responses) {
    expect(r.status()).toBe(200); // uniform responses, no enumeration
  }
  // The throttle (advisory-locked, 0025) must have logged at most 5
  // granted requests — count the mails that actually went out.
  const files = await readdir(".test-mail").catch(() => []);
  let mails = 0;
  for (const f of files) {
    const mail = JSON.parse(await readFile(`.test-mail/${f}`, "utf8")) as {
      to: string;
    };
    if (mail.to === email) mails += 1;
  }
  // Unknown address: zero mails regardless (no sign-up); the throttle
  // ledger is the authoritative check.
  expect(mails).toBe(0);
  const pg = await import("pg");
  const client = new pg.default.Client({
    connectionString: process.env.DATABASE_URL_OWNER,
  });
  await client.connect();
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM event
     WHERE type = 'auth.otp_requested' AND payload->>'email' = $1`,
    [email],
  );
  await client.end();
  expect(rows[0]!.n).toBeLessThanOrEqual(5);
});

test.describe("slug/URL bypass attempts as IK (member of forsit only)", () => {
  test.use({ storageState: authState("ik") });

  for (const path of [
    "/nebenwerk",
    "/nebenwerk/my",
    `/nebenwerk/b/${B_TENANT.root}`,
    `/nebenwerk/t/${B_TENANT.task}`,
    "/nebenwerk/admin",
    "/NEBENWERK",
    "/nebenwerk%2F..",
  ]) {
    test(`${path} 404s`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    });
  }

  test("a valid own slug cannot smuggle foreign-tenant ids", async ({ page }) => {
    const branch = await page.goto(`/forsit/b/${B_TENANT.root}`);
    expect(branch?.status()).toBe(404);
    const task = await page.goto(`/forsit/t/${B_TENANT.task}`);
    expect(task?.status()).toBe(404);
    const search = await page.goto("/forsit/search?q=Trockenbau");
    expect(search?.status()).toBe(200);
    await expect(page.getByText("Keine Treffer.")).toBeVisible();
  });
});

test("without a session cookie, tenant routes bounce to /login", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/forsit");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
