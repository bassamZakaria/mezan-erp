import type { AccountRepository } from "./account.js";
import type { CreateAccountCommand } from "./create-account.js";
import { createAccount } from "./create-account.js";

/**
 * The standard Chart-of-Accounts template — the 5 top-level roots and their
 * best-attested header/detail children, transcribed from
 * docs/catalog/04-accounting-treasury.md ("Root account types observed").
 * `id === code` throughout: account codes are unique and stable, so they
 * double as the id (this also matches the account codes already used as
 * `accountId` in the journal-posting spike, e.g. "1300-1", "4000", "2200").
 *
 * Listed parent-before-child so `seedStandardChartOfAccounts` can insert
 * sequentially without a second pass.
 */
export const STANDARD_COA_TEMPLATE: readonly CreateAccountCommand[] = [
  // --- 1000 الأصول (Assets) ---
  { id: "1000", code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true },
  { id: "1100", code: "1100", nameAr: "ذمم مدينة", nameEn: "Accounts Receivable", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true },
  { id: "1105", code: "1105", nameAr: "ذمم عملاء تجارية", nameEn: "Trade Receivables", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false },
  { id: "1110", code: "1110", nameAr: "ذمم أقساط مدينة", nameEn: "Installment Receivables", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false },
  { id: "1150", code: "1150", nameAr: "محتجزات ضمان مدينة", nameEn: "Retention Receivable", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false },
  { id: "1160", code: "1160", nameAr: "سلف الموظفين", nameEn: "Employee Advances", type: "asset", naturalBalance: "debit", parentId: "1100", isHeader: false },
  { id: "1190", code: "1190", nameAr: "مخصص هبوط المخزون", nameEn: "Inventory Provision", type: "asset", naturalBalance: "credit", parentId: "1100", isHeader: false },
  { id: "1200", code: "1200", nameAr: "المخزون", nameEn: "Inventory", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1210", code: "1210", nameAr: "مخزون المواد الخام", nameEn: "Raw Materials Inventory", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1220", code: "1220", nameAr: "مخزون المنتجات التامة", nameEn: "Finished Goods Inventory", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1250", code: "1250", nameAr: "إنتاج تحت التشغيل", nameEn: "Work In Progress", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true },
  { id: "1300-1", code: "1300-1", nameAr: "صندوق نقدي الفرع الرئيسي", nameEn: "Main Branch Cash Drawer", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
  { id: "1310", code: "1310", nameAr: "حسابات بنكية", nameEn: "Bank Accounts", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
  { id: "1315", code: "1315", nameAr: "مستحقات بطاقات الدفع", nameEn: "Card Receivables", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
  { id: "1320", code: "1320", nameAr: "شيكات تحت التحصيل", nameEn: "Cheques Under Collection", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
  { id: "1330", code: "1330", nameAr: "مستحقات المحافظ الإلكترونية", nameEn: "E-Wallet Receivables", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false },
  { id: "1350", code: "1350", nameAr: "سلف الموردين", nameEn: "Supplier Advances", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1360", code: "1360", nameAr: "شيكات مرتجعة", nameEn: "Bounced Cheques Receivable", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1400", code: "1400", nameAr: "ضريبة مدخلات", nameEn: "Input VAT Receivable", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: false },
  { id: "1500", code: "1500", nameAr: "أصول ثابتة", nameEn: "Fixed Assets", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true },
  { id: "1510", code: "1510", nameAr: "معدات", nameEn: "Equipment", type: "asset", naturalBalance: "debit", parentId: "1500", isHeader: false },
  { id: "1520", code: "1520", nameAr: "مركبات", nameEn: "Vehicles", type: "asset", naturalBalance: "debit", parentId: "1500", isHeader: false },
  // phase11/crm-projects-assets-field — Fixed Assets' system-default GL accounts
  // (docs/catalog/07 §تصنيفات الأصول "افتراضيات الإهلاك"). 1590 is a
  // contra-asset (credit natural balance), same modeling as 1190 above.
  { id: "1590", code: "1590", nameAr: "مجمع إهلاك الأصول", nameEn: "Accumulated Depreciation", type: "asset", naturalBalance: "credit", parentId: "1500", isHeader: false },

  // --- 2000 الالتزامات (Liabilities) ---
  { id: "2000", code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", naturalBalance: "credit", parentId: null, isHeader: true },
  { id: "2100", code: "2100", nameAr: "ذمم موردين تجاريين", nameEn: "Trade Accounts Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  // A stock adjustment with reason "return to supplier" removes goods without
  // naming a supplier, so it cannot debit trade payables: the AP sub-ledger is
  // built from purchase documents and would never learn about it, and the two
  // would part company. It lands here instead, and the purchase-return
  // document — which does name a supplier — is what clears it against 2100.
  { id: "2110", code: "2110", nameAr: "مرتجعات موردين تحت التسوية", nameEn: "Supplier Returns Clearing", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  { id: "2150", code: "2150", nameAr: "شيكات صادرة", nameEn: "Cheques Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  { id: "2160", code: "2160", nameAr: "دفعات مقدمة من عملاء", nameEn: "Customer Advances", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  { id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة مستحقة", nameEn: "Output VAT Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  // hr/master-data — employee-related liability accounts, appended so the
  // sibling HR sub-phases (payroll, leave-accrual) have a stable account to
  // post against without needing their own COA-template edits.
  { id: "2170", code: "2170", nameAr: "رواتب مستحقة", nameEn: "Salaries Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  { id: "2180", code: "2180", nameAr: "التزام إجازات مستحقة", nameEn: "Accrued Leave Liability", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },
  { id: "2190", code: "2190", nameAr: "استقطاعات ومستحقات رواتب", nameEn: "Payroll Withholdings Payable", type: "liability", naturalBalance: "credit", parentId: "2000", isHeader: false },

  // --- 3000 حقوق الملكية (Equity) ---
  { id: "3000", code: "3000", nameAr: "حقوق الملكية", nameEn: "Equity", type: "equity", naturalBalance: "credit", parentId: null, isHeader: true },
  { id: "3100", code: "3100", nameAr: "رأس المال", nameEn: "Capital", type: "equity", naturalBalance: "credit", parentId: "3000", isHeader: false },
  // A partner's drawings are contra-equity, not an expense: taking money out
  // of the business does not make the business less profitable (R8.1).
  { id: "3200", code: "3200", nameAr: "مسحوبات الشركاء", nameEn: "Partner Drawings", type: "equity", naturalBalance: "debit", parentId: "3000", isHeader: false },
  { id: "3900", code: "3900", nameAr: "الأرباح المرحلة", nameEn: "Retained Earnings", type: "equity", naturalBalance: "credit", parentId: "3000", isHeader: false },

  // --- 4000 الإيرادات (Revenue) ---
  { id: "4000", code: "4000", nameAr: "الإيرادات", nameEn: "Revenue", type: "revenue", naturalBalance: "credit", parentId: null, isHeader: true },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: "Sales Revenue", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false },
  // Distinct from 4900 فائض الصندوق, which is specifically a till overage —
  // an "other income" voucher is rent received, interest, a bank rebate.
  { id: "4910", code: "4910", nameAr: "إيرادات أخرى", nameEn: "Other Income", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false },
  { id: "4900", code: "4900", nameAr: "فائض الصندوق", nameEn: "Cash Overage", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false },
  { id: "4500", code: "4500", nameAr: "أرباح بيع الأصول", nameEn: "Gain on Asset Disposal", type: "revenue", naturalBalance: "credit", parentId: "4000", isHeader: false },

  // --- 5000 المصروفات (Expenses) ---
  { id: "5000", code: "5000", nameAr: "المصروفات", nameEn: "Expenses", type: "expense", naturalBalance: "debit", parentId: null, isHeader: true },
  // Counterpart to 1190 above: the aging-based inventory write-down batch
  // debits this expense account and credits the 1190 contra-asset provision
  // — the write-down never touches the item's recorded WAC/cost layers.
  { id: "5060", code: "5060", nameAr: "مصروف هبوط قيمة المخزون", nameEn: "Inventory Write-down Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // Stock-adjustment contra accounts (R5.9). Seven of the eight adjustment
  // reasons used to post nothing at all, because the template held no account
  // to post them against — damage, theft, expiry and shortage took value out
  // of inventory and the GL never heard about it, so the stock sub-ledger and
  // its 1200 control account drifted apart permanently and silently.
  { id: "5070", code: "5070", nameAr: "مصروف تلف المخزون", nameEn: "Inventory Damage Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5071", code: "5071", nameAr: "خسائر سرقة المخزون", nameEn: "Inventory Theft Loss", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5072", code: "5072", nameAr: "مصروف انتهاء صلاحية المخزون", nameEn: "Inventory Expiry Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5073", code: "5073", nameAr: "عجز وفقد المخزون", nameEn: "Inventory Shrinkage", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // Count corrections and unclassified adjustments swing both ways, so this
  // one is a variance account rather than a pure loss: it is debited on a
  // shortfall and credited on an overage.
  { id: "5074", code: "5074", nameAr: "فروق الجرد", nameEn: "Physical Count Variance", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5075", code: "5075", nameAr: "تسويات مخزون أخرى", nameEn: "Other Inventory Adjustments", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // Where the difference lands when a document settles with a supplier at the
  // invoice price but the goods leave stock at their moving-average cost
  // (D47). Without it, a purchase return credited inventory by the invoice
  // figure and the stock sub-ledger and 1200 diverged by the drift.
  { id: "5080", code: "5080", nameAr: "فروق أسعار الشراء", nameEn: "Purchase Price Variance", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5100", code: "5100", nameAr: "تكلفة البضاعة المباعة", nameEn: "Cost of Goods Sold", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5110", code: "5110", nameAr: "العمالة المحمّلة", nameEn: "Labor Applied", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // hr/master-data — appended for the same reason as 2170/2180 above.
  { id: "5120", code: "5120", nameAr: "مصروف الرواتب", nameEn: "Salary Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5130", code: "5130", nameAr: "مساهمات صاحب العمل", nameEn: "Employer Contributions Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // Allowances routed away from basic pay, so a payroll component can post to
  // its own line of the P&L instead of vanishing into 5120 (R10.7).
  { id: "5121", code: "5121", nameAr: "بدلات ومزايا العاملين", nameEn: "Staff Allowances & Benefits", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5200", code: "5200", nameAr: "مصروفات الشحن والنقل", nameEn: "Freight & Shipping Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5210", code: "5210", nameAr: "المصاريف المحمّلة", nameEn: "Overhead Applied", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5400", code: "5400", nameAr: "إهلاك الأصول", nameEn: "Depreciation Expense", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5450", code: "5450", nameAr: "خسارة بيع الأصول", nameEn: "Loss on Asset Disposal", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  // Likewise distinct from 5900 عجز الصندوق: rent paid, maintenance, utilities.
  { id: "5910", code: "5910", nameAr: "مصروفات أخرى", nameEn: "Other Expenses", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
  { id: "5900", code: "5900", nameAr: "عجز الصندوق", nameEn: "Cash Shortage", type: "expense", naturalBalance: "debit", parentId: "5000", isHeader: false },
];

/**
 * Seeds a fresh Chart of Accounts with {@link STANDARD_COA_TEMPLATE}. Inserts
 * sequentially (parents before children) through the normal `createAccount`
 * use case, so the same validation a hand-created account gets (unique code,
 * header-only parents) applies to the seed too.
 */
export async function seedStandardChartOfAccounts(repo: AccountRepository): Promise<void> {
  for (const command of STANDARD_COA_TEMPLATE) {
    await createAccount(command, repo);
  }
}
