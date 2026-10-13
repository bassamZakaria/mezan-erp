/**
 * Mezan permission catalog — a versioned TS data manifest.
 *
 * Single source of truth for the 248 permissions across 19 modules the product
 * actually enforces, descended from the matrix in
 * `docs/archive/catalog/09-settings-dashboard-ux.md` §permission matrix and mandated as
 * "data (a versioned TS manifest)" by `docs/archive/plan.md` §5.2. The role editor, the
 * API guards, and the docs are all meant to read this one manifest.
 *
 * Codes use `module.entity.action` dot notation. A few carry the ⚠ `sensitive`
 * flag (cost/salary visibility, money-reversing actions) and one is
 * platform-admin-only. The dependency graph (`deps`) is authoritative:
 * granting an action implies its prerequisites (resolved in `./resolve.ts`).
 *
 * WHAT THIS MANIFEST PROMISES (DEC-14). A code listed here is a control the
 * server enforces, not a capability the matrix once imagined. The catalog used
 * to carry 298 codes across 21 modules, transcribed from the matrix verbatim,
 * and 67 of them named something with no route, no screen and no persistence
 * behind it — a whole `pos` module, a `dashboard` module gated by login rather
 * than by permission, per-voucher-type `.view` tiers over a single voucher
 * list, print rights that are renderer-side, approvals that DEC-2 made
 * ROLE-based and a permission code can therefore never honour. Every one of
 * those was a checkbox an admin could tick to no effect, which is worse than a
 * missing feature: it reads as a control that is in force. They are gone. The
 * per-module totals are asserted at load time by `assertCatalogIntegrity()`
 * against the counts the catalog documents.
 */

import type { PermissionRow } from "./fragment.js";
import { POS_PERMISSION_MODULES, POS_PERMISSION_ROWS } from "../pos/permissions.js";
import { ENH_PERMISSION_MODULES, ENH_PERMISSION_ROWS } from "../enh/permissions.js";

/** The three-tier visibility model: own records / all-in-branch / all-cross-branch. */
export type VisibilityTier = "view" | "view_own" | "view_all";

export interface PermissionDef {
  /** Full `module.entity.action` code. */
  readonly code: string;
  /** Owning module id (first dotted segment). */
  readonly module: string;
  /** Prerequisite permission codes implied when this one is granted. */
  readonly deps: readonly string[];
  /** ⚠ sensitive metadata — distinct UI treatment + audit weight. */
  readonly sensitive: boolean;
  /** Listed in the tenant role editor but only a platform admin may grant it. */
  readonly platformAdminOnly: boolean;
}

export interface ModuleDef {
  readonly id: string;
  /** Arabic display name as seen in the matrix. */
  readonly labelAr: string;
  /** Documented permission count for this module (integrity-checked). */
  readonly count: number;
}

/** Bump when the catalog shape or contents change in a breaking way. */
export const CATALOG_VERSION = 3 as const;

const CORE_MODULES: readonly ModuleDef[] = [
  { id: "sales", labelAr: "المبيعات", count: 28 },
  { id: "purchases", labelAr: "المشتريات", count: 32 },
  { id: "inventory", labelAr: "المخزون", count: 22 },
  { id: "field", labelAr: "المبيعات الميدانية", count: 4 },
  { id: "accounting", labelAr: "المحاسبة", count: 19 },
  { id: "treasury", labelAr: "الخزينة", count: 19 },
  { id: "workflow", labelAr: "سير العمل", count: 5 },
  { id: "hr", labelAr: "الموارد البشرية", count: 40 },
  { id: "crm", labelAr: "إدارة العملاء", count: 13 },
  { id: "installments", labelAr: "الأقساط", count: 7 },
  { id: "cheques", labelAr: "الأوراق المالية", count: 6 },
  { id: "manufacturing", labelAr: "التصنيع", count: 5 },
  { id: "assets", labelAr: "الأصول", count: 8 },
  { id: "admin", labelAr: "الإدارة", count: 24 },
  { id: "notifications", labelAr: "الإشعارات", count: 2 },
  { id: "audit", labelAr: "المراجعة", count: 1 },
  // --- phase11/crm-projects-assets-field — Projects & Contracting isn't part of
  // the original matrix (docs/archive/catalog/09); it's added
  // fresh per docs/archive/catalog/07-mfg-projects-assets.md "المشاريع والمقاولات".
  { id: "projects", labelAr: "المشاريع", count: 2 },
  // المقاولات — docs/artifacts/mezan-contracting-designs.html §06 "Four rights, not
  // one": the certificate's preparer, certifier, approver and collector are four
  // different people, and one `manage` right cannot express that.
  { id: "contracting", labelAr: "المقاولات", count: 15 },
  { id: "dashboard", labelAr: "لوحة التحكم", count: 1 },
];

