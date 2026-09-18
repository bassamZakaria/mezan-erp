import { Hono, type Context } from "hono";
import {
  Money,
  type AllocatableInvoiceRepository,
  runReport,
  createSalesByPeriodReport,
  createSalesByItemReport,
  creditedRevenueAccountIds,
  createSalesByCustomerReport,
  createSalesBySalespersonReport,
  createTopProductsReport,
  createPurchasesByPeriodReport,
  createPurchasesBySupplierReport,
  createPurchasesByItemReport,
  createInventoryStockLevelsReport,
  createGoodsInTransitReport,
  createInventoryMovementReport,
  createInventoryLedgerReport,
  createInventoryValuationReport,
  createInventoryAgingReport,
  createInventoryExpiringReport,
  createInventorySlowMovingReport,
  createInventoryDriftReport,
  createMakeVsBuyReport,
  createAgingCustomersReport,
  createAgingSuppliersReport,
  createInstallmentsOverviewReport,
  createInstallmentsOverdueReport,
  createVanSalesReport,
  createTrialBalanceReport,
  createIncomeStatementReport,
  createBalanceSheetReport,
  createCashFlowReport,
  createVatReturnReport,
  createWithholdingTaxReport,
  createGeneralLedgerReport,
  createAccountLedgerReport,
  OUTPUT_VAT_ACCOUNT_ID,
  INPUT_VAT_ACCOUNT_ID,
  ACCOUNT_TYPE_LABELS,
  SALES_INVOICE_ACTIVE_STATUSES,
  SALES_INVOICE_TERMINAL_STATUSES,
  moneyToNumber,
  purchaseInvoiceBaseTotal,
  salesInvoiceTotals,
  salesInvoiceBaseGrandTotal,
  type GlReportContext,
  type SalesInvoiceRepository,
  type PurchaseInvoiceRepository,
  type CustomerRepository,
  type SupplierRepository,
  type ItemRepository,
  type BomRepository,
  type WarehouseRepository,
  type StockLedgerRepository,
  type CostLayerRepository,
  type WacSnapshotRepository,
  type DocumentRepository,
  type InstallmentLine,
  type LedgerRepository,
  type AccountRepository,
  type VanTripRepository,
  type EmployeeRepository,
  type PayrollRunRepository,
  type PayslipRepository,
  type ContractRepository,
  type AttendanceRepository,
  type LeaveBalanceRepository,
  type LeavePolicyRepository,
  createPayrollRegisterReport,
  createSocialInsuranceReturnReport,
  createSalaryTaxReturnReport,
  SOCIAL_INSURANCE_CONTROL_ACCOUNT,
  SALARY_TAX_CONTROL_ACCOUNT,
  createAttendanceSummaryReport,
  createLeaveLiabilityReport,
  createHeadcountMovementReport,
  createEmployeeDirectory,
  LEAVE_LIABILITY_CONTROL_ACCOUNT,
  type RunReportOutcome,
  salesReturnGrandTotal,
  salesReturnCreditByInvoice,
  voucherBaseAmount,
  voucherBaseWithholding,
  isStandingVoucher,
  fxRevaluationNet,
  FX_REALISED_DOC_TYPE,
  type AgingCustomersContext,
  type AgingSuppliersContext,
  type AgingOpenItem,
  type HistoricalSalesArchive,
  type HistoricalPurchaseArchive,
  customerAgingBalances,
  agingBucketsTotal,
  supplierAgingBalances,
  supplierAgingTotal,
  CUSTOMER_OPENING_BALANCE_DOC_TYPE,
  SUPPLIER_OPENING_BALANCE_DOC_TYPE,
  buildPartyStatement,
  statementSides,
  type PartyStatement,
  type PartyStatementEntry,
  type ProgressCertificate,
  purchaseReturnLineCredit,
  type SalesReturnDocument,
  type PurchaseReturnLine,
  type ChequeRepository,
  type Cheque,
  type PostedLine,
  type VoucherDocument,
  purchaseReturnCreditByInvoice,
  type AllocationRepository,
  type SubcontractStore,
  type VoucherLine,
} from "@mezan/domain";
import { branchScopeOf, createAnyPermissionGate, createPermissionGate, warehouseScopeOf, withinScope, type AuthContextResolver } from "./permission-gate.js";

/**
 * التقارير — operational reports (docs/archive/catalog/08-reports.md), mounted under
 * `/reports`. Every route follows the SAME shape: fetch the real persisted
 * rows this report needs (straight off the repositories other modules
 * already use — no report-specific data duplication), hand them to the
 * report engine's `runReport()` as `ctx`, and return its outcome verbatim.
 * All aggregation/validation lives in `@mezan/domain/reports/*` — this file
 * is wiring only.
 */
export interface ReportsRoutesDeps {
  readonly salesInvoices: SalesInvoiceRepository;
  /** Allocation sub-ledger — lets the aging reports deduct what has actually been settled. */
  readonly allocatable?: AllocatableInvoiceRepository;
  /** Confirmed sales returns, so the customer aging ladder nets the credits the GL already posted. */
  readonly salesReturnDocs?: { list(filter?: { status?: "confirmed" }): Promise<readonly SalesReturnDocument[]> };
  /** Confirmed purchase returns, so the supplier aging ladder nets the debits the GL already posted. */
  readonly purchaseReturnDocs?: {
    list(filter?: { status?: "confirmed" }): Promise<
      readonly {
        readonly id: string;
        readonly docNo: string | null;
        readonly date: string;
        readonly status: string;
        readonly reversesDocId?: string | null;
        readonly lines: readonly PurchaseReturnLine[];
      }[]
    >;
  };
  /** Cheques, whose creation already reclassified a customer's receivable or a supplier's payable. */
  readonly cheques?: Pick<ChequeRepository, "list">;
  /** Confirmed vouchers, for collections that named no invoice. */
  readonly voucherDocuments?: Pick<DocumentRepository<VoucherLine>, "list">;
  /** Allocations, to tell an applied collection from an on-account one. */
  readonly allocations?: Pick<AllocationRepository, "listByVoucher">;
  readonly purchaseInvoices: PurchaseInvoiceRepository;
  /**
   * Documents imported from the previous system (x31/x32). An unsettled one
   * posts its remainder to 1105/2100 with no invoice behind it, so both
   * ladders carry it as an open item (D210).
   */
  readonly historicalArchives?: {
    sales(): Promise<readonly HistoricalSalesArchive[]>;
    purchases(): Promise<readonly HistoricalPurchaseArchive[]>;
  };
  readonly customers: CustomerRepository;
  readonly suppliers: SupplierRepository;
  readonly items: ItemRepository;
  /**
   * التصنيع أم الشراء data source. Optional: the make-vs-buy report route is
   * only mounted when a composition wires the manufacturing module's BOMs,
   * so an app without manufacturing serves no make-vs-buy report at all
   * rather than an empty one.
   */
  readonly boms?: BomRepository;
  readonly warehouses: WarehouseRepository;
  readonly stockLedger: StockLedgerRepository;
  readonly costLayers: CostLayerRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly installmentPlans: DocumentRepository<InstallmentLine>;
  /**
   * القوائم المالية data source (docs/archive/catalog/08 — الميزان/قائمة الدخل/الميزانية/
   * التدفقات/الإقرار الضريبي/الأستاذ العام/دفتر حساب). The seven financial
   * statements aggregate over the SAME posted GL the journal/dashboard read —
   * `ledger` supplies the posted entries, `accounts` the chart to classify them.
   */
  readonly ledger: LedgerRepository;
  readonly accounts: AccountRepository;
  /**
   * مبيعات المندوبين data source. Optional: the van-sales report route is only
   * mounted when a composition actually wires field sales, so an app without
   * van trips serves no van-sales report at all rather than an empty one.
   */
  readonly vanTrips?: VanTripRepository;
  /** Resolves van-trip crew ids to employee names; ids are shown verbatim when absent. */
  readonly employees?: EmployeeRepository;
  /**
   * HR data sources. Each block is optional and each gates ITS OWN routes: an
   * install without payroll serves no payroll register rather than an empty
   * one, which is the difference between "nothing to show" and "nothing built".
   */
  readonly hrPayroll?: {
    readonly runs: Pick<PayrollRunRepository, "list">;
    readonly payslips: Pick<PayslipRepository, "listByRunId">;
  };
  readonly hrContracts?: Pick<ContractRepository, "list">;
  readonly hrAttendance?: Pick<AttendanceRepository, "list">;
  readonly hrLeave?: {
    readonly balances: Pick<LeaveBalanceRepository, "list">;
    readonly policies: Pick<LeavePolicyRepository, "list">;
  };
  /**
   * مستخلصات مقاولي الباطن. Egypt's Form 41 covers tax withheld on a PAYMENT
   * and tax withheld on a certified subcontractor's bill alike; a filing
   * assembled from vouchers alone under-declares by the whole subcontract side.
   */
  readonly subCertificates?: Pick<SubcontractStore, "listCertificates">;
  /** مستخلصات: an approved one credits AR by its deductions against the invoice it raised, which a statement must show. */
  readonly progressCertificates?: { list(): Promise<readonly ProgressCertificate[]> };
  /**
   * العروض master data, for a campaign's TYPE and English name. Optional: the
   * report still runs without it — every figure comes off the invoice's own
   * recorded promotion — and the type column is simply blank.
   */
  readonly promotions?: { list(): Promise<readonly { readonly id: string; readonly nameEn: string | null; readonly type: string }[]> };
  /** ISO `YYYY-MM-DD` "today" — overridable for tests; defaults to the real date. */
  readonly today?: () => string;
}

/**
 * The control account the purchases by-item report ties back to. Kept here
 * rather than read from the account-routing table because a reconciliation must
 * compare against where the postings ACTUALLY went, not where a tenant has
 * since decided they should go.
 *
 * Sales once had a hardcoded 4100 beside it. It is gone: the sales reference is
 * now the set of accounts the counted lines themselves credited
 * (`creditedRevenueAccountIds`), which is the same fact as the report only so
 * long as it is derived from the same lines.
 */
const INVENTORY_ACCOUNT_IDS = ["1200"] as const;

/**
 * The GL control accounts the three sub-ledger reports tie back to (D112).
 *
 * Same reasoning as the two above: these are where the postings ACTUALLY went
 * (STANDARD_COA_TEMPLATE — 1105 ذمم عملاء تجارية, 2100 ذمم موردين تجاريين,
 * 1200 المخزون), not where a tenant's account-routing table has since decided
 * they should go. A reconciliation against the routing table would agree with
 * a mis-routed posting, which is the one thing it exists to catch.
 */
const RECEIVABLES_CONTROL_ACCOUNT_ID = "1105";
const PAYABLES_CONTROL_ACCOUNT_ID = "2100";
const INVENTORY_CONTROL_ACCOUNT_ID = INVENTORY_ACCOUNT_IDS[0];

