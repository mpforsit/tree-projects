/**
 * M9 hardening (plan): the M6 core assertions re-run in DARK MODE, the
 * German string-length audit at ~95-char titles, and the accessibility
 * baseline (named controls, signals never color-only).
 */
import { expect, test, type Page } from "@playwright/test";
import { authState } from "./helpers.ts";

const T6 = "a2000000-0000-4000-8000-000000000006"; // 98-char BFSG title
const T1 = "a2000000-0000-4000-8000-000000000001";
const MYWELL = "a1000000-0000-4000-8000-000000000002";

async function darken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("treeops.theme", "dark");
  });
}

test.describe("dark-mode matrix (as MS)", () => {
  test.use({ storageState: authState("ms") });

  test("theme applies before paint and tokens flip", async ({ page }) => {
    await darken(page);
    await page.goto("/forsit");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(22, 21, 17)"); // --bg dark
  });

  test("glance signals render in dark mode", async ({ page }) => {
    await darken(page);
    await page.goto("/forsit");
    await expect(page.getByRole("img", { name: "überfällig" }).first()).toBeVisible();
    await expect(page.getByRole("img", { name: "blockiert" }).first()).toBeVisible();
  });

  test("read-only controls stay grayed with tooltip in dark mode (§15.2)", async ({
    page,
  }) => {
    await darken(page);
    await page.goto(`/forsit/t/${T1}`);
    const segment = page.getByTestId("percent-control").getByRole("button").first();
    await expect(segment).toBeDisabled();
    await expect(segment).toHaveAttribute(
      "title",
      "Nur die verantwortliche Person kann dies ändern",
    );
  });

  test("branch view: skeleton crumb, chips, and empty states in dark mode", async ({
    page,
  }) => {
    await darken(page);
    await page.goto(`/forsit/b/${MYWELL}`);
    await expect(page.locator(".skeleton-crumb")).toContainText("Forsit Holding");
    await expect(page.getByTestId("branch-percent")).toBeVisible();
  });
});

test.describe("string-length audit at ~95-char titles (as MS)", () => {
  test.use({ storageState: authState("ms") });

  test("task rows ellipsize the BFSG title on one line", async ({ page }) => {
    await page.goto(`/forsit/b/${MYWELL}`);
    const title = page
      .locator(".task-row .task-title")
      .filter({ hasText: "Barrierefreiheits-Prüfung" });
    await expect(title).toBeVisible();
    const styles = await title.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        whiteSpace: cs.whiteSpace,
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        truncated: el.scrollWidth > el.clientWidth,
      };
    });
    expect(styles.whiteSpace).toBe("nowrap");
    expect(styles.textOverflow).toBe("ellipsis");
    expect(styles.truncated).toBe(true);
  });

  test("the task view wraps the full title; badges never wrap internally", async ({
    page,
  }) => {
    await page.goto(`/forsit/t/${T6}`);
    await expect(
      page.getByRole("heading", {
        name: /Barrierefreiheits-Prüfung nach BFSG für das Kundenportal durchführen und Maßnahmen dokumentieren/,
      }),
    ).toBeVisible();
    await page.goto("/forsit");
    const badge = page.locator(".badge").first();
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
  });

  test("glance card titles clamp at two lines", async ({ page }) => {
    await page.goto("/forsit");
    const title = page.locator(".glance-title").first();
    const clamp = await title.evaluate(
      (el) => getComputedStyle(el).webkitLineClamp,
    );
    expect(clamp).toBe("2");
  });
});

test.describe("accessibility baseline (as MB)", () => {
  test.use({ storageState: authState("mb") });

  for (const path of ["/forsit", `/forsit/b/${MYWELL}`, `/forsit/t/${T1}`, "/forsit/admin"]) {
    test(`every control on ${path} has an accessible name`, async ({ page }) => {
      await page.goto(path);
      const unnamed = await page.evaluate(() => {
        const controls = [
          ...document.querySelectorAll<HTMLElement>("button, input, select, textarea"),
        ];
        return controls
          .filter((el) => {
            if (el.getAttribute("type") === "hidden") return false;
            const byText = (el.textContent ?? "").trim().length > 0;
            const byAria = Boolean(el.getAttribute("aria-label"));
            const byTitle = Boolean(el.getAttribute("title"));
            const byLabel =
              el.id && document.querySelector(`label[for="${el.id}"]`) !== null;
            const wrapped = el.closest("label") !== null;
            const byPlaceholder = Boolean(el.getAttribute("placeholder"));
            return !(byText || byAria || byTitle || byLabel || wrapped || byPlaceholder);
          })
          .map((el) => el.outerHTML.slice(0, 120));
      });
      expect(unnamed).toEqual([]);
    });
  }

  test("signals are never color-only: glyphs carry role=img and labels", async ({
    page,
  }) => {
    await page.goto(`/forsit/b/${MYWELL}`);
    const glyphs = page.getByRole("img", { name: /überfällig|bald fällig|stagniert|blockiert/ });
    expect(await glyphs.count()).toBeGreaterThan(0);
  });
});
