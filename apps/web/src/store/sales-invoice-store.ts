import type { ItemDTO } from "@mezan/contracts";
import {
  Money,
  Qty,
  extend,
  NextNumberService,
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createDocumentWorkflowGate,
  computeInvoiceTotals,
  buildSalesInvoiceGlPosting,
  StockLedgerService,
  type Account,
  type AccountRepository,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type JournalEntry,
  type LedgerRepository,
  type JournalListFilter,
  type AccountBalance,
  type AccountLedgerLine,
  type SequenceStore,
  type Customer,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceDiscount,
  type SalesInvoiceStatus,
  type SalesInvoiceRepository,
  type SalesInvoiceListFilter,
  type SalesInvoiceCogsLine,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type WacSnapshot,
  type CostLayer,
  type StockMovement,
} from "@mezan/domain";
import { demoCustomers } from "../partners-sample-data";
import { demoItems } from "../items-sample-data";
import { demoAccounts } from "../accounts-sample-data";
import { demoOpenPeriod } from "../journals-sample-data";
import { demoWarehouses, demoBranches } from "../sample-data";

/**
 * In-memory wiring for the Sales Invoices screen — the analogue of
 * `journal-store.ts` for the sales-invoice document. It stands up the REAL
 * `SalesInvoiceService` (numbering + GL posting engine + stock-ledger engine)
 * against seeded in-memory repositories, so the screen exercises actual
 * balance/period/stock enforcement rather than faking it in the UI. Swapping
 * these repos for the SQLite adapters + a fetch-backed client is the follow-up
 * once the API is wired into the web build.
 */

/** GL accounts the invoice form defaults to (docs/catalog/01 §"فواتير المبيعات"). */
export const AR_ACCOUNT_ID = "1120";
export const REVENUE_ACCOUNT_ID = "4100";
export const TAX_ACCOUNT_ID = "2200";
export const COGS_ACCOUNT_ID = "5100";
export const INVENTORY_ACCOUNT_ID = "1200";

export const DEFAULT_WAREHOUSE_ID = demoWarehouses[0]?.id ?? "MAIN-WH";
export const DEFAULT_BRANCH_ID = demoBranches[0]?.id ?? "MAIN";

/** demoAccounts has no leaf trade-receivables account yet — add one locally (mirrors 1110/1160's shape). */
const AR_ACCOUNT: Account = {
  id: AR_ACCOUNT_ID,
  code: AR_ACCOUNT_ID,
  nameAr: "ذمم عملاء تجاريين",
  nameEn: "Trade Accounts Receivable",
  type: "asset",
  naturalBalance: "debit",
  parentId: "1100",
  isHeader: false,
  status: "active",
};

const LEDGER_STATUSES = new Set(["posted", "reversed"]);

