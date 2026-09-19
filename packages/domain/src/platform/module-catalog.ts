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
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}
