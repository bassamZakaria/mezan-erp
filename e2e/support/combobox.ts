import type { Locator, Page } from "@playwright/test";

/**
 * Every native `<select>` in the app was replaced by a styled listbox
 * (packages/ui/src/primitives/Select.tsx) — a `<button role="combobox">`
 * that opens a `<ul role="listbox">` PORTALED to `document.body`. `.selectOption()`
 * no longer works against it, and the option list must be queried from `page`
 * (or another ancestor of the portal), never from a dialog/form locator that
 * sits inside the trigger's own subtree — the popup renders outside it.
 *
 * `trigger` is the `role="combobox"` element itself (found however
 * disambiguates it on the calling screen — by label when one exists, by
 * `.filter({ hasText })` on its placeholder when it doesn't).
 */
export async function chooseComboboxOption(
  trigger: Locator,
  page: Page,
  optionName: string | RegExp,
): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}
