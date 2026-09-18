import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * CRM screens (apps/web/src/screens/{Leads,Opportunities,Pipeline,
 * PipelineStages,Activities}Screen.tsx) — real API-backed against the fresh
 * seeded tenant. Pipeline Stages is the ONE CRM entity seeded by default
 * (packages/backend/src/seed.ts: 7 stages — عميل محتمل 10%, تواصل أولي 20%,
 * عرض سعر 40%, تفاوض 60%, مراجعة نهائية 80%, تم الإغلاق 100% win, خسارة 0%
 * loss). Leads/Opportunities/Activities start with zero rows, so every test
 * below creates what it needs through the UI first.
 *
 * Each describe block runs `serial` — later tests build on records an
 * earlier test in the SAME file created (the real backend persists them for
 * the rest of this `pnpm test:e2e` run); `serial` just guarantees the
 * creating test always runs first.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

async function createCustomer(page: Page, nameAr: string): Promise<void> {
  await clickSidebarItem(page, "العملاء");
  await expect(page.getByRole("heading", { name: "العملاء" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة عميل" }).click();
  const form = page.getByRole("dialog", { name: "إضافة عميل" });
  await expect(form).toBeVisible();
  await form.getByLabel("اسم العميل *").fill(nameAr);
  await form.getByRole("button", { name: "إضافة عميل", exact: true }).click();
  await expect(form).toBeHidden();
}

test.describe("Pipeline Stages", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مراحل خط المبيعات");
    await expect(page.getByRole("heading", { name: "مراحل خط المبيعات" })).toBeVisible();
  });

  test("lists the 7 seeded stages with order, win/loss badges and stats", async ({ page }) => {
    await expect(page.getByText("عرض 7 من 7 مرحلة")).toBeVisible();

    // packages/domain/src/crm/pipeline-stage.ts assigns `order: existing.length`
    // — 0-indexed, so the first seeded stage's order is 0, not 1.
    const leadStageRow = row(page, "عميل محتمل");
    await expect(leadStageRow.locator("td").first()).toHaveText("0");
    await expect(leadStageRow.getByText("10%")).toBeVisible();

    const wonRow = row(page, "تم الإغلاق");
    await expect(wonRow.getByText("مرحلة فوز")).toBeVisible();
    const lostRow = row(page, "خسارة");
    await expect(lostRow.getByText("مرحلة خسارة")).toBeVisible();

    await expect(page.getByText("إجمالي المراحل")).toBeVisible();
  });

  test("adding a stage validates the required name, then succeeds and can be reordered up", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة مرحلة" }).click();
    const form = page.getByRole("dialog", { name: "إضافة مرحلة" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("اسم المرحلة مطلوب");
    await expect(form).toBeVisible();

    await form.getByLabel("الاسم *").fill("مرحلة اختبار");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await expect(page.getByText("عرض 8 من 8 مرحلة")).toBeVisible();
    const newRow = row(page, "مرحلة اختبار");
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("مفتوحة")).toBeVisible();
    await expect(newRow.locator("td").first()).toHaveText("7"); // appended last (0-indexed, 8th stage)

    await page.getByRole("button", { name: "نقل مرحلة اختبار للأعلى" }).click();
    await expect(row(page, "مرحلة اختبار").locator("td").first()).toHaveText("6");
  });
});

