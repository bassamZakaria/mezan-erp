import { describe, it, expect, afterEach } from "vitest";
import type { Account } from "@mezan/domain";
import {
  DocumentService,
  PhysicalCountService,
  StockLedgerService,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
  createDocumentWorkflowGate,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
} from "@mezan/domain";
import {
  createSqliteStockLedgerStore,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteInventoryOpsStore,
  type SqliteStockLedgerHandle,
  type SqliteLedgerStoreHandle,
  type SqliteInventoryOpsStoreHandle,
} from "@mezan/persistence";
import {
  createStockAdjustmentsRoutes,
  createStockTransfersRoutes,
  createPhysicalCountsRoutes,
} from "./stock-documents-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

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

async function newHarness() {
  const stockStore: SqliteStockLedgerHandle = createSqliteStockLedgerStore();
  const glLedger: SqliteLedgerStoreHandle = createSqliteLedgerStore();
  const ops: SqliteInventoryOpsStoreHandle = createSqliteInventoryOpsStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(stockStore, glLedger, ops, accounts, periods);

  await accounts.create(account("1200")); // المخزون
  await accounts.create(account("3100", { type: "equity", naturalBalance: "credit" })); // رأس مال الملاك
  await periods.create({
    id: "fp-2026-01",
    year: 2026,
    periodNumber: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status: "open",
  });

  const glHook = createInventoryGlPostingHook({
    ledger: glLedger,
    accounts,
    periods,
    numbering: glLedger.numbering,
    now: () => "2026-01-15T10:00:00.000Z",
  });

  const stockLedger = new StockLedgerService({
    ledger: stockStore.ledger,
    layers: stockStore.layers,
    snapshots: stockStore.snapshots,
    policy: { allowNegativeStock: false },
    transaction: (fn) => stockStore.transaction(fn),
    gl: glHook,
  });

  const stockHook = createInventoryOpsStockHook(stockLedger, (reason) =>
    reason === "INITIAL_STOCK" ? { inventoryAccountId: "1200", counterpartAccountId: "3100" } : null,
  );

  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: ops.stockAdjustments,
    numbering: { next: () => glLedger.numbering.next("STOCK_ADJUSTMENT") },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });
  const transfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: ops.stockTransfers,
    numbering: { next: () => glLedger.numbering.next("STOCK_TRANSFER") },
    workflow: createDocumentWorkflowGate(() => null),
    stock: stockHook,
  });
  const counts = new PhysicalCountService({
    repo: ops.physicalCounts,
    stockLedger,
    adjustments,
    numbering: { next: () => glLedger.numbering.next("PHYSICAL_COUNT") },
  });

  return {
    adjustmentsApp: createStockAdjustmentsRoutes(adjustments, insecureHeaderAuthContextResolver),
    transfersApp: createStockTransfersRoutes(transfers, insecureHeaderAuthContextResolver),
    countsApp: createPhysicalCountsRoutes(counts, insecureHeaderAuthContextResolver),
    glLedger,
    stockLedger,
  };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

