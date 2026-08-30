import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Journal Entries (القيود المحاسبية) — apps/web/src/screens/JournalsScreen.tsx.
 * The e2e backend now starts as a genuinely empty tenant (packages/backend/src/
 * seed.ts seeds only the chart of accounts, VAT, one branch/warehouse and the
 * admin user — no journal entries), so every test creates its own entries
 * first via the real create flow, then isolates its own rows by a unique memo
 * — the same pattern sales-invoices.spec.ts and purchase-chain.spec.ts use,
 * since the backend is shared with other e2e spec files.
 *
 * KNOWN PRODUCT DEFECT (see the dedicated test below): the create form's
 * "الوصف *" / "تاريخ القيد *" fields (apps/web/src/settings/form-controls.tsx's
 * `Field`/`TextField`) render a `<label>` with no `htmlFor`, and the `<input>`
 * it sits beside carries no matching `id` — so the label is never
 * programmatically associated with its control (`getByLabel` cannot find it;
 * a screen reader announces nothing; clicking the label text does not focus
 * the field). Every OTHER field in this suite is fine — the memo/date fields
 * are the only ones built through that specific wrapper here. Fixture setup
 * below works around it via the field's placeholder, which is a real,
 * present-but-unlabeled control a sighted mouse user could still find.
 */

const SCREENSHOT_DIR = "e2e-results/screenshots";

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function docNumbers(page: Page) {
  return page.locator("table tbody tr td:first-child .mz-num");
}

function uniqueRow(page: Page, text: string): Locator {
  return page.locator("table tbody tr").filter({ hasText: text });
}

/** Clicks a `Select` primitive's combobox trigger, then the matching portaled option — it is not a native `<select>` (packages/ui/src/primitives/Select.tsx). */
async function chooseCombo(page: Page, comboLabel: string, optionPattern: RegExp): Promise<void> {
  await page.getByRole("combobox", { name: comboLabel }).click();
  await page.getByRole("option", { name: optionPattern }).click();
}

/** Opens قيد جديد, fills a balanced 2-line entry (1300-1 debit / 4100 credit) with the given memo, and posts it. */
async function createPostedJournalEntry(page: Page, memo: string, amount = "100"): Promise<string> {
  await clickSidebarItem(page, "القيود المحاسبية");
  await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
  // The header's "قيد جديد" is always in the DOM; the empty-state region
  // (JournalsScreen.tsx's `emptyState` prop) renders a second button with the
  // exact same label whenever the list briefly reads zero rows — .first() is
  // the header's, which is always present regardless of row count.
  await page.getByRole("button", { name: "قيد جديد" }).first().click();
  await expect(page.getByRole("heading", { name: "إنشاء قيد يومي" })).toBeVisible();

  // Workaround for the broken "الوصف *" label — see file header.
  await page.getByPlaceholder("وصف القيد...").fill(memo);
  await chooseCombo(page, "الحساب للسطر 1", /^1300-1 —/);
  await page.getByLabel("مدين للسطر 1").fill(amount);
  await chooseCombo(page, "الحساب للسطر 2", /^4100 —/);
  await page.getByLabel("دائن للسطر 2").fill(amount);

  await page.getByRole("button", { name: "ترحيل القيد" }).click();
  await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();

  await page.getByPlaceholder("بحث برقم القيد...").fill(memo);
  const row = uniqueRow(page, memo);
  await expect(row).toHaveCount(1);
  const entryNo = (await row.locator("td").first().locator(".mz-num").first().innerText()).trim();
  await page.getByPlaceholder("بحث برقم القيد...").fill("");
  return entryNo;
}

test.describe("Journal Entries — list", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("a posted entry appears in the list, findable by its own number and memo", async ({ page }) => {
    const memo = unique("قيد اختبار قائمة");
    const entryNo = await createPostedJournalEntry(page, memo);
    expect(entryNo).toMatch(/^JE-\d+$/);

    const search = page.getByPlaceholder("بحث برقم القيد...");
    await search.fill(entryNo);
    await expect(docNumbers(page)).toHaveText([entryNo]);

    await search.fill("");
    await search.fill(memo);
    await expect(docNumbers(page)).toHaveText([entryNo]);

    await search.fill(unique("لا يوجد شيء بهذا الاسم"));
    await expect(page.getByText("لا توجد قيود مطابقة")).toBeVisible();
  });

  test("the مرحل status chip filters to a freshly-posted entry; a zero-count chip like مسودة is not offered", async ({ page }) => {
    const memo = unique("قيد اختبار تصفية");
    const entryNo = await createPostedJournalEntry(page, memo);

    await clickSidebarItem(page, "القيود المحاسبية");
    await page.getByPlaceholder("بحث برقم القيد...").fill(memo);

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^مرحل\s+\d/ }).click();
    await expect(docNumbers(page)).toHaveText([entryNo]);

    // A view with count === 0 is not rendered at all (packages/ui/src/primitives/
    // ListViews.tsx) — "a zero-count option teaches nothing" — so مسودة/معكوس
    // are simply absent, not present-but-empty, while this search is scoped
    // to our one posted entry.
    await expect(tablist.getByRole("tab", { name: /^مسودة/ })).toHaveCount(0);
    await expect(tablist.getByRole("tab", { name: /^معكوس/ })).toHaveCount(0);

    await tablist.getByRole("tab", { name: /^الكل\s+\d/ }).click();
    await expect(docNumbers(page)).toHaveText([entryNo]);
  });
});

