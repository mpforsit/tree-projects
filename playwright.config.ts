import { defineConfig } from "@playwright/test";

/**
 * E2E against a dev server on a fresh seeded database. Requires
 * DATABASE_URL_OWNER and DATABASE_URL (app_user) to point at the local
 * Postgres; global setup resets the DB, the webServer runs Next.js with
 * the file mail transport (.test-mail/).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  // The dev webServer compiles routes on first hit — allow for it.
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3111",
    // Some CI environments pre-install a Chromium outside Playwright's
    // registry; point at it instead of downloading (PLAYWRIGHT_CHROMIUM
    // set by the runner). Local dev with `playwright install` needs
    // neither.
    ...(process.env.PLAYWRIGHT_CHROMIUM
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM } }
      : {}),
  },
  webServer: {
    command: "pnpm dev --port 3111",
    url: "http://localhost:3111",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      APP_ENV: "test",
      BETTER_AUTH_URL: "http://localhost:3111",
      BETTER_AUTH_SECRET: "e2e-test-secret-not-for-production",
    },
  },
});
