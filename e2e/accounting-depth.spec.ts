import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Accounting-depth screens (apps/web/src/screens/{CostCenterPnL,
 * ExchangeRates,FxRevaluation,Reconciliation,Eta}Screen.tsx) — all run the
 * REAL domain services (GL posting, FX revaluation, reconciliation, ETA
 * lifecycle) over a self-contained in-memory sandbox seeded fresh on every
 * mount (apps/web/src/store/accounting-depth-store.ts's
 * `createAccountingDepthStore()`), NOT the shared backend — so these are
 * fully deterministic and immune to state left over by other specs.
 *
 * Seeded facts used below: cost centers CC-001 الإدارة العامة / CC-002
 * المبيعات / CC-003 التسويق; an AR line in USD (5,000 EGP booked at 50,
 * i.e. 100 USD) and an AP line in EUR (3,300 EGP booked at 58); exchange
 * rates USD 55.000000 (approved) and EUR 60.500000 (approved), both
 * effective 2026-08-25, plus a pending SAR rate; one manual journal line
 * posted directly to the inventory control account (1200) — the one
 * "unlinked" line; and 6 seeded ETA submissions (2 جاهز, 1 بانتظار
 * التوقيع, 1 مرسل, 1 مقبول, 1 أخطاء).
 *
 * Fiscal period close/lock is already covered by e2e/accounting-master.spec.ts's
 * "Fiscal periods" suite — out of scope here.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

test.describe("Cost Center P&L", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أرباح مراكز التكلفة");
    await expect(page.getByRole("heading", { name: "أرباح مراكز التكلفة" })).toBeVisible();
  });

  test("computes per-cost-center revenue/expense/profit for the default August 2026 period", async ({ page }) => {
    await expect(page.getByLabel("من تاريخ")).toHaveValue("2026-08-01");
    await expect(page.getByLabel("إلى تاريخ")).toHaveValue("2026-08-31");

    // This screen's own `fmt()` formats money with ar-EG (Arabic-Indic digits,
    // e.g. "٥٬٠٠٠٫٠٠") — unlike the rest of the app's shared useFormat/MoneyDisplay,
    // which renders Western digits (see e.g. e2e/trial-balance-report.spec.ts's
    // "147,000.00"). Real inconsistency, not a typo — see final report.
    const salesRow = row(page, "المبيعات");
    // .first() — revenue and profit are both 5,000.00 here (zero expense), so the same
    // formatted string appears twice in this row (revenue cell + profit cell).
    await expect(salesRow.getByText("٥٬٠٠٠٫٠٠").first()).toBeVisible();

    const marketingRow = row(page, "التسويق");
    // exact:true — the profit cell shows "؜-٣٬٣٠٠٫٠٠", which contains this as a substring.
    await expect(marketingRow.getByText("٣٬٣٠٠٫٠٠", { exact: true })).toBeVisible(); // expense only

    const adminRow = row(page, "الإدارة العامة");
    await expect(adminRow).toBeVisible();

    await expect(page.getByText("إجمالي الإيرادات")).toBeVisible();
    await expect(page.locator("div").filter({ hasText: /^إجمالي الإيرادات/ }).getByText("٧٬٠٠٠٫٠٠")).toBeVisible();
    await expect(page.locator("div").filter({ hasText: /^إجمالي المصروفات/ }).getByText("٤٬١٠٠٫٠٠")).toBeVisible();
    await expect(page.locator("div").filter({ hasText: /^صافي الربح/ }).getByText("٢٬٩٠٠٫٠٠")).toBeVisible();
  });

  test("narrowing the date range to before any posting shows zero activity", async ({ page }) => {
    await page.getByLabel("إلى تاريخ").fill("2026-08-05");
    await expect(page.getByText("لا توجد حركات في هذه الفترة")).toBeVisible();
  });
});

test.describe("Exchange Rates", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أسعار الصرف");
    await expect(page.getByRole("heading", { name: "أسعار الصرف" })).toBeVisible();
  });

  test("lists the seeded rates, filters by status, and approves the pending SAR rate", async ({ page }) => {
    await expect(page.getByText("عرض 3 سعر صرف")).toBeVisible();
    const usdRow = row(page, "USD / EGP");
    await expect(usdRow.getByText("معتمد", { exact: true })).toBeVisible();
    const sarRow = row(page, "SAR / EGP");
    await expect(sarRow.getByText("بانتظار الاعتماد")).toBeVisible();

    await sarRow.getByRole("button", { name: "اعتماد" }).click();
    await expect(row(page, "SAR / EGP").getByText("معتمد", { exact: true })).toBeVisible();
    await expect(row(page, "SAR / EGP").getByRole("button", { name: "اعتماد" })).toHaveCount(0);

    // The status filter is a plain button-chip row (filterBarExtra), not DocumentList's tab chips.
    await page.getByRole("button", { name: "معتمد", exact: true }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(3); // USD, EUR, and the just-approved SAR
  });

  test("adding a rate appears immediately as pending", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة سعر صرف" }).click();
    await page.getByLabel("العملة الأجنبية").selectOption("GBP");
    await page.getByLabel("سعر الصرف").fill("65.1234");
    await page.getByRole("button", { name: "حفظ" }).click();

    const gbpRow = row(page, "GBP / EGP");
    await expect(gbpRow).toBeVisible();
    await expect(gbpRow.getByText("بانتظار الاعتماد")).toBeVisible();
    await expect(page.getByText("عرض 4 سعر صرف")).toBeVisible();
  });
});

