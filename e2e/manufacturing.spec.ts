import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Manufacturing screens (apps/web/src/screens/{Boms,WorkOrders,
 * ConfigurableProducts}Screen.tsx) — now real API-backed screens
 * (packages/backend/src/demo-seed.ts + demo-seed/inventory-ops.ts), not the
 * old client-side-only demo data. The BOMs/ConfigurableProducts "add" forms
 * are full create flows, not stubs.
 *
 * Seeded demo data (MEZAN_SEED_DEMO=1):
 *  - 3 BOMs: BOM-0001 (خليط شاي بالسكر, v1, 2 lines, no waste), BOM-0002
 *    (خليط شاي بالنعناع, v1, 2 lines, no waste), BOM-0003 (a synthetic BOM
 *    auto-generated for the configurable-product instance CFGI-DEMO-1 —
 *    علبة شاي هدايا حسب الطلب, v1, 2 lines WITH waste: 2%/1%). All active.
 *  - 5 work orders: WO-0001 (from the config instance, planned/not_started),
 *    WO-0002 (BOM-0001, planned/not_started, high priority, overdue end
 *    date), WO-0003 (BOM-0002, in_progress/started, overdue end date),
 *    WO-0004 (BOM-0001, cancelled), WO-0005 (BOM-0001, completed, 5/5
 *    produced).
 *  - 1 configurable product: CFG-0001 "علبة شاي هدايا حسب الطلب", formula
 *    pricing, 2 inputs (teaKg/sugarKg), 2 materials.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

/** Scopes a stat card by its exact label — StatCard's own "relative overflow-hidden" wrapper (packages/ui/src/primitives/atoms.tsx). */
function statCard(page: Page, label: string) {
  return page.locator("div.relative.overflow-hidden").filter({ has: page.getByText(label, { exact: true }) });
}

/**
 * Scopes a DocumentDetail summary-strip item by its exact label. The summary
 * grid cell has no distinguishing class of its own (packages/ui/src/
 * primitives/DocumentDetail.tsx renders it as a plain `bg-surface` div), so
 * this walks up from the label text to its parent cell instead of matching a
 * CSS class that isn't unique to it.
 */
function summaryItem(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("xpath=..");
}

/** Clicks a combobox trigger (Select or EntityPicker — neither is a native `<select>`), then the matching option. */
async function chooseCombo(scope: Page | Locator, comboLabel: string, optionName: string | RegExp): Promise<void> {
  await scope.getByRole("combobox", { name: comboLabel, exact: true }).click();
  await scope.page().getByRole("option", { name: optionName }).click();
}

