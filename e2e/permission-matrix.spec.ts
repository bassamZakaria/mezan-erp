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
 * demoEntitlements (apps/web/src/sample-data.ts) activates every
 * entitlement-gated catalog module (sales/purchases/inventory/field/
 * accounting/treasury/hr/pos/crm/installments/financial_papers→cheques/
 * manufacturing/assets/notifications) on top of the always-licensed core
 * modules (dashboard/workflow/admin/audit/transactions) — i.e. ALL 19
 * catalog modules are licensed for this tenant. That means the "hidden
 * permission" side of module-licensed filtering cannot be exercised through
 * the UI with the real demo seed; the test below instead asserts the
 * positive case (nothing is filtered) and the mechanism itself is unit
 * tested directly in module-licensing.test.ts.
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

/** SummaryStat's value <div> sits immediately before its label <div> — walk to the sibling instead of guessing container depth. */
function selectedCountValue(page: Page) {
  return page.getByText("الصلاحيات المحددة", { exact: true }).locator("xpath=preceding-sibling::div[1]");
}

test.describe("Role editor — PermissionMatrix", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await expandSidebarGroup(page, "الإعدادات");
    await clickSidebarItem(page, "الأدوار والصلاحيات");
    await expect(page.getByRole("heading", { name: "الأدوار والصلاحيات" })).toBeVisible();
  });

  test("opening a new role starts with an empty, fully-expanded matrix across all 19 licensed modules", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible();

    // One collapsible module card per licensed catalog module — see file
    // header note: demo entitlements license all 19, so nothing is filtered.
    await expect(page.locator("main").locator("button[aria-expanded]")).toHaveCount(19);
    for (const toggle of await page.locator("main").locator("button[aria-expanded]").all()) {
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
    }
    await expect(permCheckbox(page, "sales.invoice.confirm")).not.toBeChecked();
  });

  test("opening an existing demo role pre-selects exactly its granted permissions", async ({ page }) => {
    await page
      .locator("table tbody tr")
      .filter({ has: page.getByText("مندوب مبيعات", { exact: true }) })
      .getByRole("button", { name: "تعديل" })
      .click();
    await expect(page.getByRole("heading", { name: "تعديل الدور" })).toBeVisible();

    for (const code of [
      "sales.invoice.view_own",
      "sales.invoice.create",
      "field.van_trip.view_own",
      "field.van_trip.open",
    ]) {
      await expect(permCheckbox(page, code)).toBeChecked();
    }
    await expect(permCheckbox(page, "sales.invoice.confirm")).not.toBeChecked();
    await expect(selectedCountValue(page)).toHaveText("4");
  });

  test("collapsing and re-expanding a module hides and restores its permission cards", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();

    const toggle = moduleToggle(page, "المبيعات الميدانية"); // "field" module — small (4 permissions)
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(permCard(page, "field.van_trip.view")).toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(permCard(page, "field.van_trip.view")).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(permCard(page, "field.van_trip.view")).toBeVisible();
  });

  test("checking a permission auto-selects its single dependency", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();

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

    const sensitive = permCard(page, "sales.invoice.view_cost");
    await expect(sensitive).toHaveClass(/ring-warning/);
    await expect(sensitive.getByLabel("صلاحية حساسة")).toBeVisible();

    const regular = permCard(page, "sales.invoice.confirm");
    await expect(regular).not.toHaveClass(/ring-warning/);
    await expect(regular.getByLabel("صلاحية حساسة")).toHaveCount(0);
  });

  test("a platform-admin-only permission is shown but disabled with an explanatory badge", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();

    const padCard = permCard(page, "admin.modules.manage");
    await expect(padCard).toBeVisible();
    await expect(padCard.locator('input[type="checkbox"]')).toBeDisabled();
    await expect(padCard).toHaveAttribute("title", "صلاحية مخصصة لمدير المنصة فقط");
    await expect(padCard.getByText("مدير المنصة فقط", { exact: true })).toBeVisible();
  });

  test("search filters the matrix down to modules with a matching label or code", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();

    await page.getByPlaceholder("بحث بالاسم أو الكود…").fill("view_cost");
    await expect(page.locator("main").locator("button[aria-expanded]")).toHaveCount(1); // only "المبيعات"
    await expect(permCard(page, "sales.invoice.view_cost")).toBeVisible();
    await expect(permCard(page, "sales.invoice.confirm")).toHaveCount(0);

    await page.getByPlaceholder("بحث بالاسم أو الكود…").fill("");
    await expect(page.locator("main").locator("button[aria-expanded]")).toHaveCount(19);
  });

  test("rejects a duplicate role code and stays on the editor", async ({ page }) => {
    await page.getByRole("button", { name: "دور جديد" }).click();
    await page.getByLabel("اسم الدور *").fill("دور مكرر");
    await page.getByLabel("رمز الدور *").fill("VAN_SALES"); // already used by the demo role
    await page.getByRole("button", { name: "حفظ الدور" }).click();

    await expect(page.getByText("A role with code VAN_SALES already exists")).toBeVisible();
    await expect(page.getByRole("heading", { name: "دور جديد" })).toBeVisible(); // still on the editor
  });

  test("captures light and dark screenshots of the role editor", async ({ page }) => {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await page
      .locator("table tbody tr")
      .filter({ has: page.getByText("مندوب مبيعات", { exact: true }) })
      .locator("td")
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "تعديل الدور" })).toBeVisible();
    await expect(permCheckbox(page, "sales.invoice.view_own")).toBeChecked();

    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /light|dark/);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/role-editor-light.png` });

    await page.getByRole("button", { name: "تبديل المظهر" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: `${SCREENSHOT_DIR}/role-editor-dark.png` });
  });
});
