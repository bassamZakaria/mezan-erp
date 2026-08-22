import {
  Money,
  NextNumberService,
  StockLedgerService,
  DocumentService,
  LandedCostService,
  createJournalGlHook,
  createDocumentWorkflowGate,
  createInventoryStockHook,
  createSalesReturnDocumentType,
  createPurchaseReturnDocumentType,
  createLandedCostDocumentType,
  installmentPlanDocumentType,
  createFollowUp,
  completeFollowUp,
  cancelFollowUp,
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
  type SalesReturnLine,
  type PurchaseReturnLine,
  type LandedCostLine,
  type InstallmentLine,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type StockMovement,
  type CostLayer,
  type WacSnapshot,
  type CollectionFollowUp,
  type CollectionFollowUpRepository,
  type CollectionFollowUpListFilter,
  type FollowUpType,
} from "@mezan/domain";

/**
 * In-memory wiring for the returns/landed-cost/installments demo screens —
 * the analogue of `journal-store.ts` for these four document-framework
 * consumers, sharing ONE demo GL ledger + stock ledger so a confirmed return
 * actually moves the same stock/accounts the rest of the demo app shows.
 */

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
  async increment(code: string, period: number | null) {
    const key = `${code}:${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

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

class MemStockLedger implements StockLedgerRepository {
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

class MemCostLayers implements CostLayerRepository {
  private readonly rows = new Map<string, CostLayer>();
  async add(layer: CostLayer) {
    this.rows.set(layer.id, layer);
  }
  async listByPosition(itemId: string, warehouseId: string) {
    return [...this.rows.values()].filter((l) => l.itemId === itemId && l.warehouseId === warehouseId);
  }
  async updateRemaining(layerId: string, remainingQty: CostLayer["remainingQty"]) {
    const layer = this.rows.get(layerId);
    if (layer) this.rows.set(layerId, { ...layer, remainingQty });
  }
  async remove(layerId: string) {
    this.rows.delete(layerId);
  }
}

class MemSnapshots implements WacSnapshotRepository {
  private readonly rows = new Map<string, WacSnapshot>();
  private key(itemId: string, warehouseId: string) {
    return `${itemId}:${warehouseId}`;
  }
  async get(itemId: string, warehouseId: string) {
    return this.rows.get(this.key(itemId, warehouseId)) ?? null;
  }
  async save(snapshot: WacSnapshot) {
    this.rows.set(this.key(snapshot.itemId, snapshot.warehouseId), snapshot);
  }
  async list() {
    return [...this.rows.values()];
  }
}

class MemFollowUps implements CollectionFollowUpRepository {
  private readonly rows = new Map<string, CollectionFollowUp>();
  async save(f: CollectionFollowUp) {
    this.rows.set(f.id, f);
  }
  async update(f: CollectionFollowUp) {
    this.rows.set(f.id, f);
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async list(filter: CollectionFollowUpListFilter = {}) {
    return [...this.rows.values()]
      .filter((f) => (filter.status ? f.status === filter.status : true))
      .filter((f) => (filter.customerId ? f.customerId === filter.customerId : true))
      .sort((a, b) => b.followUpDate.localeCompare(a.followUpDate));
  }
  snapshot(): CollectionFollowUp[] {
    return [...this.rows.values()].sort((a, b) => b.followUpDate.localeCompare(a.followUpDate));
  }
}

/** GL account mapping for the demo tenant (docs/catalog/04 GL mapping — no settings screen for this yet, so it's fixed here; account ids match `accounts-sample-data.ts`). */
export const DEMO_GL_ACCOUNTS = {
  accountsReceivableId: "1120",
  salesReturnsAccountId: "4200",
  outputTaxPayableAccountId: "2200",
  accountsPayableId: "2100",
  inputTaxPayableId: "1400",
  inventoryAccountId: "1200",
  cogsAccountId: "5100",
  accruedLandedCostPayableId: "2120",
};

export interface ReturnsLandedInstallmentsStore {
  readonly salesReturns: DocumentService<SalesReturnLine>;
  readonly purchaseReturns: DocumentService<PurchaseReturnLine>;
  readonly landedCostDocuments: DocumentService<LandedCostLine>;
  readonly landedCosts: LandedCostService;
  readonly installments: DocumentService<InstallmentLine>;
  readonly installmentsRepo: DocumentRepository<InstallmentLine>;
  readonly followUps: CollectionFollowUpRepository;
  readonly stockService: StockLedgerService;
  snapshot(): {
    salesReturns: FrameworkDocument<SalesReturnLine>[];
    purchaseReturns: FrameworkDocument<PurchaseReturnLine>[];
    landedCosts: FrameworkDocument<LandedCostLine>[];
    installments: FrameworkDocument<InstallmentLine>[];
    followUps: CollectionFollowUp[];
  };
}

export interface ReturnsLandedInstallmentsSeed {
  readonly accounts: Account[];
  readonly period: FiscalPeriod;
  now?: () => string;
}

export function createReturnsLandedInstallmentsStore(seed: ReturnsLandedInstallmentsSeed): ReturnsLandedInstallmentsStore {
  const ledger = new MemLedger();
  const sequence = new MemSequence();
  const numbering = new NextNumberService(sequence);

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
  const gl = createJournalGlHook({ ledger, accounts, periods, numbering, now, actor: "demo" });
  const workflow = createDocumentWorkflowGate(() => null);

  const stockService = new StockLedgerService({
    ledger: new MemStockLedger(),
    layers: new MemCostLayers(),
    snapshots: new MemSnapshots(),
    policy: { allowNegativeStock: false },
    clock: now,
  });
  const stock = createInventoryStockHook(stockService);

  const salesReturnsRepo = new MemDocRepo<SalesReturnLine>();
  const salesReturns = new DocumentService(createSalesReturnDocumentType(DEMO_GL_ACCOUNTS), {
    repo: salesReturnsRepo,
    numbering: { next: () => numbering.next("SALES_RETURN") },
    gl,
    stock,
    workflow,
    now,
    actor: "demo",
  });

  const purchaseReturnsRepo = new MemDocRepo<PurchaseReturnLine>();
  const purchaseReturns = new DocumentService(createPurchaseReturnDocumentType(DEMO_GL_ACCOUNTS), {
    repo: purchaseReturnsRepo,
    numbering: { next: () => numbering.next("PURCHASE_RETURN") },
    gl,
    stock,
    workflow,
    now,
    actor: "demo",
  });

  const landedCostRepo = new MemDocRepo<LandedCostLine>();
  const landedCostDocuments = new DocumentService(createLandedCostDocumentType(DEMO_GL_ACCOUNTS), {
    repo: landedCostRepo,
    numbering: { next: () => numbering.next("LANDED_COST") },
    gl,
    workflow,
    now,
    actor: "demo",
  });
  const landedCosts = new LandedCostService(landedCostDocuments, stockService);

  const installmentsRepo = new MemDocRepo<InstallmentLine>();
  const installments = new DocumentService(installmentPlanDocumentType, {
    repo: installmentsRepo,
    numbering: { next: () => numbering.next("INSTALLMENT_PLAN") },
    workflow,
    now,
    actor: "demo",
  });

  const followUps = new MemFollowUps();

  return {
    salesReturns,
    purchaseReturns,
    landedCostDocuments,
    landedCosts,
    installments,
    installmentsRepo,
    followUps,
    stockService,
    snapshot: () => ({
      salesReturns: salesReturnsRepo.snapshot(),
      purchaseReturns: purchaseReturnsRepo.snapshot(),
      landedCosts: landedCostRepo.snapshot(),
      installments: installmentsRepo.snapshot(),
      followUps: followUps.snapshot(),
    }),
  };
}

export { createFollowUp, completeFollowUp, cancelFollowUp };
export type { FollowUpType };
