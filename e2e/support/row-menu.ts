import type { Locator, Page } from "@playwright/test";

/**
 * Row-level actions moved from a direct button in the row into an overflow
 * menu (packages/ui/src/primitives/RowMenu.tsx): a "⋯" trigger labelled
 * «إجراءات <row name>» that opens a `role="menu"` with `role="menuitem"`
 * entries, rendered inline in the row (not portaled) so it can be queried
 * from the row locator itself.
 */
export async function runRowAction(row: Locator, actionLabel: string | RegExp): Promise<void> {
  await row.getByRole("button", { name: /^(إجراءات|Actions for)/ }).click();
  await row.getByRole("menuitem", { name: actionLabel, exact: true }).click();
}

/**
 * A `tone: "danger"` row action always confirms before running
 * (RowMenu.tsx's `select()`). The confirm dialog's accessible name is
 * «تأكيد: <action label>» (ui.rowAction.confirmTitle) and its confirm button
 * repeats the action's own label.
 */
export async function confirmRowAction(page: Page, actionLabel: string): Promise<void> {
  const confirmDialog = page.getByRole("dialog", { name: `تأكيد: ${actionLabel}` });
  await confirmDialog.getByRole("button", { name: actionLabel, exact: true }).click();
}
