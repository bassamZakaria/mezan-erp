import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Manufacturing screens (apps/web/src/screens/{Boms,WorkOrders,
 * ConfigurableProducts}Screen.tsx). Unlike the phase11 CRM/Projects/Assets/
 * Field screens, these three are still client-side demo data only
 * (apps/web/src/manufacturing-sample-data.ts) — no API wiring, and their
 * "add" buttons render with no onClick handler at all. So this suite only
 * exercises what actually renders: list/filter/search/detail, and — for
 * Work Orders — the (client-side-only) 4-stage advance button, which is the
 * one genuinely interactive piece of manufacturing UI today.
 *
 * Demo data: 2 BOMs (BOM-0001 v1 inactive/2 lines, BOM-0002 v2 active/3
 * lines, both for FG-TABLE "طاولة خشبية"); 4 work orders (WO-0001 stage
 * "started"/in_progress, WO-0002 "materials_issued"/in_progress, WO-0003
 * "completed"/completed, WO-0004 "not_started"/planned); 2 configurable
 * products (WINDOW formula-priced/2 inputs, DOOR manual-priced/1 input).
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

/** Scopes a stat card by its exact label — StatCard's own "relative overflow-hidden" wrapper. */
function statCard(page: Page, label: string) {
  return page.locator("div.relative.overflow-hidden").filter({ has: page.getByText(label, { exact: true }) });
}

/** Scopes a DocumentDetail summary-strip item by its exact label — its "border-e" cell wrapper. */
function summaryItem(page: Page, label: string) {
  return page.locator("div.border-e").filter({ has: page.getByText(label, { exact: true }) });
}

test.describe("BOMs", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "قوائم المواد");
    await expect(page.getByRole("heading", { name: "قوائم المواد" })).toBeVisible();
  });

  test("lists the 2 demo BOMs with version/line-count columns and status filter chips", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 قائمة")).toBeVisible();
    const bom1 = row(page, "BOM-0001");
    await expect(bom1).toBeVisible();
    await expect(bom1.getByText("v1")).toBeVisible();
    await expect(bom1.locator("td").nth(3)).toHaveText("2"); // عدد البنود
    await expect(bom1.getByText("غير نشط")).toBeVisible();

    const bom2 = row(page, "BOM-0002");
    await expect(bom2).toBeVisible();
    await expect(bom2.getByText("v2")).toBeVisible();
    await expect(bom2.getByText("نشط", { exact: true })).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^نشط\s+\d/ }).click();
    await expect(page.getByText("عرض 1 من 2 قائمة")).toBeVisible();
    await expect(row(page, "BOM-0002")).toBeVisible();
    await expect(row(page, "BOM-0001")).toBeHidden();

    await tablist.getByRole("tab", { name: /^غير نشط\s+\d/ }).click();
    await expect(row(page, "BOM-0001")).toBeVisible();
    await expect(row(page, "BOM-0002")).toBeHidden();

    await tablist.getByRole("tab", { name: /^الكل\s+\d/ }).click();
    await expect(page.getByText("عرض 2 من 2 قائمة")).toBeVisible();
  });

  test("search narrows by BOM number or product name, and clears back to all", async ({ page }) => {
    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("0001");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "BOM-0001")).toBeVisible();

    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("طاولة");
    await expect(page.locator("table tbody tr")).toHaveCount(2); // both BOMs are for the same product

    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("لا يوجد بهذا الاسم");
    await expect(page.getByText("لا توجد قوائم مواد مطابقة")).toBeVisible();
  });

  test("opening BOM-0002 shows its waste-adjusted line quantities, then returns to the list", async ({ page }) => {
    await row(page, "BOM-0002").click();

    await expect(page.getByRole("heading", { name: "قائمة مواد BOM-0002" })).toBeVisible();
    await expect(page.getByText("الإصدار 2")).toBeVisible();

    const tab = page.getByRole("tab", { name: "بنود المواد الخام (3)" });
    await expect(tab).toBeVisible();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("لوح خشب")).toBeVisible();
    await expect(panel.getByText("مسامير")).toBeVisible();
    await expect(panel.getByText("دهان (لتر)")).toBeVisible();
    // m-paint: qty 0.5, waste 10% -> effective qty 0.55
    const paintRow = panel.locator("tbody tr").filter({ hasText: "دهان (لتر)" });
    await expect(paintRow.getByText("10%")).toBeVisible();
    await expect(paintRow.getByText("0.55")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقوائم المواد" }).click();
    await expect(page.getByRole("heading", { name: "قوائم المواد" })).toBeVisible();
    await expect(row(page, "BOM-0002")).toBeVisible();
  });

  test("the add button is a stub — it opens no dialog", async ({ page }) => {
    await page.getByRole("button", { name: "قائمة مواد جديدة" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("عرض 2 من 2 قائمة")).toBeVisible();
  });
});

