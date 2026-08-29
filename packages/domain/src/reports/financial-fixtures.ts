import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";

/**
 * A complete, self-contained, balanced tenant ledger used to compute all seven
 * financial statements (docs/archive/catalog/08-reports.md — القوائم المالية) end to
 * end. Like `./sample-gl-data.ts` (the trial-balance-only fixture) this is not
 * the app's operational chart of accounts — it is the seeded set of posted
 * journal entries the report engine aggregates over, chosen so every statement
 * reconciles by construction:
 *   - trial balance nets to zero (Σ debit = Σ credit = 452,400)
 *   - balance sheet balances (assets 389,400 = liabilities 122,400 + equity 267,000)
 *   - cash flow ties out (opening 0 + net change 299,200 = closing 299,200)
 *
 * Codes follow the classification convention in `./gl-shared.ts`: 11xx cash,
 * 12xx–14xx current assets, 15xx+ non-current assets, 21xx–24xx current
 * liabilities, 25xx+ non-current liabilities.
 */
export const financialStatementAccounts: Account[] = [
  { id: "1100", code: "1100", nameAr: "النقدية بالصندوق", nameEn: "Cash on Hand", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1110", code: "1110", nameAr: "البنك", nameEn: "Bank", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1200", code: "1200", nameAr: "ذمم مدينة (عملاء)", nameEn: "Accounts Receivable", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1300", code: "1300", nameAr: "المخزون", nameEn: "Inventory", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1400", code: "1400", nameAr: "ضريبة القيمة المضافة على المشتريات", nameEn: "Input VAT", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1500", code: "1500", nameAr: "معدات وأصول ثابتة", nameEn: "Equipment", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "2100", code: "2100", nameAr: "ذمم دائنة (موردون)", nameEn: "Accounts Payable", type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة على المبيعات", nameEn: "Output VAT", type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "2500", code: "2500", nameAr: "قرض طويل الأجل", nameEn: "Long-term Loan", type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "3100", code: "3100", nameAr: "رأس المال", nameEn: "Owner's Capital", type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "5200", code: "5200", nameAr: "مصروفات تشغيلية", nameEn: "Operating Expenses", type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
];

/** The VAT accounts, kept explicit so the VAT-return report never guesses. */
export const OUTPUT_VAT_ACCOUNT_ID = "2200";
export const INPUT_VAT_ACCOUNT_ID = "1400";

function dr(accountId: string, major: string, memo?: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.fromMajor(major), credit: Money.zero(), memo: memo ?? null };
}

function cr(accountId: string, major: string, memo?: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.zero(), credit: Money.fromMajor(major), memo: memo ?? null };
}

let seq = 0;
function je(date: string, memo: string, lines: JournalEntry["lines"]): JournalEntry {
  seq += 1;
  const n = String(seq).padStart(6, "0");
  return { id: `je-${seq}`, entryNo: `JE-${n}`, date, memo, status: "posted", source: "system", lines };
}

/**
 * Twelve balanced posted entries spanning Jan–Jul 2026. VAT lines use Egypt's
 * 14% standard rate; je-7 is a 0%/zero-rated cash sale. je-12 is a VAT
 * settlement to the authority (does not affect the VAT return itself).
 */
export const financialStatementEntries: JournalEntry[] = [
  je("2026-01-01", "رأس المال الافتتاحي", [dr("1100", "200000"), cr("3100", "200000")]),
  je("2026-01-05", "قرض بنكي طويل الأجل", [dr("1110", "100000"), cr("2500", "100000")]),
  je("2026-01-10", "شراء معدات نقداً", [dr("1500", "40000"), cr("1110", "40000")]),
  je("2026-02-01", "مشتريات مخزون آجلة (ض.ق.م 14%)", [dr("1300", "50000"), dr("1400", "7000"), cr("2100", "57000")]),
  je("2026-03-01", "مبيعات آجلة لعميل (ض.ق.م 14%)", [dr("1200", "91200"), cr("4100", "80000"), cr("2200", "11200")]),
  je("2026-03-01", "تكلفة البضاعة المباعة", [dr("5100", "48000"), cr("1300", "48000")]),
  je("2026-04-01", "مبيعات نقدية صفرية الضريبة (0%)", [dr("1100", "20000"), cr("4100", "20000")]),
  je("2026-05-01", "مصروفات تشغيلية نقدية", [dr("5200", "15000"), cr("1100", "15000")]),
  je("2026-06-01", "تحصيل من عميل", [dr("1100", "50000"), cr("1200", "50000")]),
  je("2026-06-15", "سداد لمورد", [dr("2100", "40000"), cr("1110", "40000")]),
  je("2026-07-01", "مبيعات نقدية (ض.ق.م 14%)", [dr("1100", "34200"), cr("4100", "30000"), cr("2200", "4200")]),
  je("2026-07-20", "سداد ض.ق.م للمصلحة", [dr("2200", "10000"), cr("1110", "10000")]),
];
