/**
 * Segregation-of-duties (SoD) conflict rules — ENH-051.
 *
 * A static rule set over the permission catalog: pairs of permission codes
 * that no single role or user should hold together, because holding both
 * lets one person carry out a control and its own check (COSO / ISA 315
 * maker-checker). `detectSodConflicts` is pure set membership over an
 * already-resolved permission set, so the same function drives the role
 * editor's live warning, the role/user save gate, and the role-level half of
 * `GET /security-reports/sod`.
 */

import { WILDCARD_PERMISSION } from "./catalog.js";
import { resolvePermissions } from "./resolve.js";

export enum SodConflictId {
  VoucherCreateApprove = "voucher_create_approve",
  TreasuryTransferCreateApprove = "treasury_transfer_create_approve",
  CustomerRefundCreateApprove = "customer_refund_create_approve",
  SalesInvoiceCreateVoid = "sales_invoice_create_void",
  PurchaseInvoiceCreateVoid = "purchase_invoice_create_void",
  JournalPostPeriodClose = "journal_post_period_close",
  JournalPostPeriodReopen = "journal_post_period_reopen",
  BankRecMatchFinalize = "bank_rec_match_finalize",
  AdminVsPosting = "admin_vs_posting",
  ItemPriceEditVsSale = "item_price_edit_vs_sale",
  StockAdjustmentCreateApprove = "stock_adjustment_create_approve",
  PayrollCalculateApprove = "payroll_calculate_approve",
  HrAdvanceCreateApprove = "hr_advance_create_approve",
  HrLeaveCreateApprove = "hr_leave_create_approve",
}

export interface SodConflictRule {
  readonly id: SodConflictId;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly sideLabelAr: string;
  readonly sideLabelEn: string;
  readonly checkerLabelAr: string;
  readonly checkerLabelEn: string;
  readonly sideA: readonly string[];
  readonly sideB: readonly string[];
}

