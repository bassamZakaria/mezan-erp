import { modKeyLabel, type CommandItem, type NavGroup, type NavItem } from "@mezan/ui";
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

export interface NavGroupSpec {
  readonly key: string;
  readonly itemKeys: readonly string[];
  readonly defaultCollapsed?: boolean;
}

export const navGroupSpecs: readonly NavGroupSpec[] = [
  { key: "workflow", itemKeys: ["approvals"] },
  {
    key: "sales",
    itemKeys: ["sales-hub", "customers", "quotes", "sales-invoices", "sales-returns", "price-lists", "promotions"],
  },
  {
    key: "purchases",
    itemKeys: [
      "purchases-hub",
      "vendors",
      "rfqs",
      "purchase-orders",
      "goods-receipts",
      "purchase-invoices",
      "purchase-returns",
      "landed-costs",
    ],
  },
  {
    key: "inventory",
    itemKeys: [
      "inventory-hub",
      "items",
      "stock-balance",
      "stock-transfers",
      "stock-adjustments",
      "physical-counts",
      "configurable-products",
      "product-templates",
      "item-specifications",
      "labels",
      "writedown-runs",
    ],
  },
  {
    key: "manufacturing",
    itemKeys: ["manufacturing-hub", "production-dashboard", "work-orders", "boms", "custom-manufacturing"],
  },
  {
    key: "accounting",
    itemKeys: [
      "accounting-hub",
      "coa",
      "cost-centers",
      "cost-center-pl",
      "journals",
      "fiscal-periods",
      "taxes",
      "exchange-rates",
      "revaluation",
      "reconciliation",
      "eta",
      "trial-balance-report",
      "financial-reports",
    ],
  },
  {
    key: "treasury",
    itemKeys: ["treasury-hub", "treasury-accounts", "treasury-vouchers", "bank-reconciliation"],
  },
  { key: "financial-papers", itemKeys: ["cheques"] },
  {
    key: "crm",
    itemKeys: ["crm-hub", "leads", "opportunities", "pipeline", "pipeline-stages", "crm-activities"],
  },
  {
    key: "hr",
    itemKeys: [
      "hr-dashboard",
      "employees",
      "departments",
      "job-titles",
      "contracts",
      "holidays",
      "attendance",
      "payroll",
      "advances",
      "leave-requests",
      "leave-balances",
      "leave-accrual-batches",
      "leave-policies",
      "my-leave",
    ],
  },
  { key: "projects", itemKeys: ["projects"] },
  { key: "assets", itemKeys: ["assets-hub", "asset-register", "depreciation-runs", "asset-categories"] },
  { key: "field", itemKeys: ["van-trips"] },
  { key: "installments", itemKeys: ["installment-plans", "installment-follow-ups"] },
  {
    key: "reports",
    itemKeys: [
      "report-sales-by-period",
      "report-sales-by-item",
      "report-sales-by-customer",
      "report-sales-by-salesperson",
      "report-sales-top-products",
      "report-purchases-by-period",
      "report-purchases-by-supplier",
      "report-purchases-by-item",
      "report-inventory-stock-levels",
      "report-inventory-movement",
      "report-inventory-ledger",
      "report-inventory-valuation",
      "report-inventory-aging",
      "report-inventory-expiring",
      "report-inventory-slow-moving",
      "report-inventory-drift",
      "report-aging-customers",
      "report-aging-suppliers",
      "report-installments-overview",
      "report-installments-overdue",
      "report-van-sales",
      "report-make-vs-buy",
    ],
  },
  {
    key: "settings",
    defaultCollapsed: true,
    itemKeys: [
      "settings-general",
      "settings-branches",
      "settings-warehouses",
      "settings-print",
      "notification-rules",
      "settings-data-migration",
      "settings-workflow",
      "settings-sequences",
      "settings-barcode",
      "settings-profile",
      "settings-api-keys",
      "settings-webhooks",
      "audit",
      "users",
      "roles",
    ],
  },
  { key: "system", defaultCollapsed: true, itemKeys: ["status"] },
];

const commandItemSpecs = [
  { id: "cmd-invoice", groupKey: "command.group.quickActions", hint: `${modKeyLabel()}+N` },
  { id: "cmd-receipt", groupKey: "command.group.quickActions" },
  { id: "cmd-coa", groupKey: "command.group.goTo" },
  { id: "cmd-journals", groupKey: "command.group.goTo" },
  { id: "cmd-shortcuts", groupKey: "command.group.goTo", hint: "?" },
] as const satisfies readonly { id: string; groupKey: AppTranslationKey; hint?: string }[];

export function buildTopNavItem(t: Translate): NavItem {
  return { key: "dashboard", label: t("nav.item.dashboard"), icon: navItemIcon("dashboard") };
}

export function buildNavGroups(t: Translate): NavGroup[] {
  return navGroupSpecs.map((group) => ({
    key: group.key,
    label: t(`nav.group.${group.key}` as AppTranslationKey),
    defaultCollapsed: group.defaultCollapsed,
    icon: navGroupIcon(group.key),
    items: group.itemKeys.map((key) => ({
      key,
      label: t(`nav.item.${key}` as AppTranslationKey),
      icon: navItemIcon(key),
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
