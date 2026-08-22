import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";

const SCREENSHOT_DIR = "e2e-results/screenshots";

test.describe("Theme toggle", () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await loginAsDemoUser(page);
  });

  test("defaults to the light palette with no explicit [data-theme]", async ({ page }) => {
    // useTheme() defaults to "system" (no localStorage entry) which removes
    // the attribute entirely; Chromium's default color-scheme is light, so
    // the light `:root` tokens apply (packages/ui/src/tokens/tokens.css).
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /light|dark/);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(237, 241, 238)"); // --bg light token (#edf1ee)

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
    expect(darkBg).toBe("rgb(12, 21, 18)"); // --bg dark token (#0c1512)
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

    // useTheme() only mounts inside AppShell, and a reload drops App.tsx's
    // in-memory login state — so the login screen briefly shows with no
    // [data-theme] attribute (it isn't part of AppShell). The stored
    // "mezan:theme" preference reapplies once logged back in.
    await page.reload();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
    await loginAsDemoUser(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
