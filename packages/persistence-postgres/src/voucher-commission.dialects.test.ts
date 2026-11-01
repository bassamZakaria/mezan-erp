import { describe, expect } from "vitest";
import { Money, type FrameworkDocument, type VoucherLine } from "@mezan/domain";
import { createVoucherStore, ensureTenantSchema } from "@mezan/persistence";
import { DIALECTS, runOn, useDialectDbs } from "./test-support.js";

const open = useDialectDbs();

function collection(id: string, commission: string | null): FrameworkDocument<VoucherLine> {
  return {
    id,
    docType: "TREASURY_VOUCHER",
    docNo: null,
    date: "2026-08-22",
    memo: "تحصيل",
    status: "draft",
    lines: [
      {
        voucherType: "customer_collection",
        direction: "receipt",
        amount: Money.fromMajor("1000"),
        currency: "EGP",
        branchId: "b1",
        paymentMethod: "bank",
        treasuryAccountId: "ta-bank1",
        treasuryGlAccountId: "1310",
        counterpartyGlAccountId: "1100",
        counterTreasuryAccountId: null,
        counterTreasuryGlAccountId: null,
        customerId: "cust-1",
        supplierId: null,
        referenceNo: null,
        commissionAmount: commission === null ? null : Money.fromMajor(commission),
        commissionGlAccountId: commission === null ? null : "5910",
      },
    ],
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

describe.each(DIALECTS)("transfer commission in the voucher store on $dialect (#115)", ({ dialect }) => {
  const run = runOn(dialect);

  run("round-trips commission_amount and commission_gl_account_id, and batch-reads allocations and open items", async () => {
    const { db } = await open(dialect);
    await ensureTenantSchema(db);
    const store = createVoucherStore(db);
    await store.documents.save(collection("vc-1", "15.25"));
    await store.documents.save(collection("vc-2", null));

    const withCommission = (await store.documents.findById("vc-1"))!.lines[0]!;
    expect(withCommission.commissionAmount?.toString()).toBe("15.250000");
    expect(withCommission.commissionGlAccountId).toBe("5910");
    const without = (await store.documents.findById("vc-2"))!.lines[0]!;
    expect(without.commissionAmount).toBeNull();
    expect(without.commissionGlAccountId).toBeNull();

    await store.invoices.save({ id: "inv-1", invoiceNo: "INV-1", kind: "sales", partyId: "cust-1", date: "2026-08-10", total: Money.fromMajor("1000"), allocated: Money.zero() });
    await store.invoices.save({ id: "cert-1", invoiceNo: "CERT-1", kind: "sales", partyId: "cust-1", date: "2026-08-11", total: Money.fromMajor("500"), allocated: Money.zero() });
    for (const [id, voucherId, invoiceId, amount] of [["al-1", "vc-1", "inv-1", "600"], ["al-2", "vc-1", "cert-1", "400"], ["al-3", "vc-2", "inv-1", "100"]] as const) {
      await store.allocations.save({ id, voucherId, invoiceId, amount: Money.fromMajor(amount), status: "active", createdAt: "2026-08-22T10:00:00.000Z", reversedAt: null });
    }

    const byVoucher = await store.allocations.listByVouchers!(["vc-1", "vc-2", "vc-none"]);
    expect([...byVoucher.keys()].sort()).toEqual(["vc-1", "vc-2"]);
    expect(byVoucher.get("vc-1")!.map((a) => [a.invoiceId, a.amount.toString()]).sort()).toEqual([["cert-1", "400.000000"], ["inv-1", "600.000000"]]);

    const items = await store.invoices.findByIds!(["cert-1", "missing"]);
    expect([...items.entries()].map(([id, item]) => [id, item.invoiceNo])).toEqual([["cert-1", "CERT-1"]]);
  });
});
