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
 * (docs/superpowers/specs/2026-08-27-ui-revamp-design.md §3.1, §3.3).
 *
 * A group's first item is its hub, which is what the workspace header opens.
 */
export const navGroupSpecs: readonly NavGroupSpec[] = [
  { key: "workflow", defaultCollapsed: true, itemKeys: ["approvals"] },
  {
    key: "sell",
    defaultCollapsed: true,
    itemKeys: ["sales-hub"],
    sections: [
      { key: "daily", itemKeys: ["quotes", "sales-invoices", "sales-returns", "van-trips", "installment-follow-ups", "crm-activities"] },
      { key: "master", defaultCollapsed: true, itemKeys: ["customers", "crm-hub", "leads", "opportunities", "pipeline", "installment-plans"] },
      {
        key: "reports",
        defaultCollapsed: true,
        itemKeys: [
          "report-sales-by-period",
          "report-sales-by-item",
          "report-sales-by-customer",
          "report-sales-by-salesperson",
          "report-sales-top-products",
          "report-van-sales",
          "report-aging-customers",
          "report-installments-overview",
          "report-installments-overdue",
        ],
      },
      { key: "config", defaultCollapsed: true, itemKeys: ["price-lists", "promotions", "pipeline-stages"] },
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
  {
    key: "stock",
    defaultCollapsed: true,
    itemKeys: ["inventory-hub"],
    sections: [
      { key: "daily", itemKeys: ["stock-balance", "stock-transfers", "stock-adjustments", "physical-counts", "writedown-runs"] },
      {
        key: "production",
        defaultCollapsed: true,
        itemKeys: ["manufacturing-hub", "production-dashboard", "work-orders", "custom-manufacturing", "boms"],
      },
      { key: "master", defaultCollapsed: true, itemKeys: ["items", "product-templates", "configurable-products", "item-specifications"] },
      {
        key: "reports",
        defaultCollapsed: true,
        itemKeys: [
          "report-inventory-stock-levels",
          "report-inventory-movement",
          "report-inventory-ledger",
          "report-inventory-valuation",
          "report-inventory-aging",
          "report-inventory-expiring",
          "report-inventory-slow-moving",
          "report-inventory-drift",
          "report-make-vs-buy",
        ],
      },
      { key: "config", defaultCollapsed: true, itemKeys: ["labels"] },
    ],
  },
  {
    key: "money",
    defaultCollapsed: true,
    itemKeys: ["accounting-hub"],
    sections: [
      { key: "daily", itemKeys: ["treasury-vouchers", "cheques", "journals"] },
      { key: "close", defaultCollapsed: true, itemKeys: ["fiscal-periods", "reconciliation", "bank-reconciliation", "revaluation", "eta"] },
      {
        key: "master",
        defaultCollapsed: true,
        itemKeys: ["coa", "treasury-hub", "treasury-accounts", "cost-centers", "taxes", "exchange-rates"],
      },
      { key: "reports", defaultCollapsed: true, itemKeys: ["trial-balance-report", "financial-reports", "cost-center-pl"] },
    ],
  },
  {
    key: "people",
    defaultCollapsed: true,
    itemKeys: ["hr-dashboard"],
    sections: [
      { key: "staff", itemKeys: ["employees", "departments", "job-titles", "contracts"] },
      {
        key: "time",
        defaultCollapsed: true,
        itemKeys: ["attendance", "holidays", "leave-requests", "leave-balances", "leave-accrual-batches", "my-leave"],
      },
      { key: "pay", defaultCollapsed: true, itemKeys: ["payroll", "advances"] },
      { key: "assets", defaultCollapsed: true, itemKeys: ["assets-hub", "asset-register", "depreciation-runs"] },
      { key: "projects", defaultCollapsed: true, itemKeys: ["projects"] },
      { key: "config", defaultCollapsed: true, itemKeys: ["leave-policies", "payroll-components", "asset-categories"] },
    ],
  },
  {
    key: "setup",
    defaultCollapsed: true,
    itemKeys: ["settings-general"],
    sections: [
      { key: "access", itemKeys: ["users", "roles", "settings-profile", "audit"] },
      { key: "structure", defaultCollapsed: true, itemKeys: ["settings-branches", "settings-warehouses"] },
      { key: "workflow", defaultCollapsed: true, itemKeys: ["settings-workflow", "notification-rules"] },
      { key: "documents", defaultCollapsed: true, itemKeys: ["settings-print", "settings-sequences", "settings-barcode"] },
      { key: "integrations", defaultCollapsed: true, itemKeys: ["settings-api-keys", "settings-webhooks", "settings-data-migration"] },
      { key: "system", defaultCollapsed: true, itemKeys: ["status"] },
    ],
  },
];

/** Groups the shell renders in the topbar's gear menu instead of the sidebar rail. */
export const UTILITY_GROUP_KEYS: ReadonlySet<string> = new Set(["setup"]);

/** Items the shell pins at the top of the rail, above every group; their own group never reaches the rail. */
export const PINNED_NAV_ITEM_KEYS: readonly string[] = ["approvals"];

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
        onSelect: () => {},
      });
    }
  }
  return items;
}

export function buildTopNavItem(t: Translate): NavItem {
  return { key: "dashboard", label: t("nav.item.dashboard"), icon: navItemIcon("dashboard") };
}

function buildNavItems(keys: readonly string[], t: Translate): NavItem[] {
  return keys.map((key) => ({
    key,
    label: t(`nav.item.${key}` as AppTranslationKey),
    icon: navItemIcon(key),
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
