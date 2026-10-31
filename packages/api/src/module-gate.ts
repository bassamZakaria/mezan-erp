import type { Context, MiddlewareHandler } from "hono";
import {
  hasModule, hasReadOnlyModule, moduleNotLicensedMessageAr, parentOf, SUB_MODULE_NAMES, moduleReadOnlyRefusal, MODULE_NAME_AR as DOMAIN_MODULE_NAME_AR, MODULES,
  type Entitlements, type ModuleReadOnlyRefusal, type PlanLabel,
} from "@mezan/domain";
import { POS_MODULE_ROUTES } from "./pos/route-prefixes.js";
import { ENH_MODULE_ROUTES } from "./enh/route-prefixes.js";

declare module "hono" {
  interface ContextVariableMap {
    entitlements?: Entitlements;
  }
}

/**
 * Module-gate middleware — rejects calls into a module the current
 * entitlements do not license, with 403 (docs/archive/plan.md §2.5, §5.2).
 *
 * The domain owns the actual capability check (`hasModule`); this is only the
 * transport binding. The entitlements themselves are resolved per request via
 * the injected `resolveEntitlements` — cloud pulls them off the JWT/tenant,
 * desktop off the verified license — so the API layer never assumes a source.
 */
export type EntitlementsResolver = (
  c: Context,
) => Entitlements | null | undefined | Promise<Entitlements | null | undefined>;

const MODULE_NAME_AR: Readonly<Record<string, string>> = {
  ...DOMAIN_MODULE_NAME_AR,
  ...POS_MODULE_ROUTES.namesAr,
  ...ENH_MODULE_ROUTES.namesAr,
};

/**
 * Which mounted route prefix belongs to which licensable module.
 *
 * ONLY module surface appears here. Settings, users, roles, documents, audit,
 * reports, backup, `/auth`, `/license` and the LAN protocol are platform: a
 * licence that gates them would lock an owner out of their own administration
 * and out of the screen that explains why. Ids are ENTITLEMENT ids
 * (packages/domain/src/permissions/module-licensing.ts).
 */
const CORE_MODULE_ROUTE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["/sales-invoices", "sales"],
  ["/sales-quotes", "sales"],
  ["/sales-returns", "sales"],
  ["/sales", "sales"],
  ["/customers", "sales"],
  ["/price-lists", "sales"],
  ["/promotions", "sales"],
  ["/purchases", "purchases"],
  ["/purchase-returns", "purchases"],
  ["/rfqs", "purchases"],
  ["/suppliers", "purchases"],
  ["/landed-costs", "purchases"],
  ["/inventory", "inventory"],
  ["/items", "inventory"],
  ["/item-units", "inventory"],
  ["/item-categories", "inventory"],
  ["/item-brands", "inventory"],
  ["/item-seasons", "inventory"],
  ["/item-specifications", "inventory"],
  ["/barcode-config", "inventory"],
  ["/label-layouts", "inventory"],
  ["/gl", "accounting"],
  ["/accounts", "accounting"],
  ["/accounting", "accounting"],
  ["/fiscal-periods", "accounting"],
  ["/cost-centers", "accounting"],
  ["/cost-center-pl", "accounting"],
  ["/revaluation", "accounting"],
  ["/exchange-rates", "accounting"],
  ["/tax-rates", "accounting"],
  ["/tax-groups", "accounting"],
  ["/financial-reports", "accounting"],
  ["/treasury-accounts", "treasury"],
  ["/vouchers", "treasury"],
  ["/bank-statements", "treasury"],
  ["/reconciliation", "treasury"],
  ["/cheques", "financial_papers"],
  ["/installments", "installments"],
  ["/crm", "crm"],
  // HR is licensed by part (domain entitlements/sub-modules.ts). The mixed
  // `/hr/employees/:id/*` paths are settled by each route's permission gate.
  ["/hr/payroll", "hr.payroll"],
  ["/hr/advances", "hr.payroll"],
  ["/hr/attendance", "hr.time"],
  ["/hr/holidays", "hr.time"],
  ["/hr/leave-policies", "hr.time"],
  ["/hr/leave-balances", "hr.time"],
  ["/hr/leave-accrual-batches", "hr.time"],
  ["/hr/leave-requests", "hr.time"],
  ["/hr/contracts", "hr.contracts"],
  ["/hr/self", "hr.self"],
  ["/hr/employees", "hr.people"],
  ["/hr/departments", "hr.people"],
  ["/hr/job-titles", "hr.people"],
  ["/hr/dashboard", "hr.people"],
  ["/manufacturing", "manufacturing"],
  ["/assets", "assets"],
  ["/field", "field"],
  ["/projects", "projects"],
  ["/notifications", "notifications"],
  ["/notification-rules", "notifications"],
];

export const MODULE_ROUTE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ...CORE_MODULE_ROUTE_PREFIXES,
  ...POS_MODULE_ROUTES.prefixes,
  ...ENH_MODULE_ROUTES.prefixes,
];

