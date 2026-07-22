/**
 * M8 verify (plan): flag changes effective without re-login, the move
 * tool recomputing both chains, archiving with the show-archived toggle,
 * admin/instance gating (tenant admin cannot reach /instance; the
 * instance admin without membership sees no tenant data — invariant 6).
 * State-changing tests restore the seed state they touch.
 */
import { expect, test } from "@playwright/test";
import { authState, loginViaOtp } from "./helpers.ts";

const B = {
  mywell: "a1000000-0000-4000-8000-000000000002",
  nordhof: "a1000000-0000-4000-8000-000000000003",
  website: "a1000000-0000-4000-8000-00000000000a",
};

test.describe("as MB (tenant admin)", () => {
  test.use({ storageState: authState("mb") });

  test("member flag changes are effective without re-login (both directions)", async ({
    page,
    browser,
  }) => {
    await page.goto("/forsit/admin");
    await expect(page.getByTestId("admin-members")).toBeVisible();
    const jtFlag = page.getByLabel("can_create_branches jonas.thal@forsit.de");
    await expect(jtFlag).not.toBeChecked();

    const jt = await browser.newContext({ storageState: authState("jt") });
    const jtPage = await jt.newPage();

    // The toggle fires an async server action — poll with reloads so the
    // assertion never races the commit.
    await jtFlag.check();
    await expect(jtFlag).toBeChecked();
    await jtPage.goto(`/forsit/b/${B.nordhof}`);
    await expect(async () => {
      await jtPage.reload();
      await jtPage.getByTestId("new-node").click();
      await expect(jtPage.getByTestId("create-type-project")).toBeVisible({ timeout: 1_000 });
    }).toPass();

    await jtFlag.uncheck();
    await expect(async () => {
      await jtPage.reload();
      await jtPage.getByTestId("new-node").click();
      await expect(jtPage.getByTestId("create-type-project")).toHaveCount(0, { timeout: 1_000 });
    }).toPass();
    await jt.close();
  });

  test("move tool relocates a branch after the rollup confirmation", async ({ page }) => {
    await page.goto("/forsit/admin");
    page.on("dialog", (dialog) => void dialog.accept());

    const neuland = "a1000000-0000-4000-8000-000000000007";
    const werkbank = "a1000000-0000-4000-8000-000000000005";
    const root = "a1000000-0000-4000-8000-000000000001";

    await page.getByLabel("Element").selectOption(neuland);
    await page.getByLabel("Neuer übergeordneter Bereich").selectOption(werkbank);
    await page.getByRole("button", { name: "Verschieben" }).click();
    await expect(page.getByText("Verschoben — Fortschritte neu berechnet.")).toBeVisible();

    await page.goto(`/forsit/b/${werkbank}`);
    await expect(
      page.getByTestId("subbranch-card").filter({ hasText: "Neuland Ventures" }),
    ).toBeVisible();

    // Restore: back under the root.
    await page.goto("/forsit/admin");
    await page.getByLabel("Element").selectOption(neuland);
    await page.getByLabel("Neuer übergeordneter Bereich").selectOption(root);
    await page.getByRole("button", { name: "Verschieben" }).click();
    await expect(page.getByText("Verschoben — Fortschritte neu berechnet.")).toBeVisible();
  });

  test("archiving a sub-branch updates the parent percent; the toggle reveals it", async ({
    page,
  }) => {
    page.on("dialog", (dialog) => void dialog.accept());

    // myWell weighted 63 % with the website branch, 62 % without it.
    await page.goto(`/forsit/b/${B.mywell}`);
    await expect(page.getByTestId("branch-percent")).toHaveText("63 %");

    await page.goto(`/forsit/b/${B.website}`);
    await page.getByTestId("archive-toggle").click();
    await expect(page.getByTestId("archive-toggle")).toHaveText("Archivierung aufheben");

    await page.goto(`/forsit/b/${B.mywell}`);
    await expect(page.getByTestId("branch-percent")).toHaveText("62 %");
    await expect(
      page.getByTestId("subbranch-card").filter({ hasText: "Marketing-Website" }),
    ).not.toBeVisible();

    await page.getByTestId("show-archived-toggle").click();
    const archivedCard = page
      .getByTestId("subbranch-card")
      .filter({ hasText: "Marketing-Website" });
    await expect(archivedCard).toBeVisible();
    await expect(archivedCard.getByText("archiviert")).toBeVisible();

    // Restore — wait for the action to complete (the label flips back)
    // before navigating, or the next render may precede the commit.
    await page.goto(`/forsit/b/${B.website}`);
    await page.getByTestId("archive-toggle").click();
    await expect(page.getByTestId("archive-toggle")).toHaveText("Archivieren");
    await page.goto(`/forsit/b/${B.mywell}`);
    await expect(page.getByTestId("branch-percent")).toHaveText("63 %");
  });

  test("a tenant admin cannot reach /instance", async ({ page }) => {
    const response = await page.goto("/instance");
    expect(response?.status()).toBe(404);
  });
});

