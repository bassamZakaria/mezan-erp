import { modKeyLabel, type CommandItem, type NavGroup, type NavItem } from "@mezan/ui";
import { isModuleLicensed, type Entitlements, type ModuleId } from "@mezan/domain";
import type { AppTranslationKey } from "./i18n";
import { navGroupIcon, navItemIcon } from "./nav-icons";

/**
 * Static shell configuration — the navigation tree, its top item, and the
 * command-palette entries. This is app structure, not tenant data: every
 * record the shell renders (branches, warehouses, users, entitlements) comes
 * from the API (see App.tsx). Labels are resolved through `t` at render time
 * so the tree re-labels itself when the language changes.
 */

type Translate = (key: AppTranslationKey) => string;

export interface NavSectionSpec {
  readonly key: string;
  readonly itemKeys: readonly string[];
  readonly defaultCollapsed?: boolean;
}

export interface NavGroupSpec {
  readonly key: string;
  readonly itemKeys: readonly string[];
  readonly sections?: readonly NavSectionSpec[];
  readonly defaultCollapsed?: boolean;
}

/**
 * Six workspaces, named after the work rather than after the modules the
 * software is built from. Every one of the 117 destinations that lived in the
 * previous fourteen-group tree still appears here exactly once — a workspace
 * simply gathers the documents, the master data, the reports and the set-once
 * configuration for one job into shelves, so a daily list holds only daily work
 * (the workspace model — see docs/artifacts/directions/nav-level.html).
 *
 * A group's first item is its hub, which is what the workspace header opens.
 */
