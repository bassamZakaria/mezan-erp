/**
 * Modules this build can actually serve, used as the default entitlements the
 * `/roles` route validates grants against and as what `GET /entitlements`
 * reports. Listing a module here makes its permissions grantable, so an
 * unimplemented domain must stay out. `pos`, `dashboard` and `transactions`
 * are all absent for the same reason now (DEC-14): none has a permission left
 * to license. POS has no domain, routes or persistence anywhere in this repo;
 * the dashboard is gated by being signed in; the transactions screen never
 * existed. The one code POS used to carry — the discount ceiling on a SALES
 * invoice — moved to `sales.discount.approve`, where it is grantable, because
 * under the old name it sat in a module that is deliberately never licensed
 * and so could not be granted to anyone at all. Ids are ENTITLEMENT ids, not catalog ids — the catalog's `cheques`
 * module is the `financial_papers` entitlement
 * (packages/domain/src/permissions/module-licensing.ts).
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
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}
