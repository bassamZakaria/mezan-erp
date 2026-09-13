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
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}