export const navGroupSpecs: readonly NavGroupSpec[] = [
  { key: "workflow", defaultCollapsed: true, itemKeys: ["notifications", "approvals"] },
  {
    key: "sell",
    defaultCollapsed: true,
    itemKeys: ["sales-hub"],
    sections: [
      { key: "daily", itemKeys: ["quotes", "sales-invoices", "sales-returns", "van-trips"] },
      { key: "master", defaultCollapsed: true, itemKeys: ["customers"] },
      {
        key: "reports",
        defaultCollapsed: true,
        itemKeys: [
          "report-sales-by-period",
          "report-sales-by-item",
          "report-sales-by-customer",
          "report-sales-by-salesperson",
          "report-sales-top-products",
          "report-offers",
          "report-van-sales",
          "report-aging-customers",
        ],
      },
      { key: "config", defaultCollapsed: true, itemKeys: ["price-lists", "promotions"] },
    ],
  },
  {
    key: "crm",
    defaultCollapsed: true,
    // Flat: a shelf earns its dropdown when the bar cannot carry what it holds.
    itemKeys: ["crm-hub", "crm-activities", "leads", "opportunities", "pipeline", "pipeline-stages"],
  },
  {
    key: "installments",
    defaultCollapsed: true,
    itemKeys: [
      "installment-plans",
      "installment-follow-ups",
      "report-installments-overview",
      "report-installments-overdue",
    ],
  },
  {
    key: "buy",
    defaultCollapsed: true,
    itemKeys: ["purchases-hub"],
    sections: [
      { key: "daily", itemKeys: ["rfqs", "purchase-orders", "goods-receipts", "purchase-invoices", "purchase-returns", "landed-costs"] },
      { key: "master", defaultCollapsed: true, itemKeys: ["vendors"] },
      {
        key: "reports",
        defaultCollapsed: true,
        itemKeys: ["report-purchases-by-period", "report-purchases-by-supplier", "report-purchases-by-item", "report-aging-suppliers"],
      },
    ],
  },
  /**
   * الأصناف is master data for المخزون، البيع and الشراء alike, so it is a
   * SHELF of المخزون rather than a workspace of its own — and its four screens
   * (الأصناف، القوالب، المنتجات القابلة للتهيئة، المواصفات) are four tabs of
   * ONE page, the way QuickBooks keeps a single «Products and services» list
   * with a type on the item. Likewise أرصدة المخزون, which answered the same
   * question as the hub, is now the hub's own table, and the eight inventory
   * reports are four: كل تقرير هنا يحمل عروضه بداخله (الحركة داخل السجل،
   * الفروق داخل التقييم، الصلاحية والبطيئة داخل الأعمار).
   */
  /**
   * الأصناف is its OWN workspace again. It was folded into المخزون on the
   * argument that master data belongs beside the thing that consumes it, and
   * that argument is sound on paper — but a catalogue is opened by people who
   * never touch a stock document (pricing, purchasing, the person adding a
   * barcode), and burying it under المخزون made them enter a warehouse to
   * reach it. Its own row costs one line in the column and removes that
   * detour.
   */
  {
    key: "items",
    defaultCollapsed: true,
    // Same treatment as المخزون and التصنيع: the bar carries the destinations.
    // These four were tabs of one page, three of them folded behind a «…» —
    // which is a menu inside a page inside a workspace that holds one entry.
    // They are four kinds of catalogue record and the bar has room for four.
    itemKeys: ["items-hub", "items", "product-templates", "configurable-products", "item-specifications", "boms"],
  },
  {
    key: "stock",
    defaultCollapsed: true,
    // Same treatment as التصنيع: the bar carries the destinations, so the
    // shelf goes and the overview keeps no buttons of its own. أرصدة المخزون
    // joins them — it was reachable only from a quick action on the overview,
    // which is the screen it answers the question OF.
    itemKeys: [
      "inventory-hub",
      "stock-balance",
      "stock-transfers",
      "stock-adjustments",
      "physical-counts",
      "writedown-runs",
    ],
    sections: [
      {
        key: "reports",
        defaultCollapsed: true,
        itemKeys: [
          "report-inventory-stock-levels",
          "report-inventory-goods-in-transit",
          "report-inventory-movement",
          "report-inventory-ledger",
          "report-inventory-valuation",
          "report-inventory-aging",
          "report-inventory-expiring",
          "report-inventory-slow-moving",
          "report-inventory-drift",
        ],
      },
    ],
  },
  {
    key: "manufacturing",
    defaultCollapsed: true,
    // Two documents do not need a shelf: «الحركة اليومية» put a click in front
    // of the only two things this workspace does. They sit on the bar beside
    // the hub, and only التقارير stays folded.
    // قائمة المواد is a tab of الأصناف, the way QuickBooks keeps the recipe on
    // the assembly item rather than in a list of its own.
    /**
     * The bar reads in the order the work happens: the summary, then the
     * DOCUMENT everything else is about, then the floor view of those
     * documents, then the special-case way of raising one, then the report.
     *
     * لوحة الإنتاج used to come before أوامر التصنيع, which put a view OF the
     * orders ahead of the orders themselves — you cannot have a floor before
     * you have something on it. And التقارير was a dropdown wrapping a single
     * row, which is a click in front of one screen.
     */
    itemKeys: [
      "manufacturing-hub",
      "work-orders",
      "production-dashboard",
      "custom-manufacturing",
      "report-make-vs-buy",
    ],
  },
  {
    key: "treasury",
    defaultCollapsed: true,
    itemKeys: ["treasury-hub", "treasury-vouchers", "cheques", "treasury-accounts"],
  },
  {
    key: "money",
    defaultCollapsed: true,
    itemKeys: ["accounting-hub"],
    sections: [
      { key: "daily", itemKeys: ["journals"] },
      { key: "close", itemKeys: ["fiscal-periods", "reconciliation", "bank-reconciliation", "revaluation", "eta"] },
      { key: "master", defaultCollapsed: true, itemKeys: ["coa", "cost-centers", "taxes", "tax-simplified-regime", "exchange-rates"] },
      { key: "reports", defaultCollapsed: true, itemKeys: ["trial-balance-report", "financial-reports", "cost-center-pl", "report-simplified-regime-comparison"] },
    ],
  },
  {
    key: "people",
    defaultCollapsed: true,
    itemKeys: ["hr-dashboard"],
    sections: [
      { key: "staff", itemKeys: ["employees", "departments", "job-titles", "contracts"] },
      { key: "time", defaultCollapsed: true, itemKeys: ["attendance", "holidays", "leave-requests", "leave-balances", "leave-accrual-batches", "my-leave"] },
      { key: "pay", defaultCollapsed: true, itemKeys: ["payroll", "advances"] },
      { key: "config", defaultCollapsed: true, itemKeys: ["leave-policies", "payroll-components"] },
    ],
  },
  {
    key: "assets",
    defaultCollapsed: true,
    itemKeys: ["assets-hub"],
    sections: [
      { key: "daily", itemKeys: ["asset-register", "depreciation-runs"] },
      { key: "config", defaultCollapsed: true, itemKeys: ["asset-categories"] },
    ],
  },
  /**
   * المقاولات stands on its own rather than sitting on الأصول الثابتة's daily
   * shelf. A contracting business is not a fixed-asset chore: it brings BOQs,
   * progress certificates, retention and subcontractors with it, and those are
   * a module, not a screen. One row today, the module's own home tomorrow.
   */
  { key: "contracting", defaultCollapsed: true, itemKeys: ["projects", "contracting-contracts", "variation-orders", "certificates", "internal-certificate", "subcontracts", "subcontract-certificates", "guarantees", "revenue-recognition", "site-issues", "material-consumption", "custody-register", "equipment-logs", "retention", "contracting-reports"] },
  {
    key: "setup",
    defaultCollapsed: true,
    /**
     * Two shelves, because there are two jobs and two people. المنشأة is what
     * an implementer configures once when a company is brought onto Mezan —
     * its branches, its stores, how its documents are numbered and printed,
     * and the import that carries the old books in. الصلاحيات is what an
     * owner runs forever after: who has an account, what each may do, what
     * needs approving, who gets told, and what everybody did.
     *
     * Both stay OPEN. The previous shape had four shelves with three of them
     * folded, so most of a company's setup was one click away from being
     * seen at all — and the shelf named «المستخدمون والصلاحيات» sat inside a
     * group named «الإعداد والصلاحيات», saying "صلاحيات" twice on the way to
     * the same screen.
     *
     * حالة النظام is hidden for now — like «البريد الإلكتروني» in the settings
     * screen, the surface is intact and only the way in is off. It keeps its
     * address (see `UNLISTED_SCREEN_GROUP`), so a support instruction that
     * names the URL still works and putting the row back is one string.
     *
     * الملف الشخصي takes that group-level slot instead. It is one person's own
     * account, not an administrator's shelf, so it sits beside عام rather than
     * inside المنشأة or الصلاحيات — the avatar menu still reaches it too.
     */
    itemKeys: ["settings-general", "settings-profile"],
    sections: [
      {
        key: "company",
        itemKeys: [
          "settings-branches",
          "settings-warehouses",
          "settings-sequences",
          "settings-print",
          "settings-barcode",
          "settings-data-migration",
        ],
      },
      {
        key: "permissions",
        // `status` (حالة النظام) is back in the rail. It carries the version,
        // the licence support code, the paths and the fingerprint — the answers
        // to the first four questions of every support call — and it was
        // reachable only by typing its address. It keeps that address: `setup`
        // is the group it was already filed under in `UNLISTED_SCREEN_GROUP`.
        itemKeys: ["users", "roles", "settings-workflow", "notification-rules", "audit", "devices", "settings-backup", "status"],
      },
      {
        // P-4 — four exception reports that were built, mounted and reachable
        // from nowhere. They read the same trail أحداث الأمان does, so they
        // belong beside it rather than in an operational reports shelf.
        key: "control",
        defaultCollapsed: true,
        itemKeys: [
          "report-security-exceptions",
          "report-post-posting-changes",
          "report-after-hours",
          "report-new-accounts",
        ],
      },
    ],
  },
];

