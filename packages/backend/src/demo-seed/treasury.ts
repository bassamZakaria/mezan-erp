import type { App } from "@mezan/api";
import { step, BRANCH_ID, WAREHOUSE_ID, ACCOUNTS } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Covers treasury vouchers, the cheque register, exchange rates, one
 * installment plan and two field/van-sales trips. Everything posts through
 * the same HTTP routes a user's clicks hit, so vouchers/cheques/van-trip
 * transfers all post real, balanced journal entries.
 *
 * `demo-seed.ts`'s inline `TREASURY_ACCOUNTS` block — not `CORE.treasuryAccounts`
 * from `./shared.ts` (which documents "TRA-DEMO-1/2", a naming scheme this
 * profile never actually wires up) — is what creates the two treasury
 * accounts this module builds on, under "TR-DEMO-CASH"/"TR-DEMO-BANK".
 */
const CASH_TREASURY_ID = "TR-DEMO-CASH";
const BANK_TREASURY_ID = "TR-DEMO-BANK";
const VAN_TREASURY_ID = "TR-DEMO-VAN";

const VAN_WAREHOUSE_ID = "WH-DEMO-VAN";

/** COA leaf accounts (packages/domain/src/accounts/coa-template.ts) not in shared.ts's `ACCOUNTS`, needed only here. */
const VAN_CASH_GL_ACCOUNT = "1300-2";
const CHEQUES_UNDER_COLLECTION_GL = "1320";
const CHEQUES_BOUNCED_GL = "1360";
const CHEQUES_PAYABLE_GL = "2150";
const FREIGHT_EXPENSE_GL = "5200";

