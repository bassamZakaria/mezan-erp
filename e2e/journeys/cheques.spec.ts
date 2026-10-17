import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "../support/auth";
import { creditOn, debitOn, expectPostedEntryOf, journalEntry, microUnits } from "../support/ledger";

const TRADE_RECEIVABLES = "1105";

interface RegisteredCheque {
  readonly creationJournalEntryId: string | null;
  readonly collectionJournalEntryId: string | null;
}

test.describe("Cheques journey", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
  });

  test("an incoming cheque from a seeded customer is registered, then deposited", async ({ page }) => {
    const chequeNo = String(Date.now()).slice(-7);
    await page.goto("/treasury/cheques");
    await expect(page.getByRole("heading", { name: "سجل الشيكات", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "شيك جديد" }).click();
    await page.getByRole("button", { name: /^واردة/ }).click();
    await page.getByRole("combobox", { name: "اختر العميل..." }).click();
    const customer = page.getByRole("option").first();
    const customerName = ((await customer.textContent()) ?? "").trim();
    await customer.click();
    await page.getByRole("textbox", { name: "رقم الشيك *" }).fill(chequeNo);
    await page.getByRole("textbox", { name: "اسم البنك *" }).fill("بنك مصر");
    await page.getByRole("textbox", { name: "المبلغ" }).fill("1500");
    await page.getByRole("combobox", { name: "اختر الفرع..." }).click();
    await page.getByRole("option").first().click();
    const registered = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/cheques"));
    await page.getByRole("button", { name: "حفظ الشيك" }).click();
    const registeredResponse = await registered;
    expect(registeredResponse.status()).toBe(201);
    const cheque = (await registeredResponse.json()) as RegisteredCheque;

    // Registering an incoming cheque moves the debt off the customer and onto
    // cheques under collection — a row in the register with no entry is the defect.
    expect(cheque.creationJournalEntryId, "a registered cheque must carry its journal entry").toBeTruthy();
    const registrationEntry = await journalEntry(page, cheque.creationJournalEntryId!);
    expectPostedEntryOf(registrationEntry, "1500");
    expect(creditOn(registrationEntry, TRADE_RECEIVABLES)).toBe(microUnits("1500"));
    expect(debitOn(registrationEntry, TRADE_RECEIVABLES)).toBe(0n);

    const row = page.getByRole("row").filter({ hasText: chequeNo });
    await expect(row).toBeVisible();
    await expect(row).toContainText("1,500.00");
    await expect(row).toContainText(customerName.split(/\s+/)[0]!);
    await expect(row).toContainText("قيد الانتظار");

    await row.getByRole("button", { name: `إجراءات ${chequeNo}` }).click();
    const deposited = page.waitForResponse((r) => r.request().method() === "POST" && /\/cheques\/[^/]+\/deposit$/.test(new URL(r.url()).pathname));
    await page.getByRole("menuitem", { name: "إيداع في البنك" }).click();
    const depositedResponse = await deposited;
    expect(depositedResponse.status()).toBe(200);
    await expect(page.getByRole("row").filter({ hasText: chequeNo })).toContainText("تحت التحصيل بالبنك");

    // Handing the cheque to the bank collects nothing: cash moves on تحصيل, so
    // the deposit must leave the books exactly where registration put them.
    const afterDeposit = (await depositedResponse.json()) as RegisteredCheque;
    expect(afterDeposit.collectionJournalEntryId).toBeNull();
    expect(afterDeposit.creationJournalEntryId).toBe(cheque.creationJournalEntryId);
    expect((await journalEntry(page, cheque.creationJournalEntryId!)).reversedByEntryId).toBeNull();
  });
});
