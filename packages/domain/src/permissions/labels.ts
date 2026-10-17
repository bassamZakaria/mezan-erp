export enum PermissionLabelLocale {
  Ar = "ar",
  En = "en",
}

export interface PermissionLabel {
  readonly ar: string;
  readonly en: string;
}

export const PERMISSION_ACTION_LABELS = {
  view: { ar: "عرض", en: "View" },
  post: { ar: "ترحيل", en: "Post" },
  reset: { ar: "إعادة ضبط", en: "Reset" },
  process: { ar: "معالجة", en: "Process" },
  generate: { ar: "توليد", en: "Generate" },
  send: { ar: "إرسال", en: "Send" },
  leave: { ar: "إجازاتي", en: "My leave" },
  payslip: { ar: "كشوف رواتبي", en: "My payslips" },
  advance: { ar: "سلفي", en: "My advances" },
  attendance: { ar: "حضوري", en: "My attendance" },
  clock: { ar: "تسجيل الحضور من الويب", en: "Web clock-in" },
  view_own: { ar: "عرض الخاص بي", en: "View own" },
  view_all: { ar: "عرض الكل", en: "View all" },
  view_cost: { ar: "عرض التكلفة", en: "View cost" },
  view_unattributed: { ar: "عرض القيود غير المخصصة لفرع", en: "View entries assigned to no branch" },
  view_salary: { ar: "عرض الراتب", en: "View salary" },
  view_personal: { ar: "عرض البيانات الشخصية", en: "View personal data" },
  create: { ar: "إنشاء", en: "Create" },
  edit: { ar: "تعديل", en: "Edit" },
  edit_cost: { ar: "تعديل التكلفة", en: "Edit cost" },
  delete_draft: { ar: "حذف المسودة", en: "Delete draft" },
  confirm: { ar: "تأكيد", en: "Confirm" },
  void: { ar: "إبطال", en: "Void" },
  classify_tax: { ar: "تصنيف ضريبة بند مرحّل", en: "Classify a posted line's tax" },
  cancel: { ar: "إلغاء", en: "Cancel" },
  approve: { ar: "اعتماد", en: "Approve" },
  reject: { ar: "رفض", en: "Reject" },
  manage: { ar: "إدارة", en: "Manage" },
  restore: { ar: "استعادة", en: "Restore" },
  unlock: { ar: "فكّ القفل", en: "Unlock" },
  print: { ar: "طباعة", en: "Print" },
  merge: { ar: "دمج", en: "Merge" },
  close: { ar: "إغلاق", en: "Close" },
  reopen: { ar: "إعادة فتح", en: "Reopen" },
  run: { ar: "تشغيل", en: "Run" },
  deactivate: { ar: "تعطيل", en: "Deactivate" },
  erase_personal: { ar: "محو البيانات الشخصية", en: "Erase personal data" },
  assign: { ar: "إسناد", en: "Assign" },
  convert: { ar: "تحويل", en: "Convert" },
  override: { ar: "تجاوز", en: "Override" },
  rebuild: { ar: "إعادة بناء", en: "Rebuild" },
  open: { ar: "فتح", en: "Open" },
  open_session: { ar: "فتح الوردية", en: "Open shift" },
  close_session: { ar: "إغلاق الوردية", en: "Close shift" },
  settle: { ar: "تسوية", en: "Settle" },
  terminate: { ar: "إنهاء الخدمة", en: "Terminate employment" },
  apply_preset: { ar: "تطبيق نموذج", en: "Apply preset" },
  calculate: { ar: "احتساب", en: "Calculate" },
  pay: { ar: "دفع", en: "Pay" },
  bank_file: { ar: "تصدير ملف تحويل الرواتب للبنك", en: "Export the salary bank file" },
  dispose: { ar: "استبعاد", en: "Dispose" },
  submit: { ar: "إرسال", en: "Submit" },
  import: { ar: "استيراد", en: "Import" },
  match: { ar: "مطابقة", en: "Match" },
  finalize: { ar: "إنهاء نهائي", en: "Finalize" },
  force_close: { ar: "إغلاق قسري", en: "Force close" },
  set_priority: { ar: "تحديد الأولوية", en: "Set priority" },
  discount: { ar: "خصم", en: "Discount" },
  refund: { ar: "استرداد", en: "Refund" },
  suspend: { ar: "تعليق", en: "Suspend" },
  resume: { ar: "استئناف", en: "Resume" },
  collect: { ar: "تحصيل", en: "Collect" },
  bounce: { ar: "ارتداد", en: "Bounce" },
  deposit: { ar: "إيداع", en: "Deposit" },
  migrate_open: { ar: "ترحيل الرصيد الافتتاحي", en: "Migrate opening balance" },
  year_end: { ar: "إغلاق نهاية السنة", en: "Year-end close" },
  order: { ar: "طلب", en: "Order" },
  operate: { ar: "تشغيل", en: "Operate" },
  recall: { ar: "استدعاء", en: "Recall" },
  manage_own: { ar: "إدارة الخاص بي", en: "Manage own" },
  execute: { ar: "تنفيذ", en: "Execute" },
  prepare: { ar: "إعداد", en: "Prepare" },
  certify: { ar: "اعتماد الاستشاري", en: "Certify" },
  release: { ar: "إفراج", en: "Release" },
  post_entry: { ar: "ترحيل قيد من الكشف", en: "Post entry from statement" },
  override_close: { ar: "تجاوز فحوص الإقفال", en: "Override close checks" },
  reverse: { ar: "عكس", en: "Reverse" },
  scan: { ar: "مسح وعدّ بالباركود", en: "Scan and count" },
  review: { ar: "مراجعة", en: "Review" },
} as const satisfies Record<string, PermissionLabel>;

