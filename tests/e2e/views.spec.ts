/**
 * M6 verify (plan, as two members): read-only §15.2 rendering, hidden
 * "+ Teilbereich" for flag-less members, non-clickable skeleton crumbs,
 * the percent→status→rollup round-trip, and the empty-branch state.
 */
import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers.ts";

const B = {
  mywell: "a1000000-0000-4000-8000-000000000002",
  nordhof: "a1000000-0000-4000-8000-000000000003",
  werkbank: "a1000000-0000-4000-8000-000000000005",
  neuland: "a1000000-0000-4000-8000-000000000007",
};
const T = {
  t1: "a2000000-0000-4000-8000-000000000001", // blocked, responsible IK
  w3: "a2000000-0000-4000-8000-00000000000e", // open 0 %, responsible MB, werkbank
};

test("non-responsible member sees grayed controls with tooltip (§15.2)", async ({ page }) => {
  await loginViaOtp(page, "marlene.sommer@forsit.de"); // single tenant → straight in
  await page.goto(`/forsit/t/${T.t1}`);

  const percentSegments = page.getByTestId("percent-control").getByRole("button");
  await expect(percentSegments.first()).toBeDisabled();
  await expect(percentSegments.first()).toHaveAttribute(
    "title",
    "Nur die verantwortliche Person kann dies ändern",
  );
  const statusSegments = page.getByTestId("status-control").getByRole("button");
  await expect(statusSegments.first()).toBeDisabled();
});

test("flag-less member gets no '+ Teilbereich' (hidden, not grayed)", async ({ page }) => {
  await loginViaOtp(page, "jonas.thal@forsit.de");
  await page.goto(`/forsit/b/${B.nordhof}`);
  await expect(page.getByTestId("new-task")).toBeVisible();
  await expect(page.getByTestId("new-project")).toHaveCount(0);
});

test("tenant admin sees '+ Teilbereich'", async ({ page }) => {
  await loginViaOtp(page, "mpiksa@forsit.de");
  await page.getByRole("link", { name: "Forsit", exact: true }).click();
  await page.goto(`/forsit/b/${B.nordhof}`);
  await expect(page.getByTestId("new-project")).toBeVisible();
});

test("skeleton breadcrumb is muted, tooltip'd, and not a link", async ({ page }) => {
  await loginViaOtp(page, "aylin.demir@forsit.de"); // member of mywell + beratung only
  await page.goto(`/forsit/b/${B.mywell}`);

  const crumb = page.getByTestId("skeleton-crumb");
  await expect(crumb).toHaveText(/Forsit Holding/);
  await expect(crumb).toHaveAttribute(
    "title",
    "Nur Pfad sichtbar — kein Mitglied dieses Bereichs",
  );
  const tag = await crumb.evaluate((el) => el.tagName);
  expect(tag).toBe("SPAN");
  await expect(page.getByTestId("breadcrumb").getByRole("link")).toHaveCount(0);
});

test("percent click flips the chip to 'in Arbeit' and updates the branch header (rollup round-trip)", async ({
  page,
}) => {
  await loginViaOtp(page, "mpiksa@forsit.de");
  await page.getByRole("link", { name: "Forsit", exact: true }).click();

  // werkbank: all-zero-weight fallback avg(40, 20, 0) = 20 %
  await page.goto(`/forsit/b/${B.werkbank}`);
  await expect(page.getByTestId("branch-percent")).toHaveText("20 %");

  await page.goto(`/forsit/t/${T.w3}`);
  await expect(page.locator(".chip").first()).toHaveText("offen");
  await page.getByTestId("percent-control").getByRole("button", { name: "20" }).click();
  await expect(page.locator(".chip").first()).toHaveText("in Arbeit");

  // avg(40, 20, 20) = 26.67 → 27 %
  await page.goto(`/forsit/b/${B.werkbank}`);
  await expect(page.getByTestId("branch-percent")).toHaveText("27 %");
});

test("empty branch renders '—' and the dashed panel", async ({ page }) => {
  await loginViaOtp(page, "mpiksa@forsit.de");
  await page.getByRole("link", { name: "Forsit", exact: true }).click();
  await page.goto(`/forsit/b/${B.neuland}`);

  await expect(page.getByTestId("branch-percent")).toHaveText("—");
  await expect(page.getByTestId("empty-branch")).toContainText("Noch nichts hier…");
  await expect(page.getByTestId("empty-branch")).toContainText("+ Erste Aufgabe anlegen");
});

test("task view renders info stream badges, discussion, and activity", async ({ page }) => {
  await loginViaOtp(page, "igor.kraus@forsit.de");
  await page.goto(`/forsit/t/${T.t1}`);

  await expect(page.getByTestId("info-piece")).toHaveCount(3);
  await expect(page.getByText("Thread öffnen ↗").first()).toBeVisible();
  await expect(page.getByText("KI-Zusammenfassung").first()).toBeVisible();
  await expect(page.getByTestId("time-total")).toHaveText("14 h 45 m");
  await expect(page.getByText("Blockiert unterdrückt den Stagnations-Alarm", { exact: false })).toBeVisible();
});
