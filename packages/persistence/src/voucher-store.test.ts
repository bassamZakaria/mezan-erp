import { describe, it, expect, afterEach } from "vitest";
import { Money, type AllocatableInvoice, type FrameworkDocument, type VoucherLine } from "@mezan/domain";
import { createSqliteVoucherStore, type SqliteVoucherStoreHandle } from "./voucher-store.js";

let handle: SqliteVoucherStoreHandle | null = null;
afterEach(() => {
  handle?.close();
  handle = null;
});

function voucherDoc(id: string, status: FrameworkDocument<VoucherLine>["status"], amount: string): FrameworkDocument<VoucherLine> {
  const line: VoucherLine = {
    voucherType: "customer_collection",
    direction: "receipt",
    amount: Money.fromMajor(amount),
    currency: "EGP",
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    counterpartyGlAccountId: "1100",
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: "cust-1",
    supplierId: null,
    referenceNo: "REF-9",
  };
  return {
    id,
    docType: "TREASURY_VOUCHER",
    docNo: status === "draft" ? null : "CV-000001",
    date: "2026-08-22",
    memo: "تحصيل",
    status,
    lines: [line],
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: status === "confirmed" ? "2026-08-22T10:00:00.000Z" : null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: status === "confirmed" ? "je-1" : null,
  };
}

describe("SqliteVoucherStore — documents", () => {
  it("round-trips a voucher document (money exact, single line rebuilt)", async () => {
    handle = createSqliteVoucherStore();
    const doc = voucherDoc("v1", "confirmed", "250.50");
    await handle.documents.save(doc);
    const loaded = await handle.documents.findById("v1");
    expect(loaded).not.toBeNull();
    expect(loaded!.docNo).toBe("CV-000001");
    expect(loaded!.status).toBe("confirmed");
    expect(loaded!.lines).toHaveLength(1);
    expect(loaded!.lines[0]!.amount.toString()).toBe("250.500000");
    expect(loaded!.lines[0]!.voucherType).toBe("customer_collection");
    expect(loaded!.lines[0]!.counterpartyGlAccountId).toBe("1100");
    expect(loaded!.journalEntryId).toBe("je-1");
  });

  it("round-trips the contracting project dimension (projectId, costCategory)", async () => {
    handle = createSqliteVoucherStore();
    const doc = voucherDoc("v2", "confirmed", "300");
    await handle.documents.save({
      ...doc,
      lines: [{ ...doc.lines[0]!, projectId: "proj-1", costCategory: "labour" }],
    });
    const loaded = await handle.documents.findById("v2");
    expect(loaded!.lines[0]!.projectId).toBe("proj-1");
    expect(loaded!.lines[0]!.costCategory).toBe("labour");
  });

  it("defaults projectId/costCategory to null when the voucher carries no contracting dimension", async () => {
    handle = createSqliteVoucherStore();
    await handle.documents.save(voucherDoc("v3", "confirmed", "100"));
    const loaded = await handle.documents.findById("v3");
    expect(loaded!.lines[0]!.projectId).toBeNull();
    expect(loaded!.lines[0]!.costCategory).toBeNull();
  });

  it("update persists a status/number transition", async () => {
    handle = createSqliteVoucherStore();
    await handle.documents.save(voucherDoc("v1", "draft", "100"));
    const draft = await handle.documents.findById("v1");
    await handle.documents.update({ ...draft!, status: "confirmed", docNo: "CV-000007", journalEntryId: "je-9" });
    const loaded = await handle.documents.findById("v1");
    expect(loaded!.status).toBe("confirmed");
    expect(loaded!.docNo).toBe("CV-000007");
    expect(loaded!.journalEntryId).toBe("je-9");
  });

  it("carries a held collection's requested allocations exactly, and clears them (D344)", async () => {
    handle = createSqliteVoucherStore();
    await handle.documents.save(voucherDoc("v4", "pending", "500"));
    const pending = await handle.documents.findById("v4");
    await handle.documents.update({
      ...pending!,
      lines: [{
        ...pending!.lines[0]!,
        heldAllocations: [
          { allocationId: "v4:A1", invoiceId: "inv-1", amount: Money.fromMajor("123.456789") },
          { allocationId: "v4:A2", invoiceId: "inv-2", amount: null },
        ],
      }],
    });
    const carried = (await handle.documents.findById("v4"))!.lines[0]!.heldAllocations!;
    expect(carried.map((a) => [a.allocationId, a.invoiceId, a.amount?.toString() ?? null])).toEqual([
      ["v4:A1", "inv-1", "123.456789"],
      ["v4:A2", "inv-2", null],
    ]);
    const reloaded = (await handle.documents.findById("v4"))!;
    await handle.documents.update({ ...reloaded, lines: [{ ...reloaded.lines[0]!, heldAllocations: null }] });
    expect((await handle.documents.findById("v4"))!.lines[0]!.heldAllocations).toBeNull();
  });

  it("filters by status in list()", async () => {
    handle = createSqliteVoucherStore();
    await handle.documents.save(voucherDoc("v1", "confirmed", "100"));
    await handle.documents.save(voucherDoc("v2", "draft", "50"));
    const confirmed = await handle.documents.list({ status: "confirmed" });
    expect(confirmed.map((d) => d.id)).toEqual(["v1"]);
  });
});

describe("SqliteVoucherStore — allocations + invoices", () => {
  it("persists allocations and open invoices with exact money", async () => {
    handle = createSqliteVoucherStore();
    const invoice: AllocatableInvoice = {
      id: "inv1",
      invoiceNo: "INV-000001",
      kind: "sales",
      partyId: "cust-1",
      date: "2026-08-10",
      total: Money.fromMajor("200"),
      allocated: Money.zero(),
    };
    await handle.invoices.save(invoice);
    await handle.invoices.save({ ...invoice, allocated: Money.fromMajor("120") });
    const loaded = await handle.invoices.findById("inv1");
    expect(loaded!.allocated.toString()).toBe("120.000000");

    const open = await handle.invoices.listOpen({ kind: "sales", partyId: "cust-1" });
    expect(open).toHaveLength(1);

    await handle.invoices.save({ ...invoice, allocated: Money.fromMajor("200") });
    expect(await handle.invoices.listOpen({ partyId: "cust-1" })).toHaveLength(0); // fully allocated → not open

    await handle.allocations.save({
      id: "al1",
      voucherId: "v1",
      invoiceId: "inv1",
      amount: Money.fromMajor("120"),
      status: "active",
      createdAt: "2026-08-22T10:00:00.000Z",
      reversedAt: null,
    });
    expect((await handle.allocations.listByVoucher("v1"))[0]!.amount.toString()).toBe("120.000000");

    await handle.allocations.update({
      id: "al1",
      voucherId: "v1",
      invoiceId: "inv1",
      amount: Money.fromMajor("120"),
      status: "reversed",
      createdAt: "2026-08-22T10:00:00.000Z",
      reversedAt: "2026-08-22T11:00:00.000Z",
    });
    expect((await handle.allocations.findById("al1"))!.status).toBe("reversed");
  });
});