test.describe("as JT (branch_admin of nordhof only)", () => {
  test.use({ storageState: authState("jt") });

  test("configures the branch stagnation override; hidden where not branch_admin", async ({
    page,
  }) => {
    await page.goto(`/forsit/b/${B.nordhof}`);
    await page.getByTestId("alarm-config-toggle").click();
    await page.getByLabel("Stagnations-Alarm").fill("3");
    await page.getByRole("button", { name: "OK", exact: true }).click();
    await expect(page.getByTestId("alarm-config-toggle")).toHaveText(
      "Stagnations-Alarm: 3 Tage",
    );
    // Restore the tenant default.
    await page.getByTestId("alarm-config-toggle").click();
    await page.getByRole("button", { name: "Standard verwenden" }).click();
    await expect(page.getByTestId("alarm-config-toggle")).toHaveText(
      "Stagnations-Alarm: Standard",
    );
    // Plain member elsewhere: control hidden (§15.2).
    await page.goto("/forsit/b/a1000000-0000-4000-8000-000000000005"); // werkbank
    await expect(page.getByTestId("alarm-config-toggle")).not.toBeVisible();
  });
});

test.describe("as IK (not a tenant admin)", () => {
  test.use({ storageState: authState("ik") });

  test("the admin screen 404s and the menu shows no admin link", async ({ page }) => {
    const response = await page.goto("/forsit/admin");
    expect(response?.status()).toBe(404);
    await page.goto("/forsit");
    await page.getByTestId("avatar-button").click();
    await expect(page.getByTestId("avatar-menu")).toBeVisible();
    await expect(page.getByTestId("admin-link")).not.toBeVisible();
  });
});

test.describe("as the instance admin (no memberships)", () => {
  test("manages tenants and domain claims but sees no tenant data (invariant 6)", async ({
    page,
  }) => {
    await loginViaOtp(page, "admin@lean.forsit.de");
    await expect(page.getByText("no active memberships")).toBeVisible();

    await page.goto("/instance");
    await expect(page.getByTestId("instance-tenants")).toContainText("Forsit");
    await expect(page.getByTestId("instance-tenants")).toContainText("Nebenwerk GmbH");

    await page.getByLabel("Slug").fill("drittwerk");
    await page.getByLabel("Name", { exact: true }).fill("Drittwerk GmbH");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText('Tenant "drittwerk" created.')).toBeVisible();
    await expect(page.getByTestId("instance-tenants")).toContainText("/drittwerk");

    await page.getByLabel("Domain", { exact: true }).fill("drittwerk.example");
    await page.getByLabel("Claim Tenant").selectOption({ label: "Drittwerk GmbH" });
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByTestId("claim-drittwerk.example")).toBeVisible();

    // Invariant 6: tenant metadata yes, tenant data no.
    const response = await page.goto("/forsit");
    expect(response?.status()).toBe(404);
  });
});
