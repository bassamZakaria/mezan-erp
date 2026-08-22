import {
  Money,
  type Account,
  type AllocatableInvoice,
  type FiscalPeriod,
  type TreasuryAccount,
  type VoucherAllocation,
  type VoucherDocument,
  type VoucherLine,
  type VoucherType,
} from "@mezan/domain";

/**
 * Treasury Vouchers demo data (docs/catalog/04 §"السندات النقدية") for the Cyag
 * tenant (شركة سياج). The current fiscal period (أغسطس 2026) is open. Cash
 * drawers carry opening balances so the cash-negative guard is meaningful, and
 * a handful of confirmed vouchers (+ one partial allocation) seed the list so
 * its KPIs / allocation tab / reverse action have data. New vouchers continue
 * from CV-000005 (see `demoCvStartNumber`).
 */

function leaf(id: string, code: string, nameAr: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
  return { id, code, nameAr, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

export const demoVoucherAccounts: Account[] = [
  leaf("1300-1", "1300-1", "صندوق نقدي الفرع الرئيسي", "asset", "debit"),
  leaf("1300-2", "1300-2", "صندوق نقدي الفرع الثاني", "asset", "debit"),
  leaf("1310", "1310", "البنك الأهلي المصري — جاري", "asset", "debit"),
  leaf("1100", "1100", "الذمم المدينة (العملاء)", "asset", "debit"),
  leaf("2100", "2100", "الذمم الدائنة (الموردون)", "liability", "credit"),
  leaf("2150", "2150", "دفعات مقدمة من العملاء", "liability", "credit"),
  leaf("2200", "2200", "ضريبة القيمة المضافة المستحقة", "liability", "credit"),
  leaf("3100", "3100", "رأس المال", "equity", "credit"),
  leaf("4900", "4900", "إيرادات أخرى", "revenue", "credit"),
  leaf("5900", "5900", "مصروفات أخرى", "expense", "debit"),
];

export const demoVoucherTreasuryAccounts: TreasuryAccount[] = [
  { id: "ta-cash1", code: "CASH-001", name: "صندوق نقدي الفرع الرئيسي", type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-1", openingBalance: Money.fromMajor("50000"), openingBalanceDate: "2026-08-01", status: "active" },
  { id: "ta-cash2", code: "CASH-002", name: "صندوق نقدي الفرع الثاني", type: "cash", currency: "EGP", branchId: "b1", glAccountId: "1300-2", openingBalance: Money.fromMajor("2000"), openingBalanceDate: "2026-08-01", status: "active" },
  { id: "ta-bank1", code: "BANK-001", name: "البنك الأهلي المصري — جاري", type: "bank", currency: "EGP", branchId: "b1", glAccountId: "1310", openingBalance: Money.fromMajor("30000"), openingBalanceDate: "2026-08-01", status: "active" },
];

/** Opening cash/bank balances posted into the ledger before any voucher (Dr treasury / Cr capital). */
export const demoTreasuryOpeningBalances: { glAccountId: string; amount: string }[] = [
  { glAccountId: "1300-1", amount: "50000" },
  { glAccountId: "1300-2", amount: "2000" },
  { glAccountId: "1310", amount: "30000" },
];

export const demoVoucherOpenPeriod: FiscalPeriod = {
  id: "fp-2026-08",
  year: 2026,
  periodNumber: 8,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  status: "open",
};

export interface DemoParty {
  id: string;
  nameAr: string;
}

export const demoVoucherCustomers: DemoParty[] = [
  { id: "cust-amal", nameAr: "شركة الأمل للتجارة" },
  { id: "cust-noor", nameAr: "مؤسسة النور" },
];

export const demoVoucherSuppliers: DemoParty[] = [
  { id: "sup-nile", nameAr: "شركة النيل للتوريدات" },
  { id: "sup-delta", nameAr: "مصنع الدلتا" },
];

const money = (v: string) => Money.fromMajor(v);

export const demoOpenInvoices: AllocatableInvoice[] = [
  { id: "inv-1", invoiceNo: "INV-000001", kind: "sales", partyId: "cust-amal", date: "2026-08-06", total: money("1000"), allocated: money("400") },
  { id: "inv-2", invoiceNo: "INV-000002", kind: "sales", partyId: "cust-amal", date: "2026-08-11", total: money("600"), allocated: money("0") },
  { id: "inv-3", invoiceNo: "INV-000003", kind: "sales", partyId: "cust-noor", date: "2026-08-14", total: money("450"), allocated: money("0") },
  { id: "pi-1", invoiceNo: "PI-000001", kind: "purchase", partyId: "sup-nile", date: "2026-08-09", total: money("800"), allocated: money("0") },
  { id: "pi-2", invoiceNo: "PI-000002", kind: "purchase", partyId: "sup-delta", date: "2026-08-13", total: money("1200"), allocated: money("0") },
];

function seededVoucher(
  n: number,
  date: string,
  partial: Partial<VoucherLine> & { voucherType: VoucherType; amount: Money },
): VoucherDocument {
  const direction = partial.direction ?? deriveDirection(partial.voucherType);
  const line: VoucherLine = {
    voucherType: partial.voucherType,
    direction,
    amount: partial.amount,
    currency: "EGP",
    branchId: "b1",
    paymentMethod: partial.paymentMethod ?? "cash",
    treasuryAccountId: partial.treasuryAccountId ?? "ta-cash1",
    treasuryGlAccountId: partial.treasuryGlAccountId ?? "1300-1",
    counterpartyGlAccountId: partial.counterpartyGlAccountId ?? null,
    counterTreasuryAccountId: partial.counterTreasuryAccountId ?? null,
    counterTreasuryGlAccountId: partial.counterTreasuryGlAccountId ?? null,
    customerId: partial.customerId ?? null,
    supplierId: partial.supplierId ?? null,
    referenceNo: partial.referenceNo ?? null,
  };
  const id = `cv-seed-${n}`;
  return {
    id,
    docType: "TREASURY_VOUCHER",
    docNo: `CV-${String(n).padStart(6, "0")}`,
    date,
    memo: partial.voucherType,
    status: "confirmed",
    lines: [line],
    createdAt: `${date}T09:0${n}:00.000Z`,
    confirmedAt: `${date}T09:0${n}:00.000Z`,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: `je-${id}`,
  };
}

function deriveDirection(type: VoucherType): VoucherLine["direction"] {
  if (type === "inter_treasury_transfer") return "transfer";
  if (["customer_collection", "customer_advance", "supplier_refund", "other_income", "capital_injection"].includes(type)) {
    return "receipt";
  }
  return "payment";
}

export const demoSeededVouchers: VoucherDocument[] = [
  seededVoucher(1, "2026-08-07", {
    voucherType: "customer_collection",
    amount: money("1000"),
    customerId: "cust-amal",
    counterpartyGlAccountId: "1100",
    referenceNo: "REF-1001",
  }),
  seededVoucher(2, "2026-08-10", {
    voucherType: "other_income",
    amount: money("500"),
    counterpartyGlAccountId: "4900",
  }),
  seededVoucher(3, "2026-08-12", {
    voucherType: "inter_treasury_transfer",
    amount: money("200"),
    counterTreasuryAccountId: "ta-cash2",
    counterTreasuryGlAccountId: "1300-2",
  }),
  seededVoucher(4, "2026-08-15", {
    voucherType: "supplier_payment",
    amount: money("800"),
    supplierId: "sup-nile",
    counterpartyGlAccountId: "2100",
  }),
];

/** A pre-existing partial allocation: 400 of CV-000001 applied to INV-000001. */
export const demoSeededAllocations: VoucherAllocation[] = [
  {
    id: "alloc-seed-1",
    voucherId: "cv-seed-1",
    invoiceId: "inv-1",
    amount: money("400"),
    status: "active",
    createdAt: "2026-08-07T10:00:00.000Z",
    reversedAt: null,
  },
];

export const demoCvStartNumber = 4;
