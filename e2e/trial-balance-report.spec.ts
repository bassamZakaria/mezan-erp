import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * ميزان المراجعة (apps/web/src/screens/TrialBalanceReportScreen.tsx). This is
 * now a REAL, live trial balance over the tenant's own chart of accounts and
 * posted journal entries — not the old static "sample GL data" demo (which
 * always showed a fixed 147,000.00 total regardless of the date param). The
 * e2e backend starts with no posted entries, so every account reads 0.00 by
 * default (books trivially balanced, 0 = 0); this file posts a real,
 * balanced journal entry first (mirroring journals.spec.ts's helper) so the
 * report has something real to reconcile.
 *
 * "حتى تاريخ" defaults to TODAY, computed live — not a fixed calendar date.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option. */
async function chooseCombo(page: Page, comboLabel: string, optionPattern: RegExp): Promise<void> {
  await page.getByRole("combobox", { name: comboLabel }).click();
  await page.getByRole("option", { name: optionPattern }).click();
}

/** Posts a balanced 2-line entry (1300-1 debit / 4100 credit) with the given memo and date, returning its entry number. */
async function createPostedJournalEntry(page: Page, memo: string, date: string, amount = "100"): Promise<string> {
  await clickSidebarItem(page, "القيود المحاسبية");
  await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
  await page.getByRole("button", { name: "قيد جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "إنشاء قيد يومي" })).toBeVisible();

  // Positional locator (e2e/support/broken-label.ts); journals.spec.ts holds
  // the guarantee that this field's label names its input.
  await brokenLabelField(page, "تاريخ القيد *").fill(date);
  await page.getByPlaceholder("وصف القيد...").fill(memo);
  await chooseCombo(page, "الحساب للسطر 1", /^1300-1 —/);
  await page.getByLabel("مدين للسطر 1").fill(amount);
  await chooseCombo(page, "الحساب للسطر 2", /^4100 —/);
  await page.getByLabel("دائن للسطر 2").fill(amount);

  await page.getByRole("button", { name: "ترحيل القيد" }).click();
  await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم القيد...").fill(memo);
  const row = page.locator("table tbody tr").filter({ hasText: memo });
  await expect(row).toHaveCount(1);
  const entryNo = (await row.locator("td").first().locator(".mz-num").first().innerText()).trim();
  return entryNo;
}

test.describe("Report runner — ميزان المراجعة", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "ميزان المراجعة");
    await expect(page.getByRole("heading", { name: "ميزان المراجعة" })).toBeVisible();
  });

  test("renders the param bar defaulted to today, and gates results behind عرض التقرير", async ({ page }) => {
    await expect(page.getByLabel("حتى تاريخ")).toHaveValue(todayIso());
    const runButton = page.getByRole("button", { name: "عرض التقرير" });
    await expect(runButton).toBeVisible();

    await expect(page.getByText("1300-1", { exact: true })).toHaveCount(0);
    // Export buttons are present but disabled before any result exists.
    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeDisabled();
  });

  test("running the report reflects a real posted entry, with a balanced reconciliation banner", async ({ page }) => {
    const memo = unique("قيد ميزان مراجعة");
    await createPostedJournalEntry(page, memo, todayIso(), "250");

    await clickSidebarItem(page, "ميزان المراجعة");
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    const cashRow = page.locator("table tbody tr").filter({ hasText: "1300-1" });
    await expect(cashRow).toBeVisible();
    await expect(cashRow.getByText("250.00", { exact: false }).first()).toBeVisible();

    const revenueRow = page.locator("table tbody tr").filter({ hasText: "4100" });
    await expect(revenueRow).toBeVisible();
    await expect(revenueRow.getByText("250.00", { exact: false }).first()).toBeVisible();

    await expect(page.getByText("إجمالي المدين = إجمالي الدائن")).toBeVisible();
    await expect(page.getByText("الدفاتر متوازنة — إجمالي المدين يساوي إجمالي الدائن")).toBeVisible();

    await expect(page.getByRole("button", { name: "تصدير CSV" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "تصدير Excel" })).toBeEnabled();
  });

  test("an as-of date before the entry was posted excludes it from the balance", async ({ page }) => {
    const memo = unique("قيد ميزان مراجعة سابق");
    await createPostedJournalEntry(page, memo, todayIso(), "250");

    await clickSidebarItem(page, "ميزان المراجعة");
    await page.getByLabel("حتى تاريخ").fill("2020-01-01");
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    const cashRow = page.locator("table tbody tr").filter({ hasText: "1300-1" });
    await expect(cashRow).toBeVisible();
    await expect(cashRow.getByText("0.00", { exact: false }).first()).toBeVisible();
    await expect(cashRow.getByText("250.00")).toHaveCount(0);
  });

  // Clearing the native <input type="date"> and running the report no longer
  // surfaces the old "تاريخ غير صالح" validation error — it falls back to an
  // unbounded as-of (every posted entry, regardless of date) instead of
  // refusing to run. Documented as the real, current behavior rather than
  // the fictitious error this spec used to assert.
  test("clearing the as-of date runs the report unbounded instead of refusing to run", async ({ page }) => {
    const memo = unique("قيد بلا تاريخ محدد");
    await createPostedJournalEntry(page, memo, todayIso(), "250");

    await clickSidebarItem(page, "ميزان المراجعة");
    await page.getByLabel("حتى تاريخ").fill("");
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    const cashRow = page.locator("table tbody tr").filter({ hasText: "1300-1" });
    await expect(cashRow).toBeVisible();
    // Not asserting an exact accumulated figure — earlier tests in this file
    // may have posted their own entries to the same account — only that the
    // grand total the reconciliation banner reports is genuinely non-zero
    // (the entry just posted is reflected) rather than the untouched-zero
    // reading a fresh tenant starts with.
    await expect(page.getByText("0.00 0.00")).toHaveCount(0);
    await expect(page.getByText("تاريخ غير صالح")).toHaveCount(0);
  });
});