function toCents(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100);
}

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.round(Math.abs(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function fractionOf(decimal: string, fraction: number): string {
  return money(Math.floor(toCents(decimal) * fraction));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface OpenInvoiceRow {
  readonly id: string;
  readonly outstanding: string;
}

/** Reads the real sub-ledger (`GET /open-invoices`) rather than guessing a total, so a voucher never over-allocates. */
async function outstandingOf(app: App, kind: "sales" | "purchase", partyId: string, invoiceId: string): Promise<string> {
  const rows = (await step(app, "GET", `/open-invoices?kind=${kind}&partyId=${partyId}`)) as OpenInvoiceRow[];
  const row = rows.find((r) => r.id === invoiceId);
  if (!row) {
    throw new Error(`[demo-seed] treasury: expected "${invoiceId}" to be open for "${partyId}"`);
  }
  return row.outstanding;
}

async function seedGlAccounts(app: App): Promise<void> {
  await step(app, "POST", "/accounts", {
    id: VAN_CASH_GL_ACCOUNT,
    code: VAN_CASH_GL_ACCOUNT,
    nameAr: "صندوق نقدي عربة التوزيع",
    nameEn: "Van Cash Box",
    type: "asset",
    naturalBalance: "debit",
    parentId: "1300",
    isHeader: false,
  });
}

async function seedTreasuryAccountAndWarehouse(app: App): Promise<void> {
  await step(app, "POST", "/treasury-accounts", {
    id: VAN_TREASURY_ID,
    code: "CASH-VAN-1",
    name: "عهدة نقدية - عربة التوزيع",
    nameEn: "Van Cash Custody",
    type: "cash",
    currency: "EGP",
    branchId: BRANCH_ID,
    glAccountId: VAN_CASH_GL_ACCOUNT,
  });
  await step(app, "POST", "/warehouses", {
    id: VAN_WAREHOUSE_ID,
    code: "WH-VAN",
    name: "عربة توزيع رقم ١",
    nameEn: "Delivery Van 1",
    branchId: BRANCH_ID,
    type: "VAN",
  });
}

/**
 * Receipt + payment vouchers, each direction with a draft and a confirmed
 * one; the two confirmed, allocatable ones settle for less than the real
 * outstanding balance of an unpaid core-profile invoice (never more).
 */
async function seedVouchers(app: App): Promise<void> {
  const collectionAmount = fractionOf(await outstandingOf(app, "sales", "CUST-DEMO-1", "INV-DEMO-1"), 0.45);
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-1",
    date: "2026-08-10",
    memo: "تحصيل دفعة من شركة الأمل للتجارة",
    voucherType: "customer_collection",
    amount: collectionAmount,
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterpartyGlAccountId: ACCOUNTS.receivable,
    customerId: "CUST-DEMO-1",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-1/confirm", {});
  await step(app, "POST", "/vouchers/VCH-DEMO-1/allocations", { invoiceId: "INV-DEMO-1", amount: collectionAmount });

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-2",
    date: "2026-08-21",
    memo: "تحصيل مبدئي من مؤسسة النور للمقاولات (بانتظار الاعتماد)",
    voucherType: "customer_collection",
    amount: "1200.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bank,
    counterpartyGlAccountId: ACCOUNTS.receivable,
    customerId: "CUST-DEMO-2",
  });

  const paymentAmount = fractionOf(await outstandingOf(app, "purchase", "SUPP-DEMO-1", "PI-DEMO-1"), 0.6);
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-3",
    date: "2026-08-11",
    memo: "سداد دفعة لمصنع الوادي الأخضر",
    voucherType: "supplier_payment",
    amount: paymentAmount,
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bank,
    counterpartyGlAccountId: ACCOUNTS.payable,
    supplierId: "SUPP-DEMO-1",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-3/confirm", {});
  await step(app, "POST", "/vouchers/VCH-DEMO-3/allocations", { invoiceId: "PI-DEMO-1", amount: paymentAmount });

  /**
   * محتاج تخصيص — one confirmed voucher of each intent with money still
   * unapplied, so the needs-allocation queues (R8.3) are not empty. An empty
   * work queue proves nothing about the screen that shows it.
   */
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-UNALLOC-IN",
    date: "2026-08-23",
    memo: "تحصيل من مجموعة الفجر التجارية بانتظار التخصيص",
    voucherType: "customer_collection",
    amount: "2500.00",
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterpartyGlAccountId: ACCOUNTS.receivable,
    customerId: "CUST-DEMO-3",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-UNALLOC-IN/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-UNALLOC-OUT",
    date: "2026-08-23",
    memo: "دفعة لشركة سياج للصناعات بانتظار التخصيص",
    voucherType: "supplier_payment",
    amount: "1500.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bank,
    counterpartyGlAccountId: ACCOUNTS.payable,
    supplierId: "SUPP-DEMO-2",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-UNALLOC-OUT/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-4",
    date: "2026-08-22",
    memo: "دفعة مبدئية لشركة سياج للصناعات (بانتظار الاعتماد)",
    voucherType: "supplier_payment",
    amount: "800.00",
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterpartyGlAccountId: ACCOUNTS.payable,
    supplierId: "SUPP-DEMO-2",
  });

  // A payment that withholds: Egypt withholds on most local B2B payments, so
  // the withholding report and GL 2210 need a real row to show (D27).
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-WHT",
    date: "2026-08-19",
    memo: "سداد لمورد خدمات بعد خصم ضريبة الخصم والتحصيل 3%",
    voucherType: "supplier_payment",
    amount: "2000.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bank,
    counterpartyGlAccountId: ACCOUNTS.payable,
    supplierId: "SUPP-DEMO-2",
    withholdingRatePercent: 3,
    withholdingAmount: "60.00",
    withholdingGlAccountId: "2210",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-WHT/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-5",
    date: "2026-08-13",
    memo: "مصروف نقل ومناولة بضاعة",
    voucherType: "other_expense",
    amount: "350.00",
    branchId: BRANCH_ID,
    paymentMethod: "cash",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterpartyGlAccountId: FREIGHT_EXPENSE_GL,
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-5/confirm", {});

  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-6",
    date: "2026-08-14",
    memo: "تحويل من الخزينة الرئيسية إلى البنك",
    voucherType: "inter_treasury_transfer",
    amount: "2000.00",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: CASH_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.cash,
    counterTreasuryAccountId: BANK_TREASURY_ID,
    counterTreasuryGlAccountId: ACCOUNTS.bank,
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-6/confirm", {});
}

