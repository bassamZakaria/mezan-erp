import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Accounting-depth screens (apps/web/src/screens/{CostCenterPnL,
 * ExchangeRates,FxRevaluation,Reconciliation,Eta}Screen.tsx). These no
 * longer run over a self-contained sandbox store (the old
 * `apps/web/src/store/accounting-depth-store.ts` this spec used to describe
 * no longer exists in the codebase) — every one of them is now wired to the
 * REAL shared backend, same as the rest of the app. The e2e tenant starts
 * with no cost centers, exchange rates, foreign-currency exposure, or
 * mismatched control accounts, so:
 *   - Exchange Rates gets full real CRUD coverage (add/approve/filter) since
 *     that needs no other fixture.
 *   - Cost Center P&L / FX Revaluation / Balance Reconciliation are
 *     genuinely empty in a fresh tenant (no cost-center-tagged postings, no
 *     open foreign-currency balances, no mismatched control accounts to
 *     manufacture without deep cross-module fixtures) — their honest empty
 *     states are what's tested here.
 *   - ETA e-Invoicing is now a setup/configuration screen (a readiness
 *     meter over "بيانات الربط"/"ربط الأصناف"/"ربط الوحدات"/"الإرسالات"
 *     tabs), not the old list of pre-submitted documents.
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

  test("shows a genuine empty state — no cost-center-tagged postings in a fresh tenant", async ({ page }) => {
    await expect(page.getByText("إجمالي الإيرادات")).toBeVisible();
    await expect(page.getByText("لا توجد حركات في هذه الفترة")).toBeVisible();
  });
});

test.describe("Exchange Rates", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أسعار الصرف");
    await expect(page.getByRole("heading", { name: "أسعار الصرف" })).toBeVisible();
  });

  test("adding a rate appears as pending, then approving it moves it to the معتمد filter", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة سعر صرف" }).first().click();
    await page.getByRole("combobox", { name: "العملة الأجنبية" }).click();
    await page.getByRole("option", { name: /GBP/ }).click();
    await page.getByLabel("سعر الصرف").fill("65.1234");
    await page.getByLabel("تاريخ السريان").fill("2026-08-01");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    const gbpRow = row(page, "GBP / EGP");
    await expect(gbpRow).toBeVisible();
    await expect(gbpRow.getByText("بانتظار الاعتماد")).toBeVisible();

    // "اعتماد" is behind the row's actions menu, not a direct row button.
    await gbpRow.getByRole("button", { name: "إجراءات GBP" }).click();
    await page.getByRole("menuitem", { name: "اعتماد" }).click();
    await expect(row(page, "GBP / EGP").getByText("معتمد", { exact: true })).toBeVisible();
    // RowMenu (packages/ui/src/primitives/RowMenu.tsx) renders nothing when
    // its item list is empty rather than a menu with no items — once
    // approved, ExchangeRatesScreen's rowAction offers no more actions, so
    // the trigger button itself disappears rather than opening an empty menu.
    await expect(row(page, "GBP / EGP").getByRole("button", { name: "إجراءات GBP" })).toHaveCount(0);

    // The status filter is a radiogroup of Chips, not DocumentList's tabs.
    await page.getByRole("radio", { name: "معتمد", exact: true }).click();
    await expect(row(page, "GBP / EGP")).toBeVisible();

    await page.getByRole("radio", { name: "بانتظار الاعتماد" }).click();
    await expect(row(page, "GBP / EGP")).toHaveCount(0);
  });
});

test.describe("FX Revaluation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "إعادة تقييم العملات الأجنبية");
    await expect(page.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeVisible();
  });

  test("previewing with no foreign-currency exposure shows a genuine empty result, not a crash", async ({ page }) => {
    await expect(page.getByText('اضغط "معاينة" لعرض الأرصدة المفتوحة وحساب فروق العملة.')).toBeVisible();

    await page.getByRole("button", { name: "معاينة" }).click();

    await expect(page.getByText("لا توجد أرصدة مفتوحة.").first()).toBeVisible();
  });
});

test.describe("Balance Reconciliation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مطابقة الأرصدة");
    await expect(page.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeVisible();
  });

  test("shows every control account matched in a fresh tenant with nothing posted", async ({ page }) => {
    await expect(page.getByText("جميع الأرصدة متطابقة")).toBeVisible();

    for (const label of [
      "تقييم المخزون مقابل دفتر الأستاذ",
      "ذمم العملاء مقابل دفتر الأستاذ",
      "ذمم الموردين مقابل دفتر الأستاذ",
    ]) {
      await expect(row(page, label).getByText("متطابق", { exact: true })).toBeVisible();
    }

    await expect(page.getByText("القيود غير المرتبطة (0)")).toBeVisible();
  });
});

test.describe("ETA e-Invoicing setup", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الفاتورة الإلكترونية");
    await expect(page.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeVisible();
  });

  test("shows the readiness meter and the four setup tabs, starting well under 100% ready", async ({ page }) => {
    await expect(page.getByText(/الجاهزية: \d+%/)).toBeVisible();
    const readinessText = await page.getByText(/الجاهزية: \d+%/).innerText();
    const readiness = Number(readinessText.match(/(\d+)%/)?.[1] ?? "100");
    // A fresh tenant hasn't filled in tax registration, branch codes, unit
    // mappings, etc. yet — readiness is real, not decorative.
    expect(readiness).toBeLessThan(100);

    const tablist = page.getByRole("tablist");
    for (const tab of ["عام", "بيانات الربط", "ربط الأصناف", "ربط الوحدات", "الإرسالات"]) {
      await expect(tablist.getByRole("tab", { name: tab })).toBeVisible();
    }
  });

  test("filling the tax registration number and saving raises the readiness percentage", async ({ page }) => {
    // "رقم التسجيل الضريبي *" lives on "عام" (GeneralTab) — the tab already
    // active by default — NOT "بيانات الربط" (CredentialsTab, client
    // id/secret only). See apps/web/src/screens/EtaScreen.tsx's TAB_ENTRIES
    // ("eta.tabGeneral" → "عام", "eta.tabCredentials" → "بيانات الربط").
    const before = Number((await page.getByText(/الجاهزية: \d+%/).innerText()).match(/(\d+)%/)?.[1] ?? "0");

    await page.getByLabel("رقم التسجيل الضريبي *").fill("300123456700099");
    // Two "حفظ" buttons exist on this tab — the main config form's, and the
    // branch-codes sub-table's own per-row save; .first() is the form's.
    const configSaved = page.waitForResponse((r) => r.url().includes("/eta/config") && r.request().method() === "PUT");
    await page.getByRole("button", { name: "حفظ", exact: true }).first().click();
    await configSaved;

    await expect(page.getByText(/الجاهزية: \d+%/)).toBeVisible();
    const after = Number((await page.getByText(/الجاهزية: \d+%/).innerText()).match(/(\d+)%/)?.[1] ?? "0");
    expect(after).toBeGreaterThan(before);

    // Persists across a reload — it's real tenant config, not local draft state.
    await page.reload();
    await expect(page.getByLabel("رقم التسجيل الضريبي *")).toHaveValue("300123456700099");
  });
});
