import type { AccountDTO } from "@mezan/contracts";

/**
 * Sample Chart of Accounts for the Cyag (شركة سياج) demo tenant, transcribed
 * from docs/catalog/04-accounting-treasury.md's "Root account types observed"
 * — the same account codes already referenced by the journal-posting spike
 * (1300-1, 4000, 2200), for continuity across the demo data.
 */
export const demoAccounts: AccountDTO[] = [
  { id: "1000", code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" },
  { id: "1100", code: "1100", nameAr: "ذمم مدينة", nameEn: "Accounts Receivable", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true, status: "active" },
  { id: "1110", code: "1110", nameAr: "ذمم أقساط مدينة", nameEn: "Installment Receivables", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false, status: "active" },
  { id: "1160", code: "1160", nameAr: "سلف الموظفين", nameEn: "Employee Advances", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false, status: "active" },
  { id: "1200", code: "1200", nameAr: "المخزون", nameEn: "Inventory", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false, status: "active" },
  { id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true, status: "active" },
  { id: "1300-1", code: "1300-1", nameAr: "صندوق نقدي الفرع الرئيسي", nameEn: "Main Branch Cash Drawer", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" },
  { id: "1310", code: "1310", nameAr: "حسابات بنكية", nameEn: "Bank Accounts", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" },
  { id: "1320", code: "1320", nameAr: "شيكات تحت التحصيل", nameEn: "Cheques Under Collection", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "inactive" },
  { id: "1400", code: "1400", nameAr: "ضريبة مدخلات", nameEn: "Input VAT Receivable", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false, status: "active" },
  { id: "1500", code: "1500", nameAr: "أصول ثابتة", nameEn: "Fixed Assets", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true, status: "active" },
  { id: "1510", code: "1510", nameAr: "معدات", nameEn: "Equipment", type: "asset", naturalBalance: "debit", parentId: "1500", isHeader: false, status: "active" },
  { id: "1520", code: "1520", nameAr: "مركبات", nameEn: "Vehicles", type: "asset", naturalBalance: "debit", parentId: "1500", isHeader: false, status: "active" },

  { id: "2000", code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
  { id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة مستحقة", nameEn: "Output VAT Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false, status: "active" },

  { id: "3000", code: "3000", nameAr: "حقوق الملكية", nameEn: "Equity", type: "equity", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
  { id: "3100", code: "3100", nameAr: "رأس المال", nameEn: "Capital", type: "equity", naturalBalance: "credit", parentId: "3000", isHeader: false, status: "active" },

  { id: "4000", code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false, status: "active" },
  { id: "4900", code: "4900", nameAr: "فائض الصندوق", nameEn: "Cash Overage", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false, status: "active" },

  { id: "5000", code: "5000", nameAr: "المصروفات", nameEn: "Expenses", type: "expense", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" },
  { id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false, status: "active" },
  { id: "5900", code: "5900", nameAr: "عجز الصندوق", nameEn: "Cash Shortage", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false, status: "active" },
];

/**
 * Balance snapshot for the account-detail panel, keyed by account id (EGP).
 * Real movements wire in once journal posting feeds the ledger (Phase 2) —
 * this stands in for the "رصيد أول المدة / حركة الفترة / رصيد نهاية المدة"
 * summary row the mockup shows; accounts not listed here show all-zero.
 */
export const demoAccountBalances: Record<string, { opening: number; movement: number; closing: number }> = {
  "1300-1": { opening: 238.0, movement: 100.0, closing: 338.0 },
};