export const SOD_CONFLICT_RULES: readonly SodConflictRule[] = [
  {
    id: SodConflictId.VoucherCreateApprove,
    labelAr: "إنشاء سند صرف/قبض واعتماده",
    labelEn: "Create and approve a cash voucher",
    sideLabelAr: "إنشاء السند",
    sideLabelEn: "Create the voucher",
    checkerLabelAr: "اعتماد السند",
    checkerLabelEn: "Confirm the voucher",
    sideA: ["treasury.cash_voucher.create"],
    sideB: ["treasury.cash_voucher.confirm"],
  },
  {
    id: SodConflictId.TreasuryTransferCreateApprove,
    labelAr: "إنشاء تحويل بين الخزائن واعتماده",
    labelEn: "Create and approve a treasury transfer",
    sideLabelAr: "إنشاء التحويل",
    sideLabelEn: "Create the transfer",
    checkerLabelAr: "اعتماد التحويل",
    checkerLabelEn: "Confirm the transfer",
    sideA: ["treasury.transfer.create"],
    sideB: ["treasury.transfer.confirm"],
  },
  {
    id: SodConflictId.CustomerRefundCreateApprove,
    labelAr: "إنشاء استرداد للعميل واعتماده",
    labelEn: "Create and approve a customer refund",
    sideLabelAr: "إنشاء الاسترداد",
    sideLabelEn: "Create the refund",
    checkerLabelAr: "اعتماد الاسترداد",
    checkerLabelEn: "Confirm the refund",
    sideA: ["treasury.customer_refund.create"],
    sideB: ["treasury.customer_refund.confirm"],
  },
  {
    id: SodConflictId.SalesInvoiceCreateVoid,
    labelAr: "إنشاء فاتورة مبيعات وإلغاؤها",
    labelEn: "Create and void a sales invoice",
    sideLabelAr: "إنشاء الفاتورة",
    sideLabelEn: "Create the invoice",
    checkerLabelAr: "إلغاء الفاتورة",
    checkerLabelEn: "Void the invoice",
    sideA: ["sales.invoice.create"],
    sideB: ["sales.invoice.void"],
  },
  {
    id: SodConflictId.PurchaseInvoiceCreateVoid,
    labelAr: "إنشاء فاتورة مشتريات وإلغاؤها",
    labelEn: "Create and void a purchase invoice",
    sideLabelAr: "إنشاء الفاتورة",
    sideLabelEn: "Create the invoice",
    checkerLabelAr: "إلغاء الفاتورة",
    checkerLabelEn: "Void the invoice",
    sideA: ["purchases.invoice.create"],
    sideB: ["purchases.invoice.void"],
  },
  {
    id: SodConflictId.JournalPostPeriodClose,
    labelAr: "ترحيل القيود وإقفال الفترة المالية",
    labelEn: "Post journal entries and close the fiscal period",
    sideLabelAr: "ترحيل القيد",
    sideLabelEn: "Post the entry",
    checkerLabelAr: "إقفال الفترة",
    checkerLabelEn: "Close the period",
    sideA: ["accounting.journal.post", "accounting.revaluation.reverse"],
    sideB: ["accounting.period.close"],
  },
  {
    id: SodConflictId.JournalPostPeriodReopen,
    labelAr: "ترحيل القيود وإعادة فتح الفترة المالية",
    labelEn: "Post journal entries and reopen the fiscal period",
    sideLabelAr: "ترحيل القيد",
    sideLabelEn: "Post the entry",
    checkerLabelAr: "إعادة فتح الفترة",
    checkerLabelEn: "Reopen the period",
    sideA: ["accounting.journal.post", "accounting.revaluation.reverse"],
    sideB: ["accounting.period.reopen", "accounting.year_end_close.reverse"],
  },
  {
    id: SodConflictId.BankRecMatchFinalize,
    labelAr: "مطابقة كشف البنك وإقفال التسوية",
    labelEn: "Match a bank statement and finalize the reconciliation",
    sideLabelAr: "المطابقة",
    sideLabelEn: "Match",
    checkerLabelAr: "الإقفال",
    checkerLabelEn: "Finalize",
    sideA: ["treasury.reconciliation.match"],
    sideB: ["treasury.reconciliation.finalize"],
  },
  {
    id: SodConflictId.AdminVsPosting,
    labelAr: "إدارة المستخدمين/الأدوار مقابل ترحيل أي مستند",
    labelEn: "Administer users/roles versus posting any document",
    sideLabelAr: "إدارة المستخدمين أو الأدوار",
    sideLabelEn: "Administer users or roles",
    checkerLabelAr: "ترحيل مستند",
    checkerLabelEn: "Post a document",
    sideA: ["admin.users.create", "admin.users.edit", "admin.roles.manage"],
    sideB: [
      "sales.invoice.confirm",
      "sales.return.confirm",
      "purchases.invoice.confirm",
      "purchases.receipt.confirm",
      "purchases.return.confirm",
      "purchases.landed_cost.confirm",
      "accounting.journal.post",
      "accounting.revaluation.reverse",
      "treasury.cash_voucher.confirm",
      "treasury.transfer.confirm",
      "treasury.customer_refund.confirm",
      "inventory.adjustment.confirm",
      "inventory.adjustment.reverse",
      "contracting.consumption.reverse",
      "inventory.transfer.confirm",
      "inventory.count.confirm",
      "hr.payroll.pay",
    ],
  },
  {
    id: SodConflictId.ItemPriceEditVsSale,
    labelAr: "تعديل قوائم أسعار الأصناف مقابل تسجيل مبيعات",
    labelEn: "Edit item price lists versus recording sales",
    sideLabelAr: "تعديل السعر",
    sideLabelEn: "Edit the price",
    checkerLabelAr: "تسجيل بيع",
    checkerLabelEn: "Record a sale",
    sideA: ["sales.price_list.manage"],
    sideB: ["sales.invoice.create"],
  },
  {
    id: SodConflictId.StockAdjustmentCreateApprove,
    labelAr: "إنشاء تسوية مخزنية واعتمادها",
    labelEn: "Create and approve a stock adjustment",
    sideLabelAr: "إنشاء التسوية",
    sideLabelEn: "Create the adjustment",
    checkerLabelAr: "اعتماد التسوية",
    checkerLabelEn: "Confirm the adjustment",
    sideA: ["inventory.adjustment.create"],
    sideB: ["inventory.adjustment.confirm", "inventory.adjustment.reverse"],
  },
  {
    id: SodConflictId.PayrollCalculateApprove,
    labelAr: "احتساب مسير الرواتب واعتماده",
    labelEn: "Calculate and approve a payroll run",
    sideLabelAr: "احتساب المسير",
    sideLabelEn: "Calculate the run",
    checkerLabelAr: "اعتماد المسير",
    checkerLabelEn: "Approve the run",
    sideA: ["hr.payroll.calculate"],
    sideB: ["hr.payroll.approve"],
  },
  {
    id: SodConflictId.HrAdvanceCreateApprove,
    labelAr: "طلب سلفة موظف واعتمادها",
    labelEn: "Request and approve an employee advance",
    sideLabelAr: "طلب السلفة",
    sideLabelEn: "Request the advance",
    checkerLabelAr: "اعتماد السلفة",
    checkerLabelEn: "Approve the advance",
    sideA: ["hr.advance.create"],
    sideB: ["hr.advance.approve", "hr.advance.reverse"],
  },
  {
    id: SodConflictId.HrLeaveCreateApprove,
    labelAr: "تقديم طلب إجازة واعتماده",
    labelEn: "Submit and approve a leave request",
    sideLabelAr: "تقديم الطلب",
    sideLabelEn: "Submit the request",
    checkerLabelAr: "اعتماد الطلب",
    checkerLabelEn: "Approve the request",
    sideA: ["hr.leave.create"],
    sideB: ["hr.leave.approve"],
  },
];

