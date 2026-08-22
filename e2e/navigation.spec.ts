import { test, expect } from "@playwright/test";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Sidebar routing across App.tsx's ROUTABLE_SCREENS: sales-invoices, coa,
 * settings-general, settings-branches, settings-warehouses. Every other nav
 * item is a static "قريباً" placeholder with no onClick.
 */

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("starts on Sales Invoices with that nav item marked current", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
    await expect(
      page.locator("aside nav li button").filter({ hasText: "فواتير المبيعات" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("دليل الحسابات switches to the Chart of Accounts screen", async ({ page }) => {
    await clickSidebarItem(page, "دليل الحسابات");
    await expect(page.getByRole("heading", { name: "دليل الحسابات" })).toBeVisible();
    await expect(
      page.locator("aside nav li button").filter({ hasText: "دليل الحسابات" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeHidden();
  });

  test("Settings group routes to general / branches / warehouses", async ({ page }) => {
    await expandSidebarGroup(page, "الإعدادات");

    await clickSidebarItem(page, "عام");
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();

    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الفروع");
    await expect(page.getByRole("heading", { name: "الفروع" })).toBeVisible();

    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "المستودعات");
    await expect(page.getByRole("heading", { name: "المستودعات" })).toBeVisible();
  });

  test("can return to Sales Invoices after navigating away", async ({ page }) => {
    await clickSidebarItem(page, "دليل الحسابات");
    await expect(page.getByRole("heading", { name: "دليل الحسابات" })).toBeVisible();

    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  });

  test("non-routable \"قريباً\" placeholder items do not navigate away", async ({ page }) => {
    // "العملاء" (customers) is tagged "قريباً" and has no onClick wired in
    // App.tsx's ROUTABLE_SCREENS — clicking it must be a no-op, not a crash.
    await clickSidebarItem(page, "العملاء");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();
  });
});