test.describe("Work Orders", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أوامر التصنيع");
    await expect(page.getByRole("heading", { name: "أوامر التصنيع" })).toBeVisible();
  });

  test("lists the 4 demo work orders with correct planned/in-progress/overdue stats", async ({ page }) => {
    await expect(page.getByText("عرض 4 من 4 أمر")).toBeVisible();
    await expect(row(page, "WO-0001")).toBeVisible();
    await expect(row(page, "WO-0002")).toBeVisible();
    await expect(row(page, "WO-0003")).toBeVisible();
    await expect(row(page, "WO-0004")).toBeVisible();

    // Stat cards: الإجمالي 4، مخطط 1 (WO-0004)، جار التنفيذ 2 (WO-0001/WO-0002)، متأخر 1 (WO-0001، ينتهي 2026-08-16).
    await expect(statCard(page, "الإجمالي")).toContainText("4");
    await expect(statCard(page, "مخطط")).toContainText("1");
    await expect(statCard(page, "جار التنفيذ")).toContainText("2");
    await expect(statCard(page, "متأخر")).toContainText("1");
  });

  test("status chip narrows to the completed order only", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^مكتمل\s+\d/ }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "WO-0003")).toBeVisible();

    await tablist.getByRole("tab", { name: /^الكل\s+\d/ }).click();
    await expect(page.getByText("عرض 4 من 4 أمر")).toBeVisible();
  });

  test("WO-0004 (not started) advances through all 4 stages to completed", async ({ page }) => {
    await row(page, "WO-0004").click();
    await expect(page.getByRole("heading", { name: "أمر تصنيع WO-0004" })).toBeVisible();
    await expect(page.getByText("مخطط", { exact: true })).toBeVisible();

    const advance = page.getByRole("button", { name: "بدء العمل" });
    await expect(advance).toBeVisible();
    await advance.click();

    await expect(page.getByText("قيد التنفيذ", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "صرف المواد" })).toBeVisible();
    await page.getByRole("button", { name: "صرف المواد" }).click();

    await expect(page.getByRole("button", { name: "استلام المنتج" })).toBeVisible();
    await page.getByRole("button", { name: "استلام المنتج" }).click();

    // Reaching product_received sets producedQty to the full plannedQty (12).
    await expect(summaryItem(page, "الكمية المنتجة")).toContainText("12");
    const complete = page.getByRole("button", { name: "إكمال أمر العمل" });
    await expect(complete).toBeVisible();
    await complete.click();

    await expect(page.getByText("مكتمل", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "إكمال أمر العمل" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "بدء العمل" })).toHaveCount(0);
  });

  test("a completed work order (WO-0003) offers no stage-advance action and shows its cost tab", async ({ page }) => {
    await row(page, "WO-0003").click();
    await expect(page.getByRole("heading", { name: "أمر تصنيع WO-0003" })).toBeVisible();
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "بدء العمل" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "صرف المواد" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "استلام المنتج" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "إكمال أمر العمل" })).toHaveCount(0);

    await page.getByRole("tab", { name: "التكاليف" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("تكلفة المواد")).toBeVisible();
    await expect(panel.getByText("إجمالي الإنتاج تحت التشغيل")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لأوامر التصنيع" }).click();
    await expect(page.getByRole("heading", { name: "أوامر التصنيع" })).toBeVisible();
  });
});

test.describe("Configurable Products", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "منتجات قابلة للتهيئة");
    await expect(page.getByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeVisible();
  });

  test("lists the 2 demo configurable products, both active", async ({ page }) => {
    await expect(page.getByText("عرض 2 من 2 منتج")).toBeVisible();
    const windowRow = row(page, "WINDOW");
    await expect(windowRow).toBeVisible();
    await expect(windowRow.getByText("نافذة قابلة للتهيئة")).toBeVisible();
    await expect(windowRow.getByText("العرض، الارتفاع")).toBeVisible();

    const doorRow = row(page, "DOOR");
    await expect(doorRow).toBeVisible();
    await expect(doorRow.getByText("باب قابل للتهيئة")).toBeVisible();
  });

  test("search narrows by code", async ({ page }) => {
    await page.getByLabel("بحث بالكود أو الاسم…").fill("DOOR");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "DOOR")).toBeVisible();

    await page.getByLabel("بحث بالكود أو الاسم…").fill("لا يوجد بهذا الاسم");
    await expect(page.getByText("لا توجد منتجات قابلة للتهيئة مطابقة")).toBeVisible();
  });

  test("WINDOW's detail shows its 2 inputs, formula materials and formula pricing", async ({ page }) => {
    await row(page, "WINDOW").click();
    await expect(page.getByRole("heading", { name: "نافذة قابلة للتهيئة (WINDOW)" })).toBeVisible();
    await expect(page.getByText("معادلة", { exact: true })).toBeVisible(); // طريقة التسعير

    await expect(page.getByRole("tab", { name: "مدخلات التهيئة (2)" })).toBeVisible();
    let panel = page.getByRole("tabpanel");
    await expect(panel.getByText("العرض")).toBeVisible();
    await expect(panel.getByText("الارتفاع")).toBeVisible();

    await page.getByRole("tab", { name: "خامات التصنيع (2)" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText("زجاج (م²)")).toBeVisible();
    await expect(panel.getByText("width*height/10000")).toBeVisible();

    await page.getByRole("tab", { name: "التسعير والتكلفة" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText("width*height*3.5/100")).toBeVisible();

    await page.getByRole("button", { name: "رجوع للمنتجات القابلة للتهيئة" }).click();
    await expect(page.getByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeVisible();
  });

  test("DOOR's detail shows manual pricing (no price formula)", async ({ page }) => {
    await row(page, "DOOR").click();
    await expect(page.getByRole("heading", { name: "باب قابل للتهيئة (DOOR)" })).toBeVisible();
    await expect(page.getByText("بدون — سعر يدوي")).toBeVisible();

    await page.getByRole("tab", { name: "التسعير والتكلفة" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("— (سعر يدوي)")).toBeVisible();
  });
});
