import { SUB_MODULE_NAMES, parentOf } from "./sub-modules.js";

export const MODULE_NAME_AR: Readonly<Record<string, string>> = {
  sales: "المبيعات",
  purchases: "المشتريات",
  inventory: "المخازن",
  accounting: "المحاسبة",
  treasury: "الخزينة",
  installments: "الأقساط",
  financial_papers: "الأوراق المالية",
  crm: "إدارة العملاء",
  hr: "الموارد البشرية",
  manufacturing: "التصنيع",
  assets: "الأصول الثابتة",
  field: "البيع الميداني",
  projects: "المشروعات",
  notifications: "التنبيهات",
  pos: "نقاط البيع",
};

// INVARIANT: the ONE sentence for a module the licence does not carry. The
// server answers a refused route with it and the web shell shows it in place
// of a screen opened by its address, so the two cannot say different things.
export function moduleNotLicensedMessageAr(moduleId: string, planNameAr: string | undefined, namesAr: Readonly<Record<string, string>> = MODULE_NAME_AR): string {
  const parent = parentOf(moduleId);
  if (parent !== null) {
    const partAr = SUB_MODULE_NAMES[moduleId]?.ar ?? moduleId;
    const parentAr = namesAr[parent] ?? parent;
    return planNameAr
      ? `جزء ${partAr} من ${parentAr} ليس ضمن باقة «${planNameAr}». يمكنكم إضافته بترقية الباقة من صفحة الاشتراك.`
      : `جزء ${partAr} من ${parentAr} غير مُفعّل في ترخيص هذه النسخة. تواصل مع الدعم لإضافته إلى الاشتراك.`;
  }
  const nameAr = namesAr[moduleId] ?? moduleId;
  return planNameAr
    ? `وحدة ${nameAr} ليست ضمن باقة «${planNameAr}». يمكنكم إضافتها بترقية الباقة من صفحة الاشتراك.`
    : `وحدة ${nameAr} غير مُفعّلة في ترخيص هذه النسخة. تواصل مع الدعم لإضافتها إلى الاشتراك.`;
}
