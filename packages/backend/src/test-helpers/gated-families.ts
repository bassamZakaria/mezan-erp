import { expect } from "vitest";
import type { GateableActionType } from "@mezan/domain";
import type { BackendKit, Reply } from "./backend-kit.js";

const TODAY = "2026-08-24";
const WAREHOUSE = "WH-MAIN";
const STOCK_ITEM = "ITEM-DEMO-2";

export interface GatedFamily {
  readonly actionType: GateableActionType;
  readonly mount: string;
  readonly auditEntity: string;
  readonly submitter: readonly string[];
  readonly reader: readonly string[];
  readonly canceller: readonly string[] | null;
  readonly postedStatus: string;
  draft(id: string): Promise<Reply>;
  documentOf(reply: Reply): Reply["body"];
}

async function confirmedSale(kit: BackendKit, id: string) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: WAREHOUSE, branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: STOCK_ITEM, itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

async function ownStockItem(kit: BackendKit, id: string): Promise<string> {
  const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return id;
}

async function confirmedPurchase(kit: BackendKit, id: string, itemId: string = STOCK_ITEM) {
  const created = await kit.call("POST", "/purchases/invoices", {
    id, supplierId: "SUPP-DEMO-1", date: TODAY, dueDate: "2026-09-23", branchId: "BR-MAIN", warehouseId: WAREHOUSE,
    lines: [{ itemId, kind: "inventory", qty: "4", unitCost: "73.37", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/purchases/invoices/${id}/confirm`, {})).status).toBe(200);
}

const nested = (reply: Reply) => reply.body?.document ?? reply.body;

export function gatedFamilies(kitOf: () => BackendKit): readonly GatedFamily[] {
  return [
    {
      actionType: "SALES_RETURN_CONFIRM",
      mount: "/sales-returns",
      auditEntity: "SALES_RETURN",
      submitter: ["sales.return.create", "sales.return.confirm", "sales.return.view"],
      reader: ["sales.return.view"],
      canceller: ["sales.return.void"],
      postedStatus: "confirmed",
      documentOf: nested,
      draft: async (id) => {
        await confirmedSale(kitOf(), `${id}-INV`);
        return kitOf().call("POST", "/sales-returns/from-invoice", {
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
      canceller: ["purchases.return.void"],
      postedStatus: "confirmed",
      documentOf: nested,
      draft: async (id) => {
        await confirmedPurchase(kitOf(), `${id}-INV`);
        return kitOf().call("POST", "/purchase-returns", {
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
      canceller: ["purchases.landed_cost.void"],
      postedStatus: "confirmed",
      documentOf: nested,
      draft: async (id) => {
        // ORDER MATTERS: a landed cost is absorbed on its confirm day, after which no earlier movement of that item is accepted — so each one revalues an item nothing else in the suite moves.
        const itemId = await ownStockItem(kitOf(), `${id}-ITEM`);
        await confirmedPurchase(kitOf(), `${id}-INV`, itemId);
        return kitOf().call("POST", "/landed-costs", {
          id, date: TODAY, memo: "شحن", distributionMethod: "BY_VALUE",
          costItems: [{ costType: "SHIPPING", description: "شحن", amount: "40", supplierId: "SUPP-DEMO-1" }],
          targets: [{ itemId, warehouseId: WAREHOUSE, sourceInvoiceId: `${id}-INV`, sourceInvoiceNumber: null, qty: "4", unitCost: "73.37", weight: "1" }],
        });
      },
    },
    {
      actionType: "INVENTORY_ADJUSTMENT_CONFIRM",
      mount: "/inventory/stock-adjustments",
      auditEntity: "STOCK_ADJUSTMENT",
      submitter: ["inventory.adjustment.create", "inventory.adjustment.confirm", "inventory.adjustment.view"],
      reader: ["inventory.adjustment.view"],
      canceller: null,
      postedStatus: "confirmed",
      documentOf: nested,
      draft: (id) =>
        kitOf().call("POST", "/inventory/stock-adjustments/draft", {
          id, date: TODAY, lines: [{ itemId: STOCK_ITEM, warehouseId: WAREHOUSE, reason: "INITIAL_STOCK", direction: "IN", qty: "3", unitCost: "70" }],
        }),
    },
    {
      actionType: "INVENTORY_TRANSFER_CONFIRM",
      mount: "/inventory/stock-transfers",
      auditEntity: "STOCK_TRANSFER",
      submitter: ["inventory.transfer.create", "inventory.transfer.confirm", "inventory.transfer.view"],
      reader: ["inventory.transfer.view"],
      canceller: null,
      postedStatus: "confirmed",
      documentOf: nested,
      draft: (id) =>
        kitOf().call("POST", "/inventory/stock-transfers/draft", {
          id, date: TODAY, lines: [{ itemId: STOCK_ITEM, fromWarehouseId: WAREHOUSE, toWarehouseId: "WH-BRANCH", qty: "1" }],
        }),
    },
    {
      actionType: "TREASURY_VOUCHER_CONFIRM",
      mount: "/vouchers",
      auditEntity: "TREASURY_VOUCHER",
      submitter: ["treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "treasury.cash_voucher.view"],
      reader: ["treasury.cash_voucher.view"],
      canceller: ["treasury.cash_voucher.void"],
      postedStatus: "confirmed",
      documentOf: nested,
      draft: (id) =>
        kitOf().call("POST", "/vouchers", {
          id, date: TODAY, voucherType: "other_income", amount: "120", branchId: "BR-MAIN", paymentMethod: "cash",
          treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "4100",
        }),
    },
  ];
}