export const PERMISSION_ENTITY_LABELS = {
  account: { ar: "حساب", en: "Account" },
  activity: { ar: "النشاط", en: "Activity" },
  adjustment: { ar: "تسوية", en: "Adjustment" },
  advance: { ar: "سلفة", en: "Advance" },
  allocation: { ar: "تخصيص", en: "Allocation" },
  assets: { ar: "الأصول", en: "Assets" },
  attendance: { ar: "الحضور", en: "Attendance" },
  bom: { ar: "قائمة المواد", en: "Bill of materials" },
  boq: { ar: "جدول الكميات", en: "Bill of quantities" },
  certificate: { ar: "مستخلص", en: "Progress certificate" },
  guarantee: { ar: "خطاب ضمان", en: "Letter of guarantee" },
  variation: { ar: "أمر تغيير", en: "Variation order" },
  retention: { ar: "المحتجزات الضمانية", en: "Retention" },
  branches: { ar: "الفروع", en: "Branches" },
  cash_voucher: { ar: "سند نقدي", en: "Cash voucher" },
  cheques: { ar: "الأوراق المالية", en: "Cheques" },
  coa: { ar: "شجرة الحسابات", en: "Chart of accounts" },
  config: { ar: "التهيئة", en: "Configuration" },
  contract: { ar: "عقد", en: "Contract" },
  count: { ar: "جرد", en: "Stock count" },
  customer360: { ar: "ملف العميل الشامل", en: "Customer 360" },
  customer: { ar: "عميل", en: "Customer" },
  customer_refund: { ar: "استرداد عميل", en: "Customer refund" },
  department: { ar: "قسم", en: "Department" },
  depreciation: { ar: "إهلاك", en: "Depreciation" },
  discount: { ar: "خصم", en: "Discount" },
  employee: { ar: "موظف", en: "Employee" },
  eta: { ar: "الفاتورة الإلكترونية", en: "E-invoicing" },
  exchange_rate: { ar: "سعر الصرف", en: "Exchange rate" },
  follow_up: { ar: "متابعة", en: "Follow-up" },
  installments: { ar: "أقساط", en: "Installments" },
  invoice: { ar: "فاتورة", en: "Invoice" },
  item: { ar: "صنف", en: "Item" },
  job_title: { ar: "مسمى وظيفي", en: "Job title" },
  journal: { ar: "قيد يومية", en: "Journal entry" },
  landed_cost: { ar: "التكلفة المستوردة", en: "Landed cost" },
  lead: { ar: "عميل محتمل", en: "Lead" },
  leave: { ar: "إجازة", en: "Leave" },
  leave_accrual: { ar: "استحقاق الإجازات", en: "Leave accrual" },
  self: { ar: "الخدمة الذاتية", en: "Self-service" },
  leave_policy: { ar: "سياسة الإجازات", en: "Leave policy" },
  logs: { ar: "السجلات", en: "Logs" },
  opportunity: { ar: "فرصة بيع", en: "Opportunity" },
  order: { ar: "أمر", en: "Order" },
  overdue: { ar: "المتأخرات", en: "Overdue" },
  payroll: { ar: "الرواتب", en: "Payroll" },
  period: { ar: "فترة مالية", en: "Fiscal period" },
  pipeline: { ar: "مسار البيع", en: "Pipeline" },
  plan: { ar: "الخطة", en: "Plan" },
  price: { ar: "سعر", en: "Price" },
  price_list: { ar: "قائمة أسعار", en: "Price list" },
  project: { ar: "مشروع", en: "Project" },
  promotion: { ar: "عرض ترويجي", en: "Promotion" },
  quote: { ar: "عرض سعر", en: "Quotation" },
  receipt: { ar: "إذن استلام", en: "Goods receipt" },
  reconciliation: { ar: "مطابقة", en: "Reconciliation" },
  reports: { ar: "التقارير", en: "Reports" },
  return: { ar: "مرتجع", en: "Return" },
  rfq: { ar: "طلب عرض سعر", en: "RFQ" },
  roles: { ar: "الأدوار", en: "Roles" },
  rule: { ar: "قاعدة", en: "Rule" },
  sequences: { ar: "تسلسلات الترقيم", en: "Numbering sequences" },
  backup: { ar: "النسخ الاحتياطي", en: "Backup" },
  devices: { ar: "الأجهزة المتصلة", en: "Connected devices" },
  settings: { ar: "الإعدادات", en: "Settings" },
  stock: { ar: "المخزون", en: "Stock" },
  supplier360: { ar: "ملف المورد الشامل", en: "Supplier 360" },
  supplier: { ar: "مورد", en: "Supplier" },
  tax: { ar: "ضريبة", en: "Tax" },
  template: { ar: "قالب", en: "Template" },
  tenant: { ar: "المنشأة", en: "Company" },
  transfer: { ar: "تحويل", en: "Transfer" },
  users: { ar: "المستخدمون", en: "Users" },
  valuation: { ar: "تقييم المخزون", en: "Valuation" },
  van_trip: { ar: "رحلة مندوب", en: "Van trip" },
  warehouses: { ar: "المستودعات", en: "Warehouses" },
  wo: { ar: "أمر تصنيع", en: "Work order" },
  workflow: { ar: "سير العمل", en: "Workflow" },
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" },
  writedown: { ar: "تخفيض القيمة", en: "Write-down" },
  cockpit: { ar: "لوحة المالك", en: "owner cockpit" },
  cash_forecast: { ar: "توقع السيولة", en: "cash forecast" },
  recurring: { ar: "القيود المتكررة", en: "Recurring journals" },
  collections: { ar: "تحصيل المستحقات", en: "Receivables collection" },
  pricing_guard: { ar: "رقابة الحد الأدنى للأسعار", en: "Price floor rules" },
  reorder: { ar: "إعادة الطلب", en: "Reorder" },
  health: { ar: "صحة النظام", en: "System health" },
  expiry: { ar: "الصلاحية والتشغيلات", en: "Expiry and batches" },
  owner_digest: { ar: "ملخص المالك", en: "Owner digest" },
  terminal: { ar: "جهاز نقطة البيع", en: "POS terminal" },
  revaluation: { ar: "إعادة تقييم العملات", en: "FX revaluation" },
  year_end_close: { ar: "إقفال نهاية السنة", en: "Year-end close" },
  disposal: { ar: "استبعاد أصل", en: "Asset disposal" },
  provision: { ar: "مخصص الإجازات ونهاية الخدمة", en: "Leave and end-of-service provision" },
  equipment_log: { ar: "سجل تشغيل المعدات", en: "Equipment log" },
  consumption: { ar: "صرف مواد للموقع", en: "Site material consumption" },
} as const satisfies Record<string, PermissionLabel>;

