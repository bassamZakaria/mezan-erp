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
      { key: "master", defaultCollapsed: true, itemKeys: ["coa", "cost-centers", "taxes", "exchange-rates"] },
      { key: "reports", defaultCollapsed: true, itemKeys: ["trial-balance-report", "financial-reports", "cost-center-pl"] },
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
      { key: "config", defaultCollapsed: true, itemKeys: ["leave-policies", "payroll-components", "garnishments"] },
      { key: "reports", defaultCollapsed: true, itemKeys: ["report-payroll-register", "report-social-insurance", "report-salary-tax", "report-attendance-summary", "report-leave-liability", "report-end-of-service", "report-headcount-movement"] },
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
  { key: "contracting", defaultCollapsed: true, itemKeys: ["projects"] },
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
        itemKeys: ["users", "roles", "settings-workflow", "notification-rules", "audit"],
      },
    ],
  },
];

/** Items the shell pins at the top of the rail, above every group; their own group never reaches the rail. */
/**
 * The two inboxes, pinned above the workspaces in the order they are cleared:
 * صندوق الوارد (what happened) then الموافقات (what is waiting for me).
 */
export const PINNED_NAV_ITEM_KEYS: readonly string[] = ["notifications", "approvals"];

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
