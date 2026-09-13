/**
 * One day at the safe (تقفيل الخزنة), end to end: the opening float, the
 * receipts including a cheque, the payments, a transfer to the bank, a cheque
 * from last week bouncing, and the closing balance.
 *
 * The point of the file is the identity a cashier is judged on —
 *   opening + receipts − payments = closing, to the micro-unit
 * — computed two independent ways (from the day vouchers, and from the GL) and
 * required to agree. A single figure that agrees only with itself proves
 * nothing; a pair that must match cannot hide a dropped or duplicated posting.
 *
 * Both engines are wired over ONE ledger here, because that is the only way to
 * see that a cheque received today does not become till cash and that a cheque
 * bouncing today does not touch the drawer.
 */

import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import type { Account, AccountRepository } from "../accounts/account.js";
import type { FiscalPeriod, FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { ChequeService } from "../cheques/cheque-service.js";
import { InMemoryChequeRepository } from "../cheques/test-helpers/build-test-service.js";
import { VoucherService } from "./voucher-service.js";
import { voucherLine } from "./voucher-document.js";
import { TEST_ACCOUNTS, TEST_TREASURY_ACCOUNTS } from "./test-helpers/build-test-service.js";
import { InMemoryAllocationRepository, InMemoryInvoiceRepository } from "./test-helpers/in-memory-allocation-stores.js";
import { CashBalanceWouldGoNegativeError, PeriodNotOpenForPostingError } from "../index.js";

const SAFE = "1300-1";
const BRANCH_SAFE = "1300-2";
const BANK = "1310";
const UNDER_COLLECTION = "1320";
const BOUNCED = "1360";

function leaf(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

const ACCOUNTS: Account[] = [
  ...TEST_ACCOUNTS,
  leaf(UNDER_COLLECTION, "asset", "debit"),
  leaf(BOUNCED, "asset", "debit"),
];

const AUGUST: FiscalPeriod = { id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" };
const JULY: FiscalPeriod = { id: "fp-2026-07", year: 2026, periodNumber: 7, startDate: "2026-07-01", endDate: "2026-07-31", status: "closed" };


function buildDay() {
  const ledger = new InMemoryLedgerRepository();
  const documents = new InMemoryDocumentRepository<ReturnType<typeof voucherLine>>();
  const allocations = new InMemoryAllocationRepository();
  const invoices = new InMemoryInvoiceRepository([]);
  const cheques = new InMemoryChequeRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());

  const byId = new Map(ACCOUNTS.map((a) => [a.id, a]));
  const accounts: Pick<AccountRepository, "findById"> = { async findById(id) { return byId.get(id) ?? null; } };
  const periods: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      if (date >= AUGUST.startDate && date <= AUGUST.endDate) return AUGUST;
      if (date >= JULY.startDate && date <= JULY.endDate) return JULY;
      return null;
    },
  };
  const taById = new Map(TEST_TREASURY_ACCOUNTS.map((t) => [t.id, t]));
  const treasuryAccounts: Pick<TreasuryAccountRepository, "findById"> = {
    async findById(id) { return taById.get(id) ?? null; },
  };
  const now = () => "2026-08-22T17:30:00.000Z";

  const vouchers = new VoucherService({
    documents, ledger, accounts, periods, numbering, treasuryAccounts, allocations, invoices,
    settings: { async get() { return { preventNegativeCashBalance: true, allowNegativeTreasury: true } as never; }, async save() {} },
    now, actor: "amin", actorRoles: ["*"],
  });
  const chequeService = new ChequeService({
    cheques,
    gl: { ledger, accounts, periods, numbering, now, actor: "amin" },
    now,
  });

  let seq = 0;
  async function openingFloat(accountId: string, major: string): Promise<void> {
    seq += 1;
    await ledger.save({
      id: "open-" + seq,
      entryNo: "OPEN-" + seq,
      date: "2026-08-21",
      memo: "رصيد افتتاحي",
      status: "posted",
      source: "system",
      lines: [
        { accountId, debit: Money.fromMajor(major), credit: Money.zero(), memo: null },
        { accountId: "3100", debit: Money.zero(), credit: Money.fromMajor(major), memo: null },
      ],
      createdAt: "2026-08-21T00:00:00.000Z",
      postedAt: "2026-08-21T00:00:00.000Z",
      reversesEntryId: null,
      reversedByEntryId: null,
    });
  }

  async function balance(accountId: string, asOf?: string): Promise<string> {
    return (await ledger.accountBalance(accountId, asOf)).balance.toString();
  }

  return { ledger, documents, vouchers, chequeService, cheques, openingFloat, balance };
}

type Day = ReturnType<typeof buildDay>;

async function receipt(d: Day, id: string, type: "customer_collection" | "other_income", major: string, treasury: string, gl: string, counterparty: string) {
  await d.vouchers.createVoucher({
    id, date: "2026-08-22", voucherType: type, amount: Money.fromMajor(major), branchId: "b1",
    paymentMethod: "cash", treasuryAccountId: treasury, treasuryGlAccountId: gl,
    counterpartyGlAccountId: counterparty, customerId: type === "customer_collection" ? "cust-1" : null,
  });
  return d.vouchers.confirmVoucher(id);
}

