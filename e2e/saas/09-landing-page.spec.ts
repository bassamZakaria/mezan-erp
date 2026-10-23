import { CLOUD_SITE_META } from "@mezan/contracts";
import { test, expect } from "./support/test";
import { browserSource } from "./support/env";

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 860 };

test.describe("Public landing page at / on the cloud site", () => {
  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders(browserSource("10.9.0.1"));
    await context.addInitScript(({ name, content }) => {
      document.addEventListener("DOMContentLoaded", () => {
        const meta = document.createElement("meta");
        meta.name = name;
        meta.content = content;
        document.head.append(meta);
      });
    }, CLOUD_SITE_META);
  });

  for (const [label, viewport] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
    test(`a signed-out visitor sees live prices and can still reach sign-in (${label})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      await expect(page.getByRole("heading", { level: 1, name: /حساباتك ومخزونك ومبيعاتك/ })).toBeVisible();
      await expect(page.getByTestId("landing-plan-business")).toContainText("980");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

      await page.getByRole("banner").getByRole("link", { name: "تسجيل الدخول" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("button", { name: /دخول|تسجيل الدخول/ }).first()).toBeVisible();
    });
  }

  test("a plan's button opens signup with that plan and cycle chosen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("radio", { name: "سنويًا" }).click();
    await page.getByTestId("landing-plan-business").getByRole("link", { name: "ابدأ بهذه الباقة" }).click();

    await expect(page).toHaveURL(/\/signup\?plan=business&cycle=yearly$/);
    await expect(page.getByRole("button", { name: /الأعمال/, pressed: true })).toBeVisible();
  });
});
