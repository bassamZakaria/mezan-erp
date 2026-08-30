/**
 * Mezan permission catalog — a versioned TS data manifest.
 *
 * Single source of truth for the 286 permissions across 20 modules captured in
 * `docs/archive/catalog/09-settings-dashboard-ux.md` §permission matrix and mandated as
 * "data (a versioned TS manifest)" by `docs/archive/plan.md` §5.2. The role editor, the
 * API guards, and the docs are all meant to read this one manifest.
 *
 * Codes use `module.entity.action` dot notation. A few carry the ⚠ `sensitive`
 * flag (cost/salary/personal-data visibility, money-reversing actions) and two
 * are platform-admin-only. The dependency graph (`deps`) is authoritative:
 * granting an action implies its prerequisites (resolved in `./resolve.ts`).
 *
 * FIDELITY NOTE: all 268 permissions from the matrix are transcribed here
 * verbatim (codes, dependencies, sensitive/platform flags). None were
 * summarized. The 18 codes added since are later phases and later defects —
 * promotions, projects, inventory counts, labels/templates/write-down, and the
 * five `admin.*` codes that gave the operational acts (unlocking an account,
 * freeing a till seat, reading and restoring a backup) permissions of their
 * own instead of leaving them gated on `admin.settings.edit`, which no seeded
 * role holds. The per-module totals are asserted at load time by
 * `assertCatalogIntegrity()` against the counts the catalog documents.
 */

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
export const CATALOG_VERSION = 1 as const;

export const MODULES: readonly ModuleDef[] = [
  { id: "dashboard", labelAr: "لوحة التحكم", count: 2 },
  { id: "sales", labelAr: "المبيعات", count: 29 },
  { id: "purchases", labelAr: "المشتريات", count: 34 },
  { id: "inventory", labelAr: "المخزون", count: 21 },
  { id: "field", labelAr: "المبيعات الميدانية", count: 4 },
  { id: "accounting", labelAr: "المحاسبة", count: 17 },
  { id: "treasury", labelAr: "الخزينة", count: 26 },
  { id: "workflow", labelAr: "سير العمل", count: 5 },
  { id: "hr", labelAr: "الموارد البشرية", count: 36 },
  { id: "pos", labelAr: "نقطة البيع", count: 38 },
  { id: "crm", labelAr: "إدارة العملاء", count: 15 },
  { id: "installments", labelAr: "الأقساط", count: 8 },
  { id: "cheques", labelAr: "الأوراق المالية", count: 5 },
  { id: "manufacturing", labelAr: "التصنيع", count: 5 },
  { id: "assets", labelAr: "الأصول", count: 7 },
  { id: "admin", labelAr: "الإدارة", count: 27 },
  { id: "notifications", labelAr: "الإشعارات", count: 2 },
  { id: "audit", labelAr: "المراجعة", count: 1 },
  { id: "transactions", labelAr: "المعاملات", count: 2 },
  // --- phase11/crm-projects-assets-field — Projects & Contracting isn't part of
  // the original 268-permission/19-module matrix (docs/archive/catalog/09); it's added
  // fresh per docs/archive/catalog/07-mfg-projects-assets.md "المشاريع والمقاولات".
  { id: "projects", labelAr: "المشاريع", count: 2 },
];

/**
 * Compact source rows: [code, depsCsv?, flags?].
 *   depsCsv — comma-separated full prerequisite codes.
 *   flags   — "s" sensitive, "p" platform-admin-only, "sp" both.
 * Expanded into `PermissionDef` below. Grouped by module, in matrix order.
 */
type Row = readonly [code: string, deps?: string, flags?: "s" | "p" | "sp"];

