import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { AllocatableInvoice } from "./allocation.js";
import {
  AllocationExceedsError,
  AllocationMismatchError,
  AllocationAlreadyReversedError,
  VoucherNotAllocatableError,
} from "./errors.js";

function invoice(id: string, kind: "sales" | "purchase", partyId: string, total: string): AllocatableInvoice {
  return { id, invoiceNo: id.toUpperCase(), kind, partyId, date: "2026-08-10", total: Money.fromMajor(total), allocated: Money.zero() };
}

async function confirmedCollection(total: string, invoices: AllocatableInvoice[]) {
  const h = buildTestService({ invoices });
  await h.service.createVoucher({
    id: "vc",
    date: "2026-08-22",
    voucherType: "customer_collection",
    amount: Money.fromMajor(total),
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    customerId: "cust-1",
  });
  await h.service.confirmVoucher("vc");
  return h;
}

describe("voucher invoice allocation", () => {
  it("fully allocates a collection across two invoices", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "200"), invoice("inv2", "sales", "cust-1", "150")]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    await h.service.allocate("vc", { allocationId: "al2", invoiceId: "inv2", amount: Money.fromMajor("100") });

    const summary = await h.service.allocationSummary((await h.service.findById("vc"))!);
    expect(summary.allocated.toString()).toBe("300.000000");
    expect(summary.unallocated.toString()).toBe("0.000000");
    expect(summary.fullyAllocated).toBe(true);
    expect(summary.needsAllocation).toBe(false);

    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("200.000000");
    expect((await h.invoices.findById("inv2"))!.allocated.toString()).toBe("100.000000");
  });

  it("partial allocation leaves the voucher بحاجة لتخصيص (needsAllocation)", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "200")]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("120") });
    const summary = await h.service.allocationSummary((await h.service.findById("vc"))!);
    expect(summary.allocated.toString()).toBe("120.000000");
    expect(summary.unallocated.toString()).toBe("180.000000");
    expect(summary.needsAllocation).toBe(true);
  });

  it("reversing an allocation restores voucher remainder and invoice outstanding", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "200")]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("200.000000");

    await h.service.reverseAllocation("al1");
    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("0.000000");
    const summary = await h.service.allocationSummary((await h.service.findById("vc"))!);
    expect(summary.allocated.toString()).toBe("0.000000");
    expect(summary.needsAllocation).toBe(true);
  });

  it("rejects an allocation exceeding the voucher's unallocated remainder", async () => {
    const h = await confirmedCollection("100", [invoice("inv1", "sales", "cust-1", "500")]);
    await expect(
      h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("150") }),
    ).rejects.toBeInstanceOf(AllocationExceedsError);
  });

  it("rejects an allocation exceeding the invoice's outstanding balance", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "80")]);
    await expect(
      h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("100") }),
    ).rejects.toBeInstanceOf(AllocationExceedsError);
  });

  it("rejects allocating a sales voucher onto a purchase invoice", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "purchase", "cust-1", "200")]);
    await expect(
      h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("100") }),
    ).rejects.toBeInstanceOf(AllocationMismatchError);
  });

  it("rejects allocating onto another party's invoice", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-OTHER", "200")]);
    await expect(
      h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("100") }),
    ).rejects.toBeInstanceOf(AllocationMismatchError);
  });

  it("refuses to reverse an already-reversed allocation", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "200")]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    await h.service.reverseAllocation("al1");
    await expect(h.service.reverseAllocation("al1")).rejects.toBeInstanceOf(AllocationAlreadyReversedError);
  });

  it("refuses to allocate a non-allocatable voucher type", async () => {
    const h = buildTestService({ invoices: [invoice("inv1", "sales", "cust-1", "200")] });
    await h.service.createVoucher({
      id: "vi",
      date: "2026-08-22",
      voucherType: "other_income",
      amount: Money.fromMajor("100"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "4900",
    });
    await h.service.confirmVoucher("vi");
    await expect(
      h.service.allocate("vi", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("50") }),
    ).rejects.toBeInstanceOf(VoucherNotAllocatableError);
  });

  it("reversing a voucher also reverses its active allocations", async () => {
    const h = await confirmedCollection("300", [invoice("inv1", "sales", "cust-1", "200")]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    await h.service.reverseVoucher("vc", { reversalId: "vc-rev" });
    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("0.000000");
    const allocs = await h.service.listAllocations("vc");
    expect(allocs.every((a) => a.status === "reversed")).toBe(true);
  });
});

