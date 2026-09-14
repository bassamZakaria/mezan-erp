/**
 * Modules this build can actually serve, used as the default entitlements the
 * `/roles` route validates grants against and as what `GET /entitlements`
 * reports. Listing a module here makes its permissions grantable, so an
 * unimplemented domain must stay out: `pos` has no domain, routes or
 * persistence anywhere in this repo, and its one surviving catalogue code
 * (`pos.discount.approve`) guards a SALES invoice's discount ceiling rather
 * than a till — listing `pos` here would make the rest of a module nobody can
 * serve look licensable. `dashboard` and `transactions` are gone for the
 * opposite reason (DEC-14): neither has a permission left to license, because
 * the dashboard is gated by being signed in and the transactions screen never
 * existed. Ids are ENTITLEMENT ids, not catalog ids — the catalog's `cheques`
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
