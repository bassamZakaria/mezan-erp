import type { Account } from "../accounts/account.js";
import type { JournalEntry } from "../journal.js";
import { Money } from "../money/index.js";

/**
 * A small, self-contained, balanced chart of accounts + posted journal-entry
 * history used to prove out the report engine end to end (see
 * `./trial-balance.ts`). Not the app's real chart of accounts sample data
 * (apps/web/src/accounts-sample-data.ts) — this set exists purely so the
 * report engine has GL data to aggregate over without depending on
 * persistence, which is out of scope for this package.
 */
export const sampleReportAccounts: Account[] = [
  { id: "1100", code: "1100", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1200", code: "1200", nameAr: "ذمم مدينة", nameEn: "Accounts Receivable", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "1300", code: "1300", nameAr: "المخزون", nameEn: "Inventory", type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "2100", code: "2100", nameAr: "ذمم دائنة", nameEn: "Accounts Payable", type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "3100", code: "3100", nameAr: "رأس المال", nameEn: "Owner's Capital", type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "5200", code: "5200", nameAr: "مصروفات تشغيلية", nameEn: "Operating Expenses", type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
];

function dr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.fromMajor(major), credit: Money.zero() };
}

function cr(accountId: string, major: string): JournalEntry["lines"][number] {
  return { accountId, debit: Money.zero(), credit: Money.fromMajor(major) };
}

/**
 * Eight posted entries spanning Jan–Aug 2026 (today, per the running
 * session, is 2026-08-22). Every entry balances individually, so any as-of
 * date reconciles: Σdebit = Σcredit = 147,000.00 once all eight are posted.
 */
export const sampleReportJournalEntries: JournalEntry[] = [
  { id: "je-1", date: "2026-01-01", memo: "رأس المال الافتتاحي", status: "posted", lines: [dr("1100", "100000"), cr("3100", "100000")] },
  { id: "je-2", date: "2026-02-01", memo: "مشتريات آجلة من المورد", status: "posted", lines: [dr("1300", "15000"), cr("2100", "15000")] },
  { id: "je-3", date: "2026-03-10", memo: "مبيعات نقدية", status: "posted", lines: [dr("1100", "20000"), cr("4100", "20000")] },
  { id: "je-4", date: "2026-03-10", memo: "تكلفة البضاعة المباعة", status: "posted", lines: [dr("5100", "12000"), cr("1300", "12000")] },
  { id: "je-5", date: "2026-05-15", memo: "مبيعات آجلة لعميل", status: "posted", lines: [dr("1200", "15000"), cr("4100", "15000")] },
  { id: "je-6", date: "2026-06-01", memo: "تحصيل من عميل", status: "posted", lines: [dr("1100", "10000"), cr("1200", "10000")] },
  { id: "je-7", date: "2026-06-20", memo: "مصروفات تشغيلية نقدية", status: "posted", lines: [dr("5200", "5000"), cr("1100", "5000")] },
  { id: "je-8", date: "2026-08-05", memo: "سداد جزئي لمورد", status: "posted", lines: [dr("2100", "3000"), cr("1100", "3000")] },
];