export interface SodConflictMatch {
  readonly ruleId: SodConflictId;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly sideLabelAr: string;
  readonly sideLabelEn: string;
  readonly checkerLabelAr: string;
  readonly checkerLabelEn: string;
  readonly matchedA: readonly string[];
  readonly matchedB: readonly string[];
}

/**
 * Every rule a permission set trips, resolved over its transitive
 * dependencies first — a role granting only `.confirm` still implies
 * `.view_own` (see `resolve.ts`), never the other side of one of these pairs,
 * so resolving first never manufactures a false conflict.
 */
export function detectSodConflicts(granted: Iterable<string>): readonly SodConflictMatch[] {
  const resolved = resolvePermissions(granted);
  // The wildcard is not one more code to match against `sideA`/`sideB` — it
  // IS every code, including both sides of every rule below. Without this,
  // `resolvePermissions(["*"])` resolves to the single-element set `{"*"}`
  // (see resolve.ts), so a role or an `isCompanyAdmin` grant — literally one
  // person holding every permission — read as conflict-free everywhere this
  // function is called, which is the exact concentration of power ENH-051
  // exists to surface.
  const hasWildcard = resolved.has(WILDCARD_PERMISSION);
  const out: SodConflictMatch[] = [];
  for (const rule of SOD_CONFLICT_RULES) {
    const matchedA = hasWildcard ? rule.sideA : rule.sideA.filter((code) => resolved.has(code));
    const matchedB = hasWildcard ? rule.sideB : rule.sideB.filter((code) => resolved.has(code));
    if (matchedA.length > 0 && matchedB.length > 0) {
      out.push({
        ruleId: rule.id,
        labelAr: rule.labelAr,
        labelEn: rule.labelEn,
        sideLabelAr: rule.sideLabelAr,
        sideLabelEn: rule.sideLabelEn,
        checkerLabelAr: rule.checkerLabelAr,
        checkerLabelEn: rule.checkerLabelEn,
        matchedA,
        matchedB,
      });
    }
  }
  return out;
}

export function getSodConflictRule(id: string): SodConflictRule | undefined {
  return SOD_CONFLICT_RULES.find((rule) => rule.id === id);
}
