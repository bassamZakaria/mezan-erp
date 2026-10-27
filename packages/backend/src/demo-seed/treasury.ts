import type { App } from "@mezan/api";
import { call, step, BRANCH_ID, WAREHOUSE_ID, ACCOUNTS, SeedPerson, seedActorHeaders, seededUserId, seedToday, seedScaled, seedDecimal } from "./shared.js";

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
const USD_BANK_TREASURY_ID = "TR-DEMO-BANK-USD";
const USD_BANK_ACCOUNT_NUMBER = "EG380003000100000000263180777";
const SUNDRY_INCOME_GL = "4910";
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
    name: "عربة توزيع رقم 1",
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
    issueDate: seedToday(),
    dueDate: addDays(seedToday(), 2),
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
  await step(app, "POST", "/cheques/CHQ-DEMO-3/allocations", { allocationId: "CHQ-DEMO-3-ALLOC-1", invoiceId: "INV-DEMO-4", amount: "1750.00" });
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
    issueDate: seedToday(),
    dueDate: addDays(seedToday(), 1),
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
  await step(app, "POST", "/exchange-rates", { id: "FX-DEMO-5", currency: "USD", rate: "49.60", effectiveDate: seedToday() });
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
  await step(app, "POST", "/installments/plans/overdue/process", { asOfDate: seedToday() });
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
    outcome: "تم الاتفاق على السداد يوم 31 أغسطس",
  });
  await step(app, "POST", "/installments/follow-ups/FUP-DEMO-3/cancel", {});
}

