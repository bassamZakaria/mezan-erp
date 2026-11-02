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
  integrations: "التكامل وواجهة البرمجة",
};

export const MODULE_NAME_EN: Readonly<Record<string, string>> = {
  sales: "Sales",
  purchases: "Purchases",
  inventory: "Inventory",
  accounting: "Accounting",
  treasury: "Treasury",
  installments: "Installments",
  financial_papers: "Financial papers",
  crm: "CRM",
  hr: "Human resources",
  manufacturing: "Manufacturing",
  assets: "Fixed assets",
  field: "Field sales",
  projects: "Projects",
  notifications: "Notifications",
  pos: "Point of sale",
  integrations: "Integrations and API",
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

export function moduleNotLicensedMessageEn(moduleId: string, planNameEn: string | undefined, namesEn: Readonly<Record<string, string>> = MODULE_NAME_EN): string {
  const parent = parentOf(moduleId);
  const subject =
    parent !== null
      ? `The ${SUB_MODULE_NAMES[moduleId]?.en ?? moduleId} part of ${namesEn[parent] ?? parent}`
      : `The ${namesEn[moduleId] ?? moduleId} module`;
  return planNameEn
    ? `${subject} is not in the "${planNameEn}" plan. You can add it by upgrading the plan from the subscription page.`
    : `${subject} is not enabled in this copy's licence. Contact support to add it to the subscription.`;
}