async function payment(d: Day, id: string, type: "supplier_payment" | "other_expense", major: string, treasury: string, gl: string, counterparty: string, date = "2026-08-22") {
  await d.vouchers.createVoucher({
    id, date, voucherType: type, amount: Money.fromMajor(major), branchId: "b1",
    paymentMethod: "cash", treasuryAccountId: treasury, treasuryGlAccountId: gl,
    counterpartyGlAccountId: counterparty, supplierId: type === "supplier_payment" ? "sup-1" : null,
  });
  return d.vouchers.confirmVoucher(id);
}


const CHEQUE_CONTROL = { underCollectionAccountId: UNDER_COLLECTION, bouncedAccountId: BOUNCED };

/**
 * The day: 4,500.00 in the safe and 32,000.00 in the bank at the start; a cash
 * collection, a customer cheque, two payments, a transfer to the bank, and last
 * week cheque coming back marked مرتد.
 */
async function runTheDay(): Promise<Day> {
  const d = buildDay();
  await d.openingFloat(SAFE, "4500.00");
  await d.openingFloat(BANK, "32000.00");

  // Last week: a 2,900.00 cheque received on the 15th and handed to the bank.
  await d.chequeService.createCheque({
    id: "chq-last-week", direction: "incoming", chequeNumber: "0778001", bankName: "بنك القاهرة",
    amount: Money.fromMajor("2900.00"), issueDate: "2026-08-15", dueDate: "2026-08-21", branchId: "b1",
    partyId: "cust-9", counterpartyGlAccountId: "1100", controlAccounts: CHEQUE_CONTROL, journalEntryId: "je-chq-lw",
  });
  await d.chequeService.deposit({ chequeId: "chq-last-week", bankTreasuryAccountId: "ta-bank1" });

  // --- today ---
  await receipt(d, "cv-1", "customer_collection", "1850.00", "ta-cash1", SAFE, "1100");
  await d.chequeService.createCheque({
    id: "chq-today", direction: "incoming", chequeNumber: "0451236", bankName: "البنك الأهلي",
    amount: Money.fromMajor("3200.00"), issueDate: "2026-08-22", dueDate: "2026-09-15", branchId: "b1",
    partyId: "cust-1", counterpartyGlAccountId: "1100", controlAccounts: CHEQUE_CONTROL, journalEntryId: "je-chq-today",
  });
  await payment(d, "cv-2", "supplier_payment", "1200.00", "ta-cash1", SAFE, "2100");
  await payment(d, "cv-3", "other_expense", "275.50", "ta-cash1", SAFE, "5910");
  await d.vouchers.createVoucher({
    id: "cv-4", date: "2026-08-22", voucherType: "inter_treasury_transfer", amount: Money.fromMajor("2000.00"),
    branchId: "b1", paymentMethod: "cash", treasuryAccountId: "ta-cash1", treasuryGlAccountId: SAFE,
    counterTreasuryAccountId: "ta-bank1", counterTreasuryGlAccountId: BANK,
  });
  await d.vouchers.confirmVoucher("cv-4");
  await d.chequeService.bounce({ chequeId: "chq-last-week", journalEntryId: "je-bounce-lw", date: "2026-08-22" });
  return d;
}

describe("تقفيل الخزنة — one day at the safe", () => {
  it("closes at opening + receipts − payments − transfers out, to the micro-unit", async () => {
    const d = await runTheDay();

    const opening = Money.fromMajor("4500.00");
    const receipts = Money.fromMajor("1850.00");
    const payments = Money.fromMajor("1200.00").add(Money.fromMajor("275.50"));
    const transfersOut = Money.fromMajor("2000.00");
    const expected = Money.fromScaled(opening.scaled + receipts.scaled - payments.scaled - transfersOut.scaled);

    expect(expected.toString()).toBe("2874.500000");
    expect(await d.balance(SAFE)).toBe("2874.500000");
  });

  it("the arithmetic and the ledger are two independent counts of the same day and must agree", async () => {
    const d = await runTheDay();

    // Rebuilt from the day documents, not from the ledger.
    let movement = 0n;
    for (const doc of await d.vouchers.list()) {
      if (doc.status !== "confirmed" || doc.date !== "2026-08-22") continue;
      const line = voucherLine(doc);
      if (line.treasuryGlAccountId !== SAFE) continue;
      movement += line.direction === "receipt" ? line.amount.scaled : -line.amount.scaled;
    }
    const opening = Money.fromMajor(await d.balance(SAFE, "2026-08-21"));
    expect(opening.toString()).toBe("4500.000000");
    expect(Money.fromScaled(opening.scaled + movement).toString()).toBe(await d.balance(SAFE));
  });

  it("the cheque received today is under collection, not cash in the drawer", async () => {
    const d = await runTheDay();
    expect(await d.balance(UNDER_COLLECTION)).toBe("3200.000000");
    // 4,500 opening + 1,850 collected − 1,475.50 paid − 2,000 transferred: the
    // 3,200.00 cheque is nowhere in it.
    expect(await d.balance(SAFE)).toBe("2874.500000");
  });

  it("last week cheque bouncing moves 2,900.00 out of تحت التحصيل and touches neither the safe nor the bank", async () => {
    const d = await runTheDay();
    expect(await d.balance(BOUNCED)).toBe("2900.000000");
    expect(await d.balance(SAFE)).toBe("2874.500000");
    expect(await d.balance(BANK)).toBe("34000.000000");
    expect((await d.chequeService.findById("chq-last-week"))!.status).toBe("bounced");
  });

  it("each safe and bank account closes on its own balance, and the transfer moved exactly between two of them", async () => {
    const d = await runTheDay();
    expect(await d.balance(SAFE)).toBe("2874.500000");
    expect(await d.balance(BANK)).toBe("34000.000000");
    expect(await d.balance(BRANCH_SAFE)).toBe("0.000000");
    // 32,000 opening + 2,000 in = 34,000; the safe lost exactly the same 2,000.
    expect(Money.fromMajor("34000.00").scaled - Money.fromMajor("32000.00").scaled).toBe(Money.fromMajor("2000.00").scaled);
  });
});


