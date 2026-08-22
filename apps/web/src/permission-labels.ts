import type { PermissionDef } from "@mezan/domain";

/**
 * Presentation-only labels for the permission matrix. The catalog
 * (`@mezan/domain` `permissions/catalog.ts`) intentionally carries no Arabic
 * copy per permission — only per-module names (`MODULES[i].labelAr`) — so the
 * ~268 individual permission labels shown here are DERIVED, not sourced from
 * the catalog: `<entity segment> — <action verb, Arabic>`. This keeps every
 * card's meaning traceable to its exact `module.entity.action` code (always
 * shown alongside, monospace) rather than inventing bespoke prose per
 * permission. A hand-authored bilingual copy pass is real follow-up work, not
 * something to fabricate here.
 */

const ACTION_LABELS: Readonly<Record<string, string>> = {
  view: "عرض",
  view_own: "عرض الخاص بي",
  view_all: "عرض الكل",
  view_cost: "عرض التكلفة",
  view_salary: "عرض الراتب",
  view_personal: "عرض البيانات الشخصية",
  create: "إنشاء",
  edit: "تعديل",
  edit_cost: "تعديل التكلفة",
  delete_draft: "حذف المسودة",
  confirm: "تأكيد",
  void: "إبطال",
  cancel: "إلغاء",
  approve: "اعتماد",
  reject: "رفض",
  manage: "إدارة",
  print: "طباعة",
  merge: "دمج",
  close: "إغلاق",
  reopen: "إعادة فتح",
  run: "تشغيل",
  deactivate: "تعطيل",
  assign: "إسناد",
  convert: "تحويل",
  override: "تجاوز",
  rebuild: "إعادة بناء",
  open: "فتح",
  open_session: "فتح الوردية",
  close_session: "إغلاق الوردية",
  settle: "تسوية",
  terminate: "إنهاء الخدمة",
  apply_preset: "تطبيق نموذج",
  calculate: "احتساب",
  pay: "دفع",
  dispose: "استبعاد",
  submit: "إرسال",
  import: "استيراد",
  match: "مطابقة",
  finalize: "إنهاء نهائي",
  force_close: "إغلاق قسري",
  set_priority: "تحديد الأولوية",
  discount: "خصم",
  refund: "استرداد",
  suspend: "تعليق",
  resume: "استئناف",
  collect: "تحصيل",
  bounce: "ارتداد",
  deposit: "إيداع",
  migrate_open: "ترحيل الرصيد الافتتاحي",
  year_end: "إغلاق نهاية السنة",
  order: "طلب",
  operate: "تشغيل",
  recall: "استدعاء",
  manage_own: "إدارة الخاص بي",
  execute: "تنفيذ",
};

/** `module.entity.action` -> `entity`; `module.action` (no entity) -> `module`. */
export function entitySegment(code: string): string {
  const parts = code.split(".");
  return parts.length >= 3 ? (parts[1] as string) : (parts[0] as string);
}

function actionSegment(code: string): string {
  const parts = code.split(".");
  return parts[parts.length - 1] as string;
}

/** Human-ish label: Arabic verb for the action, entity segment kept as a readable identifier. */
export function permissionLabel(permission: PermissionDef): string {
  const entity = entitySegment(permission.code).replace(/_/g, " ");
  const action = ACTION_LABELS[actionSegment(permission.code)] ?? actionSegment(permission.code);
  return `${action} — ${entity}`;
}

/** Sub-group label for the matrix: the entity segment, title-cased. */
export function subgroupLabel(permission: PermissionDef): string {
  const entity = entitySegment(permission.code).replace(/_/g, " ");
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}
