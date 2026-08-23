import type { Page } from "@playwright/test";

/**
 * Shared sidebar-navigation helpers. Mirrors apps/web/src/App.tsx's
 * ROUTABLE_SCREENS routing: nav items are plain <button>s (no href), the
 * "الإعدادات" group starts collapsed (nav-config.ts's defaultCollapsed),
 * and every other group starts expanded.
 */

/** Expands a sidebar group (e.g. "الإعدادات") if it is currently collapsed. */
export async function expandSidebarGroup(page: Page, groupLabel: string): Promise<void> {
  const toggle = page.getByRole("button", { name: groupLabel, exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
}

/** Clicks a sidebar nav item by its visible label (matches even with a "قريباً"/"نمط" tag suffix). */
export async function clickSidebarItem(page: Page, label: string): Promise<void> {
  await page
    .locator("aside nav li button, aside nav li a")
    .filter({ hasText: label })
    .first()
    .click();
}