/** Incoming + outgoing cheques across under_collection, collected and bounced. */
async function seedCheques(app: App): Promise<void> {
  await step(app, "POST", "/cheques", {
    id: "CHQ-DEMO-1",
    direction: "incoming",
    chequeNumber: "0451236",
    bankName: "بنك مصر",
    issueDate: today(),
    dueDate: addDays(today(), 2),
    branchId: BRANCH_ID,
    partyId: "CUST-DEMO-2",
    counterpartyGlAccountId: ACCOUNTS.receivable,
    controlAccounts: { underCollectionAccountId: CHEQUES_UNDER_COLLECTION_GL, bouncedAccountId: CHEQUES_BOUNCED_GL },
    amount: "2400.00",
  });

  await step(app, "POST", "/cheques", {
    id: "CHQ-DEMO-2",
    direction: "incoming",
    chequeNumber: "0451237",
    bankName: "البنك الأهلي المصري",
    issueDate: "2026-07-15",
    dueDate: "2026-07-30",
    branchId: BRANCH_ID,
    partyId: "CUST-DEMO-3",
    counterpartyGlAccountId: ACCOUNTS.receivable,
    controlAccounts: { underCollectionAccountId: CHEQUES_UNDER_COLLECTION_GL, bouncedAccountId: CHEQUES_BOUNCED_GL },
    amount: "3100.00",
  });
  await step(app, "POST", "/cheques/CHQ-DEMO-2/deposit", { bankTreasuryAccountId: BANK_TREASURY_ID });
  await step(app, "POST", "/cheques/CHQ-DEMO-2/collect", { bankGlAccountId: ACCOUNTS.bank });

  await step(app, "POST", "/cheques", {
    id: "CHQ-DEMO-3",
    direction: "incoming",
    chequeNumber: "0451238",
    bankName: "بنك القاهرة",
    issueDate: "2026-07-20",
    dueDate: "2026-08-05",
    branchId: BRANCH_ID,
    partyId: "CUST-DEMO-1",
    counterpartyGlAccountId: ACCOUNTS.receivable,
    controlAccounts: { underCollectionAccountId: CHEQUES_UNDER_COLLECTION_GL, bouncedAccountId: CHEQUES_BOUNCED_GL },
    amount: "1750.00",
  });
  await step(app, "POST", "/cheques/CHQ-DEMO-3/deposit", { bankTreasuryAccountId: BANK_TREASURY_ID });
  await step(app, "POST", "/cheques/CHQ-DEMO-3/bounce", {});

  await step(app, "POST", "/cheques", {
    id: "CHQ-DEMO-4",
    direction: "outgoing",
    chequeNumber: "9002014",
    bankName: "البنك الأهلي المصري",
    issueDate: "2026-07-18",
    dueDate: "2026-08-01",
    branchId: BRANCH_ID,
    partyId: "SUPP-DEMO-1",
    counterpartyGlAccountId: ACCOUNTS.payable,
    controlAccounts: { underCollectionAccountId: CHEQUES_PAYABLE_GL },
    amount: "4200.00",
  });
  await step(app, "POST", "/cheques/CHQ-DEMO-4/deposit", { bankTreasuryAccountId: BANK_TREASURY_ID });
  await step(app, "POST", "/cheques/CHQ-DEMO-4/collect", { bankGlAccountId: ACCOUNTS.bank });

  await step(app, "POST", "/cheques", {
    id: "CHQ-DEMO-5",
    direction: "outgoing",
    chequeNumber: "9002015",
    bankName: "بنك مصر",
    issueDate: today(),
    dueDate: addDays(today(), 1),
    branchId: BRANCH_ID,
    partyId: "SUPP-DEMO-2",
    counterpartyGlAccountId: ACCOUNTS.payable,
    controlAccounts: { underCollectionAccountId: CHEQUES_PAYABLE_GL },
    amount: "1600.00",
  });
}

/** Two currencies, two dates apiece, so the FX revaluation screen has spread to work with. */
async function seedExchangeRates(app: App): Promise<void> {
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-1", currency: "USD", rate: "48.90", effectiveDate: "2026-08-01", status: "approved" });
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-2", currency: "USD", rate: "49.35", effectiveDate: "2026-08-15", status: "approved" });
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-3", currency: "EUR", rate: "53.10", effectiveDate: "2026-08-01" });
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-4", currency: "EUR", rate: "53.75", effectiveDate: "2026-08-15" });
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-5", currency: "USD", rate: "49.60", effectiveDate: today() });
}

