import type { App } from "@mezan/api";
import { ACCOUNTS, BRANCH_ID, VAT_PERCENT, WAREHOUSE_ID, call, step } from "./shared.js";
import {
  EXPENSE_ACCOUNTS,
  HISTORY_CUSTOMERS,
  HISTORY_ITEMS,
  HISTORY_SUPPLIERS,
  MONTHLY_EXPENSES,
  type HistoryItem,
} from "./history-data.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Two and a half years of ordinary trading for the demo tenant: ~30 months of
 * purchases, sales, collections, supplier payments and monthly overheads,
 * entered through the same routes a user's clicks hit. Reports that only mean
 * something over time — year-on-year sales, aging ladders, inventory turnover,
 * a moving weighted-average cost — have nothing to show on a tenant whose
 * whole history is six weeks long.
 *
 * THREE INVARIANTS HOLD THIS TOGETHER:
 *
 * 1. It trades only in its OWN customers, suppliers and items. The
 *    `*-DEMO-*` records carry hand-authored scenarios asserted to the piastre;
 *    generating volume against them would restate every one of those figures.
 * 2. It runs BEFORE the hand-authored 2026-07 documents and ends 2026-06-30,
 *    so the ledger is written in date order. A backdated confirm would issue
 *    stock at a weighted-average cost the earlier receipt had not yet set.
 * 3. Every month buys before it sells, and `onHand` below mirrors the stock
 *    ledger so no line can issue what the warehouse does not hold —
 *    `allowNegativeStock` is off, and a confirm that oversells throws.
 */

const HISTORY_START_YEAR = 2024;
const MONTH_COUNT = 32;
/**
 * No seeded document may be dated after this. The scenario suites all work at
 * 2026-08-24 and read balances as they stand "now"; a seeded voucher dated
 * after that date is invisible to those reads but visible to any guard that
 * asks the ledger AS OF a document's own date — which is how a cash payout
 * larger than the drawer held was let through.
 */
const HISTORY_END = "2026-08-15";

/** Bank + cash the owner put in when the company opened, in piastres. */
const FOUNDING_BANK = 175_000_000;
const FOUNDING_CASH = 25_000_000;

const CASH_TREASURY_ID = "TR-DEMO-CASH";
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const SALESPEOPLE = ["EMP-DEMO-1", "EMP-DEMO-2", null] as const;
const SALESPERSON_NAMES: Record<string, string> = {
  "EMP-DEMO-1": "كريم عادل",
  "EMP-DEMO-2": "سلمى فؤاد",
};