describe("the allocation sub-ledger agrees with its control account", () => {
  /** What the customers still owe, from the invoice sub-ledger. */
  async function subLedgerOutstanding(h: Awaited<ReturnType<typeof confirmedCollection>>, ids: readonly string[]) {
    let outstanding = 0n;
    for (const id of ids) {
      const invoice = (await h.invoices.findById(id)) as { total: Money; allocated: Money };
      outstanding += invoice.total.scaled - invoice.allocated.scaled;
    }
    return outstanding;
  }

  /** What the receivables control account says, from the ledger. */
  async function controlAccountBalance(h: Awaited<ReturnType<typeof confirmedCollection>>) {
    const balance = await h.ledger.accountBalance("1100");
    return balance.debit.scaled - balance.credit.scaled;
  }

  it("holds after a sequence of partial allocations and a reversal", async () => {
    const ids = ["inv1", "inv2"];
    const h = await confirmedCollection("300", [
      invoice("inv1", "sales", "cust-1", "200"),
      invoice("inv2", "sales", "cust-1", "150"),
    ]);

    // The collection credited AR by its full 300 when it was confirmed; the
    // invoices themselves were seeded outside the ledger, so the figure that
    // must agree is the CHANGE on each side, not the absolute balance.
    const openingSubLedger = await subLedgerOutstanding(h, ids);
    const openingControl = await controlAccountBalance(h);

    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("120") });
    await h.service.allocate("vc", { allocationId: "al2", invoiceId: "inv2", amount: Money.fromMajor("80") });
    await h.service.reverseAllocation("al2");
    await h.service.allocate("vc", { allocationId: "al3", invoiceId: "inv2", amount: Money.fromMajor("50") });

    const closingSubLedger = await subLedgerOutstanding(h, ids);
    const closingControl = await controlAccountBalance(h);

    // 120 + 50 of the 300 collected has been applied to specific invoices.
    expect(openingSubLedger - closingSubLedger).toBe(170_000_000n);
    // The control account did not move again: allocating a confirmed
    // collection settles which invoice it belongs to, it does not post more.
    expect(closingControl).toBe(openingControl);
  });

  it("returns the sub-ledger exactly to where it started when every allocation is reversed", async () => {
    const ids = ["inv1", "inv2"];
    const h = await confirmedCollection("300", [
      invoice("inv1", "sales", "cust-1", "200"),
      invoice("inv2", "sales", "cust-1", "150"),
    ]);
    const opening = await subLedgerOutstanding(h, ids);

    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    await h.service.allocate("vc", { allocationId: "al2", invoiceId: "inv2", amount: Money.fromMajor("100") });
    await h.service.reverseAllocation("al1");
    await h.service.reverseAllocation("al2");

    expect(await subLedgerOutstanding(h, ids)).toBe(opening);
    const summary = await h.service.allocationSummary((await h.service.findById("vc")) as never);
    expect(summary.allocated.scaled).toBe(0n);
  });

  it("never lets the allocated total exceed what the voucher collected", async () => {
    const h = await confirmedCollection("300", [
      invoice("inv1", "sales", "cust-1", "200"),
      invoice("inv2", "sales", "cust-1", "150"),
    ]);
    await h.service.allocate("vc", { allocationId: "al1", invoiceId: "inv1", amount: Money.fromMajor("200") });
    await h.service.allocate("vc", { allocationId: "al2", invoiceId: "inv2", amount: Money.fromMajor("100") });

    const summary = await h.service.allocationSummary((await h.service.findById("vc")) as never);
    expect(summary.allocated.scaled).toBe(300_000_000n);
    expect(summary.unallocated.scaled).toBe(0n);

    await expect(
      h.service.allocate("vc", { allocationId: "al3", invoiceId: "inv2", amount: Money.fromScaled(1n) }),
    ).rejects.toBeInstanceOf(AllocationExceedsError);
  });
});