/**
 * Binds the request's entitlements onto the Hono context, once, for every
 * permission gate below it to read (`permission-gate.ts`). Mirrors
 * `permissionRefusalReporting`'s shape: mounted once by `createApp`, and the
 * only way `c.get("entitlements")` is ever populated.
 *
 * Sets nothing when the resolver has nothing to say — a desktop app or a unit
 * test that builds routes directly never mounts this, and the permission
 * gates treat an absent binding as "no module check", not as a refusal.
 */
export function entitlementsBinding(resolve: EntitlementsResolver): MiddlewareHandler {
  return async function bindEntitlements(c, next) {
    const entitlements = await resolve(c);
    if (entitlements) c.set("entitlements", entitlements);
    await next();
  };
}

/**
 * Methods that only READ. DEC-31 rule 5: a module that has left the plan keeps
 * answering these — its data and its exports are the tenant's own records and
 * are never withheld — and refuses everything else with a reason, not a 403
 * that pretends the module was never there.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

function planLabelOf(entitlements: Entitlements): PlanLabel & { readonly code: string } {
  return {
    code: entitlements.plan,
    nameAr: entitlements.planNameAr ?? entitlements.plan,
    nameEn: entitlements.planNameEn ?? entitlements.plan,
  };
}

/**
 * How a module that left the tenant's entitlements answers, by method.
 *
 * `null` means "let the request through". Only a module the tenant never held
 * — not in any plan it ever had, never add-on, never trialled — reaches the
 * plain `MODULE_NOT_LICENSED` 403 above it.
 */
export function readOnlyModuleOutcome(
  entitlements: Entitlements,
  entitlementModuleId: string,
  method: string,
): ModuleReadOnlyRefusal | null | undefined {
  if (!hasReadOnlyModule(entitlements, entitlementModuleId)) return undefined;
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  return moduleReadOnlyRefusal(entitlementModuleId, planLabelOf(entitlements));
}

/** The 403 body a permission gate answers with when its permission's module isn't licensed. */
export function moduleRefusal(moduleId: string): { error: "MODULE_NOT_LICENSED"; module: string; message: string } {
  const parent = parentOf(moduleId);
  if (parent !== null) {
    const parentAr = MODULES.find((m) => m.id === parent)?.labelAr ?? parent;
    return {
      error: "MODULE_NOT_LICENSED",
      module: moduleId,
      message: `جزء ${SUB_MODULE_NAMES[moduleId]?.ar ?? moduleId} من ${parentAr} غير مفعّل في باقتكم`,
    };
  }
  const labelAr = MODULES.find((m) => m.id === moduleId)?.labelAr ?? moduleId;
  return {
    error: "MODULE_NOT_LICENSED",
    module: moduleId,
    message: `وحدة ${labelAr} غير مفعّلة في باقتكم`,
  };
}

/**
 * Builds a gate factory bound to one entitlements resolver. Apply the returned
 * `gate(moduleId)` to any route or router that belongs to a licensable module.
 *
 *   const gate = createModuleGate((c) => c.get("entitlements"));
 *   app.use("/manufacturing/*", gate("manufacturing"));
 */
export function createModuleGate(resolveEntitlements: EntitlementsResolver) {
  return function gate(moduleId: string): MiddlewareHandler {
    return async function moduleGate(c, next) {
      const entitlements = await resolveEntitlements(c);
      if (entitlements && !hasModule(entitlements, moduleId)) {
        const readOnly = readOnlyModuleOutcome(entitlements, moduleId, c.req.method);
        if (readOnly === null) return next();
        if (readOnly) return c.json(readOnly, 403);
      }
      if (!entitlements || !hasModule(entitlements, moduleId)) {
        return c.json(
          {
            error: "MODULE_NOT_LICENSED",
            module: moduleId,
            message: moduleNotLicensedMessageAr(moduleId, entitlements?.planNameAr, MODULE_NAME_AR),
          },
          403,
        );
      }
      await next();
    };
  };
}

/**
 * Gates one route on a licensable part, read from the entitlements already
 * bound to the request (`entitlementsBinding`). For a route whose permission
 * belongs to one part but whose data belongs to another — self-service
 * payslips need `hr.payroll` as well as `hr.self`.
 */
export function requireSubModule(moduleId: string): MiddlewareHandler {
  const gate = createModuleGate((c) => c.get("entitlements"))(moduleId);
  // No entitlements bound (a desktop route test, a unit app) means no module check, as in permission-gate.
  return async (c, next) => (c.get("entitlements") ? gate(c, next) : next());
}

/**
 * Mounts the gate over every module route prefix on one app.
 *
 * Both `/x` and `/x/*` are registered: Hono's wildcard does not match the bare
 * prefix, and a collection route (`GET /items`) is exactly the one a licence
 * has to be able to refuse.
 */
export function applyModuleGates(
  app: { use(path: string, handler: MiddlewareHandler): unknown },
  resolveEntitlements: EntitlementsResolver,
): void {
  const gate = createModuleGate(resolveEntitlements);
  for (const [prefix, moduleId] of MODULE_ROUTE_PREFIXES) {
    const mw = gate(moduleId);
    app.use(prefix, mw);
    app.use(`${prefix}/*`, mw);
  }
}
