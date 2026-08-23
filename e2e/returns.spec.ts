import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Sales Returns (مرتجعات المبيعات) and Purchase Returns (مرتجعات المشتريات)
 * — apps/web/src/screens/SalesReturnsScreen.tsx / PurchaseReturnsScreen.tsx.
 * Both are document-framework-backed (draft → confirmed) but run entirely
 * against an in-memory client-side store seeded from local demo invoices
 * (`demoInvoices` for sales, a local `DEMO_PURCHASE_INVOICES` for purchases)
 * — no network calls, no shared backend state, so doc numbers are
 * deterministic per test (a fresh browser context ⇒ a fresh store, first
 * doc is always SRT-000001 / PRT-000001).
 */

const SALES_REASONS = ["معيب", "صنف خاطئ", "كمية زائدة", "تغيير رأي العميل", "أخرى"];
const PURCHASE_REASONS = ["بضاعة معيبة", "صنف خاطئ", "كمية زائدة", "مشكلة جودة", "أخرى"];

test.describe("Sales Returns", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مرتجعات المبيعات");
    await expect(page.getByRole("heading", { name: "مرتجعات المبيعات" })).toBeVisible();
    await expect(page.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeVisible();
  });

  test("creates and confirms a return directly, restocking and posting against the source invoice", async ({ page }) => {
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مرتجع مبيعات جديد" });

    await dialog.getByLabel("سبب الإرجاع *").selectOption({ label: SALES_REASONS[1]! }); // صنف خاطئ
    await dialog.getByLabel("الكمية").fill("2");
    await dialog.getByRole("button", { name: "حفظ وتأكيد" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("SRT-000001")).toBeVisible();
    const row = page.locator("table tbody tr").filter({ hasText: "SRT-000001" });
    await expect(row.getByText("مؤكد", { exact: true })).toBeVisible();
    await expect(row.getByText("بانتظار دفع المبلغ")).toBeVisible();

    await row.click();
    await expect(page.getByText(/فاتورة المصدر:/)).toBeVisible();
    // Already confirmed — no confirm action left on the detail panel.
    await expect(page.getByRole("button", { name: "تأكيد المرتجع" })).toHaveCount(0);
  });

  test("saves as a draft first, then confirms it from the detail panel", async ({ page }) => {
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    let dialog = page.getByRole("dialog", { name: "مرتجع مبيعات جديد" });
    await dialog.getByRole("button", { name: "حفظ كمسودة" }).click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("مسودة", { exact: true }).first()).toBeVisible();
    const draftRow = page.locator("table tbody tr").filter({ hasText: "مسودة" });
    await draftRow.click();

    await page.getByRole("button", { name: "تأكيد المرتجع" }).click();
    // The row (list, behind the panel) and the detail panel's own heading
    // both show the doc number once confirmed.
    await expect(page.getByText("SRT-000001").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تأكيد المرتجع" })).toHaveCount(0);
  });
});

test.describe("Purchase Returns", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مرتجعات المشتريات");
    await expect(page.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeVisible();
    await expect(page.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeVisible();
  });

  // BUG (verified by direct reproduction against the dev build): confirming
  // ANY purchase return — via either path below — fails with a domain
  // validation error ("Issuing N of item X from warehouse Y would drive
  // on-hand below zero; negative stock is disallowed."). The demo's
  // DEMO_PURCHASE_INVOICES (PI-000001/PI-000002) were never actually
  // received into stock anywhere in this in-memory store, so on-hand is
  // always 0 and de-stocking a return always goes negative. These two
  // tests document the real, current (broken) behavior rather than a
  // fictitious success — see the two variants below.

  test("confirming a return directly is blocked by the negative-stock guard, with the error shown in the create panel", async ({ page }) => {
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مرتجع مشتريات جديد" });

    await dialog.getByLabel("السبب *").selectOption({ label: PURCHASE_REASONS[3]! }); // مشكلة جودة
    await dialog.getByLabel("الكمية").fill("5");
    await dialog.getByRole("button", { name: "حفظ وتأكيد" }).click();

    // The create panel stays open with the domain error — no return is created.
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/negative stock is disallowed/)).toBeVisible();
    await expect(page.getByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeVisible();
  });

  test("BUG: confirming a draft from the detail panel fails the same way, but the error is invisible (rendered into the closed create panel)", async ({ page }) => {
    await page.getByRole("button", { name: "مرتجع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "مرتجع مشتريات جديد" });
    await dialog.getByRole("button", { name: "حفظ كمسودة" }).click();
    await expect(dialog).toBeHidden();

    const draftRow = page.locator("table tbody tr").filter({ hasText: "مسودة" });
    await draftRow.click();
    await page.getByRole("button", { name: "تأكيد المرتجع" }).click();

    // The same validation error fires, but PurchaseReturnsScreen's `error`
    // state is only rendered inside the (now-closed, aria-hidden) create
    // SidePanel — getByRole would correctly find nothing there (it respects
    // aria-hidden), but a plain text query still finds it in the raw DOM,
    // proving the message rendered into the wrong, invisible panel. The
    // user watching the (visible) detail panel sees nothing happen: the row
    // silently stays "مسودة" and the confirm button is still there.
    await expect(page.getByText(/negative stock is disallowed/)).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "مرتجع مشتريات جديد" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "تأكيد المرتجع" })).toBeVisible();
    await expect(draftRow).toContainText("مسودة");
  });
});