/**
 * One plan against a still-open core-profile invoice, confirmed, with the
 * overdue batch run against it. No installment line is seeded as "paid":
 * no route or service anywhere ever writes that transition — collection is
 * documented (installment-plan-document.ts) as flowing through a separate
 * treasury cash voucher that this codebase never links back to a plan line.
 */
async function seedInstallmentPlan(app: App): Promise<void> {
  const invoice = (await step(app, "GET", "/sales-invoices/INV-DEMO-3")) as {
    readonly docNo: string | null;
    readonly totals: { readonly grandTotal: string };
  };
  const downPayment = fractionOf(invoice.totals.grandTotal, 0.15);

  await step(app, "POST", "/installments/plans", {
    id: "IPLAN-DEMO-1",
    date: "2026-08-18",
    memo: "خطة تقسيط فاتورة مجموعة الفجر التجارية",
    customerId: "CUST-DEMO-3",
    sourceInvoiceId: "INV-DEMO-3",
    sourceInvoiceNumber: invoice.docNo,
    invoiceTotal: invoice.totals.grandTotal,
    downPayment,
    installmentCount: 6,
    frequency: "MONTHLY",
    startDate: "2026-08-18",
  });
  await step(app, "POST", "/installments/plans/IPLAN-DEMO-1/confirm", {});
  await step(app, "POST", "/installments/plans/overdue/process", { asOfDate: today() });
  await seedCollectionFollowUps(app);
}

/**
 * متابعة التحصيل — collection follow-ups against the plan seeded above. The
 * screen has three status chips, so one follow-up is left pending, one is
 * completed with an outcome and one is cancelled: a list that only ever holds
 * pending rows cannot demonstrate its own filters.
 */
async function seedCollectionFollowUps(app: App): Promise<void> {
  const followUps = [
    {
      id: "FUP-DEMO-1",
      customerId: "CUST-DEMO-3",
      installmentPlanId: "IPLAN-DEMO-1",
      type: "CALL",
      followUpDate: "2026-08-20",
      assignedTo: "EMP-DEMO-1",
      notes: "تذكير بقسط أغسطس",
    },
    {
      id: "FUP-DEMO-2",
      customerId: "CUST-DEMO-3",
      installmentPlanId: "IPLAN-DEMO-1",
      type: "VISIT",
      followUpDate: "2026-08-24",
      assignedTo: "EMP-DEMO-2",
      notes: "زيارة ميدانية لتحصيل المتأخر",
    },
    {
      id: "FUP-DEMO-3",
      customerId: "CUST-DEMO-2",
      installmentPlanId: null,
      type: "SMS",
      followUpDate: "2026-08-15",
      assignedTo: "EMP-DEMO-1",
      notes: "رسالة تذكير برصيد مستحق",
    },
  ];
  for (const followUp of followUps) {
    await step(app, "POST", "/installments/follow-ups", followUp);
  }
  await step(app, "POST", "/installments/follow-ups/FUP-DEMO-2/complete", {
    outcome: "تم الاتفاق على السداد يوم ٣١ أغسطس",
  });
  await step(app, "POST", "/installments/follow-ups/FUP-DEMO-3/cancel", {});
}

/**
 * One settled trip (small cash + stock variance found at settlement) and one
 * still open. `POST /field/van-trips` requires `id` in its body per
 * `openVanTripSchema` but `field-sales-routes.ts` discards it and assigns a
 * random uuid instead — a real bug in that file, out of this module's scope
 * (treasury.ts owns no other file) — so this seeder reads the real id back
 * off the response instead of assuming the id it sent.
 */