/**
 * Nav group key -> the entitlement module its screens require. A group with
 * no entry here (سير العمل، الإعداد) is core platform surface and always
 * shown, the same set `isModuleLicensed` treats as always-licensed.
 */
const GROUP_MODULE: Readonly<Partial<Record<string, ModuleId>>> = {
  sell: "sales",
  crm: "crm",
  installments: "installments",
  buy: "purchases",
  items: "inventory",
  stock: "inventory",
  manufacturing: "manufacturing",
  treasury: "treasury",
  money: "accounting",
  people: "hr",
  assets: "assets",
  contracting: "projects",
};

/** Per-item overrides for a screen whose module differs from its group's — الأوراق المالية sits on the treasury shelf but is its own licensable module. */
const ITEM_MODULE_OVERRIDE: Readonly<Partial<Record<string, ModuleId>>> = {
  cheques: "financial_papers",
};

function moduleForNavItem(groupKey: string, itemKey: string): ModuleId | undefined {
  return ITEM_MODULE_OVERRIDE[itemKey] ?? GROUP_MODULE[groupKey];
}

/**
 * Hides a group's items — and the group itself once it has none left — whose
 * module the tenant's plan does not license, so a business-plan tenant with
 * no `hr` module never sees الأشخاص in the rail. `entitlements === null`
 * means "still loading" and returns `groups` untouched: filtering on a `null`
 * would flash the whole rail empty for an instant on every load.
 */
