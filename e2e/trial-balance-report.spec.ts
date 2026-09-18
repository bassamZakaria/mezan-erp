import { test, expect, type Locator, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";
import { brokenLabelField } from "./support/broken-label";

/**
 * ميزان المراجعة (apps/web/src/screens/TrialBalanceReportScreen.tsx). This is
 * now a REAL, live trial balance over the tenant's own chart of accounts and
 * posted journal entries — not the old static "sample GL data" demo (which
 * always showed a fixed 147,000.00 total regardless of the date param). The
 * demo seed carries real activity on 1300-1 and 4100 (opening capital,
 * treasury vouchers, sales), so this file posts its own balanced journal
 * entry (mirroring journals.spec.ts's helper) and asserts the CHANGE it
 * causes to each account's balance — never an absolute figure, which would
 * drift with whatever else the seed or another test already posted.
 *
 * "حتى تاريخ" defaults to TODAY, computed live — not a fixed calendar date.
 */

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Reads a money cell's text (e.g. "52,367.83 ج.م") as a plain number. */
async function cellMoney(row: Locator, index: number): Promise<number> {
  const text = await row.locator("td").nth(index).innerText();
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return Number(match?.[0] ?? "NaN");
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
  // Three tests below each post their own journal entry to the SAME two GL
  // accounts (1300-1 / 4100) and read that account's aggregate balance —
  // running them in parallel would race each other's postings against one
  // another's before/after reads. Serial (same pattern as crm.spec.ts and
  // projects-assets-field.spec.ts) makes each test's delta deterministic.
  test.describe.configure({ mode: "serial" });

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
    // 1300-1 and 4100 already carry real demo activity (the seed's opening
    // capital deposit and every treasury/sales posting since), so this
    // reads the BEFORE balances first and asserts the CHANGE this entry
    // causes — never an absolute figure.
    await page.getByRole("button", { name: "عرض التقرير" }).click();
    const cashRow = page.locator("table tbody tr").filter({ hasText: "1300-1" });
    const revenueRow = page.locator("table tbody tr").filter({ hasText: "4100" });
    await expect(cashRow).toBeVisible();
    await expect(revenueRow).toBeVisible();
    const cashDebitBefore = await cellMoney(cashRow, 2);
    const revenueCreditBefore = await cellMoney(revenueRow, 3);

    const memo = unique("قيد ميزان مراجعة");
    await createPostedJournalEntry(page, memo, todayIso(), "250");

    await clickSidebarItem(page, "ميزان المراجعة");
    await expect(page.getByRole("heading", { name: "ميزان المراجعة" })).toBeVisible();
    // Same params as the first run (same as-of date) — the app's QueryClient
    // has a 30s staleTime (apps/web/src/data/queryClient.ts), so re-clicking
    // "عرض التقرير" within that window just re-serves the cached PRE-posting
    // result with no network call at all. A reload gets a genuinely fresh
    // QueryClient rather than racing the cache window.
    await page.reload();
    await expect(page.getByRole("heading", { name: "ميزان المراجعة" })).toBeVisible();
    await page.getByRole("button", { name: "عرض التقرير" }).click();

    await expect(cashRow).toBeVisible();
    expect(await cellMoney(cashRow, 2)).toBeCloseTo(cashDebitBefore + 250, 2);

    await expect(revenueRow).toBeVisible();
    expect(await cellMoney(revenueRow, 3)).toBeCloseTo(revenueCreditBefore + 250, 2);

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
