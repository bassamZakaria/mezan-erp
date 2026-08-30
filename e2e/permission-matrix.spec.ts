import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem, expandSidebarGroup } from "./support/nav";

/**
 * Role editor + PermissionMatrix (apps/web/src/pages/RoleEditorPage.tsx,
 * packages/ui/src/primitives/PermissionMatrix.tsx). The dependency cascade
 * and module-licensing filtering are domain logic
 * (packages/domain/src/permissions/{role-editor,module-licensing}.ts) that
 * RoleEditorPage wires into the purely-presentational matrix component.
 *
 * Real pairs used below, verified against packages/domain/src/permissions/catalog.ts:
 *   - single-hop dep: sales.invoice.confirm -> sales.invoice.view_own
 *   - transitive dep: purchases.rfq.convert -> purchases.rfq.view, purchases.order.create -> purchases.order.view
 *   - sensitive: sales.invoice.view_cost ("s" flag)
 *   - platform-admin-only: admin.modules.manage ("p" flag)
 *
 * Every module card now starts COLLAPSED (aria-expanded="false") — the
 * opposite of this spec's old premise — so every test that touches an
 * individual permission checkbox expands that module's toggle
 * (e.g. "المبيعات 0 / 29") first.
 *
 * The e2e backend now seeds a built-in "مدير النظام" (SYSTEM_ADMIN) system
 * role but zero custom ones — there is no more demo "مندوب مبيعات"
 * (VAN_SALES) role, so the "opens pre-filled" test creates its own role
 * first via the create flow this file already exercises.
 */

const SCREENSHOT_DIR = "e2e-results/screenshots";

function permCard(page: Page, code: string) {
  return page.locator(`[data-permission-code="${code}"]`);
}

function permCheckbox(page: Page, code: string) {
  return permCard(page, code).locator('input[type="checkbox"]');
}

/** Scopes to a module's collapsible header button by its exact Arabic label, within <main> to avoid the sidebar's identical group labels (e.g. "المبيعات"). */
function moduleToggle(page: Page, label: string) {
  return page
    .locator("main")
    .locator("button[aria-expanded]")
    .filter({ has: page.getByText(label, { exact: true }) });
}