export function filterNavGroupsByEntitlements(groups: readonly NavGroup[], entitlements: Entitlements | null): NavGroup[] {
  if (!entitlements) return [...groups];
  const isVisible = (groupKey: string, item: NavItem) => {
    const moduleId = moduleForNavItem(groupKey, item.key);
    return moduleId === undefined || isModuleLicensed(moduleId, entitlements);
  };
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isVisible(group.key, item)),
      sections: group.sections
        ?.map((section) => ({ ...section, items: section.items.filter((item) => isVisible(group.key, item)) }))
        .filter((section) => section.items.length > 0),
    }))
    .filter((group) => group.items.length > 0 || (group.sections?.length ?? 0) > 0);
}

/** Items the shell pins at the top of the rail, above every group; their own group never reaches the rail. */
/**
 * The two inboxes, pinned above the workspaces in the order they are cleared:
 * صندوق الوارد (what happened) then الموافقات (what is waiting for me).
 */
export const PINNED_NAV_ITEM_KEYS: readonly string[] = ["notifications", "approvals"];

/**
 * What each destination costs to reach (P-3).
 *
 * `permission` is the code the screen's OWN routes gate on — read off the
 * `gate("…")` call on each route group in packages/api, so the rail and the
 * server agree about who may open a screen. `module` is the ENTITLEMENT id
 * from `MODULE_ROUTE_PREFIXES` (packages/api/src/module-gate.ts) for the
 * prefix that screen calls, and only where that prefix is actually gated —
 * `/reports`, `/eta` and every platform route are absent from that map, so
 * the rows that call them carry no module either. Nav that claims a licence
 * gate the API does not enforce is a different lie from the one being fixed.
 *
 * A key with no entry is reachable by anyone signed in: the dashboard, the
 * person's own profile, their own leave.
 */
