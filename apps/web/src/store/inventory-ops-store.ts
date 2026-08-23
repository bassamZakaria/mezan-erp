import {
  Money,
  Qty,
  NextNumberService,
  DocumentService,
  StockLedgerService,
  PhysicalCountService,
  stockAdjustmentDocumentType,
  stockTransferDocumentType,
  createInventoryOpsStockHook,
  createInventoryGlPostingHook,
  rollupStockBalance,
  extend,
  unitCostOf,
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
  type DocumentRepository,
  type DocumentListFilter,
  type FrameworkDocument,
  type StockAdjustmentDocLine,
  type StockTransferDocLine,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type StockMovement,
  type CostLayer,
  type WacSnapshot,
  type PhysicalCount,
  type PhysicalCountRepository,
  type PhysicalCountListFilter,
  type AdjustmentReason,
  type StockBalanceRow,
} from "@mezan/domain";

/**
 * In-memory wiring for the phase4/inventory-ops demo (Stock Adjustments,
 * Stock Transfers, Physical Counts, Stock Balance) — the analogue of
 * `journal-store.ts` for the inventory document layer. It stands up the REAL
 * domain services (the costing + stock-ledger engine, the GL posting engine,
 * the numbering engine, the two `DocumentService`s and `PhysicalCountService`)
 * against seeded in-memory repositories, so the screens exercise actual WAC
 * costing / negative-stock guard / GL posting / lifecycle rather than faking
 * them in the UI.
 *
 * Seeding mirrors `journal-store.ts`'s approach exactly: seeded documents are
 * inserted directly into the repos (never replayed through the async
 * `DocumentService`/`StockLedgerService` calls, which yield to the microtask
 * queue at their first `await` and so can't be fired-and-forgotten
 * synchronously inside a plain factory function) — `applySeedAdjustmentLine`/
 * `applySeedTransferLine` below hand-replay the SAME weighted-average math
 * `StockLedgerService.postAdjustment`/`.postTransfer` use, so the seeded
 * snapshots/movements/GL entries stay internally consistent with what the
 * engine would have produced.
 */

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