test.describe("BOMs", () => {
  // The last test mutates (adds a 4th BOM) — serial keeps it from racing the
  // read-only assertions above it (playwright.config.ts runs fullyParallel).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "قوائم المواد");
    await expect(page.getByRole("heading", { name: "قوائم المواد" })).toBeVisible();
  });

  test("lists the 3 demo BOMs with product/version/line-count columns and status filter chips", async ({ page }) => {
    await expect(page.getByText("عرض 3 من 3 قائمة")).toBeVisible();

    const bom1 = row(page, "BOM-0001");
    await expect(bom1).toBeVisible();
    await expect(bom1.getByText("خليط شاي بالسكر 1 كجم")).toBeVisible();
    await expect(bom1.getByText("v1")).toBeVisible();
    await expect(bom1.locator("td").nth(3)).toHaveText("2"); // عدد البنود

    const bom2 = row(page, "BOM-0002");
    await expect(bom2).toBeVisible();
    await expect(bom2.getByText("خليط شاي بالنعناع 1 كجم")).toBeVisible();

    const bom3 = row(page, "BOM-0003");
    await expect(bom3).toBeVisible();
    await expect(bom3.getByText("علبة شاي هدايا حسب الطلب")).toBeVisible();

    // All three are active — none have ever been deactivated.
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^نشط\s+3/ }).click();
    await expect(page.getByText("عرض 3 من 3 قائمة")).toBeVisible();

    // A zero-count status chip renders nowhere (ListViews.tsx) — there is no
    // "غير نشط" tab to click at all, since nothing is inactive.
    await expect(tablist.getByRole("tab", { name: /^غير نشط/ })).toHaveCount(0);

    await tablist.getByRole("tab", { name: /^الكل\s+3/ }).click();
    await expect(page.getByText("عرض 3 من 3 قائمة")).toBeVisible();
  });

  test("search narrows by BOM number or product name, and clears back to all", async ({ page }) => {
    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("0001");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "BOM-0001")).toBeVisible();

    // All three products are teas — every BOM matches "شاي".
    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("شاي");
    await expect(page.locator("table tbody tr")).toHaveCount(3);

    await page.getByLabel("بحث بالرقم أو اسم المنتج…").fill("لا يوجد بهذا الاسم");
    await expect(page.getByText("لا توجد قوائم مواد مطابقة")).toBeVisible();
  });

  test("opening BOM-0003 shows its waste-adjusted line quantities, then returns to the list", async ({ page }) => {
    await row(page, "BOM-0003").click();

    await expect(page.getByRole("heading", { name: "قائمة مواد BOM-0003" })).toBeVisible();
    await expect(page.getByText("الإصدار 1")).toBeVisible();

    const tab = page.getByRole("tab", { name: "بنود المكونات (2)" });
    await expect(tab).toBeVisible();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("شاي أسود 500 جم")).toBeVisible();
    await expect(panel.getByText("سكر أبيض 1 كجم")).toBeVisible();

    // ITEM-DEMO-4: qty 6, waste 2% -> effective qty 6.12.
    const teaRow = panel.locator("tbody tr").filter({ hasText: "شاي أسود 500 جم" });
    await expect(teaRow.getByText("2%")).toBeVisible();
    await expect(teaRow.getByText("6.12")).toBeVisible();
    // ITEM-DEMO-3: qty 5, waste 1% -> effective qty 5.05.
    const sugarRow = panel.locator("tbody tr").filter({ hasText: "سكر أبيض 1 كجم" });
    await expect(sugarRow.getByText("1%")).toBeVisible();
    await expect(sugarRow.getByText("5.05")).toBeVisible();

    await page.getByRole("button", { name: "رجوع لقوائم المواد" }).click();
    await expect(page.getByRole("heading", { name: "قوائم المواد" })).toBeVisible();
    await expect(row(page, "BOM-0003")).toBeVisible();
  });

  test("the add button opens a real creation form, not a stub, and posts the new BOM", async ({ page }) => {
    await page.getByRole("button", { name: "قائمة مواد جديدة" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0); // a full sub-page, not a modal
    await expect(page.getByRole("heading", { name: "قائمة مواد جديدة" })).toBeVisible();

    const save = page.getByRole("button", { name: "حفظ قائمة المواد" });
    await expect(save).toBeDisabled();

    await page.getByLabel("الصنف المجمَّع *", { exact: true }).click();
    await page.getByRole("option", { name: "أرز أبيض 5 كجم" }).click();
    await expect(save).toBeDisabled(); // still needs a component line

    await page.getByLabel("الصنف", { exact: true }).click();
    await page.getByRole("option", { name: "زيت عباد الشمس 1 لتر" }).click();
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByRole("heading", { name: "قوائم المواد" })).toBeVisible();
    await expect(page.getByText("عرض 4 من 4 قائمة")).toBeVisible();
    const newRow = row(page, "BOM-0004");
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("أرز أبيض 5 كجم")).toBeVisible();
  });
});