test.describe("Leads", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "العملاء المحتملون");
    await expect(page.getByRole("heading", { name: "العملاء المحتملون" })).toBeVisible();
  });

  test("a new lead requires a name, then walks new -> contacted -> qualified -> converted", async ({ page }) => {
    await page.getByRole("button", { name: "عميل محتمل جديد" }).click();
    const form = page.getByRole("dialog", { name: "عميل محتمل جديد" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("الاسم مطلوب");

    await form.getByLabel("الاسم *").fill("عميل محتمل تجريبي");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    const leadRow = row(page, "عميل محتمل تجريبي");
    await expect(leadRow).toBeVisible();
    await expect(leadRow.getByText("جديد", { exact: true })).toBeVisible();

    await leadRow.click();
    const detail = page.getByRole("dialog", { name: "عميل محتمل تجريبي" });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("button", { name: "تم التواصل" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "غير مؤهل" })).toBeVisible();
    await expect(detail.getByRole("button", { name: "خسارة" })).toBeVisible();

    await detail.getByRole("button", { name: "تم التواصل" }).click();
    await expect(detail.getByText("تم التواصل", { exact: true })).toBeVisible();
    // exact:true — "غير مؤهل" is also a button here, and it contains "مؤهل" as a substring.
    await expect(detail.getByRole("button", { name: "مؤهل", exact: true })).toBeVisible();

    await detail.getByRole("button", { name: "مؤهل", exact: true }).click();
    await expect(detail.getByText("مؤهل", { exact: true }).first()).toBeVisible();
    await expect(detail.getByRole("button", { name: "تحويل" })).toBeVisible();
    // Only خسارة remains as a status transition once qualified — تحويل is separate.
    await expect(detail.getByRole("button", { name: "تم التواصل" })).toHaveCount(0);

    await detail.getByRole("button", { name: "تحويل" }).click();
    const convertForm = page.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    await expect(convertForm).toBeVisible();
    await expect(convertForm.getByLabel("عنوان الفرصة *")).not.toHaveValue("");

    // Guards the fixed prefill: the lead's Arabic name as the code 500'd as «خطأ داخلي».
    await expect(convertForm.getByLabel("كود العميل")).toHaveValue("");
    await convertForm.getByRole("button", { name: "تحويل", exact: true }).click();
    await expect(convertForm).toBeHidden();
    await expect(detail).toBeHidden(); // conversion also closes the detail panel

    await row(page, "عميل محتمل تجريبي").click();
    const convertedDetail = page.getByRole("dialog", { name: "عميل محتمل تجريبي" });
    await expect(convertedDetail.getByText("محول", { exact: true })).toBeVisible();
    await expect(convertedDetail.getByText("لا توجد إجراءات متاحة على هذا العميل المحتمل.")).toBeVisible();
  });

  test("a lead can be sent straight to خسارة, landing in a terminal state with no actions", async ({ page }) => {
    await page.getByRole("button", { name: "عميل محتمل جديد" }).click();
    const form = page.getByRole("dialog", { name: "عميل محتمل جديد" });
    await form.getByLabel("الاسم *").fill("عميل محتمل مرفوض");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await row(page, "عميل محتمل مرفوض").click();
    const detail = page.getByRole("dialog", { name: "عميل محتمل مرفوض" });
    await detail.getByRole("button", { name: "خسارة" }).click();

    await expect(detail.getByText("خسارة", { exact: true })).toBeVisible();
    await expect(detail.getByText("لا توجد إجراءات متاحة على هذا العميل المحتمل.")).toBeVisible();
    // Only the panel's own close button remains — no status-transition action.
    await expect(detail.getByRole("button", { name: "تم التواصل" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "غير مؤهل" })).toHaveCount(0);
    await expect(detail.getByRole("button", { name: "تحويل" })).toHaveCount(0);
  });

  test("status chip narrows the list to the rejected lead only", async ({ page }) => {
    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^خسارة\s+\d/ }).click();
    await expect(row(page, "عميل محتمل مرفوض")).toBeVisible();
    await expect(row(page, "عميل محتمل تجريبي")).toBeHidden();
  });
});