async function seedFieldSales(app: App): Promise<void> {
  // The van registry (R3.13): the vehicle owns its warehouse and its till, so
  // a trip names the van and the server derives both.
  await step(app, "POST", "/field/vans", {
    id: "VAN-DEMO-1",
    code: "VAN-01",
    nameAr: "مركبة التوزيع الأولى",
    nameEn: "Distribution van 1",
    plateNumber: "أ ب ج ١٢٣٤",
    branchId: BRANCH_ID,
    warehouseId: VAN_WAREHOUSE_ID,
    treasuryAccountId: VAN_TREASURY_ID,
  });

  const tripA = (await step(app, "POST", "/field/van-trips", {
    id: "seed-van-trip-a",
    tripNo: "TRIP-DEMO-1",
    date: "2026-08-12",
    vanId: "VAN-DEMO-1",
    sourceWarehouseId: WAREHOUSE_ID,
    sourceTreasuryAccountId: CASH_TREASURY_ID,
    openingCashFloat: "1000.00",
    crew: [
      { employeeId: "EMP-DEMO-1", role: "driver" },
      { employeeId: "EMP-DEMO-2", role: "rep" },
    ],
    loadedStock: [
      { itemId: "ITEM-DEMO-1", qty: "20" },
      { itemId: "ITEM-DEMO-3", qty: "30" },
    ],
    notes: "جولة توزيع - حي المعادي",
  })) as { readonly id: string };

  await step(app, "POST", `/field/van-trips/${tripA.id}/cash-movements`, {
    id: "seed-van-cash-mv-1",
    kind: "sale",
    amount: "200.00",
    occurredAt: "2026-08-12T10:30:00.000Z",
    notes: "بيع نقدي في الميدان",
  });

  await step(app, "POST", `/field/van-trips/${tripA.id}/settle`, {
    countedCash: "950.00",
    stockCounts: [
      { itemId: "ITEM-DEMO-1", countedQty: "18" },
      { itemId: "ITEM-DEMO-3", countedQty: "30" },
    ],
  });

  await step(app, "POST", "/field/van-trips", {
    id: "seed-van-trip-b",
    tripNo: "TRIP-DEMO-2",
    date: today(),
    vanId: "VAN-DEMO-1",
    sourceWarehouseId: WAREHOUSE_ID,
    sourceTreasuryAccountId: CASH_TREASURY_ID,
    openingCashFloat: "1500.00",
    crew: [{ employeeId: "EMP-DEMO-2", role: "rep" }],
    loadedStock: [{ itemId: "ITEM-DEMO-4", qty: "10" }],
    notes: "جولة توزيع - حي مدينة نصر (جارية)",
  });
}

/**
 * One VAT return already submitted, for a window nothing else in the seed or
 * the scenarios posts into (D29). It makes the filings surface real without
 * locking a period the rest of the demo data still writes to.
 */
async function seedVatFiling(app: App): Promise<void> {
  await step(app, "POST", "/gl/vat-filings", {
    id: "VATF-DEMO-2026-05",
    periodFrom: "2026-05-01",
    periodTo: "2026-05-31",
    netAmount: "4180.00",
    referenceNo: "ETA-VAT-2026-05-004180",
  });
}

const STATEMENT_PERIOD_START = "2026-08-01";
const STATEMENT_PERIOD_END = "2026-08-31";

/** The bank's own wording for a movement — a real statement never repeats the voucher's memo. */
function bankNarrative(index: number, moneyIn: boolean): string {
  const inbound = ["إيداع نقدي بالفرع", "تحويل وارد", "إيداع شيك محصّل", "تحويل وارد - انستاباي"];
  const outbound = ["تحويل صادر", "سحب نقدي", "شيك مصروف", "تحويل صادر - انستاباي"];
  const pool = moneyIn ? inbound : outbound;
  return pool[index % pool.length]!;
}

interface LedgerLineRow {
  readonly entryId: string;
  readonly date: string;
  readonly debit: string;
  readonly credit: string;
}

/**
 * كشف حساب بنكي واحد لشهر أغسطس ٢٠٢٦ — the bank-reconciliation workflow had a
 * screen, routes and an engine and no data at all: `/bank-statements` returned
 * an empty list on every seeded tenant, so import → match → finalize had never
 * once run end to end.
 *
 * The statement is DERIVED from the bank GL account's own posted movements, not
 * invented, so auto-match has real entries to find. Three deliberate differences
 * make the reconciliation a reconciliation rather than a formality:
 *
 *   - two movements carry the bank's value date, two days after the book date,
 *     so they match through the ±5-day tolerance rather than trivially;
 *   - two charges the books have never seen (service fee, transfer fee) stay
 *     unmatched — the "شوف الفروقات" step needs something to show;
 *   - the last book movement is left OFF the statement, the uncleared-payment
 *     side of the same difference.
 */