export const NAV_ITEM_ACCESS: Readonly<Record<string, { readonly permission?: string; readonly module?: string }>> = {
  dashboard: { permission: "dashboard.view" },
  notifications: { module: "notifications" },
  approvals: { permission: "workflow.view" },

  "sales-hub": { permission: "sales.invoice.view", module: "sales" },
  quotes: { permission: "sales.quote.view", module: "sales" },
  "sales-invoices": { permission: "sales.invoice.view", module: "sales" },
  "sales-returns": { permission: "sales.return.view", module: "sales" },
  "van-trips": { permission: "field.van_trip.view", module: "field" },
  customers: { permission: "sales.customer.view", module: "sales" },
  "price-lists": { permission: "sales.price_list.view", module: "sales" },
  promotions: { permission: "sales.promotion.view", module: "sales" },
  "report-sales-by-period": { permission: "sales.invoice.view" },
  "report-sales-by-item": { permission: "sales.invoice.view" },
  "report-sales-by-customer": { permission: "sales.invoice.view" },
  "report-sales-by-salesperson": { permission: "sales.invoice.view" },
  "report-sales-top-products": { permission: "sales.invoice.view" },
  "report-offers": { permission: "sales.promotion.view" },
  "report-van-sales": { permission: "field.van_trip.view" },
  "report-aging-customers": { permission: "sales.invoice.view" },

  "crm-hub": { permission: "crm.lead.view", module: "crm" },
  "crm-activities": { permission: "crm.activity.view", module: "crm" },
  leads: { permission: "crm.lead.view", module: "crm" },
  opportunities: { permission: "crm.opportunity.view", module: "crm" },
  pipeline: { permission: "crm.pipeline.view", module: "crm" },
  "pipeline-stages": { permission: "crm.pipeline.manage", module: "crm" },

  "installment-plans": { permission: "installments.plan.view", module: "installments" },
  "installment-follow-ups": { permission: "installments.follow_up.view", module: "installments" },
  "report-installments-overview": { permission: "installments.plan.view" },
  "report-installments-overdue": { permission: "installments.plan.view" },

  "purchases-hub": { permission: "purchases.invoice.view", module: "purchases" },
  rfqs: { permission: "purchases.rfq.view", module: "purchases" },
  "purchase-orders": { permission: "purchases.order.view", module: "purchases" },
  "goods-receipts": { permission: "purchases.receipt.view", module: "purchases" },
  "purchase-invoices": { permission: "purchases.invoice.view", module: "purchases" },
  "purchase-returns": { permission: "purchases.return.view", module: "purchases" },
  "landed-costs": { permission: "purchases.landed_cost.view", module: "purchases" },
  vendors: { permission: "purchases.supplier.view", module: "purchases" },
  "report-purchases-by-period": { permission: "purchases.invoice.view" },
  "report-purchases-by-supplier": { permission: "purchases.invoice.view" },
  "report-purchases-by-item": { permission: "purchases.invoice.view" },
  "report-aging-suppliers": { permission: "purchases.invoice.view" },

  "items-hub": { permission: "inventory.item.view", module: "inventory" },
  items: { permission: "inventory.item.view", module: "inventory" },
  "product-templates": { permission: "inventory.template.view", module: "inventory" },
  "configurable-products": { permission: "inventory.template.view", module: "inventory" },
  "item-specifications": { permission: "inventory.item.view", module: "inventory" },
  boms: { permission: "manufacturing.bom.view", module: "manufacturing" },

  "inventory-hub": { permission: "inventory.stock.view", module: "inventory" },
  "stock-balance": { permission: "inventory.stock.view", module: "inventory" },
  "stock-transfers": { permission: "inventory.transfer.view", module: "inventory" },
  "stock-adjustments": { permission: "inventory.adjustment.view", module: "inventory" },
  "physical-counts": { permission: "inventory.count.view", module: "inventory" },
  "writedown-runs": { permission: "inventory.writedown.view", module: "inventory" },
  "report-inventory-stock-levels": { permission: "inventory.stock.view" },
  "report-inventory-movement": { permission: "inventory.stock.view" },
  "report-inventory-ledger": { permission: "inventory.stock.view" },
  "report-inventory-valuation": { permission: "inventory.valuation.view" },
  "report-inventory-aging": { permission: "inventory.stock.view" },
  "report-inventory-expiring": { permission: "inventory.stock.view" },
  "report-inventory-slow-moving": { permission: "inventory.stock.view" },
  "report-inventory-drift": { permission: "inventory.valuation.view" },

  "manufacturing-hub": { permission: "manufacturing.wo.view", module: "manufacturing" },
  "work-orders": { permission: "manufacturing.wo.view", module: "manufacturing" },
  "production-dashboard": { permission: "manufacturing.wo.view", module: "manufacturing" },
  "custom-manufacturing": { permission: "manufacturing.wo.create", module: "manufacturing" },
  "report-make-vs-buy": { permission: "manufacturing.bom.view" },

  "treasury-hub": { permission: "treasury.account.view", module: "treasury" },
  "treasury-vouchers": { permission: "treasury.cash_voucher.view", module: "treasury" },
  cheques: { permission: "cheques.view", module: "financial_papers" },
  "treasury-accounts": { permission: "treasury.account.view", module: "treasury" },

  "accounting-hub": { permission: "accounting.reports.view", module: "accounting" },
  journals: { permission: "accounting.journal.view", module: "accounting" },
  "fiscal-periods": { permission: "accounting.period.view", module: "accounting" },
  // `/reconciliation` is mounted under the TREASURY licence prefix even though
  // its route gates on an accounting code — the rail states what the API does.
  reconciliation: { permission: "accounting.reports.view", module: "treasury" },
  "bank-reconciliation": { permission: "treasury.reconciliation.view", module: "treasury" },
  revaluation: { permission: "accounting.journal.post", module: "accounting" },
  eta: { permission: "accounting.eta.view" },
  coa: { permission: "accounting.coa.view", module: "accounting" },
  "cost-centers": { permission: "accounting.coa.view", module: "accounting" },
  taxes: { permission: "accounting.tax.view", module: "accounting" },
  "exchange-rates": { permission: "accounting.exchange_rate.manage", module: "accounting" },
  "trial-balance-report": { permission: "accounting.reports.view", module: "accounting" },
  "financial-reports": { permission: "accounting.reports.view", module: "accounting" },
  "cost-center-pl": { permission: "accounting.reports.view", module: "accounting" },

  "hr-dashboard": { permission: "hr.employee.view", module: "hr" },
  employees: { permission: "hr.employee.view", module: "hr" },
  departments: { permission: "hr.department.view", module: "hr" },
  "job-titles": { permission: "hr.job_title.view", module: "hr" },
  contracts: { permission: "hr.contract.view", module: "hr" },
  attendance: { permission: "hr.attendance.view", module: "hr" },
  holidays: { permission: "hr.leave_policy.view", module: "hr" },
  "leave-requests": { permission: "hr.leave.view", module: "hr" },
  "leave-balances": { permission: "hr.leave.view", module: "hr" },
  "leave-accrual-batches": { permission: "hr.leave_accrual.run", module: "hr" },
  "my-leave": { module: "hr" },
  payroll: { permission: "hr.payroll.view", module: "hr" },
  advances: { permission: "hr.advance.view", module: "hr" },
  "leave-policies": { permission: "hr.leave_policy.view", module: "hr" },
  "payroll-components": { permission: "hr.payroll.view", module: "hr" },

  "assets-hub": { permission: "assets.view", module: "assets" },
  "asset-register": { permission: "assets.view", module: "assets" },
  "depreciation-runs": { permission: "assets.depreciation.view", module: "assets" },
  "asset-categories": { permission: "assets.manage", module: "assets" },

  projects: { permission: "projects.project.view", module: "projects" },

  "settings-general": { permission: "admin.settings.view" },
  "settings-profile": {},
  "settings-branches": { permission: "admin.branches.view" },
  "settings-warehouses": { permission: "admin.warehouses.view" },
  "settings-sequences": { permission: "admin.sequences.view" },
  "settings-print": { permission: "admin.settings.view" },
  "settings-barcode": { permission: "admin.settings.view" },
  "settings-data-migration": { permission: "admin.settings.view" },
  users: { permission: "admin.users.view" },
  roles: { permission: "admin.roles.view" },
  "settings-workflow": { permission: "workflow.config.view" },
  "notification-rules": { permission: "notifications.rule.view", module: "notifications" },
  audit: { permission: "audit.logs.view" },
  // P-4 — the exact code each of the four /security-reports routes gates on.
  "report-security-exceptions": { permission: "audit.logs.view" },
  "report-post-posting-changes": { permission: "audit.logs.view" },
  "report-after-hours": { permission: "audit.logs.view" },
  "report-new-accounts": { permission: "audit.logs.view" },
  devices: { permission: "admin.devices.view" },
  "settings-backup": { permission: "admin.backup.view" },
  status: { permission: "admin.settings.view" },
};