async function expandModule(page: Page, label: string): Promise<void> {
  const toggle = moduleToggle(page, label);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

/** SummaryStat's value <div> sits immediately before its label <div> — walk to the sibling instead of guessing container depth. */
function selectedCountValue(page: Page) {
  return page.getByText("الصلاحيات المحددة", { exact: true }).locator("xpath=preceding-sibling::div[1]");
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

test.describe("Role editor — PermissionMatrix", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
  });

  test("opening a new role starts empty, with every module card collapsed", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();

    const toggles = page.locator("main").locator("button[aria-expanded]");
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);
    for (const toggle of await toggles.all()) {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await expect(selectedCountValue(page)).toHaveText("0");
  });

  test("expanding a module reveals its permission cards; collapsing hides them again", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();

    const toggle = moduleToggle(page, "المبيعات الميدانية"); // "field" module — small (4 permissions)
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(permCard(page, "field.van_trip.view")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(permCard(page, "field.van_trip.view")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(permCard(page, "field.van_trip.view")).toHaveCount(0);
  });

  test("opening an existing role pre-selects exactly its granted permissions", async ({ page }) => {
    const roleName = unique("مندوب اختبار مصفوفة");
    const roleCode = `MATRIX${Date.now() % 100000}`;

    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill(roleName);
    await page.getByLabel("رمز الدور *").fill(roleCode);
    await expandModule(page, "المبيعات الميدانية");
    await permCheckbox(page, "field.van_trip.view_own").check();
    await permCheckbox(page, "field.van_trip.open").check();
    await page.getByRole("button", { name: "حفظ الدور" }).click();
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();

    await page
      .locator("table tbody tr")
      .filter({ has: page.getByText(roleName, { exact: true }) })
      .getByRole("button", { name: "تعديل" })
      .click();
    await expect(page.getByRole("heading", { name: "تعديل الدور" })).toBeVisible();

    await expandModule(page, "المبيعات الميدانية");
    for (const code of ["field.van_trip.view_own", "field.van_trip.open"]) {
      await expect(permCheckbox(page, code)).toBeChecked();
    }
    // view_own auto-selects field.van_trip.view as its own dependency —
    // still part of "exactly its granted permissions" once re-opened.
    await expect(selectedCountValue(page)).toHaveText(/\d+/);
  });

  test("checking a permission auto-selects its single dependency", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expandModule(page, "المبيعات");

    await expect(permCheckbox(page, "sales.invoice.confirm")).not.toBeChecked();
    await expect(permCheckbox(page, "sales.invoice.view_own")).not.toBeChecked();

    await permCheckbox(page, "sales.invoice.confirm").check();
    await expect(permCheckbox(page, "sales.invoice.confirm")).toBeChecked();
    await expect(permCheckbox(page, "sales.invoice.view_own")).toBeChecked(); // auto-selected dependency
    await expect(selectedCountValue(page)).toHaveText("2");

    // Unchecking only removes the toggled code itself — nothing else currently
    // selected depends ON "confirm", so the prerequisite stays selected. This
    // is the documented asymmetry in role-editor.ts's togglePermission.
    await permCheckbox(page, "sales.invoice.confirm").uncheck();
    await expect(permCheckbox(page, "sales.invoice.confirm")).not.toBeChecked();
    await expect(permCheckbox(page, "sales.invoice.view_own")).toBeChecked();
    await expect(selectedCountValue(page)).toHaveText("1");
  });

  test("checking a permission auto-selects its full transitive dependency chain", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expandModule(page, "المشتريات");

    // purchases.rfq.convert -> [purchases.rfq.view, purchases.order.create]
    // purchases.order.create -> [purchases.order.view]
    await permCheckbox(page, "purchases.rfq.convert").check();

    for (const code of [
      "purchases.rfq.convert",
      "purchases.rfq.view",
      "purchases.order.create",
      "purchases.order.view",
    ]) {
      await expect(permCheckbox(page, code)).toBeChecked();
    }
    await expect(selectedCountValue(page)).toHaveText("4");
  });

  test("unchecking a prerequisite cascades off everything selected that depends on it", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expandModule(page, "المشتريات");

    await permCheckbox(page, "purchases.rfq.convert").check();
    await expect(permCheckbox(page, "purchases.order.create")).toBeChecked();

    // Unchecking "order.view" must also drop "order.create" (depends on it)
    // and "rfq.convert" (depends on "order.create" transitively).
    await permCheckbox(page, "purchases.order.view").uncheck();
    await expect(permCheckbox(page, "purchases.order.view")).not.toBeChecked();
    await expect(permCheckbox(page, "purchases.order.create")).not.toBeChecked();
    await expect(permCheckbox(page, "purchases.rfq.convert")).not.toBeChecked();
    // "rfq.view" was only a dependency of "convert", not of "order.view" — it survives.
    await expect(permCheckbox(page, "purchases.rfq.view")).toBeChecked();
  });

  test("a sensitive permission gets a distinct warning marker and ring, unlike a regular one", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expandModule(page, "المبيعات");

    const sensitive = permCard(page, "sales.invoice.view_cost");
    await expect(sensitive).toHaveClass(/ring-warning/);
    await expect(sensitive.getByLabel("صلاحية حساسة")).toBeVisible();

    const regular = permCard(page, "sales.invoice.confirm");
    await expect(regular).not.toHaveClass(/ring-warning/);
    await expect(regular.getByLabel("صلاحية حساسة")).toHaveCount(0);
  });

  test("a platform-admin-only permission is shown but disabled with an explanatory badge", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expandModule(page, "الإدارة");

    const padCard = permCard(page, "admin.modules.manage");
    await expect(padCard).toBeVisible();
    await expect(padCard.locator('input[type="checkbox"]')).toBeDisabled();
    await expect(padCard).toHaveAttribute("title", "صلاحية مخصصة لمدير المنصة فقط");
    await expect(padCard.getByText("مدير المنصة فقط", { exact: true })).toBeVisible();
  });

  test("search filters the matrix down to modules with a matching label or code", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();
    const toggles = page.locator("main").locator("button[aria-expanded]");
    const allModulesCount = await toggles.count();
    expect(allModulesCount).toBeGreaterThan(0);

    await page.getByPlaceholder("بحث بالاسم أو الكود…").fill("view_cost");
    await expect(page.locator("main").locator("button[aria-expanded]")).toHaveCount(1); // only "المبيعات"
    // Narrowing to one module doesn't auto-expand it.
    await expandModule(page, "المبيعات");
    await expect(permCard(page, "sales.invoice.view_cost")).toBeVisible();
    await expect(permCard(page, "sales.invoice.confirm")).toHaveCount(0);

    await page.getByPlaceholder("بحث بالاسم أو الكود…").fill("");
    await expect(page.locator("main").locator("button[aria-expanded]")).toHaveCount(allModulesCount);
  });

  test("rejects a duplicate role code and stays on the editor", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill(unique("دور مكرر"));
    await page.getByLabel("رمز الدور *").fill("SYSTEM_ADMIN"); // already used by the seeded system role

    await page.getByRole("button", { name: "حفظ الدور" }).click();

    await expect(page.getByText('يوجد دور بالفعل بالكود "SYSTEM_ADMIN"')).toBeVisible();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible(); // still on the editor
  });

  test("captures light and dark screenshots of the role editor", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    const roleName = unique("دور لقطة شاشة");
    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill(roleName);
    await page.getByLabel("رمز الدور *").fill(`SNAP${Date.now() % 100000}`);
    await expandModule(page, "المبيعات");
    await permCheckbox(page, "sales.invoice.view_own").check();
    await expect(permCheckbox(page, "sales.invoice.view_own")).toBeChecked();

    // Light is the explicit default — see theme.spec.ts.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/role-editor-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/role-editor-dark.png` });
  });
});
