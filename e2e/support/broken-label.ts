import type { Locator, Page } from "@playwright/test";

/**
 * PRODUCT DEFECT — verified live and documented with a dedicated
 * `test.fail()` in journals.spec.ts ("BUG: the memo field's «الوصف *» label
 * is not associated with its input").
 *
 * `apps/web/src/settings/form-controls.tsx`'s `TextField` / `NumberField` /
 * `TextAreaField` render a `<label>` with no `htmlFor`, immediately followed
 * by an `<input>`/`<textarea>` with no matching `id` — e.g.
 *   <div class="flex flex-col gap-[6px]">
 *     <label>اسم العميل *</label>
 *     <input type="text" ...>
 *   </div>
 * The two are unrelated siblings, not a wrapping `<label>`, so there is no
 * programmatic association at all: `getByLabel` cannot find the control, a
 * screen reader announces nothing for it, and clicking the label text does
 * not focus the input. `~/apps/web/src/screens` greps to ~65 screens
 * importing this exact wrapper, so the defect is systemic, not local to one
 * screen — customers, suppliers, journals, treasury accounts, purchase
 * orders/invoices and more all build at least some fields through it.
 * `SelectField`/`ToggleField` in the same file are NOT affected — they pass
 * an `aria-label` straight to their control instead of relying on `Field`'s
 * `htmlFor`. Screens that instead import `TextField` from
 * `apps/web/src/screens/item-form-controls.tsx` (Items, and others) are also
 * unaffected — that wrapper nests the control INSIDE the `<label>`, which
 * associates it implicitly.
 *
 * This locates the control the same way a sighted mouse user does — the
 * element immediately after the visible label text — so the rest of this
 * suite can still exercise the real create/edit flows these fields belong
 * to. It is a workaround for OTHER tests' setup, not a substitute for
 * `getByLabel`: keep using `getByLabel` (and expect it to fail) in any test
 * whose actual point is the field's accessible name.
 */
export function brokenLabelField(scope: Page | Locator, labelText: string): Locator {
  return scope.locator(`label:text-is(${JSON.stringify(labelText)}) + input, label:text-is(${JSON.stringify(labelText)}) + textarea`);
}
