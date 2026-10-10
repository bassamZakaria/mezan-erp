import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "../support/auth";
import { expectPostedAndBalanced, journalEntry, microUnits } from "../support/ledger";

interface ApprovedPayrollRun {
  readonly journalEntryId: string | null;
  readonly totalGross: string;
}

function aMondayLaterThisYear(): string {
  const base = Date.UTC(2026, 9, 5);
  const weeks = Math.floor(Math.random() * 12);
  return new Date(base + weeks * 7 * 86_400_000).toISOString().slice(0, 10);
}

test.describe("HR journeys", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("a leave request is filed for a seeded employee, then approved", async ({ page }) => {
    await page.goto("/people/leave-requests");
    await expect(page.getByRole("heading", { name: "طلبات الإجازات", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "طلب إجازة جديد" }).first().click();
    const form = page.getByRole("dialog", { name: "طلب إجازة جديد" });
    await form.getByRole("combobox", { name: "الموظف" }).click();
    const employeeOption = page.getByRole("option").first();
    const employeeName = ((await employeeOption.textContent()) ?? "").replace(/EMP-\d+/, "").trim();
    await employeeOption.click();
    const day = aMondayLaterThisYear();
    await form.getByRole("textbox", { name: "تاريخ البداية" }).fill(day);
    await form.getByRole("textbox", { name: "تاريخ النهاية" }).fill(day);
    await form.getByRole("textbox", { name: "السبب" }).fill("موعد طبي");
    await form.getByRole("button", { name: "حفظ الطلب" }).click();
    await expect(form).toBeHidden();

    const row = page.getByRole("row").filter({ hasText: `${day} — ${day}` }).filter({ hasText: employeeName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("بانتظار الموافقة");
    const number = ((await row.textContent()) ?? "").match(/LR-\d+/)?.[0];
    expect(number, "the new request carries an LR- number").toBeTruthy();

    await row.getByRole("button", { name: `إجراءات ${number}` }).click();
    await page.getByRole("menuitem", { name: "موافقة" }).click();
    await expect(page.getByRole("row").filter({ hasText: number! })).toContainText("موافق عليه");
  });

  test("a payroll run is created for an open period, calculated, then approved and posted", async ({ page }) => {
    await page.goto("/people/payroll");
    await expect(page.getByRole("heading", { name: "الرواتب", level: 1 })).toBeVisible();
    const existing = (await page.locator("main table tbody").innerText()).replace(/\s+/g, " ");

    await page.getByRole("button", { name: "تشغيل رواتب جديد" }).first().click();
    const form = page.getByRole("dialog", { name: "تشغيل رواتب جديد" });
    const year = await form.getByRole("spinbutton", { name: /السنة/ }).inputValue();
    const month = form.getByRole("combobox", { name: /الشهر/ });
    const defaultMonth = ((await month.textContent()) ?? "").trim();
    let period = `${defaultMonth} ${year}`;
    if (existing.includes(period)) {
      await month.click();
      const names = (await page.getByRole("option").allTextContents()).map((n) => n.trim());
      const free = names.slice(names.indexOf(defaultMonth)).find((n) => !existing.includes(`${n} ${year}`));
      expect(free, `every month of ${year} already has a payroll run`).toBeTruthy();
      await page.getByRole("option", { name: free!, exact: true }).click();
      period = `${free} ${year}`;
    }
    await form.getByRole("button", { name: "إنشاء" }).click();

    const run = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^PR-\d+$/ }) });
    await expect(run).toBeVisible();
    const number = (await run.getByRole("heading", { name: /^PR-\d+$/ }).textContent())!.trim();
    await expect(run).toContainText("مسودة");
    await expect(run).toContainText(period);

    await run.getByRole("button", { name: "احتساب الرواتب" }).click();
    await expect(run).toContainText("محتسب");
    await expect(run.getByText(/PS-\d+/).first()).toBeVisible();

    const approved = page.waitForResponse((r) => r.request().method() === "POST" && /\/hr\/payroll\/runs\/[^/]+\/approve$/.test(new URL(r.url()).pathname));
    await run.getByRole("button", { name: "اعتماد وترحيل القيد" }).click();
    const approvedResponse = await approved;
    expect(approvedResponse.status()).toBe(200);
    const approvedRun = (await approvedResponse.json()) as ApprovedPayrollRun;
    await expect(run).toContainText("معتمد");
    await expect(run).not.toContainText("القيد المحاسبي —");

    // «معتمد» has to be the accrual in the books, not a pill: one posted,
    // balanced entry, booking no less than the gross the run itself reports.
    expect(approvedRun.journalEntryId, "an approved payroll run must carry its journal entry").toBeTruthy();
    const accrual = await journalEntry(page, approvedRun.journalEntryId!);
    const accrued = expectPostedAndBalanced(accrual);
    expect(microUnits(approvedRun.totalGross)).toBeGreaterThan(0n);
    expect(accrued).toBeGreaterThanOrEqual(microUnits(approvedRun.totalGross));
    await expect(run).toContainText(accrual.entryNo!);

    await run.getByRole("button", { name: "إغلاق اللوحة" }).click();
    await expect(page.getByRole("row").filter({ hasText: number })).toContainText("معتمد");
  });
});
