import type { Page } from "@playwright/test";

/**
 * Shared navigation helpers, rebuilt against the workspace-column shell
 * (packages/ui/src/shell/AppShell.tsx). The old top row of direct sidebar
 * links is gone: the six workspaces live in a column (`WorkspaceRail`), the
 * active workspace's own screens appear in a second row (`WorkspaceScreensBar`),
 * and every screen — reachable or not from row two — is listed in the
 * «كل الشاشات» modal (`AllScreensPanel`), grouped by workspace and flattened,
 * with no collapse/expand step of its own.
 *
 * Rather than reproduce the two-level workspace → section → screen click path
 * for every spec (which changes shape per workspace: some screens are direct
 * row-two chips, some sit behind a dropdown), every spec now reaches its
 * screen through «كل الشاشات», which lists all ~120 destinations flattened and
 * always-expanded. It is slower per click than a lucky direct chip, but it is
 * the one path that works identically for every screen in the tree.
 */

const ALL_SCREENS_LABEL = "كل الشاشات";
/** t("shell.all.filter") — scopes screen lookups to the results pane, not the workspace-filter column beside it (which repeats some of the same labels, e.g. "الأصناف" is both a workspace and a screen inside it). */
const FILTER_NAV_LABEL = "تصفية حسب مساحة العمل";

async function openAllScreens(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: ALL_SCREENS_LABEL, exact: true }).click();
  await dialog.waitFor();
}

/**
 * No-op: «كل الشاشات» has no collapsed sections to expand — every screen in
 * every workspace is listed flattened, all the time. Kept so specs written
 * against the old collapsible-group sidebar don't need a second edit just to
 * drop the call.
 */
export async function expandSidebarGroup(_page: Page, _groupLabel: string): Promise<void> {}

/**
 * Opens «كل الشاشات» (if not already open) and clicks the screen whose
 * visible label is an exact match, in the results pane only.
 */
export async function clickSidebarItem(page: Page, label: string): Promise<void> {
  await openAllScreens(page);
  const dialog = page.getByRole("dialog");
  const results = dialog.locator(`nav[aria-label="${FILTER_NAV_LABEL}"] + div`);
  await results.getByRole("button", { name: label, exact: true }).click();
}
