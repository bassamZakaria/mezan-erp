import type { DashboardLayout, DashboardWidget } from "@mezan/domain";

/**
 * The dashboard's four lower panels as addressable widgets (§8.5, §8.7).
 *
 * Every figure on this screen was already real; what was fixed was the
 * ARRANGEMENT — one hard-coded order for everyone, so a warehouse keeper and an
 * accountant opened the same screen with the same thing at the top.
 *
 * A widget is named by a stable `kind`, because a stored layout refers to it by
 * that string and a rename would orphan every layout already saved.
 */
export const DASHBOARD_WIDGET_KINDS = ["aging", "expenses", "topItems", "activity"] as const;
export type DashboardWidgetKind = (typeof DASHBOARD_WIDGET_KINDS)[number];

export interface DashboardWidgetSpec {
  readonly kind: DashboardWidgetKind;
  /** i18n key for the widget's name in the layout editor. */
  readonly titleKey: string;
  /**
   * The permission a user must hold to see this widget AT ALL.
   *
   * Checked when the layout is resolved rather than when it is saved, so a
   * layout stored before a permission was revoked degrades quietly instead of
   * rendering a card the user may not read (§8.7). Retrofitting this check onto
   * a stored layout later is where a feature like this usually leaks data.
   */
  readonly permission: string;
}

export const DASHBOARD_WIDGETS: readonly DashboardWidgetSpec[] = [
  { kind: "aging", titleKey: "dashboard.aging", permission: "reports.aging.read" },
  { kind: "expenses", titleKey: "dashboard.expenses", permission: "accounting.reports.view" },
  { kind: "topItems", titleKey: "dashboard.topItems", permission: "sales.invoice.view" },
  { kind: "activity", titleKey: "dashboard.activity", permission: "accounting.journal.view" },
];

const SPEC_BY_KIND = new Map(DASHBOARD_WIDGETS.map((w) => [w.kind, w]));

/** The order everyone gets before they have chosen one. */
export function defaultDashboardLayout(): DashboardLayout {
  return {
    columns: 2,
    widgets: DASHBOARD_WIDGETS.map((spec, index) => ({
      id: spec.kind,
      kind: spec.kind,
      column: index % 2,
      order: index,
      size: "md" as const,
      visible: true,
      settings: {},
    })),
  };
}

/**
 * What this user may actually see, in the order they chose.
 *
 * Three things happen here, and each one is a way this feature goes wrong if it
 * is left out:
 *
 * - a widget the layout names but the registry no longer has is DROPPED, so an
 *   old layout cannot blank the screen with a card that has no component;
 * - a widget the user lacks the permission for is dropped, whatever the stored
 *   layout says (§8.7);
 * - a widget the registry HAS and the layout does not is appended, so adding a
 *   panel to the product does not require every user to rebuild their layout to
 *   see it.
 */
export function resolveDashboardWidgets(
  layout: DashboardLayout | null | undefined,
  can: (permission: string) => boolean,
): readonly DashboardWidget[] {
  const stored = layout?.widgets ?? defaultDashboardLayout().widgets;
  const named = new Set(stored.map((w) => w.kind));

  const known = stored.filter((w) => SPEC_BY_KIND.has(w.kind as DashboardWidgetKind));
  const appended = defaultDashboardLayout().widgets.filter((w) => !named.has(w.kind));

  return [...known, ...appended]
    .filter((w) => w.visible)
    .filter((w) => can(SPEC_BY_KIND.get(w.kind as DashboardWidgetKind)!.permission))
    .sort((a, b) => a.order - b.order);
}

/** The widgets a user may choose from — the editor's list, permission-filtered. */
export function availableDashboardWidgets(can: (permission: string) => boolean): readonly DashboardWidgetSpec[] {
  return DASHBOARD_WIDGETS.filter((spec) => can(spec.permission));
}