const ROWS: readonly Row[] = [
  // 1. dashboard — 2
  ["dashboard.view"],
  ["dashboard.export", "dashboard.view"],

  // 2. sales — 27
  ["sales.invoice.view"],
  ["sales.invoice.view_own"],
  ["sales.invoice.view_all", "sales.invoice.view"],
  ["sales.invoice.view_cost", "sales.invoice.view", "s"],
  ["sales.invoice.create", "sales.invoice.view_own"],
  ["sales.invoice.edit", "sales.invoice.view_own"],
  ["sales.invoice.confirm", "sales.invoice.view_own"],
  ["sales.invoice.void", "sales.invoice.view_own"],
  ["sales.invoice.print", "sales.invoice.view_own"],
  ["sales.invoice.delete_draft", "sales.invoice.view_own"],
  ["sales.customer.view"],
  ["sales.customer.create", "sales.customer.view"],
  ["sales.customer.edit", "sales.customer.view"],
  ["sales.customer.merge", "sales.customer.edit"],
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
  ["sales.promotion.view"],
  ["sales.promotion.manage", "sales.promotion.view"],

  // 3. purchases — 34
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
  ["purchases.invoice.delete_draft", "purchases.invoice.view_own"],
  ["purchases.invoice.edit", "purchases.invoice.view_own"],
  ["purchases.return.view"],
  ["purchases.return.create", "purchases.return.view"],
  ["purchases.return.confirm", "purchases.return.view"],
  ["purchases.return.void", "purchases.return.view"],
  ["purchases.landed_cost.view"],
  ["purchases.landed_cost.create", "purchases.landed_cost.view"],
  ["purchases.landed_cost.edit", "purchases.landed_cost.view"],
  ["purchases.landed_cost.confirm", "purchases.landed_cost.view"],
  ["purchases.landed_cost.void", "purchases.landed_cost.view"],
  ["purchases.landed_cost.delete_draft", "purchases.landed_cost.view"],
  ["purchases.supplier360.view", "purchases.supplier.view"],

  // 4. inventory — 21
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
  ["inventory.valuation.view", "inventory.stock.view"],
  ["inventory.valuation.rebuild", "inventory.valuation.view"],
  ["inventory.count.view"],
  ["inventory.count.create", "inventory.count.view"],
  ["inventory.count.confirm", "inventory.count.view"],
  // inv/labels-templates-writedown — label printing, product templates, aging write-down
  ["inventory.label.print", "inventory.item.view"],
  ["inventory.template.view"],
  ["inventory.template.manage", "inventory.template.view"],
  ["inventory.template.generate", "inventory.template.view"],
  ["inventory.writedown.view"],
  ["inventory.writedown.run", "inventory.writedown.view"],

  // 5. field (van sales) — 4
  ["field.van_trip.view"],
  ["field.van_trip.view_own"],
  ["field.van_trip.open", "field.van_trip.view_own"],
  ["field.van_trip.settle", "field.van_trip.view"],

  // 6. accounting — 17
  ["accounting.coa.view"],
  ["accounting.coa.manage", "accounting.coa.view"],
  ["accounting.journal.view"],
  ["accounting.journal.create", "accounting.journal.view"],
  ["accounting.journal.post", "accounting.journal.view"],
  ["accounting.journal.approve", "accounting.journal.view"],
  ["accounting.period.view"],
  ["accounting.period.close", "accounting.period.view"],
  ["accounting.period.reopen", "accounting.period.close"],
  ["accounting.reports.view"],
  ["accounting.exchange_rate.manage"],
  ["accounting.exchange_rate.approve", "accounting.exchange_rate.manage"],
  ["accounting.tax.view"],
  ["accounting.tax.manage", "accounting.tax.view"],
  ["accounting.eta.view"],
  ["accounting.eta.submit", "accounting.eta.view"],
  ["accounting.eta.cancel", "accounting.eta.view"],

  // 7. treasury — 26
  ["treasury.account.view"],
  ["treasury.account.manage", "treasury.account.view"],
  ["treasury.balance_transfer.create", "treasury.account.view"],
  ["treasury.customer_adjustment.create", "treasury.account.view"],
  ["treasury.supplier_adjustment.create", "treasury.account.view"],
  ["treasury.treasury_adjustment.create", "treasury.account.view"],
  ["treasury.allocation.view", "treasury.account.view"],
  ["treasury.allocation.manage", "treasury.account.view"],
  ["treasury.transfer.view"],
  ["treasury.transfer.create", "treasury.transfer.view,treasury.account.view"],
  ["treasury.transfer.confirm", "treasury.transfer.view"],
  ["treasury.transfer.void", "treasury.transfer.view"],
  ["treasury.cash_voucher.view", "treasury.account.view"],
  ["treasury.cash_voucher.create", "treasury.cash_voucher.view,treasury.account.view"],
  ["treasury.cash_voucher.confirm", "treasury.cash_voucher.view"],
  ["treasury.cash_voucher.void", "treasury.cash_voucher.view"],
  ["treasury.customer_refund.view"],
  ["treasury.customer_refund.create", "treasury.customer_refund.view,treasury.account.view"],
  ["treasury.customer_refund.confirm", "treasury.customer_refund.view"],
  ["treasury.customer_refund.approve", "treasury.customer_refund.view"],
  ["treasury.customer_refund.void", "treasury.customer_refund.view"],
  ["treasury.reconciliation.view", "treasury.account.view"],
  ["treasury.reconciliation.import", "treasury.reconciliation.view"],
  ["treasury.reconciliation.match", "treasury.reconciliation.view"],
  ["treasury.reconciliation.create", "treasury.reconciliation.view"],
  ["treasury.reconciliation.finalize", "treasury.reconciliation.view"],

  // 8. workflow — 5
  ["workflow.view"],
  ["workflow.approve", "workflow.view"],
  ["workflow.reject", "workflow.view"],
  ["workflow.config.view"],
  ["workflow.config.manage", "workflow.config.view"],

  // 9. hr — 36
  ["hr.employee.view"],
  ["hr.employee.create", "hr.employee.view"],
  ["hr.employee.edit", "hr.employee.view"],
  ["hr.employee.view_salary", "hr.employee.view", "s"],
  ["hr.employee.view_personal", "hr.employee.view", "s"],
  ["hr.employee.terminate", "hr.employee.edit"],
  ["hr.leave.view"],
  ["hr.leave.approve", "hr.leave.view"],
  ["hr.leave.create", "hr.leave.view"],
  ["hr.advance.view"],
  ["hr.advance.approve", "hr.advance.view"],
  ["hr.advance.create", "hr.advance.view"],
  ["hr.payroll.view"],
  ["hr.payroll.run", "hr.payroll.view"],
  ["hr.payroll.approve", "hr.payroll.view"],
  ["hr.payroll.pay", "hr.payroll.approve"],
  ["hr.payroll.create", "hr.payroll.view"],
  ["hr.payroll.calculate", "hr.payroll.create"],
  ["hr.payroll.void", "hr.payroll.view"],
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
  ["hr.leave_accrual.year_end", "hr.leave_accrual.run"],
  ["hr.leave_accrual.migrate_open", "hr.leave_accrual.run"],

  // 10. pos — 38
  ["pos.terminal.view"],
  ["pos.terminal.manage", "pos.terminal.view"],
  ["pos.terminal.open_session", "pos.terminal.view"],
  ["pos.terminal.close_session", "pos.terminal.open_session"],
  ["pos.session.view"],
  ["pos.session.open", "pos.session.view"],
  ["pos.session.close", "pos.session.open"],
  ["pos.session.force_close", "pos.session.close"],
  ["pos.sale.view"],
  ["pos.sale.create", "pos.sale.view,pos.session.open"],
  ["pos.sale.refund", "pos.sale.view"],
  ["pos.sale.discount", "pos.sale.create"],
  ["pos.restaurant.view"],
  ["pos.restaurant.manage", "pos.restaurant.view"],
  ["pos.restaurant.order", "pos.restaurant.view"],
  ["pos.restaurant.pay", "pos.restaurant.order"],
  ["pos.restaurant.cancel", "pos.restaurant.view"],
  ["pos.restaurant.reopen", "pos.restaurant.view"],
  ["pos.order.set_priority", "pos.restaurant.view"],
  ["pos.reservation.view", "pos.restaurant.view"],
  ["pos.reservation.create", "pos.reservation.view"],
  ["pos.reservation.edit", "pos.reservation.view"],
  ["pos.kitchen.view"],
  ["pos.kitchen.operate", "pos.kitchen.view"],
  ["pos.kitchen.recall", "pos.kitchen.view"],
  ["pos.reports.view"],
  ["pos.refund.create", "pos.sale.view"],
  ["pos.suspend.create"],
  ["pos.suspend.resume", "pos.suspend.create"],
  ["pos.suspend.void", "pos.suspend.create"],
  ["pos.discount.approve"],
  ["pos.delivery.view"],
  ["pos.delivery.create", "pos.delivery.view"],
  ["pos.delivery.manage", "pos.delivery.view"],
  ["pos.delivery.cancel", "pos.delivery.view", "s"],
  ["pos.delivery.settle", "pos.delivery.view"],
  ["pos.delivery.view_own", "pos.delivery.view"],
  ["pos.delivery.manage_own", "pos.delivery.view_own"],

  // 11. crm — 15
  ["crm.lead.view"],
  ["crm.lead.view_own"],
  ["crm.lead.create", "crm.lead.view"],
  ["crm.lead.edit", "crm.lead.view"],
  ["crm.lead.assign", "crm.lead.view"],
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

  // 12. installments — 8
  ["installments.plan.view"],
  ["installments.plan.create", "installments.plan.view"],
  ["installments.plan.cancel", "installments.plan.view"],
  ["installments.collect", "installments.plan.view"],
  ["installments.follow_up.view", "installments.plan.view"],
  ["installments.follow_up.manage", "installments.follow_up.view"],
  ["installments.collection.create", "installments.plan.view"],
  ["installments.overdue.process", "installments.plan.view"],

  // 13. cheques (financial papers) — 5
  ["cheques.view"],
  ["cheques.create", "cheques.view"],
  ["cheques.deposit", "cheques.view"],
  ["cheques.collect", "cheques.view"],
  ["cheques.bounce", "cheques.view"],

  // 14. manufacturing — 5
  ["manufacturing.bom.view"],
  ["manufacturing.bom.manage", "manufacturing.bom.view"],
  ["manufacturing.wo.view"],
  ["manufacturing.wo.create", "manufacturing.wo.view"],
  ["manufacturing.wo.execute", "manufacturing.wo.view"],

  // 15. assets — 7
  ["assets.view"],
  ["assets.create", "assets.view"],
  ["assets.manage", "assets.view"],
  ["assets.dispose", "assets.view"],
  ["assets.depreciation.view", "assets.view"],
  ["assets.depreciation.run", "assets.depreciation.view"],
  ["assets.depreciation.void", "assets.depreciation.run"],

  // 16. admin — 27
  ["admin.users.view"],
  ["admin.users.create", "admin.users.view"],
  ["admin.users.edit", "admin.users.view"],
  ["admin.users.deactivate", "admin.users.view"],
  // Clears a failed-login lockout. Its own code, not folded into `.edit`:
  // the person who should be able to unlock the till at 6pm is the branch
  // manager standing next to it, and giving them `.edit` to do it would also
  // give them every colleague's PIN.
  ["admin.users.unlock", "admin.users.view"],
  ["admin.roles.view"],
  ["admin.roles.manage", "admin.roles.view"],
  ["admin.settings.view"],
  ["admin.settings.edit", "admin.settings.view"],
  ["admin.tenant.settings.edit", "admin.settings.view", "p"],
  ["admin.branches.view"],
  ["admin.branches.create", "admin.branches.view"],
  ["admin.branches.edit", "admin.branches.view"],
  ["admin.branches.deactivate", "admin.branches.view"],
  ["admin.warehouses.view"],
  ["admin.warehouses.create", "admin.warehouses.view"],
  ["admin.warehouses.edit", "admin.warehouses.view"],
  ["admin.warehouses.deactivate", "admin.warehouses.view"],
  ["admin.sequences.view"],
  ["admin.sequences.edit", "admin.sequences.view"],
  ["admin.sequences.reset", "admin.sequences.edit"],
  ["admin.modules.view"],
  ["admin.modules.manage", "admin.modules.view", "p"],
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

  // 17. notifications — 2
  ["notifications.rule.view"],
  ["notifications.rule.manage", "notifications.rule.view"],

  // 18. audit — 1
  ["audit.logs.view"],

  // 19. transactions — 2
  ["transactions.view"],
  ["transactions.view_all", "transactions.view"],

  // 20. projects — 2 (phase11/crm-projects-assets-field, docs/archive/catalog/07 §المشاريع)
  ["projects.project.view"],
  ["projects.project.manage", "projects.project.view"],
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

export const PERMISSIONS: readonly PermissionDef[] = ROWS.map(expand);

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
