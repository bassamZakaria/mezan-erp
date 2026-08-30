/**
 * Cash application (تخصيص على الفواتير) at the precision a cashier is held to.
 *
 * `allocation.test.ts` proves the guards fire. What is missing, and what this
 * file adds, is the arithmetic a cash day actually turns on:
 *   - a receipt split across several invoices must sum EXACTLY to the receipt,
 *     including on an amount that does not divide evenly;
 *   - a refusal must leave the allocation ledger AND the invoice untouched, not
 *     merely return an error;
 *   - reversing must put each invoice outstanding back to exactly the figure it
 *     held before, not approximately;
 *   - the sub-ledger must tie to the invoice row it projects onto.
 */

import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import { invoiceOutstanding, type AllocatableInvoice } from "./allocation.js";
import { AllocationExceedsError } from "./errors.js";

type Harness = ReturnType<typeof buildTestService>;

function invoice(id: string, totalMajor: string, allocatedMajor = "0"): AllocatableInvoice {
  return {
    id,
    invoiceNo: "INV-" + id,
    kind: "sales",
    partyId: "cust-1",
    date: "2026-08-10",
    total: Money.fromMajor(totalMajor),
    allocated: Money.fromMajor(allocatedMajor),
  };
}

/**
 * Three open invoices, one of them already part-settled, and a 1,000.00 receipt
 * confirmed into the safe. Nothing starts at zero.
 */
async function receiptOf(major: string): Promise<Harness> {
  const h = buildTestService({
    invoices: [invoice("inv-1", "600.00"), invoice("inv-2", "500.00", "150.00"), invoice("inv-3", "900.00")],
  });
  await h.service.createVoucher({
    id: "v1",
    date: "2026-08-22",
    voucherType: "customer_collection",
    amount: Money.fromMajor(major),
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    customerId: "cust-1",
  });
  await h.service.confirmVoucher("v1");
  return h;
}

async function outstanding(h: Harness, id: string): Promise<string> {
  return invoiceOutstanding((await h.invoices.findById(id))!).toString();
}

async function allocatedOn(h: Harness, id: string): Promise<string> {
  return (await h.invoices.findById(id))!.allocated.toString();
}


describe("a receipt split across several invoices", () => {
  it("sums EXACTLY to the receipt on an amount that does not divide evenly", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("333.33") });
    await h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-2", amount: Money.fromMajor("333.33") });
    await h.service.allocate("v1", { allocationId: "a3", invoiceId: "inv-3", amount: Money.fromMajor("333.34") });

    const summary = await h.service.allocationSummary((await h.service.findById("v1"))!);
    expect(summary.allocated.toString()).toBe("1000.000000");
    expect(summary.unallocated.toString()).toBe("0.000000");
    expect(summary.fullyAllocated).toBe(true);
    expect(summary.needsAllocation).toBe(false);

    expect(await outstanding(h, "inv-1")).toBe("266.670000");
    expect(await outstanding(h, "inv-2")).toBe("16.670000");
    expect(await outstanding(h, "inv-3")).toBe("566.660000");
  });

  it("refuses the piastre that would take the voucher past its own amount, and writes nothing", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("600.00") });
    await h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-3", amount: Money.fromMajor("400.00") });

    const beforeAllocations = (await h.service.listAllocations("v1")).map((a) => a.id);
    const beforeInv3 = await allocatedOn(h, "inv-3");

    await expect(
      h.service.allocate("v1", { allocationId: "a3", invoiceId: "inv-3", amount: Money.fromMajor("0.01") }),
    ).rejects.toBeInstanceOf(AllocationExceedsError);

    expect((await h.service.listAllocations("v1")).map((a) => a.id)).toEqual(beforeAllocations);
    expect(await allocatedOn(h, "inv-3")).toBe(beforeInv3);
    expect((await h.service.allocationSummary((await h.service.findById("v1"))!)).allocated.toString()).toBe("1000.000000");
  });

  it("refuses over-allocating one invoice, naming both figures, and writes nothing", async () => {
    const h = await receiptOf("1000.00");
    // inv-2 is a 500.00 invoice already 150.00 settled: 350.00 is all that is left.
    const before = await allocatedOn(h, "inv-2");

    await expect(
      h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-2", amount: Money.fromMajor("350.01") }),
    ).rejects.toThrow(/350\.010000.*350\.000000/s);

    expect(await allocatedOn(h, "inv-2")).toBe(before);
    expect(await h.service.listAllocations("v1")).toEqual([]);
  });

  it("allocating exactly the remaining outstanding is allowed — the boundary is crossed on one side only", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-2", amount: Money.fromMajor("350.00") });
    expect(await outstanding(h, "inv-2")).toBe("0.000000");
    expect(await allocatedOn(h, "inv-2")).toBe("500.000000");
  });

  it("a partial allocation leaves the remainder open and the voucher بحاجة لتخصيص", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("249.99") });

    const summary = await h.service.allocationSummary((await h.service.findById("v1"))!);
    expect(summary.allocated.toString()).toBe("249.990000");
    expect(summary.unallocated.toString()).toBe("750.010000");
    expect(summary.needsAllocation).toBe(true);
    expect(await outstanding(h, "inv-1")).toBe("350.010000");
  });
});