test.describe("Work Orders", () => {
  // The last test mutates (creates and completes its own work order) —
  // serial keeps it from racing the read-only assertions above it.
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أوامر التصنيع");
    await expect(page.getByRole("heading", { name: "أوامر التصنيع" })).toBeVisible();
  });

  test("lists the 5 seeded work orders with correct planned/running/overdue stats", async ({ page }) => {
    await expect(page.getByText("عرض 5 من 5 أمر")).toBeVisible();
    await expect(row(page, "WO-0001")).toBeVisible();
    await expect(row(page, "WO-0002")).toBeVisible();
    await expect(row(page, "WO-0003")).toBeVisible();
    await expect(row(page, "WO-0004")).toBeVisible();
    await expect(row(page, "WO-0005")).toBeVisible();

    // الإجمالي 5، مخطط 2 (WO-0001/WO-0002)، جار التنفيذ 1 (WO-0003)،
    // متأخر 2 (WO-0002 وWO-0003 — تاريخ انتهاء متوقع في الماضي).
    await expect(statCard(page, "الإجمالي")).toContainText("5");
    await expect(statCard(page, "مخطط")).toContainText("2");
    await expect(statCard(page, "جار التنفيذ")).toContainText("1");
    await expect(statCard(page, "متأخر")).toContainText("2");
  });

  test("status chip narrows to the completed order only (WO-0005)", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^مكتمل\s+1/ }).click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "WO-0005")).toBeVisible();

    await tablist.getByRole("tab", { name: /^الكل\s+5/ }).click();
    await expect(page.getByText("عرض 5 من 5 أمر")).toBeVisible();
  });

  test("a completed work order (WO-0005) offers no stage-advance action and shows its cost tab", async ({ page }) => {
    await row(page, "WO-0005").click();
    await expect(page.getByRole("heading", { name: "أمر تصنيع WO-0005" })).toBeVisible();
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "بدء التصنيع" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "تجميع المنتج" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "إقفال الأمر" })).toHaveCount(0);

    await page.getByRole("tab", { name: "التكاليف" }).click();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByText("تكلفة المكونات")).toBeVisible();
    await expect(panel.getByText("إجمالي الإنتاج تحت التشغيل")).toBeVisible();

    await page.getByRole("button", { name: "رجوع إلى أوامر التصنيع" }).click();
    await expect(page.getByRole("heading", { name: "أوامر التصنيع" })).toBeVisible();
  });

  test("creates its own work order from BOM-0002 and advances it through start, build and completion", async ({ page }) => {
    await page.getByRole("button", { name: "أمر تصنيع جديد" }).click();
    const dialog = page.getByRole("dialog", { name: "أمر تصنيع جديد" });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole("button", { name: "حفظ أمر التصنيع" });
    await expect(save).toBeDisabled();

    await chooseCombo(dialog, "قائمة المواد *", /^BOM-0002 —/);
    await expect(save).toBeDisabled();
    await chooseCombo(dialog, "مستودع المكونات (مدخلات) *", "المستودع الرئيسي");
    await expect(save).toBeDisabled();
    await chooseCombo(dialog, "مستودع التشغيل *", "صالة التشغيل");
    await expect(save).toBeDisabled();
    await chooseCombo(dialog, "مستودع المنتج التام (مخرجات) *", "المستودع الرئيسي");
    await expect(save).toBeEnabled();

    await save.click();
    await expect(dialog).toBeHidden();

    // plannedQty defaults to 1 — the only row whose production reads "…/1.000000".
    const newRow = page.locator("table tbody tr").filter({ hasText: "/1.000000" });
    await expect(newRow).toBeVisible();
    await newRow.click();

    await expect(page.getByRole("heading", { name: /^أمر تصنيع WO-\d+$/ })).toBeVisible();
    await expect(page.getByText("مخطط", { exact: true })).toBeVisible();

    const start = page.getByRole("button", { name: "بدء التصنيع" });
    await expect(start).toBeVisible();
    await start.click();

    await expect(page.getByText("جارٍ التنفيذ", { exact: true })).toBeVisible();
    const build = page.getByRole("button", { name: "تجميع المنتج" });
    await expect(build).toBeVisible();
    await build.click();

    const buildDialog = page.getByRole("dialog", { name: "تجميع المنتج" });
    await expect(buildDialog).toBeVisible();
    const confirmBuild = buildDialog.getByRole("button", { name: "احفظ التجميع" });
    await expect(confirmBuild).toBeEnabled();
    await confirmBuild.click();

    await expect(buildDialog).toBeHidden();
    await expect(page.getByText("مكتمل", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "تجميع المنتج" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "بدء التصنيع" })).toHaveCount(0);
    await expect(summaryItem(page, "الكمية المنتجة")).toContainText("1");
  });
});

