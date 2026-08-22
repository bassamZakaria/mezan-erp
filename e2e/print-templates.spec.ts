import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Print view (@mezan/ui's PrintView, PR #17) — the one shared renderer every
 * printable document reuses, proved end to end by قوالب الطباعة
 * (apps/web/src/settings/PrintTemplatesPage.tsx): the tenant's default
 * PrintTemplateConfig rendering a sample فاتورة مبيعات (INV-000123, عميل
 * "شركة الأمل للتجارة"), with the Arabic amount-in-words line computed for
 * real via @mezan/domain's amountInWords. Reachable from الإعدادات (starts
 * collapsed).
 */

test.describe("Print view — قوالب الطباعة", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "قوالب الطباعة");
    await expect(page.getByRole("heading", { name: "قوالب الطباعة" })).toBeVisible();
  });

  test("renders the sample invoice print preview from the template config", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "فاتورة مبيعات" })).toBeVisible();
    await expect(page.getByText("INV-000123")).toBeVisible();
    await expect(page.getByText("شركة الأمل للتجارة")).toBeVisible();
    await expect(page.getByText("1,159.95")).toBeVisible();
    await expect(page.getByText("ألف ومائة وتسعة وخمسون جنيه مصري وخمسة وتسعون قرش فقط لا غير")).toBeVisible();
  });

  test("shows the on-screen طباعة toolbar action", async ({ page }) => {
    await expect(page.getByRole("button", { name: "طباعة", exact: true })).toBeVisible();
  });
});
