import type { Entitlements } from "../entitlements/entitlements.js";
import { getPermission, isKnownPermission, WILDCARD_PERMISSION } from "../permissions/catalog.js";
import { isModuleLicensed } from "../permissions/module-licensing.js";
import { detectSodConflicts, type SodConflictMatch } from "../permissions/sod.js";

export enum RoleTemplateId {
  Cashier = "cashier",
  Accountant = "accountant",
  WarehouseKeeper = "warehouse_keeper",
  SalesRep = "sales_rep",
  Manager = "manager",
  Auditor = "auditor",
  ExternalAuditor = "external_auditor",
}

export interface RoleTemplate {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly descriptionAr: string;
  readonly descriptionEn: string;
  readonly permissions: readonly string[];
  readonly accessDays?: number;
}

const DASHBOARD = "dashboard.view";

const AUDITOR_READS: readonly string[] = [
  DASHBOARD,
  "accounting.coa.view",
  "accounting.journal.view",
  "accounting.period.view",
  "accounting.reports.view",
  "accounting.tax.view",
  "accounting.eta.view",
  "sales.invoice.view",
  "sales.invoice.view_all",
  "sales.invoice.view_cost",
  "sales.customer.view",
  "sales.quote.view",
  "sales.return.view",
  "sales.price_list.view",
  "sales.promotion.view",
  "purchases.supplier.view",
  "purchases.supplier360.view",
  "purchases.order.view",
  "purchases.receipt.view",
  "purchases.invoice.view",
  "purchases.return.view",
  "purchases.landed_cost.view",
  "inventory.item.view",
  "inventory.stock.view",
  "inventory.valuation.view",
  "inventory.transfer.view",
  "inventory.count.view",
  "inventory.adjustment.view",
  "inventory.writedown.view",
  "treasury.account.view",
  "treasury.cash_voucher.view",
  "treasury.allocation.view",
  "treasury.reconciliation.view",
  "cheques.view",
  "crm.customer360.view",
  "installments.plan.view",
  "assets.view",
  "assets.depreciation.view",
  "workflow.view",
  "audit.logs.view",
  "audit.sequence_gaps.view",
  "audit.evidence_pack.view",
  "admin.users.view",
  "admin.roles.view",
  "admin.settings.view",
  "projects.project.view",
  "contracting.boq.view",
  "contracting.certificate.view",
  "contracting.guarantee.view",
];