/** Generic in-memory `DocumentRepository<Line>` — reused for both inventory document types. */
class MemDocRepo<Line> implements DocumentRepository<Line> {
  private readonly rows = new Map<string, FrameworkDocument<Line>>();
  async save(doc: FrameworkDocument<Line>) {
    this.rows.set(doc.id, doc);
  }
  async update(doc: FrameworkDocument<Line>) {
    this.rows.set(doc.id, doc);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(filter: DocumentListFilter = {}) {
    return [...this.rows.values()]
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  }
  snapshot(): FrameworkDocument<Line>[] {
    return [...this.rows.values()].sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  }
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

class MemStockLedgerRepo implements StockLedgerRepository {
  private readonly rows: StockMovement[] = [];
  async append(m: StockMovement) {
    this.rows.push(m);
  }
  async listByPosition(itemId: string, warehouseId: string) {
    return this.rows.filter((r) => r.itemId === itemId && r.warehouseId === warehouseId);
  }
  async listByItem(itemId: string) {
    return this.rows.filter((r) => r.itemId === itemId);
  }
  async listByWarehouse(warehouseId: string) {
    return this.rows.filter((r) => r.warehouseId === warehouseId);
  }
  async listPositions() {
    const seen = new Map<string, { itemId: string; warehouseId: string }>();
    for (const r of this.rows) seen.set(`${r.itemId}:${r.warehouseId}`, { itemId: r.itemId, warehouseId: r.warehouseId });
    return [...seen.values()];
  }
}

class MemCostLayerRepo implements CostLayerRepository {
  private readonly rows = new Map<string, CostLayer>();
  async add(l: CostLayer) {
    this.rows.set(l.id, l);
  }
  async listByPosition(itemId: string, warehouseId: string) {
    return [...this.rows.values()].filter((l) => l.itemId === itemId && l.warehouseId === warehouseId);
  }
  async updateRemaining(id: string, remainingQty: Qty) {
    const l = this.rows.get(id);
    if (l) this.rows.set(id, { ...l, remainingQty });
  }
  async remove(id: string) {
    this.rows.delete(id);
  }
}

class MemSnapshotRepo implements WacSnapshotRepository {
  private readonly rows = new Map<string, WacSnapshot>();
  private key(itemId: string, warehouseId: string) {
    return `${itemId}:${warehouseId}`;
  }
  async get(itemId: string, warehouseId: string) {
    return this.rows.get(this.key(itemId, warehouseId)) ?? null;
  }
  async save(s: WacSnapshot) {
    this.rows.set(this.key(s.itemId, s.warehouseId), s);
  }
  async list() {
    return [...this.rows.values()];
  }
}

class MemPhysicalCountRepo implements PhysicalCountRepository {
  private readonly rows = new Map<string, PhysicalCount>();
  async save(c: PhysicalCount) {
    this.rows.set(c.id, c);
  }
  async update(c: PhysicalCount) {
    this.rows.set(c.id, c);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(filter: PhysicalCountListFilter = {}) {
    return [...this.rows.values()]
      .filter((c) => (filter.status ? c.status === filter.status : true))
      .filter((c) => (filter.warehouseId ? c.warehouseId === filter.warehouseId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  snapshot(): PhysicalCount[] {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Dr/Cr account mapping per adjustment reason for the demo tenant's GL wiring. */
const GL_ACCOUNTS_BY_REASON: Partial<Record<AdjustmentReason, { inventoryAccountId: string; counterpartAccountId: string }>> = {
  INITIAL_STOCK: { inventoryAccountId: "1200", counterpartAccountId: "3100" }, // Dr المخزون / Cr رأس المال
  DAMAGE: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  THEFT: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  EXPIRY: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  SHORTAGE: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  SUPPLIER_RETURN: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  PHYSICAL_COUNT: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
  OTHER: { inventoryAccountId: "1200", counterpartAccountId: "5900" },
};

export interface SeedAdjustmentCommand {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly StockAdjustmentDocLine[];
}

export interface SeedTransferCommand {
  readonly id: string;
  readonly date: string;
  readonly memo: string;
  readonly lines: readonly StockTransferDocLine[];
}

export interface InventoryOpsStore {
  readonly stockLedger: StockLedgerService;
  readonly adjustments: DocumentService<StockAdjustmentDocLine>;
  readonly transfers: DocumentService<StockTransferDocLine>;
  readonly counts: PhysicalCountService;
  /** The GL entry backing a confirmed adjustment shares its id (`createInventoryGlPostingHook`'s trick). */
  findJournalEntry(id: string): Promise<JournalEntry | null>;
  snapshotAdjustments(): FrameworkDocument<StockAdjustmentDocLine>[];
  snapshotTransfers(): FrameworkDocument<StockTransferDocLine>[];
  snapshotCounts(): PhysicalCount[];
  getStockBalance(warehouseId?: string): Promise<readonly StockBalanceRow[]>;
}

export interface InventoryOpsStoreSeed {
  readonly accounts: Account[];
  /** Open fiscal period the demo posts into. */
  readonly period: FiscalPeriod;
  readonly adjustmentSeeds?: readonly SeedAdjustmentCommand[];
  readonly transferSeeds?: readonly SeedTransferCommand[];
  now?: () => string;
}

export function createInventoryOpsStore(seed: InventoryOpsStoreSeed): InventoryOpsStore {
  const glLedger = new MemLedger();
  const glSequence = new MemSequence();
  const stockLedgerRepo = new MemStockLedgerRepo();
  const layersRepo = new MemCostLayerRepo();
  const snapshotsRepo = new MemSnapshotRepo();
  const adjustmentsRepo = new MemDocRepo<StockAdjustmentDocLine>();
  const transfersRepo = new MemDocRepo<StockTransferDocLine>();
  const countsRepo = new MemPhysicalCountRepo();

  const adjustmentSeeds = seed.adjustmentSeeds ?? [];
  const transferSeeds = seed.transferSeeds ?? [];
  glSequence.seed("STOCK_ADJUSTMENT", adjustmentSeeds.length);
  glSequence.seed("STOCK_TRANSFER", transferSeeds.length);

  const accountsById = new Map(seed.accounts.map((a) => [a.id, a]));
  const accounts: Pick<AccountRepository, "findById"> = {
    async findById(id) {
      return accountsById.get(id) ?? null;
    },
  };
  const periods: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      return date >= seed.period.startDate && date <= seed.period.endDate ? seed.period : null;
    },
  };

  const now = seed.now ?? (() => new Date().toISOString());

  const glHook = createInventoryGlPostingHook({
    ledger: glLedger,
    accounts,
    periods,
    numbering: new NextNumberService(glSequence),
    now,
    actor: "demo",
  });

  const stockLedger = new StockLedgerService({
    ledger: stockLedgerRepo,
    layers: layersRepo,
    snapshots: snapshotsRepo,
    policy: { allowNegativeStock: false },
    gl: glHook,
    clock: now,
  });

  const stockHook = createInventoryOpsStockHook(stockLedger, (reason) => GL_ACCOUNTS_BY_REASON[reason] ?? null);

  const adjustments = new DocumentService<StockAdjustmentDocLine>(stockAdjustmentDocumentType, {
    repo: adjustmentsRepo,
    numbering: { next: () => new NextNumberService(glSequence).next("STOCK_ADJUSTMENT") },
    stock: stockHook,
    auditModule: "inventory",
    now,
    actor: "demo",
  });

  const transfers = new DocumentService<StockTransferDocLine>(stockTransferDocumentType, {
    repo: transfersRepo,
    numbering: { next: () => new NextNumberService(glSequence).next("STOCK_TRANSFER") },
    stock: stockHook,
    auditModule: "inventory",
    now,
    actor: "demo",
  });

  const counts = new PhysicalCountService({
    repo: countsRepo,
    stockLedger,
    adjustments,
    numbering: { next: () => new NextNumberService(glSequence).next("PHYSICAL_COUNT") },
    now,
  });

  // --- Seed: direct, synchronous repo pokes that hand-replay the SAME WAC
  // math the engine uses (never fire-and-forget the async service calls —
  // see the file doc comment). ---

  const positionAcc = new Map<string, { onHand: Qty; totalValue: Money }>();
  function posKey(itemId: string, warehouseId: string) {
    return `${itemId}:${warehouseId}`;
  }

  function applyIn(itemId: string, warehouseId: string, qty: Qty, unitCost: Money, source: { sourceDocType: "ADJUSTMENT" | "TRANSFER"; sourceDocId: string; sourceDocNumber: string | null; reason: AdjustmentReason | null; occurredAt: string; movementId: string }) {
    const key = posKey(itemId, warehouseId);
    const prev = positionAcc.get(key) ?? { onHand: Qty.zero(), totalValue: Money.zero() };
    const value = extend(qty, unitCost);
    const onHand = prev.onHand.add(qty);
    const totalValue = prev.totalValue.add(value);
    positionAcc.set(key, { onHand, totalValue });

    void stockLedgerRepo.append({
      id: source.movementId,
      itemId,
      warehouseId,
      direction: "IN",
      qty,
      unitCost,
      sourceDocType: source.sourceDocType,
      sourceDocId: source.sourceDocId,
      sourceDocNumber: source.sourceDocNumber,
      reason: source.reason,
      occurredAt: source.occurredAt,
    });
    void layersRepo.add({
      id: source.movementId,
      itemId,
      warehouseId,
      unitCost,
      originalQty: qty,
      remainingQty: qty,
      sourceDocType: source.sourceDocType,
      sourceDocId: source.sourceDocId,
      sourceDocNumber: source.sourceDocNumber,
      createdAt: source.occurredAt,
    });
    void snapshotsRepo.save({ itemId, warehouseId, onHand, totalValue, averageCost: unitCostOf(totalValue, onHand) });
    return { unitCost, value };
  }

  function applyOut(itemId: string, warehouseId: string, qty: Qty, source: { sourceDocType: "ADJUSTMENT" | "TRANSFER"; sourceDocId: string; sourceDocNumber: string | null; reason: AdjustmentReason | null; occurredAt: string; movementId: string }) {
    const key = posKey(itemId, warehouseId);
    const prev = positionAcc.get(key) ?? { onHand: Qty.zero(), totalValue: Money.zero() };
    const unitCost = unitCostOf(prev.totalValue, prev.onHand); // moving average at the time of this OUT
    const cogs = extend(qty, unitCost);
    const onHand = prev.onHand.subtract(qty);
    const totalValue = prev.totalValue.add(cogs.negate());
    positionAcc.set(key, { onHand, totalValue });

    void stockLedgerRepo.append({
      id: source.movementId,
      itemId,
      warehouseId,
      direction: "OUT",
      qty,
      unitCost,
      sourceDocType: source.sourceDocType,
      sourceDocId: source.sourceDocId,
      sourceDocNumber: source.sourceDocNumber,
      reason: source.reason,
      occurredAt: source.occurredAt,
    });
    void snapshotsRepo.save({ itemId, warehouseId, onHand, totalValue, averageCost: unitCostOf(totalValue, onHand) });
    return { unitCost, value: cogs.negate() };
  }

  let adjSeq = 0;
  for (const cmd of adjustmentSeeds) {
    adjSeq += 1;
    const docNo = `ADJ-${String(adjSeq).padStart(6, "0")}`;
    let valueDelta = Money.zero();
    cmd.lines.forEach((line, i) => {
      const movementId = `${cmd.id}:${i}`;
      const result =
        line.direction === "IN"
          ? applyIn(line.itemId, line.warehouseId, line.qty, line.unitCost as Money, {
              sourceDocType: "ADJUSTMENT",
              sourceDocId: cmd.id,
              sourceDocNumber: docNo,
              reason: line.reason,
              occurredAt: cmd.date,
              movementId,
            })
          : applyOut(line.itemId, line.warehouseId, line.qty, {
              sourceDocType: "ADJUSTMENT",
              sourceDocId: cmd.id,
              sourceDocNumber: docNo,
              reason: line.reason,
              occurredAt: cmd.date,
              movementId,
            });
      valueDelta = valueDelta.add(result.value);
    });

    const reason = cmd.lines[0]?.reason ?? null;
    const glAccounts = reason ? GL_ACCOUNTS_BY_REASON[reason] : null;
    if (glAccounts && valueDelta.scaled !== 0n) {
      const increased = valueDelta.scaled > 0n;
      const magnitude = increased ? valueDelta : valueDelta.negate();
      void glLedger.save({
        id: cmd.id, // matches `createInventoryGlPostingHook`'s convention: JE id == adjustment doc id
        entryNo: docNo,
        date: cmd.date,
        memo: `Stock adjustment ${docNo} (${reason})`,
        status: "posted",
        source: "system",
        lines: increased
          ? [
              { accountId: glAccounts.inventoryAccountId, debit: magnitude, credit: Money.zero() },
              { accountId: glAccounts.counterpartAccountId, debit: Money.zero(), credit: magnitude },
            ]
          : [
              { accountId: glAccounts.counterpartAccountId, debit: magnitude, credit: Money.zero() },
              { accountId: glAccounts.inventoryAccountId, debit: Money.zero(), credit: magnitude },
            ],
        createdAt: `${cmd.date}T09:00:00.000Z`,
        postedAt: `${cmd.date}T09:00:00.000Z`,
        reversesEntryId: null,
        reversedByEntryId: null,
      });
    }

    void adjustmentsRepo.save({
      id: cmd.id,
      docType: "STOCK_ADJUSTMENT",
      docNo,
      date: cmd.date,
      memo: cmd.memo,
      status: "confirmed",
      lines: cmd.lines,
      createdAt: `${cmd.date}T09:00:00.000Z`,
      confirmedAt: `${cmd.date}T09:00:00.000Z`,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null, // GL entry, when posted, shares `id` — see findJournalEntry()
    });
  }

  let trfSeq = 0;
  for (const cmd of transferSeeds) {
    trfSeq += 1;
    const docNo = `TRF-${String(trfSeq).padStart(6, "0")}`;
    cmd.lines.forEach((line, i) => {
      const { unitCost } = applyOut(line.itemId, line.fromWarehouseId, line.qty, {
        sourceDocType: "TRANSFER",
        sourceDocId: cmd.id,
        sourceDocNumber: docNo,
        reason: null,
        occurredAt: cmd.date,
        movementId: `${cmd.id}:out:${i}`,
      });
      applyIn(line.itemId, line.toWarehouseId, line.qty, unitCost, {
        sourceDocType: "TRANSFER",
        sourceDocId: cmd.id,
        sourceDocNumber: docNo,
        reason: null,
        occurredAt: cmd.date,
        movementId: `${cmd.id}:in:${i}`,
      });
    });

    void transfersRepo.save({
      id: cmd.id,
      docType: "STOCK_TRANSFER",
      docNo,
      date: cmd.date,
      memo: cmd.memo,
      status: "confirmed",
      lines: cmd.lines,
      createdAt: `${cmd.date}T09:00:00.000Z`,
      confirmedAt: `${cmd.date}T09:00:00.000Z`,
      reversesDocId: null,
      reversedByDocId: null,
      workflowRequestId: null,
      journalEntryId: null,
    });
  }

  return {
    stockLedger,
    adjustments,
    transfers,
    counts,
    findJournalEntry: (id) => glLedger.findById(id),
    snapshotAdjustments: () => adjustmentsRepo.snapshot(),
    snapshotTransfers: () => transfersRepo.snapshot(),
    snapshotCounts: () => countsRepo.snapshot(),
    getStockBalance: async (warehouseId) => {
      const { positions } = await stockLedger.getValuation();
      return rollupStockBalance(positions, { warehouseId });
    },
  };
}