/**
 * How many source documents a drill-down panel carries. Fixed here, never read
 * off the request: a limit the caller supplies is not a limit. The panel is
 * told the true total separately so it can say what it is not showing.
 */
const DRILL_DOWN_LIMIT = 25;

/**
 * Tells a contract BILLING line from a sale: true only for an account the
 * tenant's own chart holds AND classifies as something other than revenue — a
 * certificate credits مستخلصات تحت التنفيذ (liability), a retention release
 * credits the retention receivable (asset). An account the chart has never
 * heard of is NOT called a billing: a report that empties itself because the
 * chart is thin would be worse than the difference it set out to explain.
 */
async function contractBillingTest(deps: ReportsRoutesDeps): Promise<(accountId: string) => boolean> {
  const typeById = new Map((await deps.accounts.list()).map((account) => [account.id, account.type]));
  return (accountId) => {
    const type = typeById.get(accountId);
    return type !== undefined && type !== "revenue";
  };
}

function todayIso(deps: ReportsRoutesDeps): string {
  if (deps.today) return deps.today();
  // Local calendar day, not `toISOString()`: that is UTC, so it hands back
  // YESTERDAY for anyone east of Greenwich until the small hours — which is
  // everyone this product ships to.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function firstOfYear(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/**
 * The GL slice the account drill-down reads.
 *
 * REVERSED ENTRIES LOAD ALONGSIDE POSTED ONES. Reversing posts a mirror entry
 * (status `posted`) and marks the original `reversed`; loading only `posted`
 * therefore keeps the mirror and drops what it offsets, so every figure is
 * wrong by the reversal. This is the same slice
 * `financial-reports-routes.ts` loads, and the two must not diverge again —
 * they answer the same questions about the same ledger.
 */
async function loadGlContext(deps: ReportsRoutesDeps): Promise<GlReportContext> {
  const [accounts, posted, reversed] = await Promise.all([
    deps.accounts.list(),
    deps.ledger.list({ status: "posted" }),
    deps.ledger.list({ status: "reversed" }),
  ]);
  const journalEntries = [...posted, ...reversed].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { accounts, journalEntries };
}

/**
 * What a set of GL accounts took in on its NATURAL side over a date range —
 * the ledger half of a report's reconciliation (A7).
 *
 * Gross, not net, and that distinction is the whole point. Both by-item
 * reports sum what documents recorded: every sale, every purchase. The
 * matching ledger figure is therefore every credit to revenue and every debit
 * to inventory — NOT their net movement, which has had returns and cost of
 * goods sold taken back out of it and would report a difference on a set of
 * books that agree perfectly.
 */
async function postedGross(
  deps: ReportsRoutesDeps,
  accountIds: readonly string[],
  range: { dateFrom: string; dateTo: string },
  side: "debit" | "credit",
  /**
   * Restricts the ledger side to entries a given document type produced.
   * Inventory is debited by landed costs and opening balances as well as by
   * the purchase chain, so a purchases report compared against ALL inventory
   * debits reports a difference on books that agree — the figures are simply
   * not the same question. Available because journal entries carry the document
   * that made them (R6.3).
   *
   * The purchase chain needs BOTH of its document types: since D53 a receipt
   * debits inventory and its invoice clears GRNI instead, while an invoice
   * raised with no receipt behind it still debits inventory itself. Naming only
   * one of the two counts half the purchases.
   */
  sourceDocTypes?: readonly string[],
): Promise<number> {
  // One SQL aggregate where the ledger can answer it (Q-6); the fold survives
  // for in-memory ledgers and must produce the same figure.
  if (deps.ledger.sumLines) {
    const sums = await deps.ledger.sumLines({
      statuses: ["posted"],
      fromDate: range.dateFrom,
      toDate: range.dateTo,
      accountIds,
      ...(sourceDocTypes ? { sourceDocTypes } : {}),
    });
    return Number(sums[side].toString());
  }
  const entries = await deps.ledger.list({ status: "posted" });
  const allowed = new Set(accountIds);
  let total = 0;
  for (const entry of entries) {
    if (entry.date < range.dateFrom || entry.date > range.dateTo) continue;
    if (sourceDocTypes && !sourceDocTypes.includes(entry.sourceDocType ?? "")) continue;
    for (const line of entry.lines) {
      if (!allowed.has(line.accountId)) continue;
      const amount = side === "debit" ? line.debit : line.credit;
      total += amount.toScaledNumber() / 1_000_000;
    }
  }
  return total;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The balance of one GL control account on its NATURAL side, as of a date —
 * the ledger half of the reconciliation banner on أعمار ديون العملاء،
 * أعمار ديون الموردين and تقييم المخزون (D112). Until this was wired the
 * banner never rendered in the running product: the three reports declared a
 * reconciliation and no caller supplied the reference.
 *
 * Goes through `LedgerRepository.accountBalance`, which counts posted AND
 * reversed lines: reversal posts a mirror entry and leaves the original in
 * place, so a posted-only sum keeps the mirror and drops what it offsets.
 */
async function controlAccountBalance(
  deps: ReportsRoutesDeps,
  accountId: string,
  naturalSide: "debit" | "credit",
  asOfDate?: string,
): Promise<number> {
  const { balance } = await deps.ledger.accountBalance(accountId, asOfDate);
  const net = moneyToNumber(balance);
  return naturalSide === "debit" ? net : -net;
}

/**
 * The ladders age each invoice at its booked rate and revaluation restates the
 * control account without touching one, so the ladder ties to the balance net
 * of the unreversed restatement, which is shown as the reconciling item (D194).
 */
async function partyControlTie(
  deps: ReportsRoutesDeps,
  accountId: string,
  naturalSide: "debit" | "credit",
  asOfDate?: string,
): Promise<{ readonly balance: number; readonly revaluation: number }> {
  const { balance } = await deps.ledger.accountBalance(accountId, asOfDate);
  const lines = (await deps.ledger.listLines?.({ accountIds: [accountId], ...(asOfDate ? { toDate: asOfDate } : {}) })) ?? [];
  const revaluation = fxRevaluationNet(lines, accountId);
  const sign = naturalSide === "debit" ? 1n : -1n;
  return {
    balance: moneyToNumber(Money.fromScaled(sign * (balance.scaled - revaluation.scaled))),
    revaluation: moneyToNumber(Money.fromScaled(sign * revaluation.scaled)),
  };
}

function isoDateOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && ISO_DATE.test(value) ? value : undefined;
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) {
    return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  }
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
    kpis: outcome.kpis,
  });
}

/**
 * Every stock movement across every position — the shared ledger the inventory
 * reports slice differently.
 *
 * ONE query when the store can answer it (Q-6: this was a synchronous SQLite
 * round trip per position, 12,001 of them on the reference database). The
 * per-position fallback survives for stores without `listAll`, and returns the
 * array in the SAME order, which `listAll`'s contract exists to guarantee.
 */
