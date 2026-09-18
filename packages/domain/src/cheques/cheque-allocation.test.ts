import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryAllocationRepository, InMemoryInvoiceRepository } from "../vouchers/test-helpers/in-memory-allocation-stores.js";
import { invoiceOutstanding } from "../vouchers/allocation.js";
import { AllocationExceedsError, AllocationMismatchError } from "../vouchers/errors.js";
import { ChequeService, type ChequeRaisingDocumentPort } from "./cheque-service.js";
import { InvalidChequeCommandError } from "./errors.js";
import { InMemoryChequeRepository, TEST_ACCOUNTS, TEST_PERIOD } from "./test-helpers/build-test-service.js";

function harness(raisedBy?: ChequeRaisingDocumentPort) {
  const ledger = new InMemoryLedgerRepository();
  const cheques = new InMemoryChequeRepository();
  const allocations = new InMemoryAllocationRepository();
  const invoices = new InMemoryInvoiceRepository();
  const settled = new Map<string, Money>();
  const byId = new Map(TEST_ACCOUNTS.map((a) => [a.id, a]));
  const now = () => "2026-08-22T10:00:00.000Z";
  const service = new ChequeService({
    cheques,
    gl: {
      ledger,
      accounts: { findById: async (id) => byId.get(id) ?? null },
      periods: { findByDate: async (d) => (d >= TEST_PERIOD.startDate && d <= TEST_PERIOD.endDate ? TEST_PERIOD : null) },
      numbering: new NextNumberService(new InMemorySequenceStore()),
      now,
    },
    now,
    allocation: {
      allocations,
      invoices,
      settlement: { applySettled: async ({ invoiceId, settled: value }) => void settled.set(invoiceId, value) },
    },
    raisedBy,
  });
  return { service, ledger, invoices, settled };
}

async function openInvoice(h: ReturnType<typeof harness>, id: string, kind: "sales" | "purchase", partyId: string, total: string) {
  await h.invoices.save({ id, invoiceNo: id, kind, partyId, date: "2026-08-01", total: Money.fromMajor(total), allocated: Money.zero() });
}

async function subLedger(h: ReturnType<typeof harness>, id: string): Promise<string> {
  const invoice = await h.invoices.findById(id);
  return invoice ? invoiceOutstanding(invoice).toString() : "missing";
}

async function incomingAt(h: ReturnType<typeof harness>, amount: string) {
  await h.service.createCheque({
    id: "chq-in",
    direction: "incoming",
    chequeNumber: "0451238",
    bankName: "بنك القاهرة",
    amount: Money.fromMajor(amount),
    issueDate: "2026-08-05",
    dueDate: "2026-08-20",
    branchId: "b1",
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    journalEntryId: "je-create",
  });
}

describe("D192 — a cheque applied to an invoice, then returned by the bank", () => {
  it("reopens the invoice and puts the debt back on AR, so the sub-ledger still equals the control account", async () => {
    const h = harness();
    await openInvoice(h, "inv-1", "sales", "cust-1", "5335.20");
    await h.ledger.save({
      id: "je-invoice",
      entryNo: "JE-1",
      date: "2026-08-01",
      memo: "فاتورة",
      status: "posted",
      source: "system",
      lines: [
        { accountId: "1100", debit: Money.fromMajor("5335.20"), credit: Money.zero(), memo: null },
        { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("5335.20"), memo: null },
      ],
      createdAt: "2026-08-01T00:00:00.000Z",
      postedAt: "2026-08-01T00:00:00.000Z",
      reversesEntryId: null,
      reversedByEntryId: null,
    } as JournalEntry);
    const ar = async () => (await h.ledger.accountBalance("1100")).balance.toString();

    await incomingAt(h, "1750.00");
    await h.service.allocate({ chequeId: "chq-in", allocationId: "a-1", invoiceId: "inv-1", amount: Money.fromMajor("1750.00") });
    expect(await subLedger(h, "inv-1")).toBe("3585.200000");
    expect(h.settled.get("inv-1")?.toString()).toBe("1750.000000");
    expect(await ar()).toBe("3585.200000");

    await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });
    const bounced = await h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-bounce", date: "2026-08-21" });

    expect(bounced.status).toBe("bounced");
    expect(await subLedger(h, "inv-1")).toBe("5335.200000");
    expect(h.settled.get("inv-1")?.toString()).toBe("0.000000");
    expect(await ar()).toBe("5335.200000");
    expect((await h.ledger.accountBalance("1360")).balance.toString()).toBe("0.000000");
    expect((await h.ledger.accountBalance("1320")).balance.toString()).toBe("0.000000");
    const history = await h.service.listAllocations("chq-in");
    expect(history.map((a) => `${a.invoiceId}:${a.status}`)).toEqual(["inv-1:reversed"]);
  });

  it("reopens a supplier invoice the same way when an outgoing cheque bounces", async () => {
    const h = harness();
    await openInvoice(h, "pinv-1", "purchase", "sup-1", "4200.00");
    await h.service.createCheque({
      id: "chq-out",
      direction: "outgoing",
      chequeNumber: "9002014",
      bankName: "البنك الأهلي",
      amount: Money.fromMajor("4200.00"),
      issueDate: "2026-08-05",
      dueDate: "2026-08-20",
      branchId: "b1",
      partyId: "sup-1",
      counterpartyGlAccountId: "2100",
      controlAccounts: { underCollectionAccountId: "2150" },
      journalEntryId: "je-create-out",
    });
    await h.service.allocate({ chequeId: "chq-out", allocationId: "a-out", invoiceId: "pinv-1", amount: Money.fromMajor("4200.00") });
    expect(await subLedger(h, "pinv-1")).toBe("0.000000");

    await h.service.deposit({ chequeId: "chq-out", bankTreasuryAccountId: "ta-bank1" });
    await h.service.bounce({ chequeId: "chq-out", journalEntryId: "je-bounce-out", date: "2026-08-21" });

    expect(await subLedger(h, "pinv-1")).toBe("4200.000000");
    expect((await h.ledger.accountBalance("2100")).balance.toString()).toBe("0.000000");
  });

  it("applies only against the cheque's own party, the right kind of invoice, and no more than the cheque holds", async () => {
    const h = harness();
    await openInvoice(h, "inv-other", "sales", "cust-2", "900.00");
    await openInvoice(h, "pinv-1", "purchase", "cust-1", "900.00");
    await openInvoice(h, "inv-1", "sales", "cust-1", "5000.00");
    await incomingAt(h, "1750.00");

    await expect(h.service.allocate({ chequeId: "chq-in", allocationId: "x1", invoiceId: "inv-other", amount: Money.fromMajor("100") })).rejects.toBeInstanceOf(AllocationMismatchError);
    await expect(h.service.allocate({ chequeId: "chq-in", allocationId: "x2", invoiceId: "pinv-1", amount: Money.fromMajor("100") })).rejects.toBeInstanceOf(AllocationMismatchError);
    await expect(h.service.allocate({ chequeId: "chq-in", allocationId: "x3", invoiceId: "inv-1", amount: Money.fromMajor("1750.01") })).rejects.toBeInstanceOf(AllocationExceedsError);
  });

  it("refuses to apply a cheque the bank has already returned", async () => {
    const h = harness();
    await openInvoice(h, "inv-1", "sales", "cust-1", "5000.00");
    await incomingAt(h, "1750.00");
    await h.service.deposit({ chequeId: "chq-in", bankTreasuryAccountId: "ta-bank1" });
    await h.service.bounce({ chequeId: "chq-in", journalEntryId: "je-bounce", date: "2026-08-21" });

    await expect(h.service.allocate({ chequeId: "chq-in", allocationId: "late", invoiceId: "inv-1", amount: Money.fromMajor("100") })).rejects.toBeInstanceOf(InvalidChequeCommandError);
    expect(await subLedger(h, "inv-1")).toBe("5000.000000");
  });
});