/**
 * Compact source rows: [code, depsCsv?, flags?].
 *   depsCsv — comma-separated full prerequisite codes.
 *   flags   — "s" sensitive, "p" platform-admin-only, "sp" both.
 * Expanded into `PermissionDef` below. Grouped by module, in matrix order.
 */
type Row = PermissionRow;

const ROWS: readonly Row[] = [
  // 1. sales — 27
  ["sales.invoice.view"],
  ["sales.invoice.view_own"],
  ["sales.invoice.view_all", "sales.invoice.view"],
  ["sales.invoice.view_cost", "sales.invoice.view", "s"],
  ["sales.invoice.create", "sales.invoice.view_own"],
  ["sales.invoice.edit", "sales.invoice.view_own"],
  ["sales.invoice.confirm", "sales.invoice.view_own"],
  ["sales.invoice.void", "sales.invoice.view_own"],
  ["sales.invoice.delete_draft", "sales.invoice.view_own"],
  ["sales.customer.view"],
  ["sales.customer.create", "sales.customer.view"],
  ["sales.customer.edit", "sales.customer.view"],
  ["sales.quote.view"],
  ["sales.quote.view_own"],
  ["sales.quote.create", "sales.quote.view_own"],
  ["sales.quote.edit", "sales.quote.view_own"],
  ["sales.quote.send", "sales.quote.view_own"],
  ["sales.return.view"],
  ["sales.return.view_own"],
  ["sales.return.create", "sales.return.view_own"],
  ["sales.return.confirm", "sales.return.view_own"],
  ["sales.return.void", "sales.return.view_own"],
  ["sales.price_list.view"],
  ["sales.price_list.manage", "sales.price_list.view"],
  ["sales.price.override", "sales.invoice.create"],
  /*
   * Was `pos.discount.approve`, which is where it shipped and where it did not
   * belong: it gates the discount ceiling on a SALES invoice, never a till.
   * Under that name it survived DEC-14 as the last member of a module the
   * platform does not license, so `licensedPermissions()` filtered it out of
   * the role editor and the only way to hold it was the `*` wildcard — an
   * enforced control nobody could grant. The route still accepts the old code
   * so existing grants keep working.
   */
  ["sales.discount.approve", "sales.invoice.create"],
  ["sales.promotion.view"],
  ["sales.promotion.manage", "sales.promotion.view"],

  // 2. purchases — 31
  ["purchases.supplier.view"],
  ["purchases.supplier.create", "purchases.supplier.view"],
  ["purchases.supplier.edit", "purchases.supplier.view"],
  ["purchases.order.view"],
  ["purchases.order.create", "purchases.order.view"],
  ["purchases.order.cancel", "purchases.order.view"],
  ["purchases.order.edit", "purchases.order.view"],
  ["purchases.order.confirm", "purchases.order.view"],
  ["purchases.rfq.view"],
  ["purchases.rfq.create", "purchases.rfq.view"],
  ["purchases.rfq.convert", "purchases.rfq.view,purchases.order.create"],
  ["purchases.receipt.view"],
  ["purchases.receipt.create", "purchases.receipt.view"],
  ["purchases.receipt.edit_cost", "purchases.receipt.create"],
  ["purchases.receipt.confirm", "purchases.receipt.view"],
  ["purchases.receipt.void", "purchases.receipt.view"],
  ["purchases.invoice.view"],
  ["purchases.invoice.view_own"],
  ["purchases.invoice.create", "purchases.invoice.view_own"],
  ["purchases.invoice.confirm", "purchases.invoice.view_own"],
  ["purchases.invoice.void", "purchases.invoice.view_own"],
  ["purchases.invoice.edit", "purchases.invoice.view_own"],
  ["purchases.return.view"],
  ["purchases.return.create", "purchases.return.view"],
  ["purchases.return.confirm", "purchases.return.view"],
  ["purchases.return.void", "purchases.return.view"],
  ["purchases.landed_cost.view"],
  ["purchases.landed_cost.create", "purchases.landed_cost.view"],
  ["purchases.landed_cost.confirm", "purchases.landed_cost.view"],
  ["purchases.landed_cost.void", "purchases.landed_cost.view"],
  ["purchases.landed_cost.reverse", "purchases.landed_cost.view", "s"],
  ["purchases.supplier360.view", "purchases.supplier.view"],

  // 3. inventory — 20
  ["inventory.item.view"],
  ["inventory.item.create", "inventory.item.view"],
  ["inventory.item.edit", "inventory.item.view"],
  ["inventory.stock.view"],
  ["inventory.transfer.view"],
  ["inventory.transfer.create", "inventory.transfer.view"],
  ["inventory.transfer.confirm", "inventory.transfer.view"],
  ["inventory.adjustment.view"],
  ["inventory.adjustment.create", "inventory.adjustment.view"],
  ["inventory.adjustment.confirm", "inventory.adjustment.view"],
  ["inventory.adjustment.reverse", "inventory.adjustment.view", "s"],
  ["inventory.valuation.view", "inventory.stock.view"],
  ["inventory.valuation.rebuild", "inventory.valuation.view"],
  ["inventory.count.view"],
  ["inventory.count.create", "inventory.count.view"],
  ["inventory.count.confirm", "inventory.count.view"],
  // inv/labels-templates-writedown — product templates, aging write-down
  ["inventory.template.view"],
  ["inventory.template.manage", "inventory.template.view"],
  ["inventory.template.generate", "inventory.template.view"],
  ["inventory.writedown.view"],
  ["inventory.writedown.run", "inventory.writedown.view"],
  ["inventory.writedown.reverse", "inventory.writedown.view", "s"],

  // 4. field (van sales) — 4
  ["field.van_trip.view"],
  ["field.van_trip.view_own"],
  ["field.van_trip.open", "field.van_trip.view_own"],
  ["field.van_trip.settle", "field.van_trip.view"],

  // 5. accounting — 16
  ["accounting.coa.view"],
  ["accounting.coa.manage", "accounting.coa.view"],
  ["accounting.journal.view"],
  ["accounting.journal.create", "accounting.journal.view"],
  ["accounting.journal.post", "accounting.journal.view"],
  ["accounting.period.view"],
  ["accounting.period.close", "accounting.period.view"],
  ["accounting.period.reopen", "accounting.period.close"],
  ["accounting.year_end_close.reverse", "accounting.period.view", "s"],
  ["accounting.revaluation.reverse", "accounting.journal.view", "s"],
  ["accounting.reports.view"],
  ["accounting.reports.view_unattributed", "accounting.reports.view", "s"],
  ["accounting.exchange_rate.manage"],
  ["accounting.exchange_rate.approve", "accounting.exchange_rate.manage"],
  ["accounting.tax.view"],
  ["accounting.tax.manage", "accounting.tax.view"],
  ["accounting.eta.view"],
  ["accounting.eta.submit", "accounting.eta.view"],
  ["accounting.eta.cancel", "accounting.eta.view"],

  // 6. treasury — 19
  ["treasury.account.view"],
  ["treasury.account.manage", "treasury.account.view"],
  ["treasury.allocation.view", "treasury.account.view"],
  ["treasury.allocation.manage", "treasury.account.view"],
  ["treasury.cash_voucher.view", "treasury.account.view"],
  ["treasury.cash_voucher.create", "treasury.cash_voucher.view,treasury.account.view"],
  ["treasury.cash_voucher.confirm", "treasury.cash_voucher.view"],
  ["treasury.cash_voucher.void", "treasury.cash_voucher.view"],
  /*
   * The two voucher types that are NOT ordinary till traffic.
   *
   * There is one voucher list and one voucher document, so there is one
   * `.view` — `treasury.cash_voucher.view`, which every row below depends on.
   * What differs is the ACT: handing cash back to a customer and moving money
   * between the company's own treasuries are decisions a shop separates from
   * the counter, so `vouchers-routes.ts` reads the voucher's type and accepts
   * EITHER the generic `treasury.cash_voucher.<action>` or the type's own
   * code. A holder of only the type code can act on that type and nothing
   * else.
   */
  ["treasury.transfer.create", "treasury.cash_voucher.view,treasury.account.view"],
  ["treasury.transfer.confirm", "treasury.cash_voucher.view"],
  ["treasury.transfer.void", "treasury.cash_voucher.view"],
  ["treasury.customer_refund.create", "treasury.cash_voucher.view,treasury.account.view"],
  ["treasury.customer_refund.confirm", "treasury.cash_voucher.view"],
  ["treasury.customer_refund.void", "treasury.cash_voucher.view"],
  ["treasury.reconciliation.view", "treasury.account.view"],
  ["treasury.reconciliation.import", "treasury.reconciliation.view"],
  ["treasury.reconciliation.match", "treasury.reconciliation.view"],
  ["treasury.reconciliation.create", "treasury.reconciliation.view"],
  ["treasury.reconciliation.finalize", "treasury.reconciliation.view"],

  // 7. workflow — 5
  ["workflow.view"],
  ["workflow.approve", "workflow.view"],
  ["workflow.reject", "workflow.view"],
  ["workflow.config.view"],
  ["workflow.config.manage", "workflow.config.view"],

  // 8. hr — 37
  ["hr.employee.view"],
  ["hr.employee.create", "hr.employee.view"],
  ["hr.employee.edit", "hr.employee.view"],
  ["hr.employee.view_salary", "hr.employee.view", "s"],
  ["hr.employee.terminate", "hr.employee.edit"],
  ["hr.leave.view"],
  ["hr.leave.approve", "hr.leave.view"],
  ["hr.leave.create", "hr.leave.view"],
  ["hr.advance.view"],
  ["hr.advance.approve", "hr.advance.view"],
  ["hr.advance.create", "hr.advance.view"],
  ["hr.advance.reverse", "hr.advance.view", "s"],
  ["hr.payroll.view"],
  ["hr.payroll.approve", "hr.payroll.view"],
  ["hr.payroll.pay", "hr.payroll.approve"],
  ["hr.payroll.create", "hr.payroll.view"],
  ["hr.payroll.calculate", "hr.payroll.create"],
  ["hr.payroll.void", "hr.payroll.view"],
  ["hr.payroll.reverse", "hr.payroll.view", "s"],
  ["hr.provision.reverse", "hr.payroll.view", "s"],
  ["hr.attendance.view"],
  ["hr.attendance.edit", "hr.attendance.view"],
  ["hr.contract.view", "hr.employee.view"],
  ["hr.contract.create", "hr.contract.view"],
  ["hr.contract.edit", "hr.contract.view"],
  ["hr.department.view"],
  ["hr.department.create", "hr.department.view"],
  ["hr.department.edit", "hr.department.view"],
  ["hr.job_title.view"],
  ["hr.job_title.create", "hr.job_title.view"],
  ["hr.job_title.edit", "hr.job_title.view"],
  ["hr.leave_policy.view"],
  ["hr.leave_policy.edit", "hr.leave_policy.view"],
  ["hr.leave_policy.apply_preset", "hr.leave_policy.edit"],
  ["hr.leave_accrual.run", "hr.leave_policy.view"],
  // Self-service: every route under /hr/self reads the CALLER's linked employee and nobody else's.
  ["hr.self.leave"],
  ["hr.self.payslip"],
  ["hr.self.advance"],
  ["hr.self.attendance"],
  ["hr.self.clock", "hr.self.attendance"],

  // 10. crm — 13
  ["crm.lead.view"],
  ["crm.lead.create", "crm.lead.view"],
  ["crm.lead.edit", "crm.lead.view"],
  ["crm.lead.convert", "crm.lead.view,crm.opportunity.create"],
  ["crm.opportunity.view"],
  ["crm.opportunity.create", "crm.opportunity.view"],
  ["crm.opportunity.edit", "crm.opportunity.view"],
  ["crm.activity.view"],
  ["crm.activity.create", "crm.activity.view"],
  ["crm.activity.edit", "crm.activity.view"],
  ["crm.pipeline.view"],
  ["crm.pipeline.manage", "crm.pipeline.view"],
  ["crm.customer360.view", "sales.customer.view"],

  // 11. installments — 7
  ["installments.plan.view"],
  ["installments.plan.create", "installments.plan.view"],
  ["installments.plan.cancel", "installments.plan.view"],
  ["installments.collect", "installments.plan.view"],
  ["installments.follow_up.view", "installments.plan.view"],
  ["installments.follow_up.manage", "installments.follow_up.view"],
  ["installments.overdue.process", "installments.plan.view"],

  // 12. cheques (financial papers) — 5
  ["cheques.view"],
  ["cheques.create", "cheques.view"],
  ["cheques.deposit", "cheques.view"],
  ["cheques.collect", "cheques.view"],
  ["cheques.bounce", "cheques.view"],
  ["cheques.reverse", "cheques.view", "s"],

  // 13. manufacturing — 5
  ["manufacturing.bom.view"],
  ["manufacturing.bom.manage", "manufacturing.bom.view"],
  ["manufacturing.wo.view"],
  ["manufacturing.wo.create", "manufacturing.wo.view"],
  ["manufacturing.wo.execute", "manufacturing.wo.view"],

  // 14. assets — 6
  ["assets.view"],
  ["assets.create", "assets.view"],
  ["assets.manage", "assets.view"],
  ["assets.dispose", "assets.view"],
  ["assets.disposal.reverse", "assets.view", "s"],
  ["assets.depreciation.view", "assets.view"],
  ["assets.depreciation.run", "assets.depreciation.view"],
  ["assets.depreciation.reverse", "assets.depreciation.view", "s"],

  // 15. admin — 23
  ["admin.users.view"],
  ["admin.users.create", "admin.users.view"],
  ["admin.users.edit", "admin.users.view"],
  ["admin.users.deactivate", "admin.users.view"],
  // Clears a failed-login lockout. Its own code, not folded into `.edit`:
  // the person who should be able to unlock the till at 6pm is the branch
  // manager standing next to it, and giving them `.edit` to do it would also
  // give them every colleague's PIN.
  ["admin.users.unlock", "admin.users.view"],
  ["admin.users.erase_personal", "admin.users.view"],
  ["admin.roles.view"],
  ["admin.roles.manage", "admin.roles.view"],
  ["admin.settings.view"],
  ["admin.settings.edit", "admin.settings.view"],
  ["admin.tenant.settings.edit", "admin.settings.view", "p"],
  ["admin.branches.view"],
  ["admin.branches.create", "admin.branches.view"],
  ["admin.branches.edit", "admin.branches.view"],
  ["admin.warehouses.view"],
  ["admin.warehouses.create", "admin.warehouses.view"],
  ["admin.warehouses.edit", "admin.warehouses.view"],
  ["admin.sequences.view"],
  ["admin.sequences.edit", "admin.sequences.view"],
  ["admin.sequences.reset", "admin.sequences.edit"],
  // Connected tills on the LAN. Separate from `admin.settings.*` because
  // freeing a stuck seat is a shop-floor act, and gating it on the settings
  // permission meant only the owner could unblock the counter.
  ["admin.devices.view"],
  ["admin.devices.manage", "admin.devices.view"],
  // Backup and restore. Its own pair rather than a reuse of
  // `admin.tenant.settings.edit`, because restoring REPLACES the books: it is
  // the single most destructive act the product offers, and it should be
  // grantable to whoever holds the recovery runbook without also handing them
  // every tenant setting.
  ["admin.backup.view"],
  ["admin.backup.restore", "admin.backup.view"],

  // 16. notifications — 2
  ["notifications.rule.view"],
  ["notifications.rule.manage", "notifications.rule.view"],

  // 17. audit — 1
  ["audit.logs.view"],

  // 18. projects — 2 (phase11/crm-projects-assets-field, docs/archive/catalog/07 §المشاريع)
  ["projects.project.view"],
  ["projects.project.manage", "projects.project.view"],

  // 19. contracting — 12 (docs/artifacts/mezan-contracting-designs.html §06)
  ["contracting.boq.view"],
  ["contracting.boq.manage", "contracting.boq.view"],
  ["contracting.variation.approve", "contracting.boq.view"],
  ["contracting.certificate.view"],
  ["contracting.certificate.prepare", "contracting.certificate.view"],
  ["contracting.certificate.certify", "contracting.certificate.view"],
  ["contracting.certificate.approve", "contracting.certificate.view", "s"],
  ["contracting.certificate.collect", "contracting.certificate.view"],
  ["contracting.retention.release", "contracting.certificate.view", "s"],
  // خطابات الضمان. A letter of guarantee is the contractor's credit line, not a
  // till document: releasing a performance bond gave away the employer's whole
  // security. It was gated on `treasury.cash_voucher.create`, which the cashier
  // at the counter holds.
  ["contracting.guarantee.view"],
  ["contracting.guarantee.manage", "contracting.guarantee.view"],
  ["contracting.guarantee.release", "contracting.guarantee.view", "s"],
  ["contracting.guarantee.reverse", "contracting.guarantee.view", "s"],
  ["contracting.equipment_log.reverse", "projects.project.view", "s"],
  ["contracting.consumption.reverse", "projects.project.view", "s"],

  ["dashboard.view"],
];