/**
 * Deterministic PRNG (mulberry32). A seed that produced different books on
 * every run would make any figure a reviewer checked unreproducible.
 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HISTORY_RANDOM_SEED = 0x4d455a41;
let rand = makeRandom(HISTORY_RANDOM_SEED);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function between(min: number, max: number): number {
  return min + rand() * (max - min);
}

function intBetween(min: number, max: number): number {
  return Math.floor(between(min, max + 1));
}

function pickWeighted<T extends { readonly weight: number }>(items: readonly T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rand() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1]!;
}

/** Money crosses the wire as an exact decimal string, never as a float. */
function money(piastres: number): string {
  const rounded = Math.round(piastres);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function iso(year: number, month: number, day: number): string {
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return date > HISTORY_END ? HISTORY_END : date;
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

interface Month {
  readonly index: number;
  readonly year: number;
  readonly month: number;
}

function monthsInWindow(): Month[] {
  const months: Month[] = [];
  for (let index = 0; index < MONTH_COUNT; index += 1) {
    const absolute = HISTORY_START_YEAR * 12 + index;
    months.push({ index, year: Math.floor(absolute / 12), month: (absolute % 12) + 1 });
  }
  return months;
}

/**
 * Egyptian grocery demand: a Ramadan spike, the quiet high summer, a
 * back-to-school lift in September, on top of steady growth. Ramadan fell in
 * March 2024 and 2025 and in February 2026, and the stock-up happens in the
 * month BEFORE it.
 */
const RAMADAN_MONTHS = new Set(["2024-3", "2025-3", "2026-2"]);
const PRE_RAMADAN_MONTHS = new Set(["2024-2", "2025-2", "2026-1"]);

function demandFactor({ index, year, month }: Month): number {
  const growth = 1.014 ** index;
  const key = `${year}-${month}`;
  const ramadan = RAMADAN_MONTHS.has(key) ? 1.55 : PRE_RAMADAN_MONTHS.has(key) ? 1.24 : 1;
  const summer = month === 7 || month === 8 ? 0.84 : 1;
  const school = month === 9 ? 1.13 : 1;
  return growth * ramadan * summer * school;
}

/** Egyptian input-cost inflation over the window, ~7% a year. */
function priceDrift(monthIndex: number): number {
  return 1 + 0.0058 * monthIndex;
}

function costAt(item: HistoryItem, monthIndex: number): number {
  return item.costPiastres * priceDrift(monthIndex) * between(0.985, 1.015);
}

function priceAt(item: HistoryItem, monthIndex: number): number {
  return item.pricePiastres * priceDrift(monthIndex) * between(0.97, 1.03);
}

export async function seedHistory(app: App): Promise<void> {
  // INVARIANT: both `rand` and `onHand` are module state belonging to ONE
  // tenant. A second seed in the same process would otherwise continue the
  // first one's random stream (so the figures are no longer reproducible) and
  // inherit its stock balances, planning sales against stock this tenant never
  // bought — the confirm then fails NEGATIVE_STOCK partway through.
  rand = makeRandom(HISTORY_RANDOM_SEED);
  onHand.clear();
  await openFiscalYears(app);
  await seedExpenseAccounts(app);
  await seedParties(app);
  await seedItems(app);
  await seedFoundingCapital(app);
  await seedTrading(app);
}

/**
 * The bootstrap seed opens only the CURRENT year, so a 2024-dated posting has
 * no period to land in and `assertPeriodOpen` throws. Generating a year that
 * already exists answers 409, which is the right no-op — not a failure.
 */
async function openFiscalYears(app: App): Promise<void> {
  for (let year = HISTORY_START_YEAR; year <= 2026; year += 1) {
    const res = await call(app, "POST", "/fiscal-periods/generate-year", { year });
    if (!res.ok && res.status !== 409) {
      throw new Error(`[demo-seed] history: could not open ${year}: ${res.status} ${await res.text()}`);
    }
  }
}

async function seedExpenseAccounts(app: App): Promise<void> {
  for (const account of EXPENSE_ACCOUNTS) {
    await step(app, "POST", "/accounts", {
      ...account,
      type: "expense",
      naturalBalance: "debit",
      parentId: "5000",
      isHeader: false,
    });
  }
}

async function seedParties(app: App): Promise<void> {
  for (const customer of HISTORY_CUSTOMERS) {
    await step(app, "POST", "/customers", {
      id: customer.id,
      code: customer.code,
      nameAr: customer.nameAr,
      nameEn: customer.nameEn,
      phone: customer.phone,
      email: `${customer.code.toLowerCase()}@mezan-demo.example`,
      address: customer.address,
      category: customer.category,
      paymentTermsDays: customer.paymentTermsDays,
      creditLimit: customer.creditLimit,
      taxNumber: customer.taxNumber ?? null,
      etaBuyerType: customer.taxNumber ? "business" : "individual",
      currency: "EGP",
      active: true,
    });
  }
  for (const supplier of HISTORY_SUPPLIERS) {
    await step(app, "POST", "/suppliers", {
      id: supplier.id,
      code: supplier.code,
      nameAr: supplier.nameAr,
      nameEn: supplier.nameEn,
      phone: supplier.phone,
      category: supplier.category,
      addressCity: supplier.addressCity,
      paymentTermsDays: supplier.paymentTermsDays,
      currency: "EGP",
      active: true,
    });
  }
}

async function seedItems(app: App): Promise<void> {
  const endDrift = priceDrift(MONTH_COUNT - 1);
  for (const item of HISTORY_ITEMS) {
    await step(app, "POST", "/items", {
      id: item.id,
      code: item.code,
      nameAr: item.nameAr,
      nameEn: item.nameEn,
      type: "stock",
      baseUnitCode: "PCS",
      categoryId: item.categoryId,
      defaultSupplierId: HISTORY_SUPPLIERS[item.supplierIndex]!.id,
      ...(item.cartonFactor
        ? { alternateUnits: [{ code: "CTN", name: `كرتونة (${item.cartonFactor} قطعة)`, factor: item.cartonFactor }] }
        : {}),
      salePrice: money(item.pricePiastres * endDrift),
      costPrice: money(item.costPiastres * endDrift),
      taxRatePercent: VAT_PERCENT,
      trackInventory: true,
      reorderPoint: item.reorderPoint ?? null,
      reorderQty: item.reorderPoint ? item.lotSize : null,
      revenueAccountId: ACCOUNTS.revenue,
      cogsAccountId: ACCOUNTS.cogs,
      inventoryAccountId: ACCOUNTS.inventory,
    });
  }
}

/**
 * The capital the owner put in at the start of the window. Without it the
 * first two years of purchases and overheads disburse from an account that was
 * never funded, and every cash figure on the dashboard reads negative (D17).
 */
async function seedFoundingCapital(app: App): Promise<void> {
  await step(app, "POST", "/gl/journal-entries", {
    id: "JE-HIST-FOUNDING-CAPITAL",
    date: iso(HISTORY_START_YEAR, 1, 2),
    memo: "رأس المال المدفوع عند التأسيس",
    source: "manual",
    lines: [
      { accountId: ACCOUNTS.bank, debit: money(FOUNDING_BANK), credit: "0", memo: "إيداع بنكي عند التأسيس" },
      { accountId: ACCOUNTS.cash, debit: money(FOUNDING_CASH), credit: "0", memo: "نقدية بالخزينة عند التأسيس" },
      { accountId: "3100", debit: "0", credit: money(FOUNDING_BANK + FOUNDING_CASH), memo: "رأس المال المدفوع" },
    ],
  });
}

/**
 * What a just-confirmed document still owes, in piastres.
 *
 * It THROWS rather than defaulting: reading a field the DTO does not carry
 * (purchase invoices expose `remainingBalance`, never a `totals` block) made
 * every supplier payment a silent no-op and left the demo tenant owing its
 * suppliers everything it had ever bought.
 */
function outstandingOf(confirmed: unknown, documentId: string): string {
  const remaining = (confirmed as { readonly remainingBalance?: unknown } | null)?.remainingBalance;
  if (typeof remaining !== "string") {
    throw new Error(`[demo-seed] history: ${documentId} confirmed without a remainingBalance to settle against`);
  }
  return remaining;
}

/**
 * A settlement amount for a `share` of what is outstanding.
 *
 * A full settlement passes the balance back VERBATIM. `remainingBalance` is a
 * Money string at scale 1e-6, so re-deriving it through piastres rounds a
 * fraction upward and the route rejects the payment as exceeding the invoice
 * (`PAYMENT_EXCEEDS_BALANCE`). A partial one rounds DOWN, for the same reason.
 */
function settlementOf(outstanding: string, share: number): string | null {
  if (share >= 1) return Number(outstanding) > 0 ? outstanding : null;
  const piastres = Math.floor(Number(outstanding) * 100 * share);
  return piastres > 0 ? money(piastres) : null;
}

interface PlannedLine {
  readonly item: HistoryItem;
  readonly qty: number;
}

interface PlannedSale {
  readonly id: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly paymentTermsDays: number;
  readonly date: string;
  readonly lines: readonly PlannedLine[];
}

/** Base units of each item the warehouse holds; mirrors the stock ledger. */
const onHand = new Map<string, number>();

function heldOf(itemId: string): number {
  return onHand.get(itemId) ?? 0;
}

async function seedTrading(app: App): Promise<void> {
  for (const month of monthsInWindow()) {
    const sales = planSales(month);
    await postPurchases(app, month, sales);
    await postSales(app, month, sales);
    await postOverheads(app, month);
    await bankTheTakings(app, month);
  }
}

/**
 * Sweeps most of the month's cash takings into the bank.
 *
 * Without it the خزنة simply accumulates: collections arrive in cash all month
 * and almost nothing leaves it, so after two years the drawer "holds" millions
 * — a figure no real shop's safe ever shows, and one that quietly disables
 * every screen and guard that depends on a plausible cash balance.
 *
 * The amount is read back from the ledger rather than tracked here: the guard
 * that refuses an overdrawn خزنة reads the same balance, so a swept figure
 * derived from anything else would eventually exceed it.
 */
async function bankTheTakings(app: App, month: Month): Promise<void> {
  const date = iso(month.year, month.month, 28);
  // AS OF the deposit's own date, which is the balance the guard reads.
  // Collections are posted the moment their invoice is, so the drawer already
  // holds cash dated months ahead of the month being seeded; sweeping against
  // that unqualified balance pays out money the خزنة does not yet hold.
  const ledger = (await step(app, "GET", `/gl/accounts/${ACCOUNTS.cash}/ledger?asOf=${date}`)) as
    | { readonly balance?: { readonly balance?: string } }
    | undefined;
  const held = Math.floor(Number(ledger?.balance?.balance ?? "0") * 100);
  if (held < 15_000_00) return;
  const swept = Math.floor(held * 0.72);

  const id = `VCH-H-${month.year}${String(month.month).padStart(2, "0")}-DEP`;
  await step(app, "POST", "/vouchers", {
    id,
    date,
    memo: `إيداع نقدية الخزينة بالبنك — ${month.month}/${month.year}`,
    voucherType: "inter_treasury_transfer",
    amount: money(swept),
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterTreasuryAccountId: BANK_TREASURY_ID,
    counterTreasuryGlAccountId: ACCOUNTS.bank,
  });
  await step(app, "POST", `/vouchers/${id}/confirm`, {});
}

function planSales(month: Month): PlannedSale[] {
  const factor = demandFactor(month);
  const count = Math.max(8, Math.min(26, Math.round(12 * factor * between(0.85, 1.15))));
  const sales: PlannedSale[] = [];
  for (let n = 1; n <= count; n += 1) {
    const customer = pickWeighted(HISTORY_CUSTOMERS);
    const lineCount = intBetween(2, 6);
    const chosen = new Map<string, PlannedLine>();
    for (let l = 0; l < lineCount; l += 1) {
      const item = pickWeighted(HISTORY_ITEMS);
      if (chosen.has(item.id)) continue;
      const typical = Math.max(6, Math.round(item.lotSize / 3));
      const qty = Math.max(2, Math.round(typical * between(0.45, 1.75) * factor));
      chosen.set(item.id, { item, qty });
    }
    sales.push({
      id: `INV-H-${month.year}${String(month.month).padStart(2, "0")}-${String(n).padStart(2, "0")}`,
      customerId: customer.id,
      customerNameAr: customer.nameAr,
      paymentTermsDays: customer.paymentTermsDays,
      date: iso(month.year, month.month, intBetween(6, 27)),
      lines: [...chosen.values()],
    });
  }
  return sales.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Buys what the month is about to sell, plus a buffer, grouped by the item's
 * default supplier and rounded up to whole purchase lots — which is how a
 * distributor actually orders, and why closing stock is a real number rather
 * than zero.
 */
async function postPurchases(app: App, month: Month, sales: readonly PlannedSale[]): Promise<void> {
  const needed = new Map<string, number>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      needed.set(line.item.id, (needed.get(line.item.id) ?? 0) + line.qty);
    }
  }

  const bySupplier = new Map<string, PlannedLine[]>();
  for (const item of HISTORY_ITEMS) {
    const require = needed.get(item.id) ?? 0;
    const target = Math.ceil(require * 1.22);
    const shortfall = target - heldOf(item.id);
    if (shortfall <= 0) continue;
    const qty = Math.ceil(shortfall / item.lotSize) * item.lotSize;
    const supplierId = HISTORY_SUPPLIERS[item.supplierIndex]!.id;
    const lines = bySupplier.get(supplierId) ?? [];
    lines.push({ item, qty });
    bySupplier.set(supplierId, lines);
  }

  let sequence = 0;
  for (const [supplierId, lines] of bySupplier) {
    // A supplier with a long list is invoiced in two deliveries, the way a
    // real order splits across a week.
    for (const chunk of chunked(lines, 6)) {
      sequence += 1;
      const supplier = HISTORY_SUPPLIERS.find((s) => s.id === supplierId)!;
      const id = `PI-H-${month.year}${String(month.month).padStart(2, "0")}-${String(sequence).padStart(2, "0")}`;
      const date = iso(month.year, month.month, intBetween(2, 8));
      await step(app, "POST", "/purchases/invoices", {
        id,
        supplierId,
        date,
        dueDate: addDays(date, supplier.paymentTermsDays),
        supplierInvoiceNumber: `${supplier.code}/${month.year}/${String(sequence).padStart(3, "0")}`,
        branchId: BRANCH_ID,
        warehouseId: WAREHOUSE_ID,
        currency: "EGP",
        lines: chunk.map((line) => ({
          itemId: line.item.id,
          kind: "inventory",
          qty: String(line.qty),
          unitCost: money(costAt(line.item, month.index)),
          taxRatePercent: VAT_PERCENT,
        })),
      });
      const confirmed = await step(app, "POST", `/purchases/invoices/${id}/confirm`, {});
      for (const line of chunk) onHand.set(line.item.id, heldOf(line.item.id) + line.qty);
      await settleSupplier(app, id, date, supplier.paymentTermsDays, outstandingOf(confirmed, id));
    }
  }
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function postSales(app: App, month: Month, sales: readonly PlannedSale[]): Promise<void> {
  for (const sale of sales) {
    const lines = sale.lines
      .map((line) => ({ ...line, qty: Math.min(line.qty, heldOf(line.item.id)) }))
      .filter((line) => line.qty > 0);
    if (lines.length === 0) continue;

    const salespersonId = pick(SALESPEOPLE);
    await step(app, "POST", "/sales-invoices", {
      id: sale.id,
      date: sale.date,
      dueDate: addDays(sale.date, sale.paymentTermsDays),
      customerId: sale.customerId,
      customerNameAr: sale.customerNameAr,
      warehouseId: WAREHOUSE_ID,
      branchId: BRANCH_ID,
      salespersonId,
      salespersonNameAr: salespersonId ? SALESPERSON_NAMES[salespersonId]! : null,
      currency: "EGP",
      arAccountId: ACCOUNTS.receivable,
      taxAccountId: ACCOUNTS.outputVat,
      lines: lines.map((line, index) => ({
        lineId: `${sale.id}-L${index + 1}`,
        itemId: line.item.id,
        itemNameAr: line.item.nameAr,
        isStock: true,
        qty: String(line.qty),
        unitPrice: money(priceAt(line.item, month.index)),
        taxRatePercent: VAT_PERCENT,
        revenueAccountId: ACCOUNTS.revenue,
        cogsAccountId: ACCOUNTS.cogs,
        inventoryAccountId: ACCOUNTS.inventory,
      })),
    });
    const confirmed = await step(app, "POST", `/sales-invoices/${sale.id}/confirm`, {});
    for (const line of lines) onHand.set(line.item.id, heldOf(line.item.id) - line.qty);
    await settleCustomer(app, sale, outstandingOf(confirmed, sale.id));
  }
}

/**
 * How an Egyptian distributor's receivables actually age: old invoices are
 * collected, recent ones are a mix of settled, part-settled and still open,
 * and anything whose terms fall past the end of the window stays outstanding.
 * A book where every invoice is paid has no aging ladder to show.
 */
async function settleCustomer(app: App, sale: PlannedSale, outstanding: string): Promise<void> {
  if (Number(outstanding) <= 0) return;
  const dueDate = addDays(sale.date, sale.paymentTermsDays);
  const paidOn = addDays(dueDate, intBetween(-6, 12));
  if (paidOn > HISTORY_END) return;

  const settledLongAgo = addDays(sale.date, 120) < HISTORY_END;
  const roll = rand();
  const share = settledLongAgo ? (roll < 0.985 ? 1 : 0) : roll < 0.58 ? 1 : roll < 0.86 ? between(0.35, 0.7) : 0;
  const amount = settlementOf(outstanding, share);
  if (amount === null) return;
  await step(app, "POST", `/sales-invoices/${sale.id}/payments`, {
    amount,
    treasuryAccountId: rand() < 0.55 ? BANK_TREASURY_ID : CASH_TREASURY_ID,
    paymentMethod: rand() < 0.55 ? "bank" : "cash",
    date: paidOn,
    notes: share >= 1 ? "سداد كامل" : "سداد جزئي",
  });
}

async function settleSupplier(
  app: App,
  invoiceId: string,
  date: string,
  termsDays: number,
  outstanding: string,
): Promise<void> {
  if (Number(outstanding) <= 0) return;
  const paidOn = addDays(date, termsDays + intBetween(-3, 9));
  if (paidOn > HISTORY_END) return;

  const settledLongAgo = addDays(date, 120) < HISTORY_END;
  const roll = rand();
  const share = settledLongAgo ? (roll < 0.99 ? 1 : 0) : roll < 0.66 ? 1 : roll < 0.9 ? between(0.4, 0.75) : 0;
  const amount = settlementOf(outstanding, share);
  if (amount === null) return;
  await step(app, "POST", `/purchases/invoices/${invoiceId}/payments`, {
    amount,
    treasuryAccountId: BANK_TREASURY_ID,
    paymentMethod: "bank",
    date: paidOn,
    notes: share >= 1 ? "سداد كامل للمورد" : "سداد جزئي للمورد",
  });
}

/**
 * Rent, utilities, freight and marketing every month. Without them the income
 * statement is gross margin and nothing else, and no expense report, cost
 * centre split or cash-flow figure has anything below the line to show.
 */
async function postOverheads(app: App, month: Month): Promise<void> {
  let sequence = 0;
  for (const expense of MONTHLY_EXPENSES) {
    sequence += 1;
    const id = `VCH-H-${month.year}${String(month.month).padStart(2, "0")}-${sequence}`;
    const treasuryAccountId = expense.method === "bank" ? BANK_TREASURY_ID : CASH_TREASURY_ID;
    const amount = expense.basePiastres * priceDrift(month.index) * between(0.92, 1.11);
    await step(app, "POST", "/vouchers", {
      id,
      date: iso(month.year, month.month, 26 + (sequence % 3)),
      memo: `${expense.memoAr} — ${month.month}/${month.year}`,
      voucherType: "other_expense",
      amount: money(amount),
      branchId: BRANCH_ID,
      paymentMethod: expense.method,
      treasuryAccountId,
      treasuryGlAccountId: expense.method === "bank" ? ACCOUNTS.bank : ACCOUNTS.cash,
      counterpartyGlAccountId: expense.accountId,
      costCenterId: expense.costCenterId,
    });
    await step(app, "POST", `/vouchers/${id}/confirm`, {});
  }
}
