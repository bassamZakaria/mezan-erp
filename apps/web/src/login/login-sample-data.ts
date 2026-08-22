/**
 * Login + first-run-wizard demo data — Cyag tenant, matching
 * apps/web/src/sample-data.ts's demoUser (محمد الشهابي) and the entitlements
 * shape @mezan/domain's `Entitlements` (packages/domain/src/entitlements)
 * defines. Real auth (`docs/plan.md` desktop username+PIN login) and real
 * license activation (§2.5, Ed25519 `verifyLicense`) are both out of scope
 * for this screen — see FirstRunWizard's per-step stub notes.
 */

export const demoTenantName = "Cyag";
export const demoTenantPlanLabel = "Enterprise";

/** Demo-only PIN accepted by LoginScreen — never a real credential. */
export const DEMO_LOGIN_PIN = "1234";

export interface LicensedModule {
  key: string;
  label: string;
}

/** Mirrors `activeModules` from docs/catalog/09-settings-dashboard-ux.md's tenant settings payload. */
export const licensedModules: LicensedModule[] = [
  { key: "sales", label: "المبيعات" },
  { key: "purchases", label: "المشتريات" },
  { key: "inventory", label: "المخزون" },
  { key: "accounting", label: "المحاسبة" },
  { key: "treasury", label: "الخزينة" },
  { key: "pos", label: "نقاط البيع" },
  { key: "hr", label: "الموارد البشرية" },
  { key: "manufacturing", label: "التصنيع" },
  { key: "crm", label: "علاقات العملاء" },
];

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
