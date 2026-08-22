import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Journal Entries (القيود المحاسبية) — the document framework's first real
 * module (apps/web/src/screens/JournalsScreen.tsx, PR #21). 3 seeded posted
 * entries (journals-sample-data.ts): JE-000001..000003; new entries continue
 * from JE-000004. Covers the DocumentList/DocumentDetail/DocumentStatusStepper
 * primitives plus the create form's live balance gating.
 */

const SCREENSHOT_DIR = "e2e-results/screenshots";

function docNumbers(page: Page) {
  return page.locator("table tbody tr td:first-child .mz-num");
}

test.describe("Journal Entries — list", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "القيود المحاسبية");
    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
  });

  test("lists the seeded posted entries", async ({ page }) => {
    await expect(docNumbers(page)).toHaveCount(3);
    await expect(page.getByText("JE-000001")).toBeVisible();
    await expect(page.getByText("JE-000003")).toBeVisible();
    await expect(page.getByText("عرض 3 من 3 قيد")).toBeVisible();
  });

  test("status chips filter to posted entries, and to an empty draft set", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });

    await tablist.getByRole("tab", { name: /^مرحل\s+\d/ }).click();
    await expect(docNumbers(page)).toHaveCount(3);

    await tablist.getByRole("tab", { name: /^مسودة\s+\d/ }).click();
    await expect(page.getByText("لا توجد قيود مطابقة")).toBeVisible();

    await tablist.getByRole("tab", { name: /^الكل\s+\d/ }).click();
    await expect(docNumbers(page)).toHaveCount(3);
  });

  test("search filters by journal number and by memo text", async ({ page }) => {
    const search = page.getByPlaceholder("بحث برقم القيد...");

    await search.fill("000002");
    await expect(docNumbers(page)).toHaveText(["JE-000002"]);

    await search.fill("");
    await search.fill("رأس المال");
    await expect(docNumbers(page)).toHaveText(["JE-000001"]);

    await search.fill("لا يوجد شيء بهذا الاسم");
    await expect(page.getByText("لا توجد قيود مطابقة")).toBeVisible();
  });
});

test.describe("Journal Entries — detail", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "القيود المحاسبية");
    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
  });

  test("opening a posted entry shows the balance badge, the lifecycle stepper on مرحل, and a reverse action", async ({ page }) => {
    await page.getByText("JE-000001", { exact: true }).click();

    await expect(page.getByRole("heading", { name: "JE-000001" })).toBeVisible();
    await expect(page.getByText("متوازن ✓").first()).toBeVisible();

    const stepper = page.getByLabel("حالة المستند");
    await expect(stepper).toBeVisible();
    await expect(stepper.locator('[aria-current="step"]')).toContainText("مرحل");

    await expect(page.getByRole("button", { name: "عكس القيد" })).toBeVisible();
  });

  test("رجوع returns to the list", async ({ page }) => {
    await page.getByText("JE-000002", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "JE-000002" })).toBeVisible();

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
    await page.getByRole("button", { name: "قيد جديد" }).click();
    await expect(page.getByRole("heading", { name: "إنشاء قيد يومي" })).toBeVisible();
  });

  test("typing an unbalanced entry disables ترحيل القيد; balancing it enables the button", async ({ page }) => {
    const postButton = page.getByRole("button", { name: "ترحيل القيد" });
    await expect(postButton).toBeDisabled();

    await page.getByLabel("الوصف *").fill("قيد اختبار");
    await page.getByLabel("الحساب للسطر 1").selectOption("1300-1");
    await page.getByLabel("مدين للسطر 1").fill("100");

    await expect(postButton).toBeDisabled();
    await expect(page.getByText("غير متوازن", { exact: true })).toBeVisible();

    await page.getByLabel("الحساب للسطر 2").selectOption("4100");
    await page.getByLabel("دائن للسطر 2").fill("100");

    await expect(postButton).toBeEnabled();
    await expect(page.getByText("متوازن ✓", { exact: true })).toBeVisible();
  });

  test("posting a balanced entry returns to the list with the new journal number", async ({ page }) => {
    await page.getByLabel("الوصف *").fill("قيد اختبار");
    await page.getByLabel("الحساب للسطر 1").selectOption("1300-1");
    await page.getByLabel("مدين للسطر 1").fill("100");
    await page.getByLabel("الحساب للسطر 2").selectOption("4100");
    await page.getByLabel("دائن للسطر 2").fill("100");

    await page.getByRole("button", { name: "ترحيل القيد" }).click();

    await expect(page.getByRole("heading", { name: "القيود المحاسبية" })).toBeVisible();
    await expect(page.getByText("JE-000004")).toBeVisible();
    await expect(page.getByText("عرض 4 من 4 قيد")).toBeVisible();
  });

  test("light and dark screenshots of the create screen", async ({ page }) => {
    await page.getByLabel("الوصف *").fill("قيد اختبار");
    await page.getByLabel("الحساب للسطر 1").selectOption("1300-1");
    await page.getByLabel("مدين للسطر 1").fill("100");
    await page.getByLabel("الحساب للسطر 2").selectOption("4100");
    await page.getByLabel("دائن للسطر 2").fill("100");
    await expect(page.getByText("متوازن ✓")).toBeVisible();

    // Light is the default (no explicit [data-theme]) — see theme.spec.ts.
    await page.screenshot({ path: `${SCREENSHOT_DIR}/journal-create-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/journal-create-dark.png` });
  });
});
