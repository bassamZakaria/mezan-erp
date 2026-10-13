import { rowsOf, type BackendKit, type Reply } from "./backend-kit.js";

const TODAY = "2026-08-24";
const DUE = "2026-09-23";
const MAIN_WAREHOUSE = "WH-MAIN";
const CUSTOMER = "CUST-DEMO-1";
const SUPPLIER = "SUPP-DEMO-1";
const REASON = "سبب اختبار المسار العشوائي";
const COSTS = ["3.33", "7.77", "10.01", "0.07", "99.999", "100", "90", "110", "13.131313", "1"] as const;
const QUANTITIES = ["1", "2", "3", "5", "7", "0.5", "1.333", "4"] as const;

const CONTROLS: readonly (readonly [string, string])[] = [
  ["inventory", "inventory against 1200"],
  ["ap", "payables"],
  ["ar", "receivables"],
  ["grni", "received-not-invoiced against 2120"],
];

enum WalkStep {
  Buy = "buy",
  Sell = "sell",
  SalesReturn = "sales-return",
  VoidSalesReturn = "void-sales-return",
  VoidSale = "void-sale",
  CancelOrReturnPurchase = "cancel-or-return-purchase",
  VoidPurchaseReturnOrReceive = "void-purchase-return-or-receive",
  BillOrCancelReceipt = "bill-or-cancel-receipt",
  Transfer = "transfer",
  AdjustOrReverse = "adjust-or-reverse",
}

const STEP_WEIGHTS: readonly WalkStep[] = [
  WalkStep.Buy,
  WalkStep.Buy,
  WalkStep.Sell,
  WalkStep.Sell,
  WalkStep.Sell,
  WalkStep.SalesReturn,
  WalkStep.VoidSalesReturn,
  WalkStep.VoidSale,
  WalkStep.CancelOrReturnPurchase,
  WalkStep.VoidPurchaseReturnOrReceive,
  WalkStep.BillOrCancelReceipt,
  WalkStep.Transfer,
  WalkStep.AdjustOrReverse,
];

export interface StockWalkFailure {
  readonly seed: number;
  readonly after: string;
  readonly problems: readonly string[];
  readonly trail: readonly string[];
}

export interface StockWalkOutcome {
  readonly seed: number;
  readonly steps: number;
  readonly failure: StockWalkFailure | null;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function scaled(value: unknown): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{0,6}))?$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`not an exact decimal: ${String(value)}`);
  const units = BigInt(match[2]!) * 1_000_000n + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -units : units;
}

export async function allowBackorders(kit: BackendKit): Promise<void> {
  const settings = (await kit.call("GET", "/settings")).body;
  const saved = await kit.call("PUT", "/settings", { ...settings, allowBackorder: true });
  if (saved.status !== 200) throw new Error(`settings refused: ${JSON.stringify(saved.body)}`);
}

export async function secondWarehouse(kit: BackendKit): Promise<string> {
  const warehouses = rowsOf((await kit.call("GET", "/warehouses")).body) as { id: string }[];
  const other = warehouses.find((warehouse) => warehouse.id !== MAIN_WAREHOUSE && !warehouse.id.includes("TRANSIT"));
  if (!other) throw new Error("the demo tenant has no second warehouse");
  return other.id;
}

