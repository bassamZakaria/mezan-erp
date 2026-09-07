import type { Context, MiddlewareHandler } from "hono";
import { hasModule, type Entitlements } from "@mezan/domain";

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

/** Arabic name of each licensable module, so a refusal names what was bought. */
const MODULE_NAME_AR: Readonly<Record<string, string>> = {
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
export const MODULE_ROUTE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
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
  ["/hr", "hr"],
  ["/manufacturing", "manufacturing"],
  ["/assets", "assets"],
  ["/field", "field"],
  ["/projects", "projects"],
  ["/notifications", "notifications"],
  ["/notification-rules", "notifications"],
];

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
      if (!entitlements || !hasModule(entitlements, moduleId)) {
        const nameAr = MODULE_NAME_AR[moduleId] ?? moduleId;
        return c.json(
          {
            error: "MODULE_NOT_LICENSED",
            module: moduleId,
            // Arabic-first: the operator reads this, not the enum beside it.
            message:
              `وحدة ${nameAr} غير مُفعّلة في ترخيص هذه النسخة. ` +
              `تواصل مع الدعم لإضافتها إلى الاشتراك.`,
          },
          403,
        );
      }
      await next();
    };
  };
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
