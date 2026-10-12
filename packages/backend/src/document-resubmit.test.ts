import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GATEABLE_ACTION_TYPES, type GateableActionType } from "@mezan/domain";
import { bootBackendKit, type BackendKit, type Reply } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const STOCK_ITEM = "ITEM-DEMO-2";
const REJECTION = "الكمية لا تطابق محضر الاستلام";
const APPROVER_ROLE = "SUPERVISOR";

interface GatedFamily {
  readonly actionType: GateableActionType;
  readonly mount: string;
  readonly auditEntity: string;
  readonly submitter: readonly string[];
  readonly reader: readonly string[];
  readonly postedStatus: string;
  draft(id: string): Promise<Reply>;
  documentOf(reply: Reply): Reply["body"];
}

let kit: BackendKit;

async function confirmedSale(id: string) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

async function confirmedPurchase(id: string) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId: STOCK_ITEM, kind: "inventory", qty: "4", unitCost: "73.37", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

const nested = (reply: Reply) => reply.body?.document ?? reply.body;

const FAMILIES: readonly GatedFamily[] = [
  {
    actionType: "SALES_RETURN_CONFIRM",
    mount: "/sales-returns",
    auditEntity: "SALES_RETURN",
    submitter: ["sales.return.create", "sales.return.confirm", "sales.return.view"],
    reader: ["sales.return.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: async (id) => {
      await confirmedSale(`${id}-INV`);
      return kit.call("POST", "/sales-returns/from-invoice", {
        id, date: TODAY, memo: "", warehouseId: WAREHOUSE, sourceInvoiceId: `${id}-INV`, reason: "DEFECTIVE",
        requested: [{ itemId: STOCK_ITEM, sourceLineId: "A", qty: "1" }],
      });
    },
  },
  {
    actionType: "PURCHASE_RETURN_CONFIRM",
    mount: "/purchase-returns",
    auditEntity: "PURCHASE_RETURN",
    submitter: ["purchases.return.create", "purchases.return.confirm", "purchases.return.view"],
    reader: ["purchases.return.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: async (id) => {
      await confirmedPurchase(`${id}-INV`);
      return kit.call("POST", "/purchase-returns", {
        id, date: TODAY, memo: "",
        lines: [{ itemId: STOCK_ITEM, warehouseId: WAREHOUSE, supplierId: "SUPP-DEMO-1", sourceInvoiceId: `${id}-INV`, sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty: "1" }],
      });
    },
  },
  {
    actionType: "PURCHASE_LANDED_COST_CONFIRM",
    mount: "/landed-costs",
    auditEntity: "LANDED_COST",
    submitter: ["purchases.landed_cost.create", "purchases.landed_cost.confirm", "purchases.landed_cost.view"],
    reader: ["purchases.landed_cost.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: async (id) => {
      await confirmedPurchase(`${id}-INV`);
      return kit.call("POST", "/landed-costs", {
        id, date: TODAY, memo: "شحن", distributionMethod: "BY_VALUE",
        costItems: [{ costType: "SHIPPING", description: "شحن", amount: "40", supplierId: "SUPP-DEMO-1" }],
        targets: [{ itemId: STOCK_ITEM, warehouseId: WAREHOUSE, sourceInvoiceId: `${id}-INV`, sourceInvoiceNumber: null, qty: "4", unitCost: "73.37", weight: "1" }],
      });
    },
  },
  {
    actionType: "INVENTORY_ADJUSTMENT_CONFIRM",
    mount: "/inventory/stock-adjustments",
    auditEntity: "STOCK_ADJUSTMENT",
    submitter: ["inventory.adjustment.create", "inventory.adjustment.confirm", "inventory.adjustment.view"],
    reader: ["inventory.adjustment.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: (id) =>
      kit.call("POST", "/inventory/stock-adjustments/draft", {
        id, date: TODAY, lines: [{ itemId: STOCK_ITEM, warehouseId: WAREHOUSE, reason: "INITIAL_STOCK", direction: "IN", qty: "3", unitCost: "70" }],
      }),
  },
  {
    actionType: "INVENTORY_TRANSFER_CONFIRM",
    mount: "/inventory/stock-transfers",
    auditEntity: "STOCK_TRANSFER",
    submitter: ["inventory.transfer.create", "inventory.transfer.confirm", "inventory.transfer.view"],
    reader: ["inventory.transfer.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: (id) =>
      kit.call("POST", "/inventory/stock-transfers/draft", {
        id, date: TODAY, lines: [{ itemId: STOCK_ITEM, fromWarehouseId: WAREHOUSE, toWarehouseId: "WH-BRANCH", qty: "1" }],
      }),
  },
  {
    actionType: "TREASURY_VOUCHER_CONFIRM",
    mount: "/vouchers",
    auditEntity: "TREASURY_VOUCHER",
    submitter: ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "treasury.cash_voucher.view"],
    reader: ["treasury.cash_voucher.view"],
    postedStatus: "confirmed",
    documentOf: nested,
    draft: (id) =>
      kit.call("POST", "/vouchers", {
        id, date: TODAY, voucherType: "other_income", amount: "120", branchId: "BR-MAIN", paymentMethod: "cash",
        treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "4100",
      }),
  },
];

const requestIdOf = (id: string) => `${id}:confirm`;
const decide = (id: string, decision: string, comment?: string) =>
  kit.call("POST", `/workflow/requests/${encodeURIComponent(requestIdOf(id))}/decide`, { decision, ...(comment ? { comment } : {}) });
const requestOf = async (id: string) =>
  ((await kit.call("GET", "/workflow/requests")).body as Reply["body"][]).find((row) => row.id === requestIdOf(id));

beforeAll(async () => {
  kit = await bootBackendKit();
  for (const family of FAMILIES) {
    const configured = await kit.call("POST", "/workflow/configs", { actionType: family.actionType, steps: [{ role: APPROVER_ROLE }] });
    expect(configured.status, JSON.stringify(configured.body)).toBe(201);
  }
}, 180_000);

afterAll(async () => {
  await kit.close();
});

describe("the gated document families the resubmit route covers", () => {
  it("are every DocumentService family the gate catalogue holds", () => {
    const heldElsewhere = GATEABLE_ACTION_TYPES.map((entry) => entry.code).filter(
      (code) => code.endsWith("_CONFIRM") && !FAMILIES.some((family) => family.actionType === code),
    );
    expect(heldElsewhere.sort()).toEqual([
      "PURCHASE_INVOICE_CONFIRM",
      "PURCHASE_ORDER_CONFIRM",
      "PURCHASE_RECEIPT_CONFIRM",
      "SALES_INVOICE_CONFIRM",
      "TREASURY_CAPITAL_WITHDRAWAL_CONFIRM",
      "TREASURY_TAX_PAYMENT_CONFIRM",
    ]);
  });
});

describe.each(FAMILIES)("resubmitting a rejected $mount document", (family) => {
  const id = `RSB-${family.actionType}`;
  const read = async (permissions?: readonly string[]) => (await kit.call("GET", `${family.mount}/${id}`, undefined, permissions)).body;
  const resubmit = (permissions?: readonly string[]) => kit.call("POST", `${family.mount}/${id}/resubmit`, {}, permissions);

  it("is held, rejected with a reason the document shows, and the rejection stands against a plain confirm", async () => {
    const drafted = await family.draft(id);
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const submitted = await kit.call("POST", `${family.mount}/${id}/confirm`, {}, family.submitter);
    expect([submitted.status, submitted.body.held, family.documentOf(submitted).status], JSON.stringify(submitted.body)).toEqual([200, true, "pending"]);
    expect((await read(family.reader)).approval).toMatchObject({ status: "pending", rejectionReason: null });

    const refusedWhilePending = await resubmit(family.submitter);
    expect([refusedWhilePending.status, refusedWhilePending.body.error], JSON.stringify(refusedWhilePending.body)).toEqual([409, "DOCUMENT_RESUBMIT_REFUSED"]);
    expect(refusedWhilePending.body.message).toMatch(/[؀-ۿ]/);

    expect((await decide(id, "reject", REJECTION)).status).toBe(200);
    const rejected = await read(family.reader);
    expect([rejected.status, rejected.approval], JSON.stringify(rejected)).toEqual(["draft", { status: "rejected", rejectionReason: REJECTION, rejectedBy: "USER-ADMIN" }]);

    const confirmedAgain = await kit.call("POST", `${family.mount}/${id}/confirm`, {}, family.submitter);
    expect([confirmedAgain.status, confirmedAgain.body.error]).toEqual([409, "APPROVAL_REQUEST_REJECTED"]);
  });

  it("is refused to a caller who may read the document but not confirm it", async () => {
    const refused = await resubmit(family.reader);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect((await read()).status).toBe("draft");
    expect((await requestOf(id)).status).toBe("rejected");
  });

  it("goes back to pending under the same request, which keeps the rejection, and the caller is on the audit row", async () => {
    const resubmitted = await resubmit(family.submitter);
    expect([resubmitted.status, resubmitted.body.held, resubmitted.body.document?.status], JSON.stringify(resubmitted.body)).toEqual([200, true, "pending"]);
    expect(resubmitted.body.document.approval).toMatchObject({ status: "pending", rejectionReason: REJECTION });

    const request = await requestOf(id);
    expect([request.status, request.currentStep]).toEqual(["pending", 0]);
    expect(request.decisions.map((d: { kind: string; comment?: string }) => [d.kind, d.comment])).toEqual([["reject", REJECTION]]);
    expect((await read()).workflowRequestId).toBe(requestIdOf(id));

    const audit = await kit.auditRows(family.auditEntity, id, "RESUBMIT");
    expect(audit.map((row) => row.actor)).toEqual(["LIMITED"]);
  });

  it("is refused once approved, and the approval is not discarded", async () => {
    const approved = await decide(id, "approve");
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await read()).status).toBe(family.postedStatus);

    const refused = await resubmit(family.submitter);
    expect([refused.status, refused.body.error], JSON.stringify(refused.body)).toEqual([409, "DOCUMENT_RESUBMIT_REFUSED"]);
    expect((await requestOf(id)).status).toBe("approved");
    expect((await read()).status).toBe(family.postedStatus);
  });
});

describe("after every family has been through the gate", () => {
  it("the books still reconcile", async () => {
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });
});