type ActionSegment = keyof typeof PERMISSION_ACTION_LABELS;
type EntitySegment = keyof typeof PERMISSION_ENTITY_LABELS;

export type PermissionLabelTranslations = { readonly [K in `perm.action.${ActionSegment}` | `perm.entity.${EntitySegment}`]: string };

export function permissionLabelTranslations(locale: PermissionLabelLocale): PermissionLabelTranslations {
  const out: Record<string, string> = {};
  for (const [segment, label] of Object.entries(PERMISSION_ACTION_LABELS)) out[`perm.action.${segment}`] = label[locale];
  for (const [segment, label] of Object.entries(PERMISSION_ENTITY_LABELS)) out[`perm.entity.${segment}`] = label[locale];
  return out as PermissionLabelTranslations;
}

function lookup(table: Readonly<Record<string, PermissionLabel>>, segment: string): PermissionLabel | undefined {
  return Object.prototype.hasOwnProperty.call(table, segment) ? table[segment] : undefined;
}

export function permissionEntitySegment(code: string): string {
  const parts = code.split(".");
  return parts.length >= 3 ? (parts[1] as string) : (parts[0] as string);
}

// Never falls back to the raw code: a permission code in a user-facing sentence is a reconnaissance hint (D339).
export function permissionHumanLabel(code: string, locale: PermissionLabelLocale): string {
  const parts = code.split(".");
  const action = lookup(PERMISSION_ACTION_LABELS, parts[parts.length - 1] ?? "");
  const entity = lookup(PERMISSION_ENTITY_LABELS, permissionEntitySegment(code));
  const fallback = locale === PermissionLabelLocale.Ar ? "هذه العملية" : "this operation";
  if (!action && !entity) return fallback;
  if (!entity) return action![locale];
  if (!action) return entity[locale];
  return `${action[locale]} — ${entity[locale]}`;
}