test.describe("Opportunities & Pipeline", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("creating an opportunity validates required title/customer, then succeeds against a real customer", async ({ page }) => {
    await createCustomer(page, "عميل الفرص التجريبي");

    await clickSidebarItem(page, "الفرص");
    await expect(page.getByRole("heading", { name: "الفرص" })).toBeVisible();

    await page.getByRole("button", { name: "فرصة جديدة" }).click();
    const form = page.getByRole("dialog", { name: "فرصة جديدة" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("العنوان مطلوب");

    await form.getByLabel("العنوان *").fill("فرصة تجريبية أولى");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("العميل مطلوب");

    const customerField = form.getByPlaceholder("اختر العميل...");
    await customerField.click();
    await customerField.fill("عميل الفرص التجريبي");
    await form.getByRole("option", { name: /عميل الفرص التجريبي/ }).click();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    const oppRow = row(page, "فرصة تجريبية أولى");
    await expect(oppRow).toBeVisible();
    await expect(oppRow.getByText("عميل الفرص التجريبي")).toBeVisible();
    await expect(oppRow.getByText("عميل محتمل", { exact: true })).toBeVisible(); // default first stage
    await expect(oppRow.getByText("مفتوحة", { exact: true })).toBeVisible();
  });

  test("the pipeline board shows the opportunity under its stage; moving it updates the stage on the list too", async ({ page }) => {
    await clickSidebarItem(page, "خط المبيعات");
    await expect(page.getByRole("heading", { name: "خط المبيعات" })).toBeVisible();

    for (const stageName of ["عميل محتمل", "تواصل أولي", "عرض سعر", "تفاوض", "مراجعة نهائية", "تم الإغلاق", "خسارة"]) {
      await expect(page.getByRole("heading", { name: stageName, exact: true })).toBeVisible();
    }

    // Note: the "عميل محتمل" column also holds the opportunity the earlier
    // Leads conversion test created by default (createOpportunity stayed on) —
    // so this scopes to OUR card specifically rather than asserting a column count.
    const card = page.locator("div.rounded-md.border.border-border.bg-surface").filter({ hasText: "فرصة تجريبية أولى" });
    await expect(card).toBeVisible();
    await card.getByLabel("نقل إلى").selectOption({ label: "عرض سعر" });

    await clickSidebarItem(page, "الفرص");
    await expect(row(page, "فرصة تجريبية أولى").getByText("عرض سعر", { exact: true })).toBeVisible();
  });
});

test.describe("Activities", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الأنشطة");
    await expect(page.getByRole("heading", { name: "الأنشطة" })).toBeVisible();
  });

  test("a new activity requires a subject, then succeeds and can be marked complete", async ({ page }) => {
    await page.getByRole("button", { name: "نشاط جديد" }).click();
    const form = page.getByRole("dialog", { name: "نشاط جديد" });
    await expect(form).toBeVisible();

    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("الموضوع مطلوب");

    await form.getByLabel("الموضوع *").fill("نشاط متابعة تجريبي");
    await form.getByLabel("النوع").selectOption({ label: "اجتماع" });
    await form.getByLabel("تاريخ الاستحقاق").fill("2026-09-01");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    const activityRow = row(page, "نشاط متابعة تجريبي");
    await expect(activityRow).toBeVisible();
    await expect(activityRow.getByText("معلق", { exact: true })).toBeVisible();
    await expect(activityRow.getByText("اجتماع", { exact: true })).toBeVisible();

    await activityRow.getByRole("button", { name: "إكمال" }).click();
    await expect(row(page, "نشاط متابعة تجريبي").getByText("مكتمل", { exact: true })).toBeVisible();
    await expect(row(page, "نشاط متابعة تجريبي").getByRole("button", { name: "إكمال" })).toHaveCount(0);
  });

  test("a second activity can be cancelled, and status chips narrow correctly", async ({ page }) => {
    await page.getByRole("button", { name: "نشاط جديد" }).click();
    const form = page.getByRole("dialog", { name: "نشاط جديد" });
    await form.getByLabel("الموضوع *").fill("نشاط ملغى تجريبي");
    await form.getByRole("button", { name: "إضافة", exact: true }).click();
    await expect(form).toBeHidden();

    await row(page, "نشاط ملغى تجريبي").getByRole("button", { name: "إلغاء" }).click();
    await expect(row(page, "نشاط ملغى تجريبي").getByText("ملغى", { exact: true })).toBeVisible();

    const tablist = page.getByRole("tablist", { name: "تصفية حسب الحالة" });
    await tablist.getByRole("tab", { name: /^مكتمل\s+\d/ }).click();
    await expect(row(page, "نشاط متابعة تجريبي")).toBeVisible();
    await expect(row(page, "نشاط ملغى تجريبي")).toBeHidden();

    await tablist.getByRole("tab", { name: /^ملغى\s+\d/ }).click();
    await expect(row(page, "نشاط ملغى تجريبي")).toBeVisible();
    await expect(row(page, "نشاط متابعة تجريبي")).toBeHidden();
  });
});