/**
 * D196 — a cheque a «شيك» voucher raised. The voucher credited the party, so
 * the cheque only reclassifies the voucher's treasury leg (1310 here) into
 * 1320, and its bounce hands back to the voucher, which is what reverses the
 * party's credit.
 */
describe("D196 — a cheque raised by a voucher", () => {
  async function raised(h: ReturnType<typeof harness>) {
    await h.service.createCheque({
      id: "v-1",
      direction: "incoming",
      chequeNumber: "CHQ-V1",
      bankName: "غير مسجّل",
      amount: Money.fromMajor("400"),
      issueDate: "2026-08-05",
      dueDate: "2026-08-05",
      branchId: "b1",
      partyId: "cust-1",
      counterpartyGlAccountId: "1310",
      controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
      journalEntryId: "je-v1-cheque",
    });
  }
  const balance = async (h: ReturnType<typeof harness>, accountId: string) => (await h.ledger.accountBalance(accountId)).balance.toString();

  it("hands the bounce to the raising document after its own reversal posted, and never touches AR itself", async () => {
    const bounced: string[] = [];
    const h = harness({
      onBounced: async (cheque, { date }) => void bounced.push(`${cheque.id}:${cheque.status}:${date}`),
      partyControlAccountOf: async () => "1100",
    });
    await raised(h);
    expect(await balance(h, "1320")).toBe("400.000000");
    expect(await balance(h, "1310")).toBe("-400.000000");
    expect(await balance(h, "1100")).toBe("0.000000");

    await h.service.deposit({ chequeId: "v-1", bankTreasuryAccountId: "ta-bank1" });
    await h.service.bounce({ chequeId: "v-1", journalEntryId: "je-v1-bounce", date: "2026-08-25" });
    expect(bounced).toEqual(["v-1:bounced:2026-08-25"]);
    expect(await balance(h, "1320")).toBe("0.000000");
    expect(await balance(h, "1310")).toBe("0.000000");
    expect(await balance(h, "1100")).toBe("0.000000");
  });

  it("credits the party's own control account on a replacement, not the treasury leg the voucher used", async () => {
    const h = harness({ onBounced: async () => undefined, partyControlAccountOf: async () => "1100" });
    await raised(h);
    await h.service.deposit({ chequeId: "v-1", bankTreasuryAccountId: "ta-bank1" });
    await h.service.bounce({ chequeId: "v-1", journalEntryId: "je-v1-bounce" });
    const { replacement } = await h.service.replace({
      bouncedChequeId: "v-1",
      newCheque: { id: "chq-new", chequeNumber: "CHQ-V1-B", bankName: "بنك مصر", issueDate: "2026-08-26", dueDate: "2026-08-30", branchId: "b1" },
      journalEntryId: "je-replace",
    });
    expect(replacement.counterpartyGlAccountId).toBe("1100");
    expect(await balance(h, "1100")).toBe("-400.000000");
    expect(await balance(h, "1310")).toBe("0.000000");
  });
});
