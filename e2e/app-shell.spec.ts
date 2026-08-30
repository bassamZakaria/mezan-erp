import { test, expect } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";

/**
 * Rebuilt against the workspace-column shell (packages/ui/src/shell/AppShell.tsx
 * + RailFooter.tsx). Row one and its full-width `<header>` are gone: every
 * chrome control — brand, workspaces, search, scope, appearance, language,
 * the user, sign-out — now lives in the single `<nav>` column
 * (`aria-label="التنقل بين مساحات العمل"`), which is what
 * `packages/ui/src/shell/AppShell.test.tsx` asserts directly against the
 * component. There is no `<aside>` and no `<header>` anywhere in the shell.
 */

test.describe("App shell", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("renders RTL with Arabic lang/dir on the document root", async ({ page }) => {
    const html = page.locator("html");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(page).toHaveTitle(/ميزان|Mezan/);
  });

  test("the workspace column shows the brand mark and the real workspaces in Arabic", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    await expect(rail.getByText("ميزان", { exact: true })).toBeVisible();

    for (const workspace of ["البيع والتحصيل", "الشراء والتوريد", "المالية والإقفال", "الإعداد والصلاحيات"]) {
      await expect(rail.getByRole("button", { name: workspace, exact: true })).toBeVisible();
    }

    // Every workspace is a flat one-click tab now — there is no
    // collapsed/expanded group state left in the column to assert.
    await expect(rail.getByRole("button", { name: /كل الشاشات/ })).toBeVisible();
  });

  test("the column's foot shows the signed-in user once, with a link to their profile", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    // NAME ONLY in the chip (RailFooter.tsx) — the role line was dropped in
    // favour of showing it on الملف الشخصي, so it must not be duplicated here.
    await expect(rail.getByText("محمد الشهابي")).toHaveCount(1);

    await rail.getByRole("button", { name: /محمد الشهابي/ }).click();
    await expect(page).toHaveURL(/\/setup\/settings-profile$/);
    await expect(page.getByRole("heading", { name: "محمد الشهابي", level: 1 })).toBeVisible();
    await expect(page.getByText("مدير الشركة")).toBeVisible();
  });

  test("the column's foot shows the single-branch scope as a label and the warehouse scope as a switcher", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    // Seed data has exactly one branch — a single option renders as a static
    // label (ScopeSwitcher.tsx), not a dropdown offering a choice of one.
    await expect(rail.getByTitle("الفرع الحالي: الفرع الرئيسي")).toBeVisible();
    await expect(rail.getByRole("combobox", { name: "المستودع الحالي" })).toHaveText("كل المستودعات");
  });

  test("صندوق الوارد opens the notifications inbox from row one", async ({ page }) => {
    await page.getByRole("button", { name: "صندوق الوارد", exact: true }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole("heading", { name: "الإشعارات" })).toBeVisible();
  });

  test("Ctrl+K opens the command palette, filters, and Escape closes it", async ({ page }) => {
    await expect(page.getByRole("dialog", { name: "لوحة الأوامر" })).toBeHidden();

    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "لوحة الأوامر" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("دليل الحسابات")).toBeVisible();
    await expect(dialog.getByText("فاتورة مبيعات جديدة")).toBeVisible();

    await dialog.getByRole("combobox", { name: "لوحة الأوامر" }).fill("القيود");
    await expect(dialog.getByText("القيود المحاسبية")).toBeVisible();
    await expect(dialog.getByText("فاتورة مبيعات جديدة")).toBeHidden();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("clicking the column's search trigger also opens the command palette and runs a command", async ({ page }) => {
    await page.getByRole("button", { name: "بحث وأوامر (CtrlK)" }).click();
    const dialog = page.getByRole("dialog", { name: "لوحة الأوامر" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("combobox", { name: "لوحة الأوامر" }).fill("دليل الحسابات");
    await dialog.getByText("دليل الحسابات").click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/money\/coa$/);
  });
});