async function loadAllMovements(deps: ReportsRoutesDeps) {
  if (deps.stockLedger.listAll) return deps.stockLedger.listAll();
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.stockLedger.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

/** Every cost layer across every position (aging + drift both need the full set). */
async function loadAllLayers(deps: ReportsRoutesDeps) {
  if (deps.costLayers.listAll) return deps.costLayers.listAll();
  const positions = await deps.stockLedger.listPositions();
  const lists = await Promise.all(positions.map((p) => deps.costLayers.listByPosition(p.itemId, p.warehouseId)));
  return lists.flat();
}

type PartyKind = "customer" | "supplier";

/**
 * What an as-of ladder needs to know about the day it is run for (D220): every
 * term must stand as it stood that day, or the ladder nets a receipt, a return
 * or a bounce that the control balance as of that day does not yet hold.
 */
interface AgingAsOf {
  readonly kind: PartyKind;
  readonly asOfDate: string;
  readonly controlId: string;
  /** Every line on the control account, whatever its date; entries are dated by them. */
  readonly controlLines: readonly PostedLine[];
  readonly entryDates: ReadonlyMap<string, string>;
  /** This side's invoices dated after `asOfDate`: an allocation to one had not been applied that day. */
  readonly laterInvoiceIds: ReadonlySet<string>;
}

function nextDay(iso: string): string {
  const at = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(at) ? iso : new Date(at + 86_400_000).toISOString().slice(0, 10);
}

async function agingAsOf(deps: ReportsRoutesDeps, kind: PartyKind, asOfDate: string): Promise<AgingAsOf> {
  const controlId = kind === "customer" ? RECEIVABLES_CONTROL_ACCOUNT_ID : PAYABLES_CONTROL_ACCOUNT_ID;
  const controlLines = (await deps.ledger.listLines?.({ accountIds: [controlId] })) ?? [];
  const entryDates = new Map<string, string>();
  for (const line of controlLines) entryDates.set(line.entryId, line.date);
  const later =
    kind === "customer"
      ? await deps.salesInvoices.list({ fromDate: nextDay(asOfDate) })
      : await deps.purchaseInvoices.list({ fromDate: nextDay(asOfDate) });
  return {
    kind,
    asOfDate,
    controlId,
    controlLines,
    entryDates,
    laterInvoiceIds: new Set(later.filter((invoice) => invoice.date > asOfDate).map((invoice) => invoice.id)),
  };
}

/**
 * Whether a voucher stood on `asOfDate`: dated on or before it, and not yet
 * reversed. A reversal's mirror carries the date the reversal posted, so a
 * voucher reversed after the snapshot still counts in it.
 */
function voucherStoodOn(doc: VoucherDocument, byId: ReadonlyMap<string, VoucherDocument>, asOfDate: string): boolean {
  if (doc.reversesDocId || doc.date > asOfDate) return false;
  if (isStandingVoucher(doc)) return true;
  if (doc.status !== "reversed") return false;
  const reversedOn = (doc.reversedByDocId ? byId.get(doc.reversedByDocId)?.date : undefined) ?? doc.date;
  return reversedOn > asOfDate;
}

/** The days a cheque's credit to its party arose and, if it bounced, was undone — read off the entries that posted them. */
function chequeDays(cheque: Cheque, asOf: AgingAsOf): { readonly raised: string; readonly undone: string | null } {
  const raised = (cheque.creationJournalEntryId ? asOf.entryDates.get(cheque.creationJournalEntryId) : undefined) ?? cheque.issueDate;
  if (cheque.status !== "bounced" && cheque.status !== "replaced") return { raised, undone: null };
  const undone = (cheque.bounceJournalEntryId ? asOf.entryDates.get(cheque.bounceJournalEntryId) : undefined) ?? cheque.bouncedAt?.slice(0, 10) ?? raised;
  return { raised, undone };
}

interface UnappliedTerms {
  /** Per party: what its receipts (or payments) standing on the day had not applied to an invoice of that day. */
  readonly unapplied: ReadonlyMap<string, Money>;
  /** Per invoice: what a receipt (or payment) dated after the day has since applied to it. */
  readonly settledAfter: ReadonlyMap<string, Money>;
}

/**
 * Party credits (customer) or debits (supplier) that no invoice claims on the
 * day: a live cheque written against the control account and the unallocated
 * remainder of a standing collection or payment. The ladder nets them oldest
 * bucket first (D37, D193).
 */
async function unappliedPartyTerms(deps: ReportsRoutesDeps, asOf: AgingAsOf): Promise<UnappliedTerms> {
  const unapplied = new Map<string, bigint>();
  const settledAfter = new Map<string, bigint>();
  const direction = asOf.kind === "customer" ? "incoming" : "outgoing";

  const source = async (id: string, partyId: string | null | undefined, amount: bigint, date: string, standing: boolean) => {
    const active = ((await deps.allocations?.listByVoucher(id)) ?? []).filter((alloc) => alloc.status === "active");
    if (date > asOf.asOfDate) {
      for (const alloc of active) settledAfter.set(alloc.invoiceId, (settledAfter.get(alloc.invoiceId) ?? 0n) + alloc.amount.scaled);
      return;
    }
    if (!standing || !partyId) return;
    const applied = active.filter((alloc) => !asOf.laterInvoiceIds.has(alloc.invoiceId)).reduce((sum, alloc) => sum + alloc.amount.scaled, 0n);
    const left = amount - applied;
    if (left > 0n) unapplied.set(partyId, (unapplied.get(partyId) ?? 0n) + left);
  };

  for (const cheque of (await deps.cheques?.list({ direction })) ?? []) {
    if (cheque.direction !== direction || cheque.counterpartyGlAccountId !== asOf.controlId) continue;
    const { raised, undone } = chequeDays(cheque, asOf);
    await source(cheque.id, cheque.partyId, cheque.amount.scaled, raised, undone === null || undone > asOf.asOfDate);
  }

  const vouchers = (await deps.voucherDocuments?.list()) ?? [];
  const byId = new Map(vouchers.map((doc) => [doc.id, doc]));
  const voucherDirection = asOf.kind === "customer" ? "receipt" : "payment";
  for (const doc of vouchers) {
    if (doc.reversesDocId) continue;
    const line = doc.lines[0];
    if (!line || line.direction !== voucherDirection || line.counterpartyGlAccountId !== asOf.controlId) continue;
    if (!isStandingVoucher(doc) && doc.status !== "reversed") continue;
    const partyId = asOf.kind === "customer" ? line.customerId : line.supplierId;
    await source(doc.id, partyId, voucherBaseAmount(line).scaled, doc.date, voucherStoodOn(doc, byId, asOf.asOfDate));
  }

  const toMoney = (map: Map<string, bigint>) => new Map([...map].map(([id, scaled]) => [id, Money.fromScaled(scaled)]));
  return { unapplied: toMoney(unapplied), settledAfter: toMoney(settledAfter) };
}

const OPENING_ENTRY_ID = { customer: /^OB-CUST-JE:(.+?)(?::v\d+)?(?::REV)?$/, supplier: /^OB-SUPP-JE:(.+?)(?::v\d+)?(?::REV)?$/ } as const;

/**
 * The party an opening-balance line belongs to. Books written before D204
 * carry no document type on the entry, but its id has always been
 * `OB-CUST-JE:<party>` / `OB-SUPP-JE:<party>` (`:v<n>` for a correction,
 * `:REV` for the reversal of a superseded one) — D223.
 */
function openingPartyOf(line: PostedLine, kind: PartyKind): string | null {
  const docType = kind === "customer" ? CUSTOMER_OPENING_BALANCE_DOC_TYPE : SUPPLIER_OPENING_BALANCE_DOC_TYPE;
  if (line.sourceDocType === docType && line.sourceDocId) return line.sourceDocId;
  return OPENING_ENTRY_ID[kind].exec(line.entryId)?.[1] ?? null;
}

/**
 * What the control account holds for a party that no invoice carries: its
 * opening balance (D204), dated by the entries that posted it (D223), every
 * manual journal line that names it (D205), the open remainder of an imported
 * document (D210) and a refund paid back across the control account (D211).
 * Signed on the party's natural side.
 */
async function partyOpenItems(
  deps: ReportsRoutesDeps,
  asOf: AgingAsOf,
  parties: readonly { readonly id: string; readonly openingBalance?: Money; readonly branchId?: string | null }[],
): Promise<AgingOpenItem[]> {
  const { kind, controlId } = asOf;
  const sign = kind === "customer" ? 1n : -1n;
  const items: AgingOpenItem[] = [];
  const openingByPartyDay = new Map<string, Map<string, bigint>>();
  for (const line of asOf.controlLines) {
    const amount = sign * (line.debit.scaled - line.credit.scaled);
    if (line.partyId) {
      // A realised exchange difference is carried by the allocation that
      // produced it — the voucher it used up and the invoice it relieved — so
      // it is no open item of its own (D221).
      if (line.sourceDocType !== FX_REALISED_DOC_TYPE) {
        items.push({ partyId: line.partyId, source: "journal", reference: line.entryNo ?? line.entryId, date: line.date, amount: Money.fromScaled(amount), branchId: line.branchId });
      }
      continue;
    }
    const partyId = openingPartyOf(line, kind);
    if (!partyId) continue;
    const days = openingByPartyDay.get(partyId) ?? new Map<string, bigint>();
    days.set(line.date, (days.get(line.date) ?? 0n) + amount);
    openingByPartyDay.set(partyId, days);
  }
  for (const party of parties) {
    const posted = openingByPartyDay.get(party.id);
    if (posted) {
      for (const [date, scaled] of posted) {
        if (scaled !== 0n) items.push({ partyId: party.id, source: "opening", date, amount: Money.fromScaled(scaled), branchId: party.branchId ?? null });
      }
      continue;
    }
    const opening = party.openingBalance ?? Money.zero();
    if (opening.scaled === 0n) continue;
    items.push({ partyId: party.id, source: "opening", date: todayIso(deps), amount: opening, branchId: party.branchId ?? null });
  }
  const archives =
    kind === "customer"
      ? ((await deps.historicalArchives?.sales()) ?? []).map((a) => ({ ...a, partyId: a.customerId, isReturn: a.docType === "SALES_RETURN" }))
      : ((await deps.historicalArchives?.purchases()) ?? []).map((a) => ({ ...a, partyId: a.supplierId, isReturn: a.docType === "PURCHASE_RETURN" }));
  for (const archive of archives) {
    if (archive.settled || archive.remainingBalance.scaled === 0n) continue;
    items.push({
      partyId: archive.partyId,
      source: "imported",
      reference: archive.originalNumber,
      date: archive.date,
      dueDate: archive.dueDate,
      amount: archive.isReturn ? archive.remainingBalance.negate() : archive.remainingBalance,
    });
  }
  // Money paid back to a customer, or refunded by a supplier, across the
  // control account: it reopens the balance a return or an overpayment closed.
  const refundDirection = kind === "customer" ? "payment" : "receipt";
  const vouchers = (await deps.voucherDocuments?.list()) ?? [];
  const byId = new Map(vouchers.map((doc) => [doc.id, doc]));
  for (const doc of vouchers) {
    if (!voucherStoodOn(doc, byId, asOf.asOfDate)) continue;
    const line = doc.lines[0];
    if (!line || line.direction !== refundDirection || line.counterpartyGlAccountId !== controlId) continue;
    const partyId = kind === "customer" ? line.customerId : line.supplierId;
    if (!partyId) continue;
    items.push({ partyId, source: "refund", reference: doc.docNo ?? doc.id, date: doc.date, amount: voucherBaseAmount(line), branchId: line.branchId ?? null });
  }
  return items;
}

/**
 * Invoices voided or cancelled after the snapshot were still live on it: their
 * posting stood on the control account until the reversal, dated by the
 * reversal's own line (it carries the invoice as its source document, D199).
 */
function liveOnTheDay<T extends { readonly id: string }>(voided: readonly T[], asOf: AgingAsOf): T[] {
  const undoneOn = new Map<string, string>();
  for (const line of asOf.controlLines) {
    if (!line.sourceDocId) continue;
    const undoes = asOf.kind === "customer" ? line.credit.scaled > 0n : line.debit.scaled > 0n;
    if (!undoes) continue;
    const seen = undoneOn.get(line.sourceDocId);
    if (!seen || line.date > seen) undoneOn.set(line.sourceDocId, line.date);
  }
  return voided.filter((invoice) => (undoneOn.get(invoice.id) ?? "") > asOf.asOfDate);
}

/** The one place the ladder's netting terms are built; the customers screen must not get its own (D195). */
async function agingCustomersTerms(
  deps: ReportsRoutesDeps,
  invoices: readonly { readonly id: string }[],
  given?: AgingAsOf,
): Promise<Omit<AgingCustomersContext, "invoices" | "receivablesControlBalance" | "fxRevaluationOnControl">> {
  const asOf = given ?? (await agingAsOf(deps, "customer", todayIso(deps)));
  const asOfDate = asOf.asOfDate;
  const [returns, terms, customers, allocatedByInvoiceId] = await Promise.all([
    returnsByInvoiceId(deps, asOfDate),
    unappliedPartyTerms(deps, asOf),
    deps.customers.findAll(),
    settledByInvoiceId(deps, invoices),
  ]);
  const openItems = await partyOpenItems(deps, asOf, customers);
  return {
    customers,
    allocatedByInvoiceId,
    settledAfterAsOfByInvoiceId: terms.settledAfter,
    returnsByInvoiceId: returns,
    unappliedCreditsByCustomerId: terms.unapplied,
    openItems,
  };
}

/** Each customer's row total on today's customer aging ladder, every branch (D195). */
export async function customerAgingOwed(deps: ReportsRoutesDeps): Promise<ReadonlyMap<string, Money>> {
  const asOfDate = todayIso(deps);
  const invoices = await deps.salesInvoices.list({ statusIn: [...SALES_INVOICE_ACTIVE_STATUSES], toDate: asOfDate });
  const balances = customerAgingBalances({ asOfDate, branchId: "" }, { invoices, ...(await agingCustomersTerms(deps, invoices, await agingAsOf(deps, "customer", asOfDate))) });
  return new Map([...balances].map(([customerId, row]) => [customerId, agingBucketsTotal(row)]));
}

/** The supplier ladder's netting terms, shared by the report and the suppliers screen (D201). */
async function agingSuppliersTerms(
  deps: ReportsRoutesDeps,
  invoices: readonly { readonly id: string }[],
  given?: AgingAsOf,
): Promise<Omit<AgingSuppliersContext, "invoices" | "payablesControlBalance" | "fxRevaluationOnControl">> {
  const asOf = given ?? (await agingAsOf(deps, "supplier", todayIso(deps)));
  const asOfDate = asOf.asOfDate;
  const [suppliers, returns, terms, allocatedByInvoiceId] = await Promise.all([
    deps.suppliers.findAll(),
    purchaseReturnsByInvoiceId(deps, asOfDate),
    unappliedPartyTerms(deps, asOf),
    settledByInvoiceId(deps, invoices),
  ]);
  const openItems = await partyOpenItems(deps, asOf, suppliers);
  return {
    suppliers,
    allocatedByInvoiceId,
    settledAfterAsOfByInvoiceId: terms.settledAfter,
    returnsByInvoiceId: returns,
    unappliedDebitsBySupplierId: terms.unapplied,
    openItems,
  };
}

/** Each supplier's row total on today's supplier aging ladder, every branch — what the suppliers screen shows as owed (D201). */
export async function supplierAgingOwed(deps: ReportsRoutesDeps): Promise<ReadonlyMap<string, Money>> {
  const asOfDate = todayIso(deps);
  const invoices = await deps.purchaseInvoices.list({ status: "confirmed", toDate: asOfDate });
  const balances = supplierAgingBalances({ asOfDate, branchId: "" }, { invoices, ...(await agingSuppliersTerms(deps, invoices, await agingAsOf(deps, "supplier", asOfDate))) });
  return new Map([...balances].map(([supplierId, row]) => [supplierId, supplierAgingTotal(row)]));
}

/** Confirmed purchase-return debit per source invoice, attributed line by line, as of a day. */
async function purchaseReturnsByInvoiceId(deps: ReportsRoutesDeps, asOfDate?: string): Promise<ReadonlyMap<string, Money>> {
  const docs = (await deps.purchaseReturnDocs?.list({ status: "confirmed" })) ?? [];
  return purchaseReturnCreditByInvoice(docs.filter((doc) => !asOfDate || doc.date <= asOfDate));
}

/**
 * Confirmed sales-return credit per source invoice, line by line — the figure
 * the invoice screen nets from its remaining balance (D219).
 */
async function salesReturnCreditsByInvoiceId(deps: ReportsRoutesDeps): Promise<ReadonlyMap<string, Money>> {
  const docs = (await deps.salesReturnDocs?.list({ status: "confirmed" })) ?? [];
  return salesReturnCreditByInvoice(docs.filter((doc) => !doc.reversesDocId));
}

/** Confirmed sales-return credit per source invoice, as of a day. */
async function returnsByInvoiceId(deps: ReportsRoutesDeps, asOfDate: string): Promise<ReadonlyMap<string, Money>> {
  const out = new Map<string, bigint>();
  for (const doc of (await deps.salesReturnDocs?.list({ status: "confirmed" })) ?? []) {
    if (doc.status !== "confirmed" || doc.reversesDocId || doc.date > asOfDate) continue;
    const invoiceId = doc.lines[0]?.sourceInvoiceId;
    if (!invoiceId) continue;
    out.set(invoiceId, (out.get(invoiceId) ?? 0n) + salesReturnGrandTotal(doc).scaled);
  }
  return new Map([...out].map(([id, scaled]) => [id, Money.fromScaled(scaled)]));
}

/**
 * How much of each of these invoices the allocation sub-ledger records as
 * settled.
 *
 * It asks by ID, never through `listOpen`: that query is `total > allocated`,
 * so a FULLY settled invoice is absent from its result, the caller reads the
 * missing entry as zero allocated, and the document is reported as owing its
 * whole value. Sales survived it because `aging.customers` falls back to the
 * invoice's own `amountPaid`; a purchase invoice carries no such counter, so
 * `aging.suppliers` restated every paid supplier bill as outstanding (D66).
 */
async function settledByInvoiceId(
  deps: ReportsRoutesDeps,
  invoices: readonly { readonly id: string }[],
): Promise<ReadonlyMap<string, Money>> {
  if (!deps.allocatable) return new Map();
  return deps.allocatable.allocatedByIds(invoices.map((invoice) => invoice.id));
}

/**
 * The branches a report may cover (P-7).
 *
 * `branchScopeOf` is the SCOPE — what this session is allowed to see at all —
 * and `?branchId=` is a presentation filter that may only narrow it. A
 * `branchId` the session may not see resolves to no branches rather than
 * widening the scope, which is the whole point of a scope.
 */
function reportBranches(c: Context): readonly string[] | undefined {
  const scope = branchScopeOf(c);
  const requested = (c.req.query("branchId") ?? "").trim();
  if (requested === "" || requested === "*") return scope;
  if (scope && !scope.includes(requested)) return [];
  return [requested];
}

export function createReportsRoutes(
  deps: ReportsRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);

  /** Rows already in hand, narrowed to the branches this report may cover (P-7). */
  function scopedRows<T extends { readonly branchId?: string | null }>(c: Context, rows: readonly T[]): readonly T[] {
    return withinScope(rows, reportBranches(c), (r) => r.branchId);
  }

  /**
   * An instalment plan carries no branch of its own; its branch is the branch
   * of the sales invoice it was raised against, which is a resolution, not a
   * guess. A plan whose source invoice is gone stays unattributed.
   */
  async function scopedPlans<T extends { readonly lines: readonly { readonly sourceInvoiceId: string }[] }>(
    c: Context,
    plans: readonly T[],
  ): Promise<readonly T[]> {
    const branches = reportBranches(c);
    if (!branches) return plans;
    const branchByInvoiceId = new Map((await deps.salesInvoices.list()).map((i) => [i.id, i.branchId]));
    return withinScope(plans, branches, (p) => {
      const sourceId = p.lines[0]?.sourceInvoiceId;
      return sourceId ? branchByInvoiceId.get(sourceId) ?? null : null;
    });
  }

  function queryParams(c: Context): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of new URL(c.req.url).searchParams) out[key] = value;
    return out;
  }

  /**
   * The sales invoices this caller may see (D111).
   *
   * `branchScopeOf` is AUTHORITY, not a presentation filter: a caller scoped
   * to فرع القاهرة never receives another branch's figures, with or without a
   * `branchId` parameter, and the parameter — applied inside the report's own
   * `run` — can only narrow what is left. Asking for a branch outside the
   * scope therefore returns that caller's own nothing rather than the other
   * branch's numbers. Same line every list route in this package holds.
   */
  async function scopedSalesInvoices(c: Context, bounds?: Parameters<SalesInvoiceRepository["list"]>[0]) {
    return withinScope(await deps.salesInvoices.list(bounds), branchScopeOf(c), (invoice) => invoice.branchId);
  }

  /** The purchase invoices this caller may see. See {@link scopedSalesInvoices}. */
  async function scopedPurchaseInvoices(c: Context, bounds?: Parameters<PurchaseInvoiceRepository["list"]>[0]) {
    return withinScope(await deps.purchaseInvoices.list(bounds), branchScopeOf(c), (invoice) => invoice.branchId);
  }

  /**
   * The warehouse ids this request may see, or `undefined` for all of them.
   *
   * Branch scope reaches stock ONLY through the warehouse holding it — a
   * movement, a cost layer and a WAC snapshot each carry a warehouse and never
   * a branch — so a branch-scoped caller's stock scope is the intersection of
   * their branches' warehouses with any warehouse scope they also carry.
   */
  async function stockScopeOf(c: Context): Promise<readonly string[] | undefined> {
    const branches = branchScopeOf(c);
    const warehouses = warehouseScopeOf(c);
    if (!branches) return warehouses;
    const inBranch = (await deps.warehouses.findAll())
      .filter((warehouse) => branches.includes(warehouse.branchId))
      .map((warehouse) => warehouse.id);
    return warehouses ? inBranch.filter((id) => warehouses.includes(id)) : inBranch;
  }

  /**
   * Whether this run covers fewer than all branches — because the caller is
   * scoped, or because they asked for one branch.
   *
   * It decides whether the GL reconciliation reference is offered at all. A
   * control account holds the WHOLE company, so comparing a one-branch ladder
   * against it reports a difference on books that agree perfectly, and a
   * banner that cries wolf on every run is one nobody reads. A branch-level
   * control balance would need a branch on the journal entry, which the GL
   * does not carry.
   */
  function branchNarrowed(c: Context, params: { readonly branchId?: unknown }): boolean {
    return branchScopeOf(c) !== undefined || (typeof params.branchId === "string" && params.branchId !== "");
  }

  /** As {@link branchNarrowed}, plus the warehouse dimension the stock reports also narrow on. */
  function stockNarrowed(c: Context, params: { readonly branchId?: unknown; readonly warehouseId?: unknown }): boolean {
    return (
      branchNarrowed(c, params) ||
      warehouseScopeOf(c) !== undefined ||
      (typeof params.warehouseId === "string" && params.warehouseId !== "")
    );
  }

  // --- المبيعات ------------------------------------------------------

  app.get("/sales/by-period", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByPeriodReport(firstOfMonth(today), today);
    const invoices = await scopedSalesInvoices(c);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, allocatedByInvoiceId }),
    );
  });

  app.get("/sales/by-item", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByItemReport(firstOfMonth(today), today);
    const [invoices, items, isContractBilling] = await Promise.all([
      scopedSalesInvoices(c),
      deps.items.list(),
      contractBillingTest(deps),
    ]);
    const allocatedByInvoiceId = await settledByInvoiceId(deps, invoices);
    const params = { ...definition.defaultParams, ...queryParams(c) };
    // The ledger side is company-wide, so it is only a valid reference for a
    // company-wide run — see `branchNarrowed`. It sums exactly the accounts the
    // lines the report counted credited, so both halves read one fact.
    const range = params as { dateFrom: string; dateTo: string };
    const postedRevenue = branchNarrowed(c, params)
      ? undefined
      : await postedGross(
          deps,
          creditedRevenueAccountIds(invoices, range.dateFrom, range.dateTo, isContractBilling),
          range,
          "credit",
          ["SALES_INVOICE"],
        );
    return respond(
      c,
      runReport(definition, params, {
        invoices,
        items,
        allocatedByInvoiceId,
        isContractBilling,
        postedRevenue: postedRevenue === undefined ? undefined : () => postedRevenue,
      }),
    );
  });

  app.get("/sales/by-customer", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesByCustomerReport(firstOfMonth(today), today);
    const [invoices, customers, returnsByInvoiceId] = await Promise.all([scopedSalesInvoices(c), deps.customers.findAll(), salesReturnCreditsByInvoiceId(deps)]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, customers, returnsByInvoiceId }));
  });

  app.get("/sales/by-salesperson", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createSalesBySalespersonReport(firstOfMonth(today), today);
    const [invoices, returnsByInvoiceId] = await Promise.all([scopedSalesInvoices(c), salesReturnCreditsByInvoiceId(deps)]);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, returnsByInvoiceId }));
  });

  app.get("/sales/top-products", gate("sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createTopProductsReport(firstOfMonth(today), today);
    const [invoices, items, isContractBilling] = await Promise.all([
      scopedSalesInvoices(c),
      deps.items.list(),
      contractBillingTest(deps),
    ]);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, items, isContractBilling }),
    );
  });

  /**
   * تقرير العروض — the promotions report (docs/archive/catalog/08-reports.md:87,
   * fully specified in 01-sales.md §"تقرير العروض"). The one catalogue report
   * with no route at all (P-8).
   *
   * What it answers: how much was given away through promotions in a period,
   * per campaign, net of what the returns handed back. Every figure comes off
   * documents that were actually posted — the promotion the invoice RECORDED
   * (`appliedPromotion`, stamped at confirm), never a re-evaluation of today's
   * campaign rules against yesterday's invoice, which would restate history
   * every time someone edits a promotion.
   *
   * «خصم معكوس» is pro-rated per returned line: a return of 3 of the 10 units
   * a promotion discounted reverses three tenths of that line's discount. The
   * alternative — reversing a campaign's whole discount on any return against
   * the invoice — overstates the reversal and can drive the net negative.
   *
   * Money is summed in `Money` and converted once per emitted figure, at the
   * response boundary.
   */
  app.get("/sales/offers", gateAny("sales.promotion.view", "sales.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const params = { dateFrom: firstOfMonth(today), dateTo: today, ...queryParams(c) };
    if (!ISO_DATE.test(params.dateFrom) || !ISO_DATE.test(params.dateTo)) {
      return c.json(
        {
          error: "VALIDATION_ERROR",
          errors: [
            ...(ISO_DATE.test(params.dateFrom) ? [] : [{ path: "dateFrom", messageAr: "تاريخ غير صالح" }]),
            ...(ISO_DATE.test(params.dateTo) ? [] : [{ path: "dateTo", messageAr: "تاريخ غير صالح" }]),
          ],
        },
        400,
      );
    }

    const [allInvoices, promotions, returns] = await Promise.all([
      deps.salesInvoices.list(),
      deps.promotions?.list() ?? Promise.resolve([]),
      deps.salesReturnDocs?.list() ?? Promise.resolve([]),
    ]);
    const invoices = scopedRows(c, allInvoices);

    const promotionById = new Map(promotions.map((promotion) => [promotion.id, promotion]));

    interface Agg {
      code: string;
      nameAr: string;
      nameEn: string | null;
      type: string;
      uses: number;
      granted: Money;
      reversed: Money;
    }
    const byPromotion = new Map<string, Agg>();
    /** Invoices in range that carry a promotion — the only ones a return can reverse against. */
    const inRange = new Map<string, (typeof invoices)[number]>();

    for (const invoice of invoices) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
      if (invoice.date < params.dateFrom || invoice.date > params.dateTo) continue;
      const applied = invoice.appliedPromotion;
      if (!applied) continue;
      inRange.set(invoice.id, invoice);
      const master = promotionById.get(applied.promotionId);
      const existing = byPromotion.get(applied.promotionId) ?? {
        code: applied.code,
        nameAr: applied.nameAr,
        nameEn: master?.nameEn ?? null,
        type: master?.type ?? "",
        uses: 0,
        granted: Money.zero(),
        reversed: Money.zero(),
      };
      existing.uses += 1;
      existing.granted = existing.granted.add(applied.discountTotal);
      byPromotion.set(applied.promotionId, existing);
    }

    for (const doc of returns) {
      if (doc.status !== "confirmed") continue;
      if (doc.date < params.dateFrom || doc.date > params.dateTo) continue;
      for (const line of doc.lines) {
        const invoice = inRange.get(line.sourceInvoiceId);
        const applied = invoice?.appliedPromotion;
        if (!invoice || !applied) continue;
        const agg = byPromotion.get(applied.promotionId);
        if (!agg) continue;
        const discountedForItem = Money.sum(
          applied.lineDiscounts.filter((d) => d.itemId === line.itemId).map((d) => d.amount),
        );
        if (discountedForItem.scaled === 0n) continue;
        const invoicedQty = invoice.lines
          .filter((l) => l.itemId === line.itemId)
          .reduce<bigint>((total, l) => total + l.qty.scaled, 0n);
        if (invoicedQty === 0n) continue;
        const share = (discountedForItem.scaled * line.qty.scaled) / invoicedQty;
        agg.reversed = agg.reversed.add(Money.fromScaled(share));
      }
    }

    const rows = [...byPromotion.entries()]
      .map(([promotionId, agg]) => ({
        promotionId,
        code: agg.code,
        nameAr: agg.nameAr,
        nameEn: agg.nameEn,
        type: agg.type,
        uses: agg.uses,
        granted: moneyToNumber(agg.granted),
        reversed: moneyToNumber(agg.reversed),
        net: moneyToNumber(Money.fromScaled(agg.granted.scaled - agg.reversed.scaled)),
      }))
      .sort((a, b) => b.net - a.net);

    const sum = (pick: (row: (typeof rows)[number]) => number): number => rows.reduce((total, row) => total + pick(row), 0);

    return c.json({
      params,
      rows,
      groups: [],
      grandTotals: {
        uses: sum((r) => r.uses),
        granted: sum((r) => r.granted),
        reversed: sum((r) => r.reversed),
        net: sum((r) => r.net),
      },
      reconciliation: null,
      kpis: [
        { key: "promotionsUsed", labelAr: "عروض مستخدمة", format: "qty" as const, value: rows.length },
        { key: "uses", labelAr: "عدد مرات الاستخدام", format: "qty" as const, value: sum((r) => r.uses) },
        { key: "granted", labelAr: "إجمالي الخصم الممنوح", format: "money" as const, value: sum((r) => r.granted) },
        { key: "net", labelAr: "صافي الخصم", format: "money" as const, value: sum((r) => r.net) },
      ],
    });
  });

  // --- المشتريات -----------------------------------------------------

  app.get("/purchases/by-period", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByPeriodReport(firstOfMonth(today), today);
    const invoices = await scopedPurchaseInvoices(c);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices }));
  });

  app.get("/purchases/by-supplier", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesBySupplierReport(firstOfMonth(today), today);
    const [invoices, suppliers] = await Promise.all([scopedPurchaseInvoices(c), deps.suppliers.findAll()]);
    const [allocatedByInvoiceId, returnsByInvoiceId] = await Promise.all([settledByInvoiceId(deps, invoices), purchaseReturnsByInvoiceId(deps)]);
    return respond(
      c,
      runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { invoices, suppliers, allocatedByInvoiceId, returnsByInvoiceId }),
    );
  });

  app.get("/purchases/by-item", gate("purchases.invoice.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createPurchasesByItemReport(firstOfMonth(today), today);
    const [invoices, items] = await Promise.all([scopedPurchaseInvoices(c), deps.items.list()]);
    const params = { ...definition.defaultParams, ...queryParams(c) };
    const postedInventory = branchNarrowed(c, params)
      ? undefined
      : await postedGross(deps, INVENTORY_ACCOUNT_IDS, params as { dateFrom: string; dateTo: string }, "debit", ["PURCHASE_INVOICE", "PURCHASE_RECEIPT"]);
    return respond(
      c,
      runReport(definition, params, {
        invoices,
        items,
        postedInventory: postedInventory === undefined ? undefined : () => postedInventory,
      }),
    );
  });

  // --- المخزون -------------------------------------------------------

  app.get("/inventory/stock-levels", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryStockLevelsReport();
    const [items, allSnapshots, warehouses] = await Promise.all([deps.items.list(), deps.wacSnapshots.list(), deps.warehouses.findAll()]);
    const snapshots = withinScope(allSnapshots, await stockScopeOf(c), (s) => s.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots, warehouses }));
  });

  app.get("/inventory/goods-in-transit", gate("inventory.stock.view"), async (c) => {
    const definition = createGoodsInTransitReport();
    const [items, allSnapshots, warehouses] = await Promise.all([deps.items.list(), deps.wacSnapshots.list(), deps.warehouses.findAll()]);
    const snapshots = withinScope(allSnapshots, await stockScopeOf(c), (s) => s.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots, warehouses }));
  });

  app.get("/inventory/movement", gate("inventory.stock.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createInventoryMovementReport(firstOfMonth(today), today);
    const [allMovements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    const movements = withinScope(allMovements, await stockScopeOf(c), (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/ledger", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryLedgerReport();
    const [allMovements, items, warehouses] = await Promise.all([loadAllMovements(deps), deps.items.list(), deps.warehouses.findAll()]);
    const movements = withinScope(allMovements, await stockScopeOf(c), (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { movements, items, warehouses }));
  });

  app.get("/inventory/valuation", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryValuationReport();
    const params = { ...definition.defaultParams, ...queryParams(c) };
    const [items, allSnapshots, warehouses] = await Promise.all([deps.items.list(), deps.wacSnapshots.list(), deps.warehouses.findAll()]);
    const snapshots = withinScope(allSnapshots, await stockScopeOf(c), (s) => s.warehouseId);
    // The valuation this report sums from the stock sub-ledger must equal what
    // every receipt, issue, adjustment and landed cost posted to inventory —
    // the single test that proves the costing engine (D112).
    const inventoryControl = stockNarrowed(c, params)
      ? undefined
      : await controlAccountBalance(deps, INVENTORY_CONTROL_ACCOUNT_ID, "debit");
    return respond(
      c,
      runReport(definition, params, {
        items,
        snapshots,
        warehouses,
        inventoryControlBalance: inventoryControl === undefined ? undefined : () => inventoryControl,
      }),
    );
  });

  app.get("/inventory/aging", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryAgingReport(todayIso(deps));
    const [items, warehouses, allLayers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    const layers = withinScope(allLayers, await stockScopeOf(c), (layer) => layer.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/expiring", gate("inventory.stock.view"), async (c) => {
    const definition = createInventoryExpiringReport(todayIso(deps));
    const [items, warehouses, allLayers] = await Promise.all([deps.items.list(), deps.warehouses.findAll(), loadAllLayers(deps)]);
    const layers = withinScope(allLayers, await stockScopeOf(c), (layer) => layer.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, warehouses, layers }));
  });

  app.get("/inventory/slow-moving", gate("inventory.stock.view"), async (c) => {
    const definition = createInventorySlowMovingReport(todayIso(deps));
    const [items, allSnapshots, invoices, warehouses] = await Promise.all([
      deps.items.list(),
      deps.wacSnapshots.list(),
      scopedSalesInvoices(c),
      deps.warehouses.findAll(),
    ]);
    const snapshots = withinScope(allSnapshots, await stockScopeOf(c), (s) => s.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, snapshots, invoices, warehouses }));
  });

  app.get("/inventory/drift", gate("inventory.valuation.view"), async (c) => {
    const definition = createInventoryDriftReport();
    const [allSnapshots, allMovements, items, warehouses] = await Promise.all([
      deps.wacSnapshots.list(),
      loadAllMovements(deps),
      deps.items.list(),
      deps.warehouses.findAll(),
    ]);
    const stockScope = await stockScopeOf(c);
    const snapshots = withinScope(allSnapshots, stockScope, (s) => s.warehouseId);
    const movements = withinScope(allMovements, stockScope, (m) => m.warehouseId);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { snapshots, movements, items, warehouses }));
  });

  // --- التصنيع أم الشراء -----------------------------------------------

  if (deps.boms) {
    const boms = deps.boms;
    app.get("/manufacturing/make-vs-buy", gate("manufacturing.bom.view"), async (c) => {
      const definition = createMakeVsBuyReport();
      const [items, bomList, invoices] = await Promise.all([deps.items.list(), boms.list(), scopedPurchaseInvoices(c)]);
      return respond(
        c,
        runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { items, boms: bomList, purchaseInvoices: invoices }),
      );
    });
  }

  // --- الموارد البشرية والرواتب ----------------------------------------
  //
  // An employee carries a branch and nothing else in HR does, so branch scope
  // (D111) reaches payslips, attendance and leave balances through the
  // employee they belong to.

  const hrEmployees = deps.employees;

  async function scopedEmployeeIds(c: Context): Promise<ReadonlySet<string> | null> {
    const branches = reportBranches(c);
    if (!branches || !hrEmployees) return null;
    return new Set(withinScope(await hrEmployees.list(), branches, (e) => e.branchId).map((e) => e.id));
  }

  function inScope<T extends { readonly employeeId: string }>(rows: readonly T[], ids: ReadonlySet<string> | null): T[] {
    return ids === null ? [...rows] : rows.filter((row) => ids.has(row.employeeId));
  }

  async function controlBalance(accountId: string): Promise<Money> {
    let scaled = 0n;
    for (const entry of await deps.ledger.list({ status: "posted" })) {
      for (const line of entry.lines) {
        if (line.accountId === accountId) scaled += line.credit.scaled - line.debit.scaled;
      }
    }
    return Money.fromScaled(scaled);
  }

  const hrPayroll = deps.hrPayroll;
  if (hrPayroll && hrEmployees) {
    const directory = createEmployeeDirectory(hrEmployees);
    app.get("/hr/payroll-register", gate("hr.payroll.view"), async (c) => {
      const definition = createPayrollRegisterReport();
      const ids = await scopedEmployeeIds(c);
      const runs = await hrPayroll.runs.list();
      const payslips = (await Promise.all(runs.map((run) => hrPayroll.payslips.listByRunId(run.id)))).flat();
      const employees = await directory.list();
      return respond(
        c,
        runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, {
          runs,
          payslips: inScope(payslips, ids),
          employees,
        }),
      );
    });

    // The two statutory returns reconcile to their control account only when
    // they cover the whole company: the account holds every branch.
    async function statutoryReturnContext(c: Context, account: string) {
      const ids = await scopedEmployeeIds(c);
      const runs = await hrPayroll!.runs.list();
      const payslips = (await Promise.all(runs.map((run) => hrPayroll!.payslips.listByRunId(run.id)))).flat();
      const glBalancesByAccountId = branchNarrowed(c, queryParams(c)) ? undefined : new Map([[account, await controlBalance(account)]]);
      return { runs, payslips: inScope(payslips, ids), employees: await directory.list(), glBalancesByAccountId };
    }

    app.get("/hr/social-insurance-return", gate("hr.payroll.view"), async (c) => {
      const definition = createSocialInsuranceReturnReport();
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, await statutoryReturnContext(c, SOCIAL_INSURANCE_CONTROL_ACCOUNT)));
    });

    app.get("/hr/salary-tax-return", gate("hr.payroll.view"), async (c) => {
      const definition = createSalaryTaxReturnReport();
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, await statutoryReturnContext(c, SALARY_TAX_CONTROL_ACCOUNT)));
    });
  }

  const hrAttendance = deps.hrAttendance;
  if (hrAttendance && hrEmployees) {
    app.get("/hr/attendance-summary", gate("hr.attendance.view"), async (c) => {
      const definition = createAttendanceSummaryReport();
      const ids = await scopedEmployeeIds(c);
      const [employees, attendance] = await Promise.all([hrEmployees.list(), hrAttendance.list()]);
      return respond(
        c,
        runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, {
          employees: ids === null ? employees : employees.filter((e) => ids.has(e.id)),
          attendance: inScope(attendance, ids),
        }),
      );
    });
  }

  const hrContracts = deps.hrContracts;
  const hrLeave = deps.hrLeave;
  if (hrContracts && hrLeave && hrEmployees) {
    app.get("/hr/leave-liability", gate("hr.leave.view"), async (c) => {
      const definition = createLeaveLiabilityReport();
      const params = { ...definition.defaultParams, asOfDate: todayIso(deps), ...queryParams(c) };
      const ids = await scopedEmployeeIds(c);
      const [employees, contracts, balances, policies] = await Promise.all([
        hrEmployees.list(),
        hrContracts.list(),
        hrLeave.balances.list(),
        hrLeave.policies.list(),
      ]);
      // The control account holds the whole company, so a branch-narrowed run
      // is not compared against it.
      const glBalancesByAccountId = branchNarrowed(c, queryParams(c))
        ? undefined
        : new Map([[LEAVE_LIABILITY_CONTROL_ACCOUNT, await controlBalance(LEAVE_LIABILITY_CONTROL_ACCOUNT)]]);
      return respond(
        c,
        runReport(definition, params, {
          employees,
          contracts,
          balances: inScope(balances, ids),
          policies,
          glBalancesByAccountId,
        }),
      );
    });
  }

  if (hrEmployees) {
    app.get("/hr/headcount-movement", gate("hr.employee.view"), async (c) => {
      const definition = createHeadcountMovementReport();
      const employees = withinScope(await hrEmployees.list(), reportBranches(c), (e) => e.branchId);
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { employees }));
    });
  }

  // --- أعمار الديون ---------------------------------------------------

  app.get("/aging/customers", gate("sales.invoice.view"), async (c) => {
    const definition = createAgingCustomersReport(todayIso(deps));
    const params = { ...definition.defaultParams, ...queryParams(c) };
    // The ladder drops every invoice that is not live and every one dated after
    // the snapshot, so both bounds belong in SQL rather than in a fold over the
    // whole table (Q-6). The set here must stay exactly the report's own.
    const asOfDate = isoDateOrUndefined(params.asOfDate) ?? todayIso(deps);
    const live = await scopedSalesInvoices(c, { statusIn: [...SALES_INVOICE_ACTIVE_STATUSES], toDate: asOfDate });
    const asOf = await agingAsOf(deps, "customer", asOfDate);
    const voided = liveOnTheDay(
      await scopedSalesInvoices(c, { statusIn: [...SALES_INVOICE_TERMINAL_STATUSES], toDate: asOfDate }),
      asOf,
    ).map((invoice) => ({ ...invoice, status: "confirmed" as const }));
    const invoices = [...live, ...voided];
    const terms = await agingCustomersTerms(deps, invoices, asOf);
    // The ladder walks invoices; 1105 holds what those invoices, their
    // collections and their returns actually posted. Two independent paths to
    // one number — a difference means one of them is wrong (D112).
    const receivablesControl = branchNarrowed(c, params)
      ? undefined
      : await partyControlTie(deps, RECEIVABLES_CONTROL_ACCOUNT_ID, "debit", isoDateOrUndefined(params.asOfDate));
    return respond(
      c,
      runReport(definition, params, {
        invoices,
        ...terms,
        receivablesControlBalance: receivablesControl === undefined ? undefined : () => receivablesControl.balance,
        fxRevaluationOnControl: receivablesControl === undefined ? undefined : () => receivablesControl.revaluation,
      }),
    );
  });

  app.get("/aging/suppliers", gate("purchases.invoice.view"), async (c) => {
    const definition = createAgingSuppliersReport(todayIso(deps));
    const params = { ...definition.defaultParams, ...queryParams(c) };
    // Same two bounds as the customer ladder, and the same rule: the SQL set
    // must be exactly what the report itself would have kept (Q-6).
    const asOfDate = isoDateOrUndefined(params.asOfDate) ?? todayIso(deps);
    const live = await scopedPurchaseInvoices(c, { status: "confirmed" as const, toDate: asOfDate });
    const asOf = await agingAsOf(deps, "supplier", asOfDate);
    const cancelled = liveOnTheDay(
      await scopedPurchaseInvoices(c, { status: "cancelled" as const, toDate: asOfDate }),
      asOf,
    ).map((invoice) => ({ ...invoice, status: "confirmed" as const }));
    const invoices = [...live, ...cancelled];
    const terms = await agingSuppliersTerms(deps, invoices, asOf);
    const payablesControl = branchNarrowed(c, params)
      ? undefined
      : await partyControlTie(deps, PAYABLES_CONTROL_ACCOUNT_ID, "credit", isoDateOrUndefined(params.asOfDate));
    return respond(
      c,
      runReport(definition, params, {
        invoices,
        ...terms,
        payablesControlBalance: payablesControl === undefined ? undefined : () => payablesControl.balance,
        fxRevaluationOnControl: payablesControl === undefined ? undefined : () => payablesControl.revaluation,
      }),
    );
  });

  // --- كشف حساب العميل / المورد ------------------------------------------
  // Built from the aging ladder's own terms, in base currency, so a party's
  // statement closes on exactly their ladder row (D200, D201, D204, D205).

  async function voucherAllocations(voucherId: string, invoiceRefs: ReadonlyMap<string, string>) {
    const active = (await deps.allocations?.listByVoucher(voucherId)) ?? [];
    return active
      .filter((alloc) => alloc.status === "active")
      .map((alloc) => ({ invoiceRef: invoiceRefs.get(alloc.invoiceId) ?? alloc.invoiceId, amount: alloc.amount }));
  }

  function openItemEntries(items: readonly AgingOpenItem[], partyId: string, asOfDate: string): PartyStatementEntry[] {
    return items
      .filter((item) => item.partyId === partyId && item.date <= asOfDate)
      .map((item, index) => ({
        key: `${item.source}-${index}`,
        date: item.date,
        kind: item.source === "refund" ? "refund" : item.source,
        reference: item.reference ?? "",
        ...statementSides(item.amount),
      }));
  }

  /**
   * The realised exchange differences posted against a party (D221): each
   * restates what the party's voucher or cheque settled to the invoice's booked
   * rate, so without them the statement closes that far from the ladder.
   */
  async function realisedFxEntries(controlId: string, partyId: string, asOfDate: string, sign: 1n | -1n): Promise<PartyStatementEntry[]> {
    const lines = (await deps.ledger.listLines?.({ accountIds: [controlId], toDate: asOfDate })) ?? [];
    return lines
      .filter((line) => line.sourceDocType === FX_REALISED_DOC_TYPE && line.partyId === partyId)
      .map((line) => ({
        key: `fx-${line.entryId}`,
        date: line.date,
        kind: "fx_difference" as const,
        reference: line.entryNo ?? line.entryId,
        ...statementSides(Money.fromScaled(sign * (line.debit.scaled - line.credit.scaled))),
      }));
  }

  function serializeStatement(partyId: string, asOfDate: string, statement: PartyStatement, agingTotal: Money) {
    return {
      partyId,
      asOfDate,
      lines: statement.lines.map((line) => ({
        key: line.key,
        date: line.date,
        kind: line.kind,
        reference: line.reference,
        increase: line.increase.toString(),
        decrease: line.decrease.toString(),
        balance: line.balance.toString(),
        allocations: (line.allocations ?? []).map((a) => ({ invoiceRef: a.invoiceRef, amount: a.amount.toString() })),
      })),
      totalIncrease: statement.totalIncrease.toString(),
      totalDecrease: statement.totalDecrease.toString(),
      closing: statement.closing.toString(),
      agingTotal: agingTotal.toString(),
    };
  }

  app.get("/statements/customers/:id", gate("sales.customer.view"), async (c) => {
    const id = c.req.param("id");
    const customer = await deps.customers.findById(id);
    if (!customer || withinScope([customer], branchScopeOf(c), (row) => row.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    const asOfDate = todayIso(deps);
    const invoices = (await scopedSalesInvoices(c, { statusIn: [...SALES_INVOICE_ACTIVE_STATUSES], toDate: asOfDate })).filter(
      (invoice) => invoice.customerId === id,
    );
    const asOf = await agingAsOf(deps, "customer", asOfDate);
    const terms = await agingCustomersTerms(deps, invoices, asOf);
    const invoiceRefs = new Map(invoices.map((invoice) => [invoice.id, invoice.docNo ?? invoice.id]));
    const entries: PartyStatementEntry[] = invoices.map((invoice) => ({
      key: `inv-${invoice.id}`,
      date: invoice.date,
      kind: "invoice",
      reference: invoice.docNo ?? invoice.id,
      increase: salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate),
      decrease: Money.zero(),
    }));
    for (const doc of (await deps.salesReturnDocs?.list({ status: "confirmed" })) ?? []) {
      if (doc.status !== "confirmed" || doc.date > asOfDate || !invoiceRefs.has(doc.lines[0]?.sourceInvoiceId ?? "")) continue;
      entries.push({ key: `ret-${doc.id}`, date: doc.date, kind: "return", reference: doc.docNo ?? doc.id, increase: Money.zero(), decrease: salesReturnGrandTotal(doc) });
    }
    for (const doc of (await deps.voucherDocuments?.list({ status: "confirmed" })) ?? []) {
      if (!isStandingVoucher(doc) || doc.date > asOfDate) continue;
      const line = doc.lines[0];
      if (!line || line.direction !== "receipt" || line.counterpartyGlAccountId !== RECEIVABLES_CONTROL_ACCOUNT_ID || line.customerId !== id) continue;
      entries.push({
        key: `vch-${doc.id}`,
        date: doc.date,
        kind: "receipt",
        reference: doc.docNo ?? doc.id,
        increase: Money.zero(),
        decrease: voucherBaseAmount(line),
        allocations: await voucherAllocations(doc.id, invoiceRefs),
      });
    }
    for (const cheque of (await deps.cheques?.list({ direction: "incoming" })) ?? []) {
      if (cheque.direction !== "incoming" || cheque.counterpartyGlAccountId !== RECEIVABLES_CONTROL_ACCOUNT_ID || cheque.partyId !== id) continue;
      const days = chequeDays(cheque, asOf);
      if (days.raised > asOfDate) continue;
      entries.push({ key: `chq-${cheque.id}`, date: days.raised, kind: "cheque", reference: cheque.chequeNumber, increase: Money.zero(), decrease: cheque.amount });
      if (days.undone !== null && days.undone <= asOfDate) {
        entries.push({
          key: `chq-back-${cheque.id}`,
          date: days.undone,
          kind: "cheque_returned",
          reference: cheque.chequeNumber,
          increase: cheque.amount,
          decrease: Money.zero(),
        });
      }
    }
    for (const certificate of (await deps.progressCertificates?.list()) ?? []) {
      if (!certificate.invoiceId || !invoiceRefs.has(certificate.invoiceId) || certificate.postedDeductionsTotal.scaled === 0n) continue;
      entries.push({
        key: `ded-${certificate.id}`,
        date: (certificate.approvedAt ?? certificate.periodTo).slice(0, 10),
        kind: "deduction",
        reference: certificate.docNo,
        increase: Money.zero(),
        decrease: certificate.postedDeductionsTotal,
      });
    }
    entries.push(...openItemEntries(terms.openItems ?? [], id, asOfDate));
    entries.push(...(await realisedFxEntries(RECEIVABLES_CONTROL_ACCOUNT_ID, id, asOfDate, 1n)));
    const row = customerAgingBalances({ asOfDate, branchId: "" }, { invoices, ...terms }).get(id);
    return c.json(serializeStatement(id, asOfDate, buildPartyStatement(entries), row ? agingBucketsTotal(row) : Money.zero()));
  });

  app.get("/statements/suppliers/:id", gate("purchases.supplier.view"), async (c) => {
    const id = c.req.param("id");
    const supplier = await deps.suppliers.findById(id);
    if (!supplier || withinScope([supplier], branchScopeOf(c), (row) => row.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
    const asOfDate = todayIso(deps);
    const invoices = (await scopedPurchaseInvoices(c, { status: "confirmed", toDate: asOfDate })).filter(
      (invoice) => invoice.supplierId === id,
    );
    const asOf = await agingAsOf(deps, "supplier", asOfDate);
    const terms = await agingSuppliersTerms(deps, invoices, asOf);
    const invoiceRefs = new Map(invoices.map((invoice) => [invoice.id, invoice.number ?? invoice.id]));
    const entries: PartyStatementEntry[] = invoices.map((invoice) => ({
      key: `inv-${invoice.id}`,
      date: invoice.date,
      kind: "invoice",
      reference: invoice.number ?? invoice.id,
      increase: purchaseInvoiceBaseTotal(invoice),
      decrease: Money.zero(),
    }));
    for (const doc of (await deps.purchaseReturnDocs?.list({ status: "confirmed" })) ?? []) {
      if (doc.status !== "confirmed" || doc.reversesDocId || doc.date > asOfDate) continue;
      const mine = doc.lines.filter((line) => line.sourceInvoiceId && invoiceRefs.has(line.sourceInvoiceId));
      if (mine.length === 0) continue;
      entries.push({
        key: `ret-${doc.id}`,
        date: doc.date,
        kind: "return",
        reference: doc.docNo ?? doc.id,
        increase: Money.zero(),
        decrease: Money.sum(mine.map(purchaseReturnLineCredit)),
      });
    }
    for (const doc of (await deps.voucherDocuments?.list({ status: "confirmed" })) ?? []) {
      if (!isStandingVoucher(doc) || doc.date > asOfDate) continue;
      const line = doc.lines[0];
      if (!line || line.direction !== "payment" || line.counterpartyGlAccountId !== PAYABLES_CONTROL_ACCOUNT_ID || line.supplierId !== id) continue;
      entries.push({
        key: `vch-${doc.id}`,
        date: doc.date,
        kind: "payment",
        reference: doc.docNo ?? doc.id,
        increase: Money.zero(),
        decrease: voucherBaseAmount(line),
        allocations: await voucherAllocations(doc.id, invoiceRefs),
      });
    }
    for (const cheque of (await deps.cheques?.list({ direction: "outgoing" })) ?? []) {
      if (cheque.direction !== "outgoing" || cheque.counterpartyGlAccountId !== PAYABLES_CONTROL_ACCOUNT_ID || cheque.partyId !== id) continue;
      const days = chequeDays(cheque, asOf);
      if (days.raised > asOfDate) continue;
      entries.push({ key: `chq-${cheque.id}`, date: days.raised, kind: "cheque", reference: cheque.chequeNumber, increase: Money.zero(), decrease: cheque.amount });
      if (days.undone !== null && days.undone <= asOfDate) {
        entries.push({
          key: `chq-back-${cheque.id}`,
          date: days.undone,
          kind: "cheque_returned",
          reference: cheque.chequeNumber,
          increase: cheque.amount,
          decrease: Money.zero(),
        });
      }
    }
    for (const certificate of (await deps.subCertificates?.listCertificates()) ?? []) {
      if (!certificate.invoiceId || !invoiceRefs.has(certificate.invoiceId) || certificate.postedDeductionsTotal.scaled === 0n) continue;
      entries.push({
        key: `ded-${certificate.id}`,
        date: (certificate.approvedAt ?? certificate.periodTo).slice(0, 10),
        kind: "deduction",
        reference: certificate.docNo,
        increase: Money.zero(),
        decrease: certificate.postedDeductionsTotal,
      });
    }
    entries.push(...openItemEntries(terms.openItems ?? [], id, asOfDate));
    entries.push(...(await realisedFxEntries(PAYABLES_CONTROL_ACCOUNT_ID, id, asOfDate, -1n)));
    const row = supplierAgingBalances({ asOfDate, branchId: "" }, { invoices, ...terms }).get(id);
    return c.json(serializeStatement(id, asOfDate, buildPartyStatement(entries), row ? supplierAgingTotal(row) : Money.zero()));
  });

  // --- الأقساط ---------------------------------------------------------

  app.get("/installments/overview", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverviewReport(todayIso(deps));
    const [allPlans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    const plans = await scopedPlans(c, allPlans);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  app.get("/installments/overdue", gate("installments.plan.view"), async (c) => {
    const definition = createInstallmentsOverdueReport(todayIso(deps));
    const [allPlans, customers] = await Promise.all([deps.installmentPlans.list(), deps.customers.findAll()]);
    const plans = await scopedPlans(c, allPlans);
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { plans, customers }));
  });

  // --- المبيعات الميدانية ------------------------------------------------

  if (deps.vanTrips) {
    const vanTrips = deps.vanTrips;
    app.get("/field/van-sales", gate("field.van_trip.view"), async (c) => {
      const today = todayIso(deps);
      const definition = createVanSalesReport(firstOfMonth(today), today);
      const [allTrips, employees] = await Promise.all([vanTrips.list(), deps.employees?.list() ?? []]);
      const trips = withinScope(allTrips, branchScopeOf(c), (trip) => trip.branchId);
      return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { trips, employees }));
    });
  }

  // --- القوائم المالية — Financial statements (docs/archive/catalog/08) -------------
  // The seven statements below all compute from the REAL posted GL (loadGlContext),
  // never a fixture ledger. Each recreates the SAME `ReportDefinition` the web
  // screen renders through, so params/columns/reconciliation can never drift.

  app.get("/tax/withholding", gate("accounting.reports.view"), async (c) => {
    const today = todayIso(deps);
    const definition = createWithholdingTaxReport(firstOfYear(today), today);
    const [allVouchers, suppliers] = await Promise.all([
      deps.voucherDocuments?.list({ status: "confirmed" }) ?? Promise.resolve([]),
      deps.suppliers.findAll(),
    ]);
    // A voucher's branch lives on its single line (vouchers-routes.ts scopes
    // the register the same way).
    const vouchers = withinScope(allVouchers, branchScopeOf(c), (doc) => doc.lines[0]?.branchId);
    const supplierName = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    const rows = vouchers.flatMap((doc) => {
      // A reversal's mirror is a confirmed document with the same line; the
      // tax it withheld was un-withheld by that very reversal (D200).
      if (!isStandingVoucher(doc)) return [];
      const line = doc.lines[0];
      if (!line || !line.withholdingAmount || line.withholdingAmount.scaled <= 0n) return [];
      return [{
        voucherId: doc.id,
        voucherNo: doc.docNo,
        date: doc.date,
        partyId: line.supplierId,
        partyNameAr: (line.supplierId && supplierName.get(line.supplierId)) || "—",
        grossAmount: voucherBaseAmount(line),
        ratePercent: line.withholdingRatePercent ?? null,
        withheldAmount: voucherBaseWithholding(line),
      }];
    });
    // The subcontract half: the tax was withheld when the certificate was
    // approved for payment, on the certified value, and is owed to the
    // authority from that date whether or not the sub has been paid yet.
    const certificates = (await deps.subCertificates?.listCertificates()) ?? [];
    for (const certificate of certificates) {
      if (certificate.status !== "approved_for_payment" && certificate.status !== "invoiced") continue;
      const row = certificate.computed.deductions.find((d) => d.key === "withholdingTax");
      if (!row || row.thisCertificate.scaled <= 0n) continue;
      rows.push({
        voucherId: certificate.id,
        voucherNo: certificate.docNo,
        date: certificate.approvedAt ?? certificate.executionDate,
        partyId: certificate.supplierId,
        partyNameAr: supplierName.get(certificate.supplierId) || certificate.supplierId,
        grossAmount: certificate.computed.thisCertificateNetCertified,
        ratePercent: row.percent === null ? null : Number(row.percent),
        withheldAmount: row.thisCertificate,
      });
    }
    return respond(c, runReport(definition, { ...definition.defaultParams, ...queryParams(c) }, { rows }));
  });

  // --- التفاصيل — drill-down from an entity cell (A5) ----------------------
  // A report row is an aggregate. The only honest answer to "what is this
  // figure made of" is the documents that produced it, resolved here from the
  // posted records — never re-sliced in the browser out of the loaded page.

  app.get("/drill-down/customer/:id", gate("sales.customer.view"), async (c) => {
    const id = c.req.param("id");
    const [customers, invoices, returned] = await Promise.all([deps.customers.findAll(), scopedSalesInvoices(c), salesReturnCreditsByInvoiceId(deps)]);
    const customer = customers.find((entry) => entry.id === id);
    if (!customer) return c.json({ error: "NOT_FOUND" }, 404);
    const own = invoices
      .filter((invoice) => invoice.customerId === id && SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status))
      .sort((a, b) => b.date.localeCompare(a.date));
    let outstanding = 0n;
    let billed = 0n;
    for (const invoice of own) {
      const total = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
      billed += total.scaled;
      const balance = total.scaled - invoice.amountPaid.scaled - (returned.get(invoice.id)?.scaled ?? 0n);
      if (balance > 0n) outstanding += balance;
    }
    return c.json({
      kind: "customer",
      id,
      titleAr: customer.nameAr,
      subtitleAr: customer.code,
      facts: [
        { key: "phone", labelAr: "الهاتف", value: customer.phone ?? "—" },
        { key: "creditLimit", labelAr: "حد الائتمان", value: customer.creditLimit.toString(), format: "money" },
        { key: "billed", labelAr: "إجمالي المفوتر", value: (Number(billed) / 1e6).toFixed(2), format: "money" },
        { key: "outstanding", labelAr: "المستحق", value: (Number(outstanding) / 1e6).toFixed(2), format: "money" },
      ],
      documents: own.slice(0, DRILL_DOWN_LIMIT).map((invoice) => ({
        id: invoice.id,
        docNo: invoice.docNo ?? invoice.id,
        date: invoice.date,
        type: "SALES_INVOICE",
        status: invoice.status,
        amount: moneyToNumber(salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate)),
        amountFormat: "money",
      })),
      documentCount: own.length,
    });
  });

  app.get("/drill-down/supplier/:id", gate("purchases.supplier.view"), async (c) => {
    const id = c.req.param("id");
    const [suppliers, invoices] = await Promise.all([deps.suppliers.findAll(), scopedPurchaseInvoices(c)]);
    const supplier = suppliers.find((entry) => entry.id === id);
    if (!supplier) return c.json({ error: "NOT_FOUND" }, 404);
    const own = invoices
      .filter((invoice) => invoice.supplierId === id && invoice.status === "confirmed")
      .sort((a, b) => b.date.localeCompare(a.date));
    let billed = 0n;
    for (const invoice of own) billed += purchaseInvoiceBaseTotal(invoice).scaled;
    return c.json({
      kind: "supplier",
      id,
      titleAr: supplier.nameAr,
      subtitleAr: supplier.code,
      facts: [
        { key: "phone", labelAr: "الهاتف", value: supplier.phone ?? "—" },
        { key: "paymentTermsDays", labelAr: "مهلة السداد (يوم)", value: String(supplier.paymentTermsDays), format: "qty" },
        { key: "billed", labelAr: "إجمالي المشتريات", value: (Number(billed) / 1e6).toFixed(2), format: "money" },
        { key: "invoiceCount", labelAr: "عدد الفواتير", value: String(own.length), format: "qty" },
      ],
      documents: own.slice(0, DRILL_DOWN_LIMIT).map((invoice) => ({
        id: invoice.id,
        docNo: invoice.number,
        date: invoice.date,
        type: "PURCHASE_INVOICE",
        status: invoice.status,
        amount: moneyToNumber(purchaseInvoiceBaseTotal(invoice)),
        amountFormat: "money",
      })),
      documentCount: own.length,
    });
  });

  app.get("/drill-down/item/:id", gate("inventory.item.view"), async (c) => {
    const id = c.req.param("id");
    const [items, snapshots] = await Promise.all([deps.items.list(), deps.wacSnapshots.list()]);
    const item = items.find((entry) => entry.id === id);
    if (!item) return c.json({ error: "NOT_FOUND" }, 404);
    const stockScope = await stockScopeOf(c);
    const positions = withinScope(
      snapshots.filter((snapshot) => snapshot.itemId === id),
      stockScope,
      (snapshot) => snapshot.warehouseId,
    );
    let onHand = 0n;
    let value = 0n;
    for (const position of positions) {
      onHand += position.onHand.scaled;
      value += position.totalValue.scaled;
    }
    const movements = withinScope(await loadAllMovements(deps), stockScope, (movement) => movement.warehouseId)
      .filter((movement) => movement.itemId === id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return c.json({
      kind: "item",
      id,
      titleAr: item.nameAr,
      subtitleAr: item.code,
      facts: [
        { key: "unit", labelAr: "الوحدة", value: item.baseUnitCode },
        { key: "onHand", labelAr: "المخزون الحالي", value: (Number(onHand) / 1e6).toString(), format: "qty" },
        { key: "value", labelAr: "قيمة المخزون", value: (Number(value) / 1e6).toFixed(2), format: "money" },
        { key: "warehouseCount", labelAr: "عدد المستودعات", value: String(positions.length), format: "qty" },
      ],
      documents: movements.slice(0, DRILL_DOWN_LIMIT).map((movement) => ({
        id: movement.sourceDocId,
        docNo: movement.sourceDocNumber ?? movement.sourceDocId,
        date: movement.occurredAt.slice(0, 10),
        type: "STOCK_MOVEMENT",
        status: movement.direction,
        amount: Number(movement.qty.toString()),
        amountFormat: "qty",
      })),
      documentCount: movements.length,
    });
  });

  app.get("/drill-down/account/:id", gate("accounting.reports.view"), async (c) => {
    const id = c.req.param("id");
    const ctx = await loadGlContext(deps);
    const account = ctx.accounts.find((entry) => entry.id === id);
    if (!account) return c.json({ error: "NOT_FOUND" }, 404);
    let debit = 0n;
    let credit = 0n;
    const touching: { id: string; docNo: string; date: string; net: bigint }[] = [];
    for (const entry of ctx.journalEntries) {
      let net = 0n;
      let touched = false;
      for (const line of entry.lines) {
        if (line.accountId !== id) continue;
        touched = true;
        debit += line.debit.scaled;
        credit += line.credit.scaled;
        net += line.debit.scaled - line.credit.scaled;
      }
      if (touched) touching.push({ id: entry.id, docNo: entry.entryNo ?? entry.id, date: entry.date, net });
    }
    touching.sort((a, b) => b.date.localeCompare(a.date));
    return c.json({
      kind: "account",
      id,
      titleAr: account.nameAr,
      subtitleAr: account.code,
      facts: [
        { key: "type", labelAr: "نوع الحساب", value: ACCOUNT_TYPE_LABELS[account.type] },
        { key: "debit", labelAr: "إجمالي المدين", value: (Number(debit) / 1e6).toFixed(2), format: "money" },
        { key: "credit", labelAr: "إجمالي الدائن", value: (Number(credit) / 1e6).toFixed(2), format: "money" },
        { key: "balance", labelAr: "الرصيد", value: (Number(debit - credit) / 1e6).toFixed(2), format: "money" },
      ],
      documents: touching.slice(0, DRILL_DOWN_LIMIT).map((entry) => ({
        id: entry.id,
        docNo: entry.docNo,
        date: entry.date,
        type: "JOURNAL_ENTRY",
        status: "posted",
        amount: Number(entry.net) / 1e6,
        amountFormat: "money",
      })),
      documentCount: touching.length,
    });
  });

  return app;
}