export async function stockWalk(kit: BackendKit, otherWarehouse: string, seed: number, steps: number): Promise<StockWalkOutcome> {
  const random = mulberry32(seed);
  const pick = <T,>(from: readonly T[]): T => from[Math.floor(random() * from.length)] as T;
  const items = [`RW${seed}A`, `RW${seed}B`];
  const warehouses = [MAIN_WAREHOUSE, otherWarehouse];
  const trail: string[] = [];
  const sales: { id: string; item: string; qty: string; warehouseId: string; voided: boolean }[] = [];
  const salesReturns: { id: string; voided: boolean }[] = [];
  const purchases: { id: string; item: string; qty: string; cancelled: boolean }[] = [];
  const purchaseReturns: { id: string; voided: boolean }[] = [];
  const receipts: { id: string; item: string; qty: string; cost: string }[] = [];
  const adjustments: { id: string; reversed: boolean }[] = [];
  let sequence = 0;

  const fail = (after: string, problems: readonly string[]): StockWalkOutcome => ({ seed, steps, failure: { seed, after, problems, trail: [...trail] } });

  for (const id of items) {
    const created = await kit.call("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" });
    if (created.status !== 201) return fail(`create item ${id}`, [JSON.stringify(created.body)]);
  }

  const problemsNow = async (): Promise<string[]> => {
    const problems: string[] = [];
    const positions = rowsOf((await kit.call("GET", "/inventory/valuation")).body) as { itemId: string; warehouseId: string; onHand: string; totalValue: string }[];
    for (const position of positions) {
      if (!items.includes(position.itemId)) continue;
      const onHand = scaled(position.onHand);
      const value = scaled(position.totalValue);
      const at = `${position.itemId}@${position.warehouseId} ${position.onHand}/${position.totalValue}`;
      if (onHand > 0n && value < 0n) problems.push(`quantity held at a negative value: ${at}`);
      if (onHand === 0n && value !== 0n) problems.push(`value with no quantity: ${at}`);
      if (onHand < 0n && value > 0n) problems.push(`a shortfall carrying positive value: ${at}`);
    }
    for (const itemId of items) {
      for (const warehouseId of warehouses) {
        const drift = (await kit.call("GET", `/inventory/drift?itemId=${itemId}&warehouseId=${warehouseId}`)).body;
        if (scaled(drift.cacheDrift) !== 0n) problems.push(`${itemId}@${warehouseId} replays to ${drift.recomputedValue}, the cache holds ${drift.cachedValue}`);
      }
    }
    const totals = (await kit.call("GET", "/financial-reports/trial-balance")).body?.grandTotals ?? {};
    if (scaled(totals.debit) !== scaled(totals.credit)) problems.push(`the trial balance is off by ${scaled(totals.debit) - scaled(totals.credit)}`);
    const reconciliation = (await kit.call("GET", "/reconciliation")).body;
    for (const [key, name] of CONTROLS) {
      const row = rowsOf(reconciliation).find((control) => control.key === key);
      if (!row) problems.push(`no ${name} control row`);
      else if (scaled(row.subLedgerBalance) !== scaled(row.glBalance)) problems.push(`${name} is off by ${scaled(row.subLedgerBalance) - scaled(row.glBalance)}`);
    }
    if (reconciliation.stockPositions?.count !== 0) problems.push(`stock position faults: ${JSON.stringify(reconciliation.stockPositions?.rows)}`);
    return problems;
  };

  const confirmDraft = async (created: Reply, confirmPath: string): Promise<Reply> => (created.status === 201 ? kit.call("POST", confirmPath, {}) : created);

  const settle = async (label: string, reply: Reply): Promise<StockWalkOutcome | null> => {
    trail.push(`${label} -> ${reply.status}${reply.status >= 400 ? ` ${String(reply.body?.error ?? "")}` : ""}`);
    if (reply.status >= 500) return fail(label, [`server error ${reply.status}: ${JSON.stringify(reply.body).slice(0, 400)}`]);
    const problems = await problemsNow();
    return problems.length > 0 ? fail(label, problems) : null;
  };

  for (let step = 0; step < steps; step++) {
    const kind = pick(STEP_WEIGHTS);
    const item = pick(items);
    const id = `RW${seed}-${sequence++}`;
    let label = "";
    let reply: Reply = { status: 0, body: null };

    if (kind === WalkStep.Buy) {
      const qty = pick(QUANTITIES);
      const cost = pick(COSTS);
      label = `buy ${id} ${item} ${qty}@${cost}`;
      reply = await confirmDraft(
        await kit.call("POST", "/purchases/invoices", { id, supplierId: SUPPLIER, date: TODAY, dueDate: DUE, branchId: "BR-MAIN", warehouseId: MAIN_WAREHOUSE, lines: [{ itemId: item, kind: "inventory", qty, unitCost: cost, taxRateId: "VAT14" }] }),
        `/purchases/invoices/${id}/confirm`,
      );
      if (reply.status === 200) purchases.push({ id, item, qty, cancelled: false });
    } else if (kind === WalkStep.Sell) {
      const qty = pick(QUANTITIES);
      const warehouseId = random() < 0.2 ? otherWarehouse : MAIN_WAREHOUSE;
      label = `sell ${id} ${item} ${qty} @${warehouseId}`;
      reply = await confirmDraft(
        await kit.call("POST", "/sales-invoices", {
          id, date: TODAY, dueDate: DUE, customerId: CUSTOMER, customerNameAr: "عميل", warehouseId, branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
          lines: [{ lineId: "A", itemId: item, itemNameAr: "صنف", isStock: true, qty, unitPrice: "150", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
        }),
        `/sales-invoices/${id}/confirm`,
      );
      if (reply.status === 200) sales.push({ id, item, qty, warehouseId, voided: false });
    } else if (kind === WalkStep.SalesReturn) {
      const sale = pick(sales.filter((candidate) => !candidate.voided));
      if (!sale) continue;
      const qty = random() < 0.5 ? sale.qty : pick(QUANTITIES);
      label = `sales return ${id} of ${sale.id} qty ${qty}`;
      reply = await confirmDraft(
        await kit.call("POST", "/sales-returns/from-invoice", { id, date: TODAY, memo: "", warehouseId: sale.warehouseId, sourceInvoiceId: sale.id, reason: "DEFECTIVE", requested: [{ itemId: sale.item, sourceLineId: "A", qty }] }),
        `/sales-returns/${id}/confirm`,
      );
      if (reply.status === 200) salesReturns.push({ id, voided: false });
    } else if (kind === WalkStep.VoidSalesReturn) {
      const target = pick(salesReturns.filter((candidate) => !candidate.voided));
      if (!target) continue;
      label = `void sales return ${target.id}`;
      reply = await kit.call("POST", `/sales-returns/${target.id}/void`, { reason: REASON });
      if (reply.status === 200) target.voided = true;
    } else if (kind === WalkStep.VoidSale) {
      const sale = pick(sales.filter((candidate) => !candidate.voided));
      if (!sale) continue;
      label = `void sale ${sale.id}`;
      reply = await kit.call("POST", `/sales-invoices/${sale.id}/void`, { reason: REASON });
      if (reply.status === 200) sale.voided = true;
    } else if (kind === WalkStep.CancelOrReturnPurchase) {
      const purchase = pick(purchases.filter((candidate) => !candidate.cancelled));
      if (!purchase) continue;
      if (random() < 0.5) {
        label = `cancel purchase ${purchase.id}`;
        reply = await kit.call("POST", `/purchases/invoices/${purchase.id}/cancel`, {});
        if (reply.status === 200) purchase.cancelled = true;
      } else {
        const qty = random() < 0.5 ? purchase.qty : pick(QUANTITIES);
        label = `purchase return ${id} of ${purchase.id} qty ${qty}`;
        reply = await confirmDraft(
          await kit.call("POST", "/purchase-returns", { id, date: TODAY, memo: "", lines: [{ itemId: purchase.item, warehouseId: MAIN_WAREHOUSE, supplierId: SUPPLIER, sourceInvoiceId: purchase.id, sourceInvoiceNumber: null, sourceLineId: "0", reason: "DEFECTIVE", qty }] }),
          `/purchase-returns/${id}/confirm`,
        );
        if (reply.status === 200) purchaseReturns.push({ id, voided: false });
      }
    } else if (kind === WalkStep.VoidPurchaseReturnOrReceive) {
      const target = pick(purchaseReturns.filter((candidate) => !candidate.voided));
      if (target && random() < 0.6) {
        label = `void purchase return ${target.id}`;
        reply = await kit.call("POST", `/purchase-returns/${target.id}/void`, { reason: REASON });
        if (reply.status === 200) target.voided = true;
      } else {
        const qty = pick(QUANTITIES);
        const cost = pick(COSTS);
        label = `receive ${id} ${item} ${qty}@${cost}`;
        reply = await confirmDraft(
          await kit.call("POST", "/purchases/receipts", { id, supplierId: SUPPLIER, warehouseId: MAIN_WAREHOUSE, date: TODAY, lines: [{ itemId: item, qty, unitCost: cost }] }),
          `/purchases/receipts/${id}/confirm`,
        );
        if (reply.status === 200) receipts.push({ id, item, qty, cost });
      }
    } else if (kind === WalkStep.BillOrCancelReceipt) {
      const receipt = pick(receipts);
      if (!receipt) continue;
      if (random() < 0.25) {
        label = `cancel receipt ${receipt.id}`;
        reply = await kit.call("POST", `/purchases/receipts/${receipt.id}/cancel`, {});
      } else {
        const cost = pick(COSTS);
        const partial = random() < 0.5 && scaled(receipt.qty) > 1_000_000n;
        const remaining = partial ? "1" : ((await kit.call("GET", `/purchases/receipts/${receipt.id}`)).body?.lines?.[0]?.remainingQty as string | undefined);
        if (!remaining || scaled(remaining) === 0n) continue;
        label = `bill ${id} receipt ${receipt.id} ${remaining}@${cost}`;
        reply = await confirmDraft(
          await kit.call("POST", "/purchases/invoices", { id, supplierId: SUPPLIER, date: TODAY, dueDate: DUE, branchId: "BR-MAIN", warehouseId: MAIN_WAREHOUSE, receiptId: receipt.id, lines: [{ itemId: receipt.item, kind: "inventory", qty: remaining, unitCost: cost, taxRateId: "VAT14" }] }),
          `/purchases/invoices/${id}/confirm`,
        );
        if (reply.status === 200 && random() < 0.3) {
          const billed = await settle(label, reply);
          if (billed) return billed;
          label = `cancel bill ${id}`;
          reply = await kit.call("POST", `/purchases/invoices/${id}/cancel`, {});
        }
      }
    } else if (kind === WalkStep.Transfer) {
      const qty = pick(QUANTITIES);
      const back = random() < 0.5;
      label = `transfer ${id} ${item} ${qty} ${back ? "other->main" : "main->other"}`;
      reply = await confirmDraft(
        await kit.call("POST", "/inventory/stock-transfers/draft", { id, date: TODAY, lines: [{ itemId: item, fromWarehouseId: back ? otherWarehouse : MAIN_WAREHOUSE, toWarehouseId: back ? MAIN_WAREHOUSE : otherWarehouse, qty }] }),
        `/inventory/stock-transfers/${id}/confirm`,
      );
    } else {
      const target = pick(adjustments.filter((candidate) => !candidate.reversed));
      if (target && random() < 0.4) {
        label = `reverse adjustment ${target.id}`;
        reply = await kit.call("POST", `/inventory/stock-adjustments/${target.id}/reverse`, { reason: REASON, memo: REASON });
        if (reply.status === 201) target.reversed = true;
      } else {
        const inbound = random() < 0.5;
        const qty = pick(QUANTITIES);
        label = `adjust ${id} ${item} ${inbound ? "IN" : "OUT"} ${qty}`;
        reply = await confirmDraft(
          await kit.call("POST", "/inventory/stock-adjustments/draft", {
            id, date: TODAY,
            lines: [{ itemId: item, warehouseId: MAIN_WAREHOUSE, reason: inbound ? "INITIAL_STOCK" : "DAMAGE", direction: inbound ? "IN" : "OUT", qty, ...(inbound ? { unitCost: pick(COSTS) } : {}) }],
          }),
          `/inventory/stock-adjustments/${id}/confirm`,
        );
        if (reply.status === 200 && !reply.body?.held) adjustments.push({ id, reversed: false });
      }
    }

    const broken = await settle(label, reply);
    if (broken) return broken;
  }

  for (const itemId of items) {
    for (const warehouseId of warehouses) {
      const query = `itemId=${itemId}&warehouseId=${warehouseId}`;
      const cached = (await kit.call("GET", `/inventory/balance?${query}`)).body;
      const drift = (await kit.call("GET", `/inventory/drift?${query}`)).body;
      const rebuilt = await kit.call("POST", `/inventory/rebuild?${query}`, {});
      if (rebuilt.status !== 200) return fail(`rebuild ${itemId}@${warehouseId}`, [JSON.stringify(rebuilt.body)]);
      const problems: string[] = [];
      if (scaled(drift.cacheDrift) !== 0n) problems.push(`cache drift ${drift.cacheDrift}`);
      if (scaled(rebuilt.body.onHand) !== scaled(cached.onHand) || scaled(rebuilt.body.totalValue) !== scaled(cached.totalValue)) {
        problems.push(`the rebuild holds ${rebuilt.body.onHand}/${rebuilt.body.totalValue}, the cache held ${cached.onHand}/${cached.totalValue}`);
      }
      if (problems.length > 0) return fail(`rebuild ${itemId}@${warehouseId}`, problems);
    }
  }
  const afterRebuild = await problemsNow();
  if (afterRebuild.length > 0) return fail("rebuild of every walked position", afterRebuild);

  return { seed, steps, failure: null };
}

export function describeFailure(failure: StockWalkFailure): string {
  return [`seed ${failure.seed} broke after: ${failure.after}`, ...failure.problems.map((problem) => `  ${problem}`), "trail:", ...failure.trail.map((line) => `  ${line}`)].join("\n");
}