function expand(row: Row): PermissionDef {
  const [code, depsCsv, flags] = row;
  const dotIndex = code.indexOf(".");
  const moduleId = dotIndex === -1 ? code : code.slice(0, dotIndex);
  const deps = depsCsv ? depsCsv.split(",").map((d) => d.trim()) : [];
  return {
    code,
    module: moduleId,
    deps,
    sensitive: flags === "s" || flags === "sp",
    platformAdminOnly: flags === "p" || flags === "sp",
  };
}

const FRAGMENT_ROWS: readonly Row[] = [...POS_PERMISSION_ROWS, ...ENH_PERMISSION_ROWS];

function fragmentRowCount(moduleId: string): number {
  return FRAGMENT_ROWS.filter((row) => expand(row).module === moduleId).length;
}

export const MODULES: readonly ModuleDef[] = [
  ...CORE_MODULES.map((m) => ({ ...m, count: m.count + fragmentRowCount(m.id) })),
  ...[...POS_PERMISSION_MODULES, ...ENH_PERMISSION_MODULES].map((m) => ({ ...m, count: fragmentRowCount(m.id) })),
];

export const PERMISSIONS: readonly PermissionDef[] = [...ROWS, ...FRAGMENT_ROWS].map(expand);

const BY_CODE: ReadonlyMap<string, PermissionDef> = new Map(
  PERMISSIONS.map((p) => [p.code, p]),
);

