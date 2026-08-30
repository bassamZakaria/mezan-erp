import type { Locator, Page } from "@playwright/test";

/**
 * Locates a field by the element immediately after its visible label text.
 *
 * This existed because of D67: `apps/web/src/settings/form-controls.tsx`'s
 * `TextField` / `NumberField` / `TextAreaField` rendered a `<label>` with no
 * `htmlFor` beside a control with no `id`, so `getByLabel` found nothing on
 * roughly 65 screens. That is FIXED — the wrappers generate an id with
 * `useId` and wire `htmlFor`/`id`, and journals.spec.ts holds the guarantee.
 *
 * It survives only as a positional locator for the specs already written
 * against it: unlike `getByLabel`, it never matches a second control whose
 * accessible name merely contains the same words. New tests should use
 * `getByLabel`.
 */
export function brokenLabelField(scope: Page | Locator, labelText: string): Locator {
  return scope.locator(`label:text-is(${JSON.stringify(labelText)}) + input, label:text-is(${JSON.stringify(labelText)}) + textarea`);
}