test.describe("Configurable Products", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "منتجات قابلة للتهيئة");
    await expect(page.getByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeVisible();
  });

  test("lists the 1 demo configurable product, active", async ({ page }) => {
    await expect(page.getByText("عرض 1 من 1 منتج")).toBeVisible();
    const cfgRow = row(page, "CFG-0001");
    await expect(cfgRow).toBeVisible();
    await expect(cfgRow.getByText("علبة شاي هدايا حسب الطلب")).toBeVisible();
    await expect(cfgRow.getByText("نشط", { exact: true })).toBeVisible();
  });

  /**
   * DEFECT: ConfigurableProductsScreen.tsx:241 joins the input-label column
   * with `t("common.notes")` ("ملاحظات") instead of a real separator, so two
   * inputs render as one run-on string with the word "ملاحظات" welded between
   * them — e.g. "وزن الشاي (كجم)ملاحظاتوزن السكر (كجم)" — rather than the
   * two labels separated by a comma. Evidence: probed list row text for
   * CFG-0001 is exactly that run-on string. Not a test bug — the join
   * separator in the app is wrong.
   */
  test.fail("the configuration-inputs column separates multiple input labels legibly (D: joins with «ملاحظات» instead of a separator)", async ({ page }) => {
    const cfgRow = row(page, "CFG-0001");
    await expect(cfgRow.getByText("وزن الشاي (كجم)، وزن السكر (كجم)")).toBeVisible();
  });

  test("search narrows by code", async ({ page }) => {
    await page.getByLabel("بحث بالكود أو الاسم…").fill("CFG");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(row(page, "CFG-0001")).toBeVisible();

    await page.getByLabel("بحث بالكود أو الاسم…").fill("لا يوجد بهذا الاسم");
    await expect(page.getByText("لا توجد منتجات قابلة للتهيئة مطابقة")).toBeVisible();
  });

  test("CFG-0001's detail shows its 2 inputs, formula materials and formula pricing", async ({ page }) => {
    await row(page, "CFG-0001").click();
    await expect(page.getByRole("heading", { name: "علبة شاي هدايا حسب الطلب (CFG-0001)" })).toBeVisible();
    await expect(page.getByText("معادلة", { exact: true })).toBeVisible(); // طريقة التسعير

    await expect(page.getByRole("tab", { name: "مدخلات التهيئة (2)" })).toBeVisible();
    let panel = page.getByRole("tabpanel");
    await expect(panel.getByText("وزن الشاي (كجم)")).toBeVisible();
    await expect(panel.getByText("وزن السكر (كجم)")).toBeVisible();

    await page.getByRole("tab", { name: "خامات التصنيع (2)" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText("شاي أسود 500 جم")).toBeVisible();
    await expect(panel.getByText("teaKg*2")).toBeVisible();
    await expect(panel.getByText("سكر أبيض 1 كجم")).toBeVisible();

    await page.getByRole("tab", { name: "التسعير والتكلفة" }).click();
    panel = page.getByRole("tabpanel");
    await expect(panel.getByText("teaKg*320+sugarKg*70")).toBeVisible();

    await page.getByRole("button", { name: "رجوع للمنتجات القابلة للتهيئة" }).click();
    await expect(page.getByRole("heading", { name: "المنتجات القابلة للتهيئة" })).toBeVisible();
  });
});