class MemLedger implements LedgerRepository {
  private readonly rows = new Map<string, JournalEntry>();
  async save(entry: JournalEntry) {
    this.rows.set(entry.id, entry);
  }
  async update(entry: JournalEntry) {
    this.rows.set(entry.id, entry);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByEntryNo(entryNo: string) {
    for (const e of this.rows.values()) if (e.entryNo === entryNo) return e;
    return null;
  }
  async list(filter: JournalListFilter = {}) {
    return [...this.rows.values()].filter((e) => (filter.status ? e.status === filter.status : true));
  }
  async accountBalance(accountId: string): Promise<AccountBalance> {
    let debit = 0n;
    let credit = 0n;
    for (const e of this.rows.values()) {
      if (!LEDGER_STATUSES.has(e.status)) continue;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        debit += l.debit.scaled;
        credit += l.credit.scaled;
      }
    }
    return { accountId, debit: Money.fromScaled(debit), credit: Money.fromScaled(credit), balance: Money.fromScaled(debit - credit) };
  }
  async accountLedger(): Promise<readonly AccountLedgerLine[]> {
    return [];
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

class MemSequence implements SequenceStore {
  private readonly counters = new Map<string, number>();
  seed(code: string, value: number) {
    this.counters.set(`${code}:`, value);
  }
  async increment(code: string, period: number | null) {
    const key = `${code}:${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

class MemSalesInvoiceRepo implements SalesInvoiceRepository {
  private readonly rows = new Map<string, SalesInvoice>();
  async save(invoice: SalesInvoice) {
    this.rows.set(invoice.id, invoice);
  }
  async update(invoice: SalesInvoice) {
    this.rows.set(invoice.id, invoice);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(filter: SalesInvoiceListFilter = {}) {
    return [...this.rows.values()]
      .filter((inv) => (filter.status ? inv.status === filter.status : true))
      .filter((inv) => (filter.customerId ? inv.customerId === filter.customerId : true))
      .filter((inv) => (filter.fromDate ? inv.date >= filter.fromDate : true))
      .filter((inv) => (filter.toDate ? inv.date <= filter.toDate : true));
  }
  snapshot(): SalesInvoice[] {
    return [...this.rows.values()].sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/** In-memory StockLedgerRepository (mirrors inventory/test-helpers/in-memory-stores.ts — not exported from the barrel). */
class MemStockLedger implements StockLedgerRepository {
  readonly movements: StockMovement[] = [];
  async append(movement: StockMovement) {
    this.movements.push(movement);
  }
  async listByPosition(itemId: string, warehouseId: string) {
    return this.movements.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
  }
  async listByItem(itemId: string) {
    return this.movements.filter((m) => m.itemId === itemId);
  }
  async listByWarehouse(warehouseId: string) {
    return this.movements.filter((m) => m.warehouseId === warehouseId);
  }
  async listPositions() {
    const seen = new Map<string, { itemId: string; warehouseId: string }>();
    for (const m of this.movements) seen.set(`${m.itemId}|${m.warehouseId}`, { itemId: m.itemId, warehouseId: m.warehouseId });
    return [...seen.values()];
  }
}

class MemCostLayers implements CostLayerRepository {
  readonly layers: CostLayer[] = [];
  async add(layer: CostLayer) {
    this.layers.push(layer);
  }
  async listByPosition(itemId: string, warehouseId: string) {
    return this.layers.filter((l) => l.itemId === itemId && l.warehouseId === warehouseId);
  }
  async updateRemaining(layerId: string, remainingQty: Qty) {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers[idx] = { ...(this.layers[idx] as CostLayer), remainingQty };
  }
  async remove(layerId: string) {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers.splice(idx, 1);
  }
}

class MemSnapshots implements WacSnapshotRepository {
  private readonly byKey = new Map<string, WacSnapshot>();
  private key(itemId: string, warehouseId: string) {
    return `${itemId}|${warehouseId}`;
  }
  async get(itemId: string, warehouseId: string) {
    return this.byKey.get(this.key(itemId, warehouseId)) ?? null;
  }
  async save(snapshot: WacSnapshot) {
    this.byKey.set(this.key(snapshot.itemId, snapshot.warehouseId), snapshot);
  }
  async list() {
    return [...this.byKey.values()];
  }
}

export interface SalesInvoiceStore {
  readonly service: SalesInvoiceService;
  /** Postable (leaf, active) accounts for the account pickers. */
  readonly accounts: Account[];
  readonly customers: Customer[];
  readonly items: ItemDTO[];
  readonly warehouses: { id: string; name: string; branchId: string }[];
  snapshot(): SalesInvoice[];
}

export interface SalesInvoiceStoreSeed {
  readonly customers?: Customer[];
  readonly items?: ItemDTO[];
  readonly accounts?: Account[];
  /** Open fiscal period the demo posts into. */
  readonly period?: FiscalPeriod;
  /** Seeds the INV-/JE- counters so newly confirmed invoices continue the numbering. */
  readonly startInvoiceNumber?: number;
  readonly startJeNumber?: number;
  now?: () => string;
}

/** One line of a seeded, already-confirmed demo invoice. */
interface SeedLine {
  readonly item: ItemDTO;
  readonly qty: string;
  readonly unitPriceMajor?: string;
  readonly discountPercent?: number;
}

interface SeedInvoiceInput {
  readonly n: number;
  readonly date: string;
  readonly dueDate: string;
  readonly customer: Customer;
  readonly status: Extract<SalesInvoiceStatus, "confirmed" | "partially_paid" | "paid">;
  readonly lines: readonly SeedLine[];
  /** Fraction (0..1) of the grand total already collected — only meaningful for partially_paid. */
  readonly paidFraction?: number;
}

function buildSeedInvoiceLine(n: number, i: number, l: SeedLine): SalesInvoiceLine {
  const isStock = l.item.type === "stock";
  return {
    lineId: `seed-inv-${n}-L${i + 1}`,
    itemId: l.item.id,
    itemNameAr: l.item.nameAr,
    isStock,
    qty: Qty.fromMajor(l.qty),
    unitPrice: Money.fromMajor(l.unitPriceMajor ?? l.item.salePrice ?? "0"),
    discountPercent: l.discountPercent ?? 0,
    taxRatePercent: l.item.taxRatePercent,
    revenueAccountId: l.item.revenueAccountId ?? REVENUE_ACCOUNT_ID,
    cogsAccountId: isStock ? (l.item.cogsAccountId ?? COGS_ACCOUNT_ID) : null,
    inventoryAccountId: isStock ? (l.item.inventoryAccountId ?? INVENTORY_ACCOUNT_ID) : null,
    unitCost: isStock ? Money.fromMajor(l.item.costPrice ?? "0") : null,
  };
}

/**
 * Build an already-confirmed demo invoice + its posted journal entry directly
 * (no I/O — every dependency here is a synchronous in-memory Map), the same
 * shortcut `journal-store.ts` uses for its seeded documents. New invoices
 * created through the UI always go through the REAL `SalesInvoiceService`.
 */
function buildSeedInvoice(input: SeedInvoiceInput, now: () => string): { invoice: SalesInvoice; journalEntry: JournalEntry } {
  const id = `seed-inv-${input.n}`;
  const docNo = `INV-${String(input.n).padStart(6, "0")}`;
  const jeId = `seed-je-${input.n}`;
  const jeNo = `JE-${String(input.n).padStart(6, "0")}`;
  const createdAt = `${input.date}T09:00:00.000Z`;
  const confirmedAt = `${input.date}T09:05:00.000Z`;

  const lines = input.lines.map((l, i) => buildSeedInvoiceLine(input.n, i, l));
  const discount: SalesInvoiceDiscount = { type: "amount", amount: Money.zero() };

  const base: SalesInvoice = {
    id,
    docType: "SALES_INVOICE",
    docNo,
    status: "confirmed",
    date: input.date,
    dueDate: input.dueDate,
    customerId: input.customer.id,
    customerNameAr: input.customer.nameAr,
    customerTaxExempt: input.customer.taxExempt,
    warehouseId: DEFAULT_WAREHOUSE_ID,
    branchId: DEFAULT_BRANCH_ID,
    currency: input.customer.currency,
    notes: null,
    internalNotes: null,
    discount,
    arAccountId: AR_ACCOUNT_ID,
    taxAccountId: TAX_ACCOUNT_ID,
    lines,
    amountPaid: Money.zero(),
    createdAt,
    confirmedAt,
    journalEntryId: jeId,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
  };

  const totals = computeInvoiceTotals(lines, discount, { taxExempt: base.customerTaxExempt });
  const cogsLines: SalesInvoiceCogsLine[] = lines
    .filter((l): l is SalesInvoiceLine & { cogsAccountId: string; inventoryAccountId: string } => l.isStock && !!l.cogsAccountId && !!l.inventoryAccountId)
    .map((l) => ({ cogsAccountId: l.cogsAccountId, inventoryAccountId: l.inventoryAccountId, cost: extend(l.qty, l.unitCost ?? Money.zero()) }));

  const posting = buildSalesInvoiceGlPosting(base, totals, cogsLines);
  const journalEntry: JournalEntry = {
    id: jeId,
    entryNo: jeNo,
    date: input.date,
    memo: posting.memo,
    status: "posted",
    source: "system",
    lines: posting.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo ?? null })),
    createdAt,
    postedAt: confirmedAt,
    reversesEntryId: null,
    reversedByEntryId: null,
  };

  const amountPaid =
    input.status === "paid"
      ? totals.grandTotal
      : input.status === "partially_paid"
        ? Money.fromScaled((totals.grandTotal.scaled * BigInt(Math.round((input.paidFraction ?? 0.5) * 100))) / 100n)
        : Money.zero();

  return { invoice: { ...base, status: input.status, amountPaid }, journalEntry };
}

export function createSalesInvoiceStore(seed: SalesInvoiceStoreSeed = {}): SalesInvoiceStore {
  const now = seed.now ?? (() => new Date().toISOString());

  const customers = seed.customers ?? demoCustomers;
  const items = seed.items ?? demoItems;
  const accounts = seed.accounts ?? [...demoAccounts, AR_ACCOUNT];
  const period = seed.period ?? demoOpenPeriod;

  const ledger = new MemLedger();
  const sequence = new MemSequence();
  const invoiceRepo = new MemSalesInvoiceRepo();

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const accountsPort: Pick<AccountRepository, "findById"> = {
    async findById(id) {
      return accountsById.get(id) ?? null;
    },
  };
  const periodsPort: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      return date >= period.startDate && date <= period.endDate ? period : null;
    },
  };

  const glNumbering = new NextNumberService(sequence);
  const gl = createSalesInvoiceGlHook({
    ledger,
    accounts: accountsPort,
    periods: periodsPort,
    numbering: glNumbering,
    now,
    actor: "demo",
  });

  const stockLedgerRepo = new MemStockLedger();
  const costLayerRepo = new MemCostLayers();
  const snapshotsRepo = new MemSnapshots();
  const stockService = new StockLedgerService({
    ledger: stockLedgerRepo,
    layers: costLayerRepo,
    snapshots: snapshotsRepo,
    policy: { allowNegativeStock: true },
    clock: now,
  });
  const stock = createSalesInvoiceStockHook(stockService);

  const invoiceNumbering = new NextNumberService(sequence);

  const service = new SalesInvoiceService({
    repo: invoiceRepo,
    numbering: { next: () => invoiceNumbering.next("SALES_INVOICE") },
    gl,
    stock,
    workflow: createDocumentWorkflowGate(() => null),
    now,
    actor: "demo",
  });

  // --- Seed opening stock for every stock item, so a new invoice's confirm
  // has real cost layers to draw COGS from (opening balance is a synchronous
  // Map write — see the classes above — so it's ready before this returns). --
  for (const item of items) {
    if (item.type !== "stock") continue;
    const openingQty = Qty.fromMajor("200");
    const unitCost = Money.fromMajor(item.costPrice ?? item.salePrice ?? "0");
    const movement: StockMovement = {
      id: `seed-open-${item.id}`,
      itemId: item.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      direction: "IN",
      qty: openingQty,
      unitCost,
      sourceDocType: "ADJUSTMENT",
      sourceDocId: `seed-open-${item.id}`,
      sourceDocNumber: null,
      reason: "INITIAL_STOCK",
      occurredAt: `${period.startDate}T00:00:00.000Z`,
    };
    void stockLedgerRepo.append(movement);
    void costLayerRepo.add({
      id: movement.id,
      itemId: item.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      unitCost,
      originalQty: openingQty,
      remainingQty: openingQty,
      sourceDocType: "ADJUSTMENT",
      sourceDocId: movement.sourceDocId,
      sourceDocNumber: null,
      createdAt: movement.occurredAt,
    });
    void snapshotsRepo.save({
      itemId: item.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      onHand: openingQty,
      totalValue: extend(openingQty, unitCost),
      averageCost: unitCost,
    });
  }

  // --- Seed a few already-confirmed demo invoices (Cyag tenant) -------------
  const rice = items.find((i) => i.id === "itm-1");
  const oil = items.find((i) => i.id === "itm-2");
  const maintenance = items.find((i) => i.id === "itm-6");
  const custAmal = customers.find((c) => c.id === "cust-1");
  const custNour = customers.find((c) => c.id === "cust-2");
  const custCyag = customers.find((c) => c.id === "cust-3");

  const seedInputs: SeedInvoiceInput[] = [];
  if (rice && maintenance && custAmal) {
    seedInputs.push({
      n: 1,
      date: "2026-08-10",
      dueDate: "2026-09-10",
      customer: custAmal,
      status: "confirmed",
      lines: [
        { item: rice, qty: "5" },
        { item: maintenance, qty: "1" },
      ],
    });
  }
  if (oil && custNour) {
    seedInputs.push({
      n: 2,
      date: "2026-08-09",
      dueDate: "2026-09-08",
      customer: custNour,
      status: "paid",
      lines: [{ item: oil, qty: "20" }],
    });
  }
  if (rice && oil && custCyag) {
    seedInputs.push({
      n: 3,
      date: "2026-07-20",
      dueDate: "2026-08-05", // before "today" in the demo → overdue
      customer: custCyag,
      status: "partially_paid",
      paidFraction: 0.4,
      lines: [
        { item: rice, qty: "3" },
        { item: oil, qty: "10" },
      ],
    });
  }

  for (const input of seedInputs) {
    const { invoice, journalEntry } = buildSeedInvoice(input, now);
    void invoiceRepo.save(invoice);
    void ledger.save(journalEntry);
  }

  sequence.seed("SALES_INVOICE", seed.startInvoiceNumber ?? seedInputs.length);
  sequence.seed("JOURNAL_ENTRY", seed.startJeNumber ?? seedInputs.length);

  return {
    service,
    accounts: accounts.filter((a) => !a.isHeader && a.status === "active"),
    customers,
    items,
    warehouses: demoWarehouses,
    snapshot: () => invoiceRepo.snapshot(),
  };
}
