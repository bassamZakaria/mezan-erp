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
  const nameAr = namesAr[moduleId] ?? moduleId;
  return planNameAr
    ? `وحدة ${nameAr} ليست ضمن باقة «${planNameAr}». يمكنكم إضافتها بترقية الباقة من صفحة الاشتراك.`
    : `وحدة ${nameAr} غير مُفعّلة في ترخيص هذه النسخة. تواصل مع الدعم لإضافتها إلى الاشتراك.`;
}
