/**
 * Modules this build can actually serve, used as the default entitlements the
 * `/roles` route validates grants against and as what `GET /entitlements`
 * reports. Listing a module here makes its permissions grantable, so an
 * unimplemented domain must stay out. `dashboard` and `transactions` stay
 * absent (DEC-14). `pos` is licensable (DEC-23) but is kept out of the seeded
 * SaaS plans until the POS close-out lane — see `create-platform.ts`. Ids are
 * ENTITLEMENT ids, not catalog ids — the catalog's `cheques` module is the
 * `financial_papers` entitlement (packages/domain/src/permissions/module-licensing.ts).
 */
export const MODULE_CATALOG = [
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "treasury",
  "installments",
  "financial_papers",
  "crm",
  "hr",
  "manufacturing",
  "assets",
  "field",
  "workflow",
  "audit",
  "admin",
  "notifications",
  "projects",
  "contracting",
  "pos",
  "integrations",
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}

export interface ModuleName {
  readonly ar: string;
  readonly en: string;
}

export const MODULE_NAMES: Readonly<Record<ModuleId, ModuleName>> = {
  sales: { ar: "المبيعات", en: "Sales" },
  purchases: { ar: "المشتريات", en: "Purchases" },
  inventory: { ar: "المخزون", en: "Inventory" },
  accounting: { ar: "المحاسبة", en: "Accounting" },
  treasury: { ar: "الخزينة", en: "Treasury" },
  installments: { ar: "الأقساط", en: "Instalments" },
  financial_papers: { ar: "الأوراق المالية", en: "Cheques" },
  crm: { ar: "إدارة العملاء", en: "CRM" },
  hr: { ar: "الموارد البشرية", en: "HR" },
  manufacturing: { ar: "التصنيع", en: "Manufacturing" },
  assets: { ar: "الأصول الثابتة", en: "Fixed assets" },
  field: { ar: "المبيعات الميدانية", en: "Field sales" },
  workflow: { ar: "سير العمل", en: "Workflow" },
  audit: { ar: "المراجعة", en: "Audit" },
  admin: { ar: "الإدارة", en: "Administration" },
  notifications: { ar: "الإشعارات", en: "Notifications" },
  projects: { ar: "المشروعات", en: "Projects" },
  contracting: { ar: "المقاولات", en: "Contracting" },
  pos: { ar: "نقاط البيع", en: "Point of sale" },
  integrations: { ar: "التكامل وواجهة البرمجة", en: "Integrations and API" },
};

// DEC-17 / DEC-27: served only by the cloud edition. A build that answers no `/api/v1` must not
// report the module as active, or its nav entry leads to a screen with nothing behind it.
export const CLOUD_ONLY_MODULES: readonly ModuleId[] = ["integrations"];

export function isCloudOnlyModule(id: string): boolean {
  return (CLOUD_ONLY_MODULES as readonly string[]).includes(id);
}

export function moduleName(id: string): ModuleName {
  return isKnownModule(id) ? MODULE_NAMES[id] : { ar: id, en: id };
}
