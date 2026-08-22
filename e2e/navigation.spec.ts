import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Sidebar routing across App.tsx's ROUTABLE_SCREENS: dashboard,
 * sales-invoices, customers, vendors, coa, settings-general,
 * settings-branches, settings-warehouses. Every other nav item is a static
 * "قريباً" placeholder with no onClick.
 */

test.describe("Sidebar navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("starts on the Dashboard with the top nav item marked current", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
    await expect(
      page.locator("aside nav li button").filter({ hasText: "لوحة التحكم" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("دليل الحسابات switches to the Chart of Accounts screen", async ({ page }) => {
    await clickSidebarItem(page, "دليل الحسابات");
    await expect(page.getByRole("heading", { name: "دليل الحسابات" })).toBeVisible();
    await expect(
      page.locator("aside nav li button").filter({ hasText: "دليل الحسابات" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeHidden();
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

  test("can navigate to Sales Invoices and back to the Dashboard", async ({ page }) => {
    await clickSidebarItem(page, "فواتير المبيعات");
    await expect(page.getByRole("heading", { name: "فواتير المبيعات" })).toBeVisible();

    await clickSidebarItem(page, "لوحة التحكم");
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });

  test("non-routable \"قريباً\" placeholder items do not navigate away", async ({ page }) => {
    // "عروض الأسعار" (quotes) is tagged "قريباً" and has no onClick wired in
    // App.tsx's ROUTABLE_SCREENS — clicking it must be a no-op, not a crash.
    await clickSidebarItem(page, "عروض الأسعار");
    await expect(page.getByRole("heading", { name: /مرحباً، محمد/ })).toBeVisible();
  });
});