describe("what the close must refuse", () => {
  it("a receipt back-dated into a closed month is refused and writes nothing", async () => {
    const d = await runTheDay();
    const closingBefore = await d.balance(SAFE);

    await d.vouchers.createVoucher({
      id: "cv-backdated", date: "2026-07-20", voucherType: "customer_collection",
      amount: Money.fromMajor("900.00"), branchId: "b1", paymentMethod: "cash",
      treasuryAccountId: "ta-cash1", treasuryGlAccountId: SAFE, counterpartyGlAccountId: "1100", customerId: "cust-1",
    });

    await expect(d.vouchers.confirmVoucher("cv-backdated")).rejects.toBeInstanceOf(PeriodNotOpenForPostingError);

    const doc = (await d.vouchers.findById("cv-backdated"))!;
    expect(doc.status).toBe("draft");
    expect(doc.docNo).toBeNull();
    expect(doc.journalEntryId).toBeNull();
    expect(await d.ledger.findById("cv-backdated")).toBeNull();
    expect(await d.balance(SAFE)).toBe(closingBefore);
  });

  it("a safe that holds nothing cannot pay anything out, and the refusal writes nothing", async () => {
    const d = await runTheDay();
    await d.vouchers.createVoucher({
      id: "cv-empty", date: "2026-08-22", voucherType: "other_expense", amount: Money.fromMajor("1.00"),
      branchId: "b1", paymentMethod: "cash", treasuryAccountId: "ta-cash2", treasuryGlAccountId: BRANCH_SAFE,
      counterpartyGlAccountId: "5910",
    });

    await expect(d.vouchers.confirmVoucher("cv-empty")).rejects.toBeInstanceOf(CashBalanceWouldGoNegativeError);

    expect((await d.vouchers.findById("cv-empty"))!.status).toBe("draft");
    expect(await d.balance(BRANCH_SAFE)).toBe("0.000000");
    expect(await d.ledger.findById("cv-empty")).toBeNull();
  });

  it("paying out exactly what the safe holds is allowed — the guard bites below zero, not at it", async () => {
    const d = await runTheDay();
    await payment(d, "cv-drain", "other_expense", "2874.50", "ta-cash1", SAFE, "5910");
    expect(await d.balance(SAFE)).toBe("0.000000");
  });
});

describe("LIMITATION: the cash-negative guard reads the ledger before it posts, with no lock in between", () => {
  it("two payments confirmed at the same instant both pass and take the safe negative", async () => {
    const d = await runTheDay();
    expect(await d.balance(SAFE)).toBe("2874.500000");

    for (const id of ["cv-x", "cv-y"]) {
      await d.vouchers.createVoucher({
        id, date: "2026-08-22", voucherType: "other_expense", amount: Money.fromMajor("2000.00"),
        branchId: "b1", paymentMethod: "cash", treasuryAccountId: "ta-cash1", treasuryGlAccountId: SAFE,
        counterpartyGlAccountId: "5910",
      });
    }
    const results = await Promise.allSettled([d.vouchers.confirmVoucher("cv-x"), d.vouchers.confirmVoucher("cv-y")]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await d.balance(SAFE)).toBe("-1125.500000");
  });
});

describe("LIMITATION: there is no close event to sign", () => {
  it("the closing figure is derived from the ledger and no counted-cash figure can be recorded against it", async () => {
    const d = await runTheDay();
    const treasury = TEST_TREASURY_ACCOUNTS.find((t) => t.id === "ta-cash1")!;

    // The account carries an OPENING balance and its date, and nothing for the
    // other end of the day: no counted figure, no difference, no closedAt, no
    // closedBy. The system balance is simply asserted to be right.
    expect(Object.keys(treasury)).toEqual([
      "id", "code", "name", "nameEn", "type", "currency", "branchId", "glAccountId",
      "openingBalance", "openingBalanceDate", "guaranteeFacilityLimit", "status",
    ]);
    expect(await d.balance(SAFE)).toBe("2874.500000");
  });
});