/**
 * The quick actions (R1.5). Go-to entries are NOT listed here — they are
 * generated from the nav config below, so a screen added to the sidebar is
 * reachable from the palette without anyone remembering to add it twice.
 */
const commandItemSpecs = [
  { id: "cmd-invoice", groupKey: "command.group.quickActions", hint: `${modKeyLabel()}+N` },
  { id: "cmd-collect", groupKey: "command.group.quickActions" },
  { id: "cmd-receipt", groupKey: "command.group.quickActions" },
  { id: "cmd-receive", groupKey: "command.group.quickActions" },
  { id: "cmd-pay-supplier", groupKey: "command.group.quickActions" },
  { id: "cmd-purchase-invoice", groupKey: "command.group.quickActions" },
  { id: "cmd-quote", groupKey: "command.group.quickActions" },
  { id: "cmd-item", groupKey: "command.group.quickActions" },
  { id: "cmd-adjustment", groupKey: "command.group.quickActions" },
  { id: "cmd-shortcuts", groupKey: "command.group.goTo", hint: "?" },
] as const satisfies readonly { id: string; groupKey: AppTranslationKey; hint?: string }[];

/**
 * One go-to entry per navigable screen, built from the same specs the sidebar
 * uses. Generated rather than listed so the palette cannot drift out of step
 * with the nav — the previous hand-written list covered two screens of about
 * ninety.
 */