/** Wildcard grant held by tenant admins — bypasses every gate (recon §4). */
export const WILDCARD_PERMISSION = "*" as const;

export function getPermission(code: string): PermissionDef | undefined {
  return BY_CODE.get(code);
}

export function isKnownPermission(code: string): boolean {
  return code === WILDCARD_PERMISSION || BY_CODE.has(code);
}

export function isSensitive(code: string): boolean {
  return BY_CODE.get(code)?.sensitive ?? false;
}

export function isPlatformAdminOnly(code: string): boolean {
  return BY_CODE.get(code)?.platformAdminOnly ?? false;
}

/** All permission codes, in catalog order. */
export const ALL_PERMISSION_CODES: readonly string[] = PERMISSIONS.map(
  (p) => p.code,
);

/**
 * Validates the manifest against what the catalog documents: unique codes,
 * every dependency resolvable, and per-module counts matching. Called once at
 * module load so a transcription slip fails loudly instead of silently.
 */
export function assertCatalogIntegrity(): void {
  const seen = new Set<string>();
  for (const p of PERMISSIONS) {
    if (seen.has(p.code)) {
      throw new Error(`Duplicate permission code in catalog: ${p.code}`);
    }
    seen.add(p.code);
    for (const dep of p.deps) {
      if (!BY_CODE.has(dep)) {
        throw new Error(
          `Permission ${p.code} depends on unknown permission ${dep}`,
        );
      }
    }
  }

  for (const mod of MODULES) {
    const actual = PERMISSIONS.filter((p) => p.module === mod.id).length;
    if (actual !== mod.count) {
      throw new Error(
        `Module ${mod.id} expected ${mod.count} permissions, found ${actual}`,
      );
    }
  }

  const declaredModules = new Set(MODULES.map((m) => m.id));
  for (const p of PERMISSIONS) {
    if (!declaredModules.has(p.module)) {
      throw new Error(
        `Permission ${p.code} belongs to undeclared module ${p.module}`,
      );
    }
  }
}

assertCatalogIntegrity();