test.describe("Journal Entries — detail", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("opening a posted entry shows the balance badge, the lifecycle stepper on مرحل, and a reverse action", async ({ page }) => {
    const memo = unique("قيد اختبار تفاصيل");
    const entryNo = await createPostedJournalEntry(page, memo);
    await clickSidebarItem(page, "القيود المحاسبية");
    await page.getByPlaceholder("بحث برقم القيد...").fill(memo);
    await uniqueRow(page, memo).click();

    await expect(page.getByRole("heading", { name: entryNo })).toBeVisible();
    await expect(page.getByText("متوازن ✓").first()).toBeVisible();

    const stepper = page.getByLabel("حالة المستند");
    await expect(stepper).toBeVisible();
    await expect(stepper.locator('[aria-current="step"]')).toContainText("مرحل");

    await expect(page.getByRole("button", { name: "عكس القيد" })).toBeVisible();
  });

  test("رجوع returns to the list", async ({ page }) => {
    const memo = unique("قيد اختبار رجوع");
    const entryNo = await createPostedJournalEntry(page, memo);
    await clickSidebarItem(page, "القيود المحاسبية");
    await page.getByPlaceholder("بحث برقم القيد...").fill(memo);
    await uniqueRow(page, memo).click();
    await expect(page.getByRole("heading", { name: entryNo })).toBeVisible();

    await page.getByRole("button", { name: "رجوع" }).click();
    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
  });
});

test.describe("Journal Entries — create: live balance gating", () => {
  test.beforeEach(async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "القيود المحاسبية");
    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
    await page.getByRole("button", { name: "قيد جديد" }).first().click();
    await expect(page.getByRole("heading", { name: "إنشاء قيد يومي" })).toBeVisible();
  });

  // D67 was here: `TextField` rendered a <label> with no `htmlFor` beside an
  // <input> with no `id`, so this screen's memo field — bound through that
  // wrapper (JournalsScreen.tsx's `t("journals.description2")`) — had no
  // accessible name at all. The wrapper now generates the id, and this is the
  // guarantee that made it a fix rather than a workaround: the label reaches
  // the control, for a screen reader and for a click on the label text.
  test("the memo field's «الوصف *» label names its input", async ({ page }) => {
    const memo = page.getByLabel("الوصف *");
    await memo.fill("قيد اختبار");
    await expect(memo).toHaveValue("قيد اختبار");
    await expect(memo).toHaveAttribute("placeholder", "وصف القيد...");
  });

  test("typing an unbalanced entry disables ترحيل القيد; balancing it enables the button", async ({ page }) => {
    const postButton = page.getByRole("button", { name: "ترحيل القيد" });
    await expect(postButton).toBeDisabled();

    await page.getByPlaceholder("وصف القيد...").fill(unique("قيد اختبار"));
    await chooseCombo(page, "الحساب للسطر 1", /^1300-1 —/);
    await page.getByLabel("مدين للسطر 1").fill("100");

    await expect(postButton).toBeDisabled();
    await expect(page.getByText("غير متوازن", { exact: true })).toBeVisible();

    await chooseCombo(page, "الحساب للسطر 2", /^4100 —/);
    await page.getByLabel("دائن للسطر 2").fill("100");

    await expect(postButton).toBeEnabled();
    await expect(page.getByText("متوازن ✓", { exact: true })).toBeVisible();
  });

  test("posting a balanced entry returns to the list with the new journal number", async ({ page }) => {
    const memo = unique("قيد اختبار ترحيل");
    await page.getByPlaceholder("وصف القيد...").fill(memo);
    await chooseCombo(page, "الحساب للسطر 1", /^1300-1 —/);
    await page.getByLabel("مدين للسطر 1").fill("100");
    await chooseCombo(page, "الحساب للسطر 2", /^4100 —/);
    await page.getByLabel("دائن للسطر 2").fill("100");

    await page.getByRole("button", { name: "ترحيل القيد" }).click();

    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
    await page.getByPlaceholder("بحث برقم القيد...").fill(memo);
    const row = uniqueRow(page, memo);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(/^JE-\d+$/)).toBeVisible();
  });

  test("light and dark screenshots of the create screen", async ({ page }) => {
    await page.getByPlaceholder("وصف القيد...").fill(unique("قيد اختبار"));
    await chooseCombo(page, "الحساب للسطر 1", /^1300-1 —/);
    await page.getByLabel("مدين للسطر 1").fill("100");
    await chooseCombo(page, "الحساب للسطر 2", /^4100 —/);
    await page.getByLabel("دائن للسطر 2").fill("100");
    await expect(page.getByText("متوازن ✓")).toBeVisible();

    // Light is the explicit default — see theme.spec.ts.
    await page.screenshot({ path: `${SCREENSHOT_DIR}/journal-create-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/journal-create-dark.png` });
  });
});
