/**
 * M7 verify (plan): My Work grouping, search visibility scoping in the
 * browser, umlaut/compound query, and the keyboard flow (/ focus,
 * ↑/↓ + Enter, Esc up).
 */
import { expect, test } from "@playwright/test";
import { authState } from "./helpers.ts";

test.describe("as IK", () => {
  test.use({ storageState: authState("ik") });

  test("My Work groups by urgency with branch-path second lines", async ({ page }) => {
    await page.goto("/forsit/my");

    // IK is responsible for t5 (overdue), t1/w1 (due_soon), k1/k2 (none)
    await expect(page.getByTestId("group-overdue")).toHaveText("Überfällig");
    await expect(page.getByTestId("group-due_soon")).toHaveText("Bald fällig");
    await expect(page.getByTestId("group-rest")).toHaveText("Weitere");
    await expect(page.getByTestId("my-alarm-row")).toHaveCount(3);
    await expect(
      page.getByTestId("my-task-row").filter({ hasText: "Penetrationstest" }),
    ).toContainText("myWell");
    await expect(
      page.getByTestId("my-task-row").filter({ hasText: "DATEV" }),
    ).toContainText("Werkbank — internes Tooling");
  });

  test("search finds compound titles via umlaut query and opens via keyboard", async ({
    page,
  }) => {
    await page.goto("/forsit");
    // "/" focuses the box (retry across hydration)
    await expect(async () => {
      await page.keyboard.press("/");
      await expect(page.getByLabel("Suche")).toBeFocused({ timeout: 300 });
    }).toPass();
    await page.keyboard.type("Prüfung");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/forsit\/search\?q=Pr/);
    const results = page.getByTestId("search-result");
    await expect(results.filter({ hasText: "Barrierefreiheits-Prüfung" })).toBeVisible();

    // keyboard flow: blur the box, walk the selection, open with Enter
    await page.getByLabel("Suche").blur();
    const count = await results.count();
    for (let i = 0; i < count; i++) {
      const row = page.locator('[data-testid="search-result"][aria-selected="true"]');
      if ((await row.textContent())?.includes("Barrierefreiheits-Prüfung")) break;
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/forsit\/t\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Barrierefreiheits-Prüfung",
    );
  });

  test("Esc on the search screen goes back up", async ({ page }) => {
    await page.goto("/forsit");
    await page.goto("/forsit/search?q=DATEV");
    await expect(page.getByTestId("search-result").first()).toBeVisible();
    // Retry — the results are server-rendered and visible before
    // hydration attaches the keydown listener.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page).not.toHaveURL(/\/search/, { timeout: 1_000 });
    }).toPass();
  });
});

test.describe("as JT (restricted member)", () => {
  test.use({ storageState: authState("jt") });

  test("restricted member finds nothing outside their subtrees", async ({ page }) => {
    await page.goto("/forsit/search?q=Mollie");
    await expect(page.getByText("Keine Treffer.")).toBeVisible();

    await page.goto("/forsit/search?q=DATEV");
    await expect(
      page.getByTestId("search-result").filter({ hasText: "DATEV" }).first(),
    ).toBeVisible();
  });
});