async function seedBankStatement(app: App): Promise<void> {
  const ledger = (await step(app, "GET", `/gl/accounts/${ACCOUNTS.bank}/ledger?asOf=${STATEMENT_PERIOD_END}`)) as {
    lines: LedgerLineRow[];
  };
  const inPeriod = ledger.lines
    .filter((line) => line.date >= STATEMENT_PERIOD_START && line.date <= STATEMENT_PERIOD_END)
    // Ordered by date then amount, NOT by entryId: most entries here carry a
    // generated uuid, so an id tiebreak would pick a different movement to leave
    // off the statement on every seed and the demo would reconcile differently
    // each run.
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        toCents(a.debit) - toCents(a.credit) - (toCents(b.debit) - toCents(b.credit)) ||
        a.entryId.localeCompare(b.entryId),
    );

  // The seed's own bank vouchers and cheque collections post here; if that ever
  // stops being true the statement would silently become a file of two fees, so
  // refuse rather than seed a statement with nothing to reconcile against.
  if (inPeriod.length < 3) {
    throw new Error(
      `[demo-seed] GL ${ACCOUNTS.bank} has only ${inPeriod.length} movement(s) in ${STATEMENT_PERIOD_START}..${STATEMENT_PERIOD_END}; a bank statement seeded against it would have nothing to match.`,
    );
  }

  const onStatement = inPeriod.slice(0, -1);
  const lagged = new Set(onStatement.slice(-2).map((line) => line.entryId));

  const rows = onStatement.map((line, index) => {
    const moneyIn = toCents(line.debit) > 0;
    const amount = moneyIn ? line.debit : line.credit;
    return {
      date: lagged.has(line.entryId) ? addDays(line.date, 2) : line.date,
      description: bankNarrative(index, moneyIn),
      debit: moneyIn ? "" : amount,
      credit: moneyIn ? amount : "",
      reference: `TRX${String(index + 1).padStart(6, "0")}`,
    };
  });

  const CHARGES = [
    { date: "2026-08-28", description: "مصاريف خدمات بنكية", amount: "85.00", reference: "FEE000041" },
    { date: "2026-08-30", description: "رسوم تحويل", amount: "40.00", reference: "FEE000042" },
  ];
  for (const charge of CHARGES) {
    rows.push({ date: charge.date, description: charge.description, debit: charge.amount, credit: "", reference: charge.reference });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const openingCents = ledger.lines
    .filter((line) => line.date < STATEMENT_PERIOD_START)
    .reduce((sum, line) => sum + toCents(line.debit) - toCents(line.credit), 0);
  const closingCents = rows.reduce((sum, row) => sum + toCents(row.credit || "0") - toCents(row.debit || "0"), openingCents);

  const header = "التاريخ,البيان,مدين,دائن,المرجع";
  const rawCsv = [header, ...rows.map((r) => `${r.date},${r.description},${r.debit},${r.credit},${r.reference}`)].join("\n");

  await step(app, "POST", "/bank-statements/import", {
    id: "BSTMT-DEMO-1",
    treasuryAccountId: BANK_TREASURY_ID,
    statementNumber: "BS-2026-08",
    rawCsv,
    mapping: {
      dateColumn: "التاريخ",
      descriptionColumn: "البيان",
      debitColumn: "مدين",
      creditColumn: "دائن",
      referenceColumn: "المرجع",
      dateFormat: "YYYY-MM-DD",
    },
    periodStart: STATEMENT_PERIOD_START,
    periodEnd: STATEMENT_PERIOD_END,
    openingBalance: money(openingCents),
    closingBalance: money(closingCents),
  });

  // Left at "قيد التسوية" with the two fees outstanding, not finalized: a
  // statement seeded as منتهية would leave the match/unmatch/finalize controls
  // with nothing to act on, which is the state this seed exists to end.
  await step(app, "POST", "/bank-statements/BSTMT-DEMO-1/auto-match", {});
}

export async function seedTreasury(app: App): Promise<void> {
  await seedGlAccounts(app);
  await seedTreasuryAccountAndWarehouse(app);
  await seedVouchers(app);
  await seedCheques(app);
  await seedExchangeRates(app);
  await seedInstallmentPlan(app);
  await seedFieldSales(app);
  await seedVatFiling(app);
  await seedBankStatement(app);
}
