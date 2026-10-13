import { describe, it, expect, afterEach } from "vitest";
import { StockLedgerService, type Account } from "@mezan/domain";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqlitePurchasingStores,
  createSqliteStockLedgerStore,
} from "@mezan/persistence";
import { createApp } from "./app.js";
import { MasterDataKind, unknownMasterIds, type MasterDataChecks, type MasterRecordCheck } from "./master-data-check.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function roster(...ids: readonly string[]): MasterRecordCheck {
  const held = new Set(ids);
  return { findById: async (id) => (held.has(id) ? { id } : null) };
}

const MASTER_DATA: MasterDataChecks = {
  [MasterDataKind.Supplier]: roster("sup-1"),
  [MasterDataKind.Branch]: roster("MAIN"),
  [MasterDataKind.Warehouse]: roster("MAIN-WH"),
};

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

async function newApp() {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const purchasing = createSqlitePurchasingStores();
  const stockStore = createSqliteStockLedgerStore();
  closers.push(uow, ledger, accounts, periods, purchasing, stockStore);

  await accounts.create(account("1300-inv"));
  await accounts.create(account("1360-vat"));
  await accounts.create(account("2100-ap", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("5200-freight", { type: "expense" }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const stock = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });

  return createApp(uow, {
    purchases: {
      masterData: MASTER_DATA,
      orders: purchasing.orders,
      receipts: purchasing.receipts,
      invoices: purchasing.invoices,
      numbering: ledger.numbering,
      stock,
      gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
      accounts: {
        inventoryAccountId: "1300-inv",
        payableAccountId: "2100-ap",
        taxAccountId: "1360-vat",
        freightAccountId: "5200-freight",
      },
      resolveTaxRate: () => 14,
      now: () => "2026-08-21T09:00:00.000Z",
    },
  });
}

function post(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-permissions": "*" },
    body: JSON.stringify(body),
  });
}

function invoiceBody(supplierId: string, overrides: Record<string, string> = {}) {
  return {
    id: `pi-${supplierId}-${Object.values(overrides).join("-")}`,
    supplierId,
    date: "2026-08-21",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    lines: [{ itemId: "item-A", qty: "3", unitCost: "100.00", taxRatePercent: 14 }],
    ...overrides,
  };
}

describe("unknownMasterIds", () => {
  it("reports only the ids the repository does not hold, de-duplicated and in first-seen order", async () => {
    const unknown = await unknownMasterIds(roster("a", "c"), ["b", "a", "b", "d", null, undefined, ""]);
    expect(unknown).toEqual(["b", "d"]);
  });
});

describe("D310 — a document may not name a master record that does not exist", () => {
  it("refuses a purchase invoice whose supplier has no master record", async () => {
    const app = await newApp();
    const res = await app.fetch(post("/purchases/invoices", invoiceBody("SUP-DEMO-1")));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; supplierIds: string[]; message: string; messageEn: string };
    expect(body.error).toBe("SUPPLIER_NOT_FOUND");
    expect(body.supplierIds).toEqual(["SUP-DEMO-1"]);
    expect(body.message).toContain("SUP-DEMO-1");
    expect(body.messageEn).toContain("SUP-DEMO-1");
  });

  it("refuses a purchase invoice whose branch or warehouse has no master record", async () => {
    const app = await newApp();
    const branch = await app.fetch(post("/purchases/invoices", invoiceBody("sup-1", { branchId: "BR-PHANTOM" })));
    expect(branch.status).toBe(422);
    expect(((await branch.json()) as { error: string }).error).toBe("BRANCH_NOT_FOUND");

    const warehouse = await app.fetch(post("/purchases/invoices", invoiceBody("sup-1", { warehouseId: "WH-PHANTOM" })));
    expect(warehouse.status).toBe(422);
    expect(((await warehouse.json()) as { error: string }).error).toBe("WAREHOUSE_NOT_FOUND");
  });

  it("refuses a purchase order and an ad-hoc goods receipt on the same ground", async () => {
    const app = await newApp();
    const order = await app.fetch(
      post("/purchases/orders", {
        id: "po-phantom",
        supplierId: "SUP-DEMO-1",
        date: "2026-08-21",
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "item-A", qty: "1", unitPrice: "10.00" }],
      }),
    );
    expect(order.status).toBe(422);
    expect(((await order.json()) as { error: string }).error).toBe("SUPPLIER_NOT_FOUND");

    const receipt = await app.fetch(
      post("/purchases/receipts", {
        id: "grn-phantom",
        date: "2026-08-21",
        supplierId: "SUP-DEMO-1",
        warehouseId: "MAIN-WH",
        lines: [{ itemId: "item-A", description: null, qty: "1", unitCost: "10.00", batchNo: null, expiryDate: null }],
      }),
    );
    expect(receipt.status).toBe(422);
    expect(((await receipt.json()) as { error: string }).error).toBe("SUPPLIER_NOT_FOUND");
  });

  it("still accepts a document whose every id is real", async () => {
    const app = await newApp();
    const res = await app.fetch(post("/purchases/invoices", invoiceBody("sup-1")));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { supplierId: string }).supplierId).toBe("sup-1");
  });
});
