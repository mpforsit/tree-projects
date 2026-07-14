/**
 * M4 verify (plan): MB switches tenants and the tree changes completely;
 * a deep link into a foreign tenant 404s (never 403 — existence is not
 * confirmed).
 */
import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers.ts";

test("switching tenants swaps the whole tree", async ({ page }) => {
  await loginViaOtp(page, "mpiksa@forsit.de");
  await page.getByRole("link", { name: "Forsit", exact: true }).click();
  await expect(page.getByTestId("glance-card").filter({ hasText: "myWell" })).toBeVisible();

  await page.getByTestId("avatar-button").click();
  await page.getByTestId("avatar-menu").getByRole("link", { name: "Nebenwerk GmbH" }).click();
  await expect(page.getByTestId("tenant-name")).toHaveText("Nebenwerk GmbH");
  await expect(
    page.getByTestId("glance-card").filter({ hasText: "Büroumbau 2026" }),
  ).toBeVisible();
  await expect(page.getByText("myWell")).not.toBeVisible();
});

test("deep link into a foreign tenant 404s", async ({ page }) => {
  // IK is a member of forsit only → lands there directly (single tenant).
  await loginViaOtp(page, "igor.kraus@forsit.de");
  await expect(page.getByTestId("tenant-name")).toHaveText("Forsit");

  await page.goto("/nebenwerk");
  await expect(page.getByText("404")).toBeVisible();
  await expect(page.getByText("Nicht gefunden.")).toBeVisible();
});