export const EXTERNAL_AUDITOR_ACCESS_DAYS = 30;
export const EXTERNAL_AUDITOR_MAX_ACCESS_DAYS = 180;

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    id: RoleTemplateId.Cashier,
    code: "CASHIER",
    nameAr: "أمين الخزنة",
    nameEn: "Cashier",
    descriptionAr: "يحرّر سندات القبض والصرف ويودع الشيكات ويستورد كشف البنك — ولا يعتمد سنداته ولا يطابق الكشف.",
    descriptionEn: "Writes receipt and payment vouchers, deposits cheques and imports the bank statement — does not confirm its own vouchers or reconcile the statement.",
    permissions: [
      DASHBOARD,
      "treasury.account.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.create",
      "treasury.allocation.view",
      "treasury.allocation.manage",
      "treasury.transfer.create",
      "treasury.customer_refund.create",
      "treasury.reconciliation.view",
      "treasury.reconciliation.import",
      "cheques.view",
      "cheques.create",
      "cheques.deposit",
      "cheques.collect",
      "cheques.bounce",
      "installments.plan.view",
      "installments.collect",
      "sales.invoice.view",
      "sales.customer.view",
      "purchases.invoice.view",
      "purchases.supplier.view",
      "admin.devices.view",
    ],
  },
  {
    id: RoleTemplateId.Accountant,
    code: "ACCOUNTANT",
    nameAr: "محاسب",
    nameEn: "Accountant",
    descriptionAr: "يقيّد الحركات المالية ويرحّلها ويراجعها ويطابق كشف البنك — ولا يقفل الفترة ولا يحرّر سندات النقدية.",
    descriptionEn: "Books, posts and reviews journal entries and matches the bank statement — does not close periods or write cash vouchers.",
    permissions: [
      DASHBOARD,
      "accounting.journal.view",
      "accounting.journal.create",
      "accounting.journal.post",
      "accounting.coa.view",
      "accounting.period.view",
      "accounting.reports.view",
      "treasury.cash_voucher.view",
      "treasury.reconciliation.view",
      "treasury.reconciliation.match",
      "treasury.reconciliation.post_entry",
      "sales.invoice.view",
      "purchases.invoice.view",
      "sales.invoice.classify_tax",
      "purchases.invoice.classify_tax",
      "accounting.eta.view",
    ],
  },
  {
    id: RoleTemplateId.WarehouseKeeper,
    code: "WAREHOUSE_KEEPER",
    nameAr: "أمين مخزن",
    nameEn: "Warehouse keeper",
    descriptionAr: "يستلم البضاعة ويحوّل المخزون ويجري الجرد — دون تسويات أو اعتماد جرد.",
    descriptionEn: "Receives goods, transfers stock and counts — without stock adjustments or count approval.",
    permissions: [
      DASHBOARD,
      "inventory.stock.view",
      "inventory.transfer.view",
      "inventory.transfer.create",
      "inventory.count.view",
      "inventory.count.create",
      "inventory.count.assign",
      "inventory.count.scan",
      "inventory.item.view",
      "purchases.receipt.view",
      "purchases.receipt.create",
      "purchases.receipt.confirm",
      "purchases.supplier.view",
      "purchases.order.view",
    ],
  },
  {
    id: RoleTemplateId.SalesRep,
    code: "SALES_REP",
    nameAr: "مندوب مبيعات",
    nameEn: "Sales rep",
    descriptionAr: "يصدر عروض الأسعار والفواتير لعملائه فقط — دون إلغاء الفواتير أو تعديل الأسعار.",
    descriptionEn: "Issues quotes and invoices for their own customers only — cannot void invoices or edit price lists.",
    permissions: [
      DASHBOARD,
      "sales.quote.view_own",
      "sales.quote.create",
      "sales.invoice.view_own",
      "sales.invoice.create",
      "sales.customer.view",
      "inventory.stock.view",
    ],
  },
  {
    id: RoleTemplateId.Manager,
    code: "MANAGER",
    nameAr: "مدير",
    nameEn: "Manager",
    descriptionAr: "يتابع بيع وشراء ومخزون الفرع ويعتمد سندات الخزينة والتحويلات والجرد وإجازات الفريق — ولا يحرّر السندات.",
    descriptionEn: "Oversees branch sales, purchasing and stock and approves treasury vouchers, transfers, counts and team leave — does not write the vouchers.",
    permissions: [
      DASHBOARD,
      "accounting.journal.view",
      "accounting.coa.view",
      "sales.price_list.view",
      "purchases.supplier.view",
      "sales.invoice.view",
      "sales.invoice.view_all",
      "sales.invoice.create",
      "sales.invoice.confirm",
      "sales.quote.view",
      "sales.customer.view",
      "purchases.invoice.view",
      "purchases.order.view",
      "inventory.item.view",
      "inventory.stock.view",
      "inventory.transfer.view",
      "inventory.transfer.confirm",
      "inventory.count.view",
      "inventory.count.confirm",
      "inventory.count.review",
      "inventory.count.approve",
      "inventory.adjustment.view",
      "treasury.cash_voucher.view",
      "treasury.cash_voucher.confirm",
      "accounting.reports.view",
      "hr.employee.view",
      "hr.attendance.view",
      "hr.leave.view",
      "hr.leave.approve",
      "workflow.view",
    ],
  },
  {
    id: RoleTemplateId.Auditor,
    code: "AUDITOR",
    nameAr: "مراجع (قراءة فقط)",
    nameEn: "Auditor (read-only)",
    descriptionAr: "يقرأ كل شيء ولا يغيّر أي شيء.",
    descriptionEn: "Reads everything and changes nothing.",
    permissions: AUDITOR_READS,
  },
  {
    id: RoleTemplateId.ExternalAuditor,
    code: "EXTERNAL_AUDITOR",
    nameAr: "مراجع خارجي (وصول مؤقت، قراءة فقط)",
    nameEn: "Auditor (time-boxed, read-only)",
    descriptionAr: "لمراقب الحسابات من خارج المنشأة: يقرأ الدفاتر ويُعدّ حزمة أدلة المراجعة الموقّعة، ولا يغيّر شيئًا، وينتهي دخوله تلقائيًا في التاريخ المحدد للمستخدم.",
    descriptionEn: "For an outside auditor: reads the books and builds the signed evidence pack, changes nothing, and loses access automatically on the user's expiry date.",
    permissions: [...AUDITOR_READS, "audit.evidence_pack.build"],
    accessDays: EXTERNAL_AUDITOR_ACCESS_DAYS,
  },
];

export function findRoleTemplate(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((template) => template.id === id);
}

export function timeBoxedTemplateForRoleCode(roleCode: string | null | undefined): RoleTemplate | undefined {
  if (!roleCode) return undefined;
  return ROLE_TEMPLATES.find(
    (template) => template.accessDays !== undefined && (roleCode === template.code || roleCode.startsWith(`${template.code}_`)),
  );
}

export interface RoleTemplateProblems {
  readonly unknownPermissions: readonly string[];
  readonly sodConflicts: readonly SodConflictMatch[];
}

export function roleTemplateProblems(template: Pick<RoleTemplate, "permissions">): RoleTemplateProblems {
  return {
    unknownPermissions: template.permissions.filter((code) => code === WILDCARD_PERMISSION || !isKnownPermission(code)),
    sodConflicts: detectSodConflicts(template.permissions),
  };
}

export interface LicensedTemplatePermissions {
  readonly granted: readonly string[];
  readonly omitted: readonly string[];
}

export function licensedTemplatePermissions(
  template: Pick<RoleTemplate, "permissions">,
  entitlements: Entitlements,
): LicensedTemplatePermissions {
  const granted: string[] = [];
  const omitted: string[] = [];
  for (const code of template.permissions) {
    const module = getPermission(code)?.module;
    (module !== undefined && isModuleLicensed(module, entitlements) ? granted : omitted).push(code);
  }
  return { granted, omitted };
}
