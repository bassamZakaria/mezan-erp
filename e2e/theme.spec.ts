import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";

const SCREENSHOT_DIR = "e2e-results/screenshots";

test.describe("Theme toggle", () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await loginAsDemoUser(page);
  });

  test("defaults to the light palette with an explicit [data-theme=light]", async ({ page }) => {
    // useTheme() (packages/ui/src/hooks/useTheme.ts) now defaults to the
    // explicit "light" preference with nothing stored — "system" (no
    // attribute) is only reached by toggling twice from dark back past light.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(236, 230, 218)"); // --bg light token (#ece6da)

    // Not fullPage: on this Chromium build, full-page capture reliably
    // repaints with stale (pre-toggle) CSS custom-property values even
    // though getComputedStyle/DOM already reflect the new theme — a capture
    // quirk, not a product bug (confirmed via a plain viewport screenshot).
    await page.screenshot({ path: `${SCREENSHOT_DIR}/light.png` });
  });

  test("toggling sets [data-theme=dark] and swaps the background/text tokens", async ({ page }) => {
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // The identity moved to Cyag blue — packages/ui/src/tokens/tokens.css's
    // dark --bg is #0e1116 now, not the old teal-leaning #0a1310.
    expect(darkBg).toBe("rgb(14, 17, 22)"); // --bg dark token (#0e1116)
    expect(darkBg).not.toBe(lightBg);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/dark.png` });

    // Toggling again flips back to explicit light (not back to "system").
    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const backToLightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(backToLightBg).toBe(lightBg);
  });

  test("theme preference persists across a reload via localStorage", async ({ page }) => {
    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The session now persists across a reload too (apps/web/src/data/session.ts
    // restores it from localStorage), so the reload lands straight back in the
    // app shell — no re-login — and the stored "mezan:theme" preference is
    // still what applies.
    await page.reload();
    await expect(page.getByRole("button", { name: "تبديل المظهر" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