/** One settled trip (small cash + stock variance found at settlement) and one still open. */
async function seedFieldSales(app: App): Promise<void> {
  // The van registry (R3.13): the vehicle owns its warehouse and its till, so
  // a trip names the van and the server derives both.
  await step(app, "POST", "/field/vans", {
    id: "VAN-DEMO-1",
    code: "VAN-01",
    nameAr: "مركبة التوزيع الأولى",
    nameEn: "Distribution van 1",
    plateNumber: "أ ب ج 1234",
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

  // Approval is a second person's act (E3-04): the supervisor posts the cash
  // handover, the stock return and the SHORTAGE adjustment the count found.
  const approval = await app.fetch(
    new Request(`http://demo-seed/field/van-trips/${tripA.id}/approve`, {
      method: "POST",
      headers: await seedActorHeaders(seededUserId(SeedPerson.Supervisor), ["field.van_trip.approve", "field.van_trip.view"]),
      body: JSON.stringify({}),
    }),
  );
  if (!approval.ok) {
    throw new Error(`[demo-seed] POST /field/van-trips/${tripA.id}/approve failed with ${approval.status}: ${await approval.text()}`);
  }

  await step(app, "POST", "/field/van-trips", {
    id: "seed-van-trip-b",
    tripNo: "TRIP-DEMO-2",
    date: seedToday(),
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
 * INVARIANT: filed only after May's own entries — its payroll, its recurring entry, its supplementary depreciation — are in the books; a filed return refuses every later posting into its month (D29).
 */
export async function seedVatFiling(app: App): Promise<void> {
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
export enum BankNarrative {
  CashDeposit = "إيداع نقدي بالفرع",
  TransferOut = "تحويل صادر",
}

/** Money reaches this account over the counter and leaves it by transfer, which is how the tenant trades. */
export function bankNarrative(moneyIn: boolean): BankNarrative {
  return moneyIn ? BankNarrative.CashDeposit : BankNarrative.TransferOut;
}

interface LedgerLineRow {
  readonly entryId: string;
  readonly date: string;
  readonly debit: string;
  readonly credit: string;
}

/**
 * The reference the books hold for the movement behind a GL line — the transfer
 * reference the treasurer wrote on the voucher, when there is one.
 *
 * This is what auto-match scores on: amount (50) + same day (25) + reference
 * (15) is exactly the 90 it needs, and a CSV carries no counterparty to make up
 * the difference. Quoting a reference the books do not hold would be a bank
 * statement nobody could reconcile; quoting none, which is what this seed did
 * before D323, made every one of the 16 lines stop at 75.
 */
export async function bookReferenceOf(app: App, entryId: string): Promise<string | null> {
  const entry = (await step(app, "GET", `/gl/journal-entries/${encodeURIComponent(entryId)}`)) as {
    readonly sourceDocId?: string | null;
  };
  if (!entry.sourceDocId) return null;
  const res = await call(app, "GET", `/vouchers/${encodeURIComponent(entry.sourceDocId)}`);
  if (!res.ok) return null;
  const voucher = (await res.json()) as { readonly referenceNo?: string | null };
  return voucher.referenceNo ?? null;
}

/**
 * كشف حساب بنكي واحد لشهر أغسطس 2026 — the bank-reconciliation workflow had a
 * screen, routes and an engine and no data at all: `/bank-statements` returned
 * an empty list on every seeded tenant, so import → match → finalize had never
 * once run end to end.
 *
 * The statement is DERIVED from the bank GL account's own posted movements, not
 * invented, so auto-match has real entries to find, and each line quotes the
 * transfer reference the books hold for that movement where there is one.
 * What clears and what does not is decided by the books, not by the fixture:
 *
 *   - the supplier transfers the purchasing screen recorded a reference for
 *     carry it on both sides and auto-apply — amount (50) + same day (25) +
 *     reference (15) is exactly the 90 the threshold asks of a CSV, which
 *     carries no counterparty to make up any shortfall;
 *   - the counter deposits and the vouchers written without a reference stop
 *     at 75 and are matched by hand;
 *   - two movements carry the bank's value date, two days after the book date,
 *     which costs them their date score as well;
 *   - two charges the books have never seen (service fee, transfer fee) stay
 *     unmatched — the "شوف الفروقات" step needs something to show;
 *   - the last book movement is left OFF the statement, the uncleared-payment
 *     side of the same difference.
 */
export async function seedBankStatement(app: App): Promise<void> {
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

  const rows: { date: string; description: string; debit: string; credit: string; reference: string }[] = [];
  for (const [index, line] of onStatement.entries()) {
    const moneyIn = toCents(line.debit) > 0;
    const amount = moneyIn ? line.debit : line.credit;
    const bookReference = await bookReferenceOf(app, line.entryId);
    rows.push({
      date: lagged.has(line.entryId) ? addDays(line.date, 2) : line.date,
      description: bankNarrative(moneyIn),
      debit: moneyIn ? "" : amount,
      credit: moneyIn ? amount : "",
      reference: bookReference ?? `TRX${String(index + 1).padStart(6, "0")}`,
    });
  }

  const CHARGES = [
    { date: "2026-08-28", description: "مصاريف خدمات بنكية", amount: "85.00", reference: "FEE000041" },
    { date: "2026-08-30", description: "رسوم تحويل", amount: "40.00", reference: "FEE000042" },
  ];
  for (const charge of CHARGES) {
    rows.push({ date: charge.date, description: charge.description, debit: charge.amount, credit: "", reference: charge.reference });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  // INVARIANT: exact, never rounded to the piastre — the books hold movements to the micro-unit, and a balance rounded here leaves a difference no matching can clear (period-close-bank-blocker.test.ts).
  const opening = ledger.lines
    .filter((line) => line.date < STATEMENT_PERIOD_START)
    .reduce((sum, line) => sum + seedScaled(line.debit) - seedScaled(line.credit), 0n);
  const closing = rows.reduce((sum, row) => sum + seedScaled(row.credit || "0") - seedScaled(row.debit || "0"), opening);

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
    openingBalance: seedDecimal(opening),
    closingBalance: seedDecimal(closing),
  });

  // Left at "قيد التسوية": auto-match clears the referenced transfers and
  // leaves the lagged, the teller deposits and the two fees for a human. A
  // statement seeded as منتهية would leave the match/unmatch/finalize controls
  // with nothing to act on, which is the state this seed exists to end.
  const autoMatch = (await step(app, "POST", "/bank-statements/BSTMT-DEMO-1/auto-match", {})) as {
    readonly matchedCount: number;
  };
  // A statement where nothing cleared is what D323 was: every line stuck at 75
  // because no book reference reached it. It reads as "قيد التسوية" either way,
  // which is how it went unnoticed, so the seed checks rather than assumes.
  if (autoMatch.matchedCount === 0) {
    throw new Error(
      "[demo-seed] auto-match cleared none of the seeded bank statement; the book movements have lost the transfer reference their statement lines quote (D323).",
    );
  }
}

/**
 * A foreign-currency bank account, one USD receipt posted on it, and the OFX
 * statement the bank sends for it.
 *
 * The GL holds the receipt in pounds at the day's approved rate; the statement
 * states dollars. Without the reader recovering the foreign figure from the
 * posting's own rate there is no candidate a USD line can equal, and the
 * account cannot be reconciled at all.
 */
async function seedForeignCurrencyBankStatement(app: App): Promise<void> {
  await step(app, "POST", "/vouchers", {
    id: "VCH-DEMO-USD-1",
    date: "2026-08-05",
    memo: "تحصيل تصدير بالدولار",
    voucherType: "other_income",
    amount: "1200.00",
    currency: "USD",
    branchId: BRANCH_ID,
    paymentMethod: "bank",
    treasuryAccountId: USD_BANK_TREASURY_ID,
    treasuryGlAccountId: ACCOUNTS.bankUsd,
    counterpartyGlAccountId: SUNDRY_INCOME_GL,
    referenceNo: "USD000001",
  });
  await step(app, "POST", "/vouchers/VCH-DEMO-USD-1/confirm", {});

  const ofx = [
    "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    "<CURDEF>USD</CURDEF>",
    `<BANKACCTFROM><ACCTID>${USD_BANK_ACCOUNT_NUMBER}</ACCTID></BANKACCTFROM>`,
    "<BANKTRANLIST><DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>",
    "<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260805</DTPOSTED><TRNAMT>1200.00</TRNAMT><CHECKNUM>USD000001</CHECKNUM><FITID>USD000001</FITID><NAME>EXPORT SETTLEMENT</NAME><MEMO>تحصيل تصدير بالدولار</MEMO></STMTTRN>",
    "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260828</DTPOSTED><TRNAMT>-25.00</TRNAMT><FITID>USD000002</FITID><NAME>SWIFT FEE</NAME><MEMO>رسوم تحويل بالدولار</MEMO></STMTTRN>",
    "</BANKTRANLIST><LEDGERBAL><BALAMT>1175.00</BALAMT></LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
  ].join("\n");

  await step(app, "POST", "/bank-statements/import-file", {
    id: "BSTMT-DEMO-USD-1",
    treasuryAccountId: USD_BANK_TREASURY_ID,
    format: "ofx",
    content: ofx,
    statementNumber: "BS-USD-2026-08",
    openingBalance: "0.00",
  });
  await step(app, "POST", "/bank-statements/BSTMT-DEMO-USD-1/auto-match", {});
}

export async function seedTreasury(app: App): Promise<void> {
  await seedGlAccounts(app);
  await seedTreasuryAccountAndWarehouse(app);
  await seedVouchers(app);
  await seedCheques(app);
  await seedExchangeRates(app);
  await seedInstallmentPlan(app);
  await seedFieldSales(app);
  await seedForeignCurrencyBankStatement(app);
}