test.describe("FX Revaluation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "إعادة تقييم العملات الأجنبية");
    await expect(page.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeVisible();
  });

  test("previewing shows the open USD/EUR balances with a clean 500 gain on the USD line, then posting confirms", async ({ page }) => {
    await expect(page.getByText('اضغط "معاينة" لعرض الأرصدة المفتوحة وحساب فروق العملة.')).toBeVisible();

    await page.getByRole("button", { name: "معاينة" }).click();

    await expect(page.getByText("عرض 2 رصيد للتقييم")).toBeVisible();
    const usdRow = row(page, "USD", false);
    await expect(usdRow).toBeVisible();
    // exact:true — "٥٬٥٠٠٫٠٠" (revalued base) contains "٥٠٠٫٠٠" as a substring.
    await expect(usdRow.getByText("٥٠٠٫٠٠", { exact: true })).toBeVisible(); // clean: 5000 booked @50 -> 5500 @55 (ar-EG digits — see Cost Center P&L note above)
    await expect(row(page, "EUR", false)).toBeVisible();

    await expect(page.getByText("إجمالي المكاسب")).toBeVisible();

    // BUG: FxRevaluationScreen.tsx's runPost() calls setPosted({...}) and then
    // immediately `await runPreview()`, whose own FIRST statement is
    // setPosted(null) — executed synchronously (before runPreview's own await
    // yields), so React batches both updates into one render and `posted`
    // never actually renders. The success banner ("تم ترحيل قيد إعادة
    // التقييم …") can never appear; posting silently gives no confirmation.
    await page.getByRole("button", { name: "ترحيل التقييم" }).click();
    await expect(page.getByText("عرض 2 رصيد للتقييم")).toBeVisible(); // the re-run preview still renders fine
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("a date after the open balances but before the rates' effective date surfaces the missing-rate error", async ({ page }) => {
    // 2026-08-15: after both je-fx-usd/je-fx-eur (08-10/08-12, so the open
    // balances exist) but before the USD/EUR rates' effective date (08-25).
    await page.getByLabel("إلى تاريخ").fill("2026-08-15");
    await page.getByRole("button", { name: "معاينة" }).click();
    await expect(page.getByRole("alert")).toContainText("لا يوجد سعر إقفال معتمد للعملة");
  });
});

test.describe("Balance Reconciliation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مطابقة الأرصدة");
    await expect(page.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeVisible();
  });

  test("flags the inventory control account as mismatched while AR/AP match, and shows the one unlinked manual line", async ({ page }) => {
    await expect(page.getByText("توجد فروقات تحتاج إلى مراجعة")).toBeVisible();

    const inventoryRow = row(page, "تقييم المخزون مقابل دفتر الأستاذ");
    await expect(inventoryRow.getByText("غير متطابق")).toBeVisible();
    const arRow = row(page, "ذمم العملاء مقابل دفتر الأستاذ");
    await expect(arRow.getByText("متطابق", { exact: true })).toBeVisible();
    const apRow = row(page, "ذمم الموردين مقابل دفتر الأستاذ");
    await expect(apRow.getByText("متطابق", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /القيود غير المرتبطة/ }).click();
    await expect(page.getByText("عرض 1 بند غير مرتبط")).toBeVisible();
    await expect(page.getByText("تسوية يدوية على حساب المخزون").first()).toBeVisible();
  });
});

test.describe("ETA e-Invoicing", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الفاتورة الإلكترونية");
    await expect(page.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeVisible();
  });

  test("lists the 6 seeded submissions across their lifecycle statuses", async ({ page }) => {
    await expect(page.getByText("عرض 6 من 6 مستند")).toBeVisible();
    await expect(row(page, "INV-000014").getByText("جاهز", { exact: true })).toBeVisible();
    await expect(row(page, "INV-000011").getByText("مقبول")).toBeVisible();
    await expect(row(page, "INV-000011").getByText("ETA-UUID-11")).toBeVisible();
    const errorRow = row(page, "INV-000009");
    await expect(errorRow.getByText("أخطاء", { exact: true })).toBeVisible();
    await expect(errorRow.getByText(/رقم تسجيل المشتري مطلوب/)).toBeVisible();

    await expect(page.getByRole("button", { name: /^جاهز/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^مقبول/ })).toBeVisible();
  });

  test("submitting a ready document offline stays queued with a notice (online transmit is stubbed)", async ({ page }) => {
    await row(page, "INV-000014").getByRole("button", { name: "إرسال" }).click();
    await expect(page.getByRole("status")).toContainText("الإرسال الفعلي متاح فقط عند الاتصال");
    await expect(row(page, "INV-000014").getByText("جاهز", { exact: true })).toBeVisible(); // unchanged
  });

  test("excluding the error document requires a reason, then moves it to مستبعد", async ({ page }) => {
    await row(page, "INV-000009").getByRole("button", { name: "استبعاد" }).click();
    await expect(page.getByText("سبب الاستبعاد (إلزامي)")).toBeVisible();

    await page.getByLabel("سبب الاستبعاد").fill("تم إلغاء الفاتورة");
    await page.getByRole("button", { name: "تأكيد الاستبعاد" }).click();

    await expect(row(page, "INV-000009").getByText("مستبعد", { exact: true })).toBeVisible();
    await expect(row(page, "INV-000009").getByRole("button", { name: "إرسال" })).toHaveCount(0);
  });
});