describe("stock-adjustments routes — permission gate", () => {
  it("403s a draft without inventory.adjustment.create", async () => {
    const { adjustmentsApp } = await newHarness();
    const res = await adjustmentsApp.fetch(
      req("/draft", { method: "POST", body: JSON.stringify({ id: "A1", date: "2026-01-01", lines: [] }) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("stock-adjustments routes — INITIAL_STOCK opening balance, end to end over HTTP", () => {
  it("draft → confirm assigns ADJ- number, moves stock, and posts a real GL journal entry", async () => {
    const { adjustmentsApp, glLedger, stockLedger } = await newHarness();
    const draft = await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "OPEN1",
          date: "2026-01-15",
          memo: "الرصيد الافتتاحي",
          lines: [
            {
              itemId: "I1",
              warehouseId: "W1",
              reason: "INITIAL_STOCK",
              direction: "IN",
              qty: "100",
              unitCost: "5000",
            },
          ],
        }),
      }),
    );
    expect(draft.status).toBe(201);

    const confirm = await adjustmentsApp.fetch(
      req("/OPEN1/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }),
    );
    expect(confirm.status).toBe(200);
    const body = (await confirm.json()) as { document: { docNo: string; status: string; journalEntryId: string | null } };
    expect(body.document.docNo).toBe("ADJ-000001");
    expect(body.document.status).toBe("confirmed");

    const balance = await stockLedger.getBalanceDetail("I1", "W1");
    expect(balance.totalValue.toString()).toBe("500000.000000");

    // The GL entry id == the adjustment's own doc id (createInventoryGlPostingHook's trick).
    const je = await glLedger.findById("OPEN1");
    expect(je?.status).toBe("posted");
    expect(je?.lines.find((l) => l.debit.scaled > 0n)?.accountId).toBe("1200");
    expect(je?.lines.find((l) => l.credit.scaled > 0n)?.accountId).toBe("3100");
  });

  it("400s a malformed draft payload", async () => {
    const { adjustmentsApp } = await newHarness();
    const res = await adjustmentsApp.fetch(
      req("/draft", { method: "POST", permissions: "inventory.adjustment.create", body: JSON.stringify({ id: "A1" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("404s confirming an unknown adjustment", async () => {
    const { adjustmentsApp } = await newHarness();
    const res = await adjustmentsApp.fetch(
      req("/nope/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }),
    );
    expect(res.status).toBe(404);
  });
});

describe("stock-transfers routes — valuation neutrality over HTTP", () => {
  it("keeps total valuation unchanged after a confirmed transfer", async () => {
    const { adjustmentsApp, transfersApp, stockLedger } = await newHarness();
    await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "OPEN1",
          date: "2026-01-15",
          lines: [{ itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "10", unitCost: "5" }],
        }),
      }),
    );
    await adjustmentsApp.fetch(req("/OPEN1/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }));

    const before = (await stockLedger.getValuation()).totalValue.toString();

    const draft = await transfersApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({
          id: "T1",
          date: "2026-01-16",
          lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: "4" }],
        }),
      }),
    );
    expect(draft.status).toBe(201);
    const confirm = await transfersApp.fetch(req("/T1/confirm", { method: "POST", permissions: "inventory.transfer.confirm" }));
    expect(confirm.status).toBe(200);
    const body = (await confirm.json()) as { document: { docNo: string } };
    expect(body.document.docNo).toBe("TRF-000001");

    const after = (await stockLedger.getValuation()).totalValue.toString();
    expect(after).toBe(before);
  });
});

describe("physical-counts routes — count → variance → adjustment flow over HTTP", () => {
  it("starts a count, records qty, completes, and generates a confirmed adjustment", async () => {
    const { adjustmentsApp, countsApp, stockLedger } = await newHarness();
    await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "OPEN1",
          date: "2026-01-15",
          lines: [{ itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "10", unitCost: "5" }],
        }),
      }),
    );
    await adjustmentsApp.fetch(req("/OPEN1/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }));

    const start = await countsApp.fetch(
      req("/", {
        method: "POST",
        permissions: "inventory.count.create",
        body: JSON.stringify({ id: "C1", warehouseId: "W1", date: "2026-01-20", itemIds: ["I1"] }),
      }),
    );
    expect(start.status).toBe(201);
    const started = (await start.json()) as { countNo: string; lines: { systemQty: string }[] };
    expect(started.countNo).toBe("CNT-000001");
    expect(started.lines[0]?.systemQty).toBe("10.000000");

    await countsApp.fetch(
      req("/C1/counts", {
        method: "POST",
        permissions: "inventory.count.create",
        body: JSON.stringify({ entries: [{ itemId: "I1", countedQty: "8" }] }),
      }),
    );
    const complete = await countsApp.fetch(req("/C1/complete", { method: "POST", permissions: "inventory.count.create" }));
    expect(complete.status).toBe(200);

    const generate = await countsApp.fetch(
      req("/C1/generate-adjustment", {
        method: "POST",
        permissions: "inventory.count.confirm",
        body: JSON.stringify({ adjustmentId: "ADJGEN1" }),
      }),
    );
    expect(generate.status).toBe(200);
    const body = (await generate.json()) as {
      count: { status: string; generatedAdjustmentId: string | null };
      adjustment: { status: string; lines: { direction: string; qty: string }[] } | null;
    };
    expect(body.count.status).toBe("ADJUSTMENT_GENERATED");
    expect(body.count.generatedAdjustmentId).toBe("ADJGEN1");
    expect(body.adjustment?.status).toBe("confirmed");
    expect(body.adjustment?.lines[0]?.direction).toBe("OUT");
    expect(body.adjustment?.lines[0]?.qty).toBe("2.000000");

    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("8.000000");
  });
});

