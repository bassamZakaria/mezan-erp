import {
  Money,
  NextNumberService,
  postJournalEntry,
  computeCostCenterPnL,
  computeFxRevaluation,
  postFxRevaluation,
  deriveOpenFxBalances,
  computeBalanceReconciliation,
  findUnlinkedControlLines,
  EtaService,
  type Account,
  type AccountRepository,
  type CostCenter,
  type FiscalPeriod,
  type FiscalPeriodRepository,
  type JournalEntry,
  type JournalListFilter,
  type AccountBalance,
  type AccountLedgerLine,
  type LedgerRepository,
  type PostedLine,
  type PostedLineFilter,
  type SequenceStore,
  type ExchangeRate,
  type ExchangeRateRepository,
  type CostCenterPnLReport,
  type FxRevaluationResult,
  type NaturalBalance,
  type EtaConfig,
  type EtaConfigRepository,
  type EtaSubmission,
  type EtaSubmissionRepository,
  type EtaSubmissionStatus,
  DEFAULT_ETA_CONFIG,
} from "@mezan/domain";
import { demoCostCenters } from "../accounting-treasury-sample-data";

/**
 * In-memory wiring for the Phase 9 accounting-depth screens — the analogue of
 * `journal-store.ts`. It stands up the REAL domain services (GL posting engine,
 * FX revaluation, cost-center P&L, reconciliation, ETA service) against seeded
 * in-memory repositories, so each screen exercises actual domain logic rather
 * than faking it in the UI. Swapping these repos for the SQLite adapters + a
 * fetch client is the follow-up once the API is wired into the web build.
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
  private accumulate(accountId: string, asOfDate?: string) {
    let debit = 0n;
    let credit = 0n;
    for (const e of this.rows.values()) {
      if (!LEDGER_STATUSES.has(e.status)) continue;
      if (asOfDate && e.date > asOfDate) continue;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        debit += l.debit.scaled;
        credit += l.credit.scaled;
      }
    }
    return { debit, credit };
  }
  async accountBalance(accountId: string, asOfDate?: string): Promise<AccountBalance> {
    const { debit, credit } = this.accumulate(accountId, asOfDate);
    return { accountId, debit: Money.fromScaled(debit), credit: Money.fromScaled(credit), balance: Money.fromScaled(debit - credit) };
  }
  async accountLedger(): Promise<readonly AccountLedgerLine[]> {
    return [];
  }
  async listLines(filter: PostedLineFilter = {}): Promise<readonly PostedLine[]> {
    const out: PostedLine[] = [];
    for (const e of this.rows.values()) {
      if (!LEDGER_STATUSES.has(e.status)) continue;
      if (filter.fromDate && e.date < filter.fromDate) continue;
      if (filter.toDate && e.date > filter.toDate) continue;
      e.lines.forEach((l) => {
        if (filter.costCenterId !== undefined && (l.costCenterId ?? null) !== filter.costCenterId) return;
        if (filter.accountIds && !filter.accountIds.includes(l.accountId)) return;
        out.push({
          entryId: e.id,
          entryNo: e.entryNo ?? null,
          date: e.date,
          source: e.source ?? "manual",
          accountId: l.accountId,
          costCenterId: l.costCenterId ?? null,
          currency: l.currency ?? null,
          fxRate: l.fxRate ?? null,
          memo: l.memo ?? null,
          debit: l.debit,
          credit: l.credit,
        });
      });
    }
    return out.sort((a, b) => (a.date === b.date ? a.entryId.localeCompare(b.entryId) : a.date.localeCompare(b.date)));
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

class MemEtaConfig implements EtaConfigRepository {
  private cfg: EtaConfig = { ...DEFAULT_ETA_CONFIG };
  async get() {
    return this.cfg;
  }
  async save(cfg: EtaConfig) {
    this.cfg = cfg;
  }
}

class MemEtaSubmissions implements EtaSubmissionRepository {
  private readonly rows = new Map<string, EtaSubmission>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByInternalId(internalId: string) {
    for (const s of this.rows.values()) if (s.internalId === internalId) return s;
    return null;
  }
  async list(status?: EtaSubmissionStatus) {
    return [...this.rows.values()].filter((s) => (status ? s.status === status : true)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async create(s: EtaSubmission) {
    this.rows.set(s.id, s);
  }
  async update(s: EtaSubmission) {
    this.rows.set(s.id, s);
  }
}

function account(id: string, type: Account["type"], nameAr: string): Account {
  const naturalBalance: NaturalBalance = type === "asset" || type === "expense" ? "debit" : "credit";
  return { id, code: id, nameAr, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

const SEED_ACCOUNTS: Account[] = [
  account("1100", "asset", "ذمم مدينة"),
  account("1200", "asset", "المخزون"),
  account("1300", "asset", "النقدية"),
  account("2100", "liability", "ذمم دائنة"),
  account("4000", "revenue", "إيرادات المبيعات"),
  account("5000", "expense", "مصروفات تشغيلية"),
  account("4900", "revenue", "أرباح فروق عملة"),
  account("5900", "expense", "خسائر فروق عملة"),
];

const FX_GAIN_ACCOUNT = "4900";
const FX_LOSS_ACCOUNT = "5900";
const CLOSING_DATE = "2026-08-31";

export interface AccountingDepthStore {
  readonly accounts: readonly Account[];
  readonly costCenters: readonly CostCenter[];
  costCenterPnL(fromDate: string, toDate: string): Promise<CostCenterPnLReport>;
  listExchangeRates(): ExchangeRate[];
  addExchangeRate(rate: ExchangeRate): void;
  approveExchangeRate(id: string): void;
  fxPreview(date: string, currencies: string[], autoReverse: boolean): Promise<FxRevaluationResult>;
  fxClosingRates(date: string): Map<string, string>;
  fxPost(date: string, currencies: string[], autoReverse: boolean): Promise<{ entry: JournalEntry | null; reversal: JournalEntry | null }>;
  reconciliation(): Promise<{
    rows: ReturnType<typeof computeBalanceReconciliation>["rows"];
    allMatched: boolean;
    unlinked: ReturnType<typeof findUnlinkedControlLines>;
  }>;
  readonly eta: EtaService;
  refreshEta(): Promise<EtaSubmission[]>;
}

const SUB_LEDGER_BALANCES: Array<{ key: string; label: string; controlAccountId: string; naturalBalance: NaturalBalance; subLedger: string }> = [
  { key: "inventory", label: "تقييم المخزون مقابل دفتر الأستاذ", controlAccountId: "1200", naturalBalance: "debit", subLedger: "602425.90" },
  { key: "ar", label: "ذمم العملاء مقابل دفتر الأستاذ", controlAccountId: "1100", naturalBalance: "debit", subLedger: "5000" },
  { key: "ap", label: "ذمم الموردين مقابل دفتر الأستاذ", controlAccountId: "2100", naturalBalance: "credit", subLedger: "3300" },
];

export function createAccountingDepthStore(): AccountingDepthStore {
  const ledger = new MemLedger();
  const sequence = new MemSequence();
  sequence.seed("JOURNAL_ENTRY", 200);
  const numbering = new NextNumberService(sequence);

  const accountsById = new Map(SEED_ACCOUNTS.map((a) => [a.id, a]));
  const accounts: AccountRepository = {
    async findById(id) {
      return accountsById.get(id) ?? null;
    },
    async findByCode(code) {
      return accountsById.get(code) ?? null;
    },
    async list() {
      return [...accountsById.values()];
    },
    async create() {},
    async update() {},
  };

  const period: FiscalPeriod = { id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" };
  const septemberPeriod: FiscalPeriod = { id: "fp-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" };
  const periods: Pick<FiscalPeriodRepository, "findByDate"> = {
    async findByDate(date) {
      if (date >= period.startDate && date <= period.endDate) return period;
      if (date >= septemberPeriod.startDate && date <= septemberPeriod.endDate) return septemberPeriod;
      return null;
    },
  };

  const glDeps = { ledger, accounts, periods, numbering, now: () => "2026-08-31T10:00:00.000Z", actor: "demo" };

  // Exchange rates (approved USD/EUR closing rates + one pending row for the workflow).
  const rates: ExchangeRate[] = [
    { id: "r-usd", currency: "USD", rate: "55.000000", effectiveDate: "2026-08-25", rateType: "standard", source: "manual", status: "approved" },
    { id: "r-eur", currency: "EUR", rate: "60.500000", effectiveDate: "2026-08-25", rateType: "standard", source: "manual", status: "approved" },
    { id: "r-sar", currency: "SAR", rate: "14.700000", effectiveDate: "2026-08-20", rateType: "standard", source: "manual", status: "pending" },
  ];
  const exchangeRates: ExchangeRateRepository = {
    async findById(id) {
      return rates.find((r) => r.id === id) ?? null;
    },
    async list() {
      return [...rates];
    },
    async findRate(currency, asOfDate) {
      const usable = rates
        .filter((r) => r.currency === currency && r.effectiveDate <= asOfDate && (r.status === "approved" || r.status === "locked"))
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
      return usable[0] ?? null;
    },
    async create(rate) {
      rates.push(rate);
    },
    async update(rate) {
      const i = rates.findIndex((r) => r.id === rate.id);
      if (i >= 0) rates[i] = rate;
    },
  };

  // ETA service seeded with a mix of lifecycle states.
  const etaConfigRepo = new MemEtaConfig();
  const etaSubmissions = new MemEtaSubmissions();
  const eta = new EtaService({ config: etaConfigRepo, submissions: etaSubmissions, now: () => "2026-08-22T10:00:00.000Z", newId: () => `eta-${Math.random().toString(36).slice(2, 8)}` });

  async function seed() {
    // AR sale in USD booked at 50 (100 USD) — becomes an open FX balance revalued at 55.
    await postJournalEntry(
      {
        id: "je-fx-usd", date: "2026-08-10", memo: "فاتورة بالدولار", source: "system",
        lines: [
          { accountId: "1100", debit: Money.fromMajor("5000"), credit: Money.zero(), currency: "USD", fxRate: "50" },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("5000"), costCenterId: "cc-sales" },
        ],
      },
      glDeps,
    );
    // AP purchase in EUR booked at 58 (~56.55 EUR) — liability FX balance revalued at 60.5.
    await postJournalEntry(
      {
        id: "je-fx-eur", date: "2026-08-12", memo: "فاتورة مورد باليورو", source: "system",
        lines: [
          { accountId: "5000", debit: Money.fromMajor("3300"), credit: Money.zero(), costCenterId: "cc-marketing" },
          { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("3300"), currency: "EUR", fxRate: "58" },
        ],
      },
      glDeps,
    );
    // Cost-center-tagged operating activity (EGP).
    await postJournalEntry(
      {
        id: "je-cc", date: "2026-08-15", memo: "إيراد ومصروف موزع", source: "system",
        lines: [
          { accountId: "1300", debit: Money.fromMajor("2000"), credit: Money.zero() },
          { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("2000"), costCenterId: "cc-admin" },
        ],
      },
      glDeps,
    );
    await postJournalEntry(
      {
        id: "je-cc2", date: "2026-08-16", memo: "مصروف إداري", source: "system",
        lines: [
          { accountId: "5000", debit: Money.fromMajor("800"), credit: Money.zero(), costCenterId: "cc-admin" },
          { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("800") },
        ],
      },
      glDeps,
    );
    // A MANUAL line hitting the inventory control account → flagged unlinked.
    await postJournalEntry(
      {
        id: "je-manual", date: "2026-08-18", memo: "تسوية يدوية على حساب المخزون", source: "manual",
        lines: [
          { accountId: "1200", debit: Money.fromMajor("150"), credit: Money.zero(), memo: "تسوية يدوية على حساب المخزون" },
          { accountId: "1300", debit: Money.zero(), credit: Money.fromMajor("150") },
        ],
      },
      glDeps,
    );

    const now = "2026-08-22T10:00:00.000Z";
    const mk = (id: string, internalId: string, documentType: EtaSubmission["documentType"], status: EtaSubmissionStatus, extra: Partial<EtaSubmission> = {}): EtaSubmission => ({
      id, internalId, documentType, status, etaUuid: null, payload: { internalId }, errors: [], exclusionReason: null, createdAt: now, updatedAt: now, submittedAt: null, ...extra,
    });
    await etaSubmissions.create(mk("s1", "INV-000014", "invoice", "ready"));
    await etaSubmissions.create(mk("s2", "INV-000015", "invoice", "ready"));
    await etaSubmissions.create(mk("s3", "SRT-000001", "debit_note", "pending_signature"));
    await etaSubmissions.create(mk("s4", "INV-000012", "invoice", "submitted", { submittedAt: now }));
    await etaSubmissions.create(mk("s5", "INV-000011", "invoice", "accepted", { etaUuid: "ETA-UUID-11", submittedAt: now }));
    await etaSubmissions.create(mk("s6", "INV-000009", "invoice", "error", { errors: ["رقم تسجيل المشتري مطلوب للفواتير فوق 25,000"] }));
  }

  const ready = seed();

  return {
    accounts: SEED_ACCOUNTS,
    costCenters: demoCostCenters as unknown as CostCenter[],
    async costCenterPnL(fromDate, toDate) {
      await ready;
      const lines = await ledger.listLines({ fromDate, toDate });
      return computeCostCenterPnL(lines, SEED_ACCOUNTS, demoCostCenters as unknown as CostCenter[]);
    },
    listExchangeRates() {
      return [...rates];
    },
    addExchangeRate(rate) {
      rates.push(rate);
    },
    approveExchangeRate(id) {
      const i = rates.findIndex((r) => r.id === id);
      if (i >= 0) rates[i] = { ...rates[i]!, status: "approved" };
    },
    fxClosingRates(date) {
      const map = new Map<string, string>();
      for (const currency of ["USD", "EUR"]) {
        const usable = rates
          .filter((r) => r.currency === currency && r.effectiveDate <= date && (r.status === "approved" || r.status === "locked"))
          .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
        if (usable) map.set(currency, usable.rate);
      }
      return map;
    },
    async fxPreview(date, currencies, _autoReverse) {
      await ready;
      const lines = await ledger.listLines({ toDate: date });
      const filter = currencies.length > 0 ? new Set(currencies) : undefined;
      const balances = deriveOpenFxBalances(lines, SEED_ACCOUNTS, filter);
      const closingRates = new Map<string, string>();
      for (const currency of new Set(balances.map((b) => b.currency))) {
        const rate = await exchangeRates.findRate(currency, date);
        if (rate) closingRates.set(currency, rate.rate);
      }
      return computeFxRevaluation(balances, { date, closingRates, gainAccountId: FX_GAIN_ACCOUNT, lossAccountId: FX_LOSS_ACCOUNT });
    },
    async fxPost(date, currencies, autoReverse) {
      await ready;
      const lines = await ledger.listLines({ toDate: date });
      const filter = currencies.length > 0 ? new Set(currencies) : undefined;
      const balances = deriveOpenFxBalances(lines, SEED_ACCOUNTS, filter);
      const closingRates = new Map<string, string>();
      for (const currency of new Set(balances.map((b) => b.currency))) {
        const rate = await exchangeRates.findRate(currency, date);
        if (rate) closingRates.set(currency, rate.rate);
      }
      const result = await postFxRevaluation(
        balances,
        { date, closingRates, gainAccountId: FX_GAIN_ACCOUNT, lossAccountId: FX_LOSS_ACCOUNT },
        glDeps,
        { id: `fxr-${date}`, reversalId: `fxr-${date}-rev`, autoReverse },
      );
      return { entry: result.entry, reversal: result.reversal };
    },
    async reconciliation() {
      await ready;
      const comparisons = await Promise.all(
        SUB_LEDGER_BALANCES.map(async (control) => {
          const bal = await ledger.accountBalance(control.controlAccountId);
          const glBalance = control.naturalBalance === "debit" ? bal.balance : Money.fromScaled(-bal.balance.scaled);
          return { key: control.key, label: control.label, controlAccountId: control.controlAccountId, subLedgerBalance: Money.fromMajor(control.subLedger), glBalance };
        }),
      );
      const summary = computeBalanceReconciliation(comparisons);
      const controlIds = new Set(SUB_LEDGER_BALANCES.map((x) => x.controlAccountId));
      const lines = await ledger.listLines();
      const unlinked = findUnlinkedControlLines(lines, controlIds);
      return { rows: summary.rows, allMatched: summary.allMatched, unlinked };
    },
    eta,
    async refreshEta() {
      await ready;
      return eta.list();
    },
  };
}

export const FX_CLOSING_DATE = CLOSING_DATE;
