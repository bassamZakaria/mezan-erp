/**
 * Labels for the first-run wizard's seed step. These describe what the real
 * `POST /bootstrap` endpoint actually creates — they are not stand-in data.
 */

export interface SeedTask {
  key: string;
  label: string;
  hint: string;
}

/** The first-run wizard's "seed" step — COA/tax/numbering/branch/warehouse, per the Phase-1 task scope. */
export const seedTasks: SeedTask[] = [
  { key: "coa", label: "دليل الحسابات", hint: "شجرة حسابات افتراضية تناسب نشاطك" },
  { key: "tax", label: "الضريبة", hint: "ضريبة القيمة المضافة 14% حسب الإعدادات الافتراضية" },
  { key: "numbering", label: "تسلسلات الترقيم", hint: "تسلسلات الفواتير والسندات والقيود" },
  { key: "branch", label: "الفرع الرئيسي", hint: "فرع افتراضي واحد يمكن تعديله لاحقاً" },
  { key: "warehouse", label: "المستودع الرئيسي", hint: "مستودع مرتبط بالفرع الرئيسي" },
];