describe("reversing an allocation restores the invoice to exactly what it was", () => {
  it("puts every outstanding back to the figure it held before, to the micro-unit", async () => {
    const h = await receiptOf("1000.00");
    const before = {
      "inv-1": await outstanding(h, "inv-1"),
      "inv-2": await outstanding(h, "inv-2"),
      "inv-3": await outstanding(h, "inv-3"),
    };
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("333.33") });
    await h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-2", amount: Money.fromMajor("333.33") });
    await h.service.allocate("v1", { allocationId: "a3", invoiceId: "inv-3", amount: Money.fromMajor("333.34") });

    for (const id of ["a1", "a2", "a3"]) {
      await h.service.reverseAllocation(id);
    }

    expect(await outstanding(h, "inv-1")).toBe(before["inv-1"]);
    expect(await outstanding(h, "inv-2")).toBe(before["inv-2"]);
    expect(await outstanding(h, "inv-3")).toBe(before["inv-3"]);
    const summary = await h.service.allocationSummary((await h.service.findById("v1"))!);
    expect(summary.allocated.toString()).toBe("0.000000");
    expect(summary.needsAllocation).toBe(true);
  });

  it("the sub-ledger ties to the invoice row it projects onto, invoice by invoice", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("120.50") });
    await h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-2", amount: Money.fromMajor("200.25") });
    await h.service.reverseAllocation("a1");
    await h.service.allocate("v1", { allocationId: "a3", invoiceId: "inv-1", amount: Money.fromMajor("75.75") });

    for (const id of ["inv-1", "inv-2", "inv-3"]) {
      const rows = await h.allocations.listByInvoice(id);
      const active = Money.sum(rows.filter((r) => r.status === "active").map((r) => r.amount));
      const opening = id === "inv-2" ? Money.fromMajor("150.00") : Money.zero();
      expect((await h.invoices.findById(id))!.allocated.toString()).toBe(
        Money.fromScaled(opening.scaled + active.scaled).toString(),
      );
    }
    expect(await allocatedOn(h, "inv-1")).toBe("75.750000");
    expect(await allocatedOn(h, "inv-2")).toBe("350.250000");
  });
});


describe("reversing the voucher itself", () => {
  it("restores every invoice it had settled and posts the mirror entry", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("400.00") });
    await h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-2", amount: Money.fromMajor("350.00") });
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("1000.000000");

    const { original } = await h.service.reverseVoucher("v1", { reversalId: "v1-rev", date: "2026-08-23" });

    expect(original.status).toBe("reversed");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
    expect(await outstanding(h, "inv-1")).toBe("600.000000");
    expect(await outstanding(h, "inv-2")).toBe("350.000000");
    expect((await h.service.listAllocations("v1")).every((a) => a.status === "reversed")).toBe(true);
  });

  it("a reversal the ledger refuses leaves the allocations exactly as they were", async () => {
    const h = await receiptOf("1000.00");
    await h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("400.00") });
    const before = await outstanding(h, "inv-1");

    // 2026-07-15 falls outside the only open fiscal period, so the reversing
    // journal entry cannot post.
    await expect(h.service.reverseVoucher("v1", { reversalId: "v1-rev", date: "2026-07-15" })).rejects.toThrow();

    // The voucher is still confirmed and its 1,000.00 is still in the safe, so
    // the invoice it settled must still read as settled.
    expect((await h.service.findById("v1"))!.status).toBe("confirmed");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("1000.000000");
    expect(await outstanding(h, "inv-1")).toBe(before);
    expect((await h.service.listAllocations("v1")).map((a) => a.status)).toEqual(["active"]);
  });
});


describe("LIMITATION: allocation is a read-then-write with no lock", () => {
  it("two allocations applied at once both pass the remainder check and over-apply the receipt", async () => {
    const h = await receiptOf("500.00");

    const results = await Promise.allSettled([
      h.service.allocate("v1", { allocationId: "a1", invoiceId: "inv-1", amount: Money.fromMajor("400.00") }),
      h.service.allocate("v1", { allocationId: "a2", invoiceId: "inv-3", amount: Money.fromMajor("400.00") }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    // 800.00 applied out of a 500.00 receipt: the sub-ledger now says two
    // customers were credited money that never entered the safe.
    const summary = await h.service.allocationSummary((await h.service.findById("v1"))!);
    expect(summary.allocated.toString()).toBe("800.000000");
    expect(summary.unallocated.toString()).toBe("-300.000000");
    expect(summary.fullyAllocated).toBe(true);
  });
});