describe("warehouse scope on the WRITE path (D103)", () => {
  const scoped = (permissions: string) => ({
    permissions,
    headers: { "x-warehouse-scope": "W2" },
  });

  it("LIMITATION (D103): a caller scoped to one warehouse can post an adjustment into another", async () => {
    const { adjustmentsApp, stockLedger } = await newHarness();

    // The caller may act in W2 only. The draft names W1.
    const draft = await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        ...scoped("inventory.adjustment.create"),
        body: JSON.stringify({
          id: "OUT-OF-SCOPE",
          date: "2026-01-15",
          memo: "خارج نطاق المستخدم",
          lines: [
            { itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "5", unitCost: "10" },
          ],
        }),
      }),
    );
    expect(draft.status).toBe(201);

    const confirm = await adjustmentsApp.fetch(
      req("/OUT-OF-SCOPE/confirm", { method: "POST", ...scoped("inventory.adjustment.confirm") }),
    );
    expect(confirm.status).toBe(200);

    // The goods landed in a warehouse this user may not even list.
    const position = await stockLedger.getBalanceDetail("I1", "W1");
    expect(position.onHand.toString()).toBe("5.000000");

    // When D103 is closed, the draft or the confirm should be refused and this
    // position should stay empty — that is the expectation to rewrite.
  });

  it("LIMITATION (D103): the same caller is correctly scoped out of the READ path", async () => {
    const { adjustmentsApp } = await newHarness();
    await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "IN-W1",
          date: "2026-01-15",
          memo: "في W1",
          lines: [
            { itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "5", unitCost: "10" },
          ],
        }),
      }),
    );

    const listed = await adjustmentsApp.fetch(req("/", scoped("inventory.adjustment.view")));
    expect(listed.status).toBe(200);
    const rows = (await listed.json()) as unknown[];
    // The read path filters by scope — which is exactly what makes the write
    // path's silence a hole rather than a design decision.
    expect(rows).toEqual([]);
  });

  it("LIMITATION (D103): a transfer can move goods out of a warehouse the caller may not see", async () => {
    const { adjustmentsApp, transfersApp, stockLedger } = await newHarness();
    await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "SEED-W1",
          date: "2026-01-15",
          memo: "رصيد افتتاحي",
          lines: [
            { itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "10", unitCost: "10" },
          ],
        }),
      }),
    );
    await adjustmentsApp.fetch(
      req("/SEED-W1/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }),
    );

    const draft = await transfersApp.fetch(
      req("/draft", {
        method: "POST",
        ...scoped("inventory.transfer.create"),
        body: JSON.stringify({
          id: "TRF-OUT",
          date: "2026-01-16",
          memo: "نقل من مستودع خارج النطاق",
          lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: "4" }],
        }),
      }),
    );
    expect(draft.status).toBe(201);

    const confirm = await transfersApp.fetch(
      req("/TRF-OUT/confirm", { method: "POST", ...scoped("inventory.transfer.confirm") }),
    );
    expect(confirm.status).toBe(200);
    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("6.000000");
  });
});

describe("a confirmed transfer has no in-transit state (D90)", () => {
  it("LIMITATION (D90): both legs post inside one confirm, with no receiving step to follow", async () => {
    const { adjustmentsApp, transfersApp, stockLedger } = await newHarness();
    await adjustmentsApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.adjustment.create",
        body: JSON.stringify({
          id: "SEED-T",
          date: "2026-01-15",
          memo: "رصيد افتتاحي",
          lines: [
            { itemId: "I1", warehouseId: "W1", reason: "INITIAL_STOCK", direction: "IN", qty: "10", unitCost: "10" },
          ],
        }),
      }),
    );
    await adjustmentsApp.fetch(req("/SEED-T/confirm", { method: "POST", permissions: "inventory.adjustment.confirm" }));

    await transfersApp.fetch(
      req("/draft", {
        method: "POST",
        permissions: "inventory.transfer.create",
        body: JSON.stringify({
          id: "TRF-1",
          date: "2026-01-16",
          memo: "نقل",
          lines: [{ itemId: "I1", fromWarehouseId: "W1", toWarehouseId: "W2", qty: "4" }],
        }),
      }),
    );
    const confirm = await transfersApp.fetch(
      req("/TRF-1/confirm", { method: "POST", permissions: "inventory.transfer.confirm" }),
    );
    const document = ((await confirm.json()) as { document: { status: string } }).document;

    // One call moved the goods the whole way: the receiving warehouse already
    // holds them, and the document is terminal — there is no "in transit" and
    // nothing for the receiving keeper to confirm or dispute. A driver who
    // never arrives leaves no trace here.
    expect(document.status).toBe("confirmed");
    expect((await stockLedger.getBalanceDetail("I1", "W1")).onHand.toString()).toBe("6.000000");
    expect((await stockLedger.getBalanceDetail("I1", "W2")).onHand.toString()).toBe("4.000000");

    const second = await transfersApp.fetch(
      req("/TRF-1/confirm", { method: "POST", permissions: "inventory.transfer.confirm" }),
    );
    expect(second.status).toBeGreaterThanOrEqual(400);
  });
});