export function buildGoToCommandItems(t: Translate): CommandItem[] {
  const seen = new Set<string>();
  const items: CommandItem[] = [];
  for (const group of navGroupSpecs) {
    const groupLabel = t(`nav.group.${group.key}` as AppTranslationKey);
    const keys = [...group.itemKeys, ...(group.sections ?? []).flatMap((section) => section.itemKeys)];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `goto-${key}`,
        label: t(`nav.item.${key}` as AppTranslationKey),
        group: `${t("command.group.goTo")} · ${groupLabel}`,
        keywords: COMMAND_KEYWORDS[key]?.map((k) => t(k as AppTranslationKey)),
        onSelect: () => {},
      });
    }
  }
  return items;
}

/**
 * Report titles that live INSIDE a screen and therefore have no nav label of
 * their own (§8.4).
 *
 * «قائمة الدخل» is a tab within «التقارير المالية», so typing its name into the
 * command bar matched nothing — the bar searched nav labels and that name is
 * not one. Attaching the titles as keywords beats minting a nav entry per
 * statement, which would double the length of the reports group for no
 * navigational gain: they all open the same screen.
 */
const COMMAND_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "financial-reports": [
    "finReports.incomeStatement",
    "finReports.balanceSheet",
    "finReports.cashFlow",
    "finReports.vatReturn",
    "finReports.withholdingTax",
    "finReports.generalLedger",
    "finReports.financialStatements",
  ],
  "trial-balance-report": ["finReports.trialBalance"],
};

export function buildTopNavItem(t: Translate): NavItem {
  return { key: "dashboard", label: t("nav.item.dashboard"), icon: navItemIcon("dashboard"), ...NAV_ITEM_ACCESS.dashboard };
}

function buildNavItems(keys: readonly string[], t: Translate): NavItem[] {
  return keys.map((key) => ({
    key,
    label: t(`nav.item.${key}` as AppTranslationKey),
    icon: navItemIcon(key),
    ...NAV_ITEM_ACCESS[key],
  }));
}

export function buildNavGroups(t: Translate): NavGroup[] {
  return navGroupSpecs.map((group) => ({
    key: group.key,
    label: t(`nav.group.${group.key}` as AppTranslationKey),
    defaultCollapsed: group.defaultCollapsed,
    icon: navGroupIcon(group.key),
    items: buildNavItems(group.itemKeys, t),
    sections: group.sections?.map((section) => ({
      key: section.key,
      label: t(`nav.section.${group.key}.${section.key}` as AppTranslationKey),
      defaultCollapsed: section.defaultCollapsed,
      items: buildNavItems(section.itemKeys, t),
    })),
  }));
}

export function buildCommandItems(t: Translate): CommandItem[] {
  return commandItemSpecs.map((spec) => ({
    id: spec.id,
    label: t(`command.item.${spec.id}` as AppTranslationKey),
    group: t(spec.groupKey),
    hint: "hint" in spec ? spec.hint : undefined,
    onSelect: () => {},
  }));
}
