/**
 * Modules this build can actually serve, used as the default entitlements the
 * `/roles` route validates grants against and as what `GET /entitlements`
 * reports. Listing a module here makes its permissions grantable, so an
 * unimplemented domain must stay out: `pos` has no domain, routes or
 * persistence anywhere in this repo. Ids are ENTITLEMENT ids, not catalog
 * ids — the catalog's `cheques` module is the `financial_papers` entitlement
 * (packages/domain/src/permissions/module-licensing.ts).
 */
export const MODULE_CATALOG = [
  "dashboard",
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
  "transactions",
  "admin",
  "notifications",
  "projects",
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}
