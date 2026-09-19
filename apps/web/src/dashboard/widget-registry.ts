import type { DashboardLayout, DashboardWidget, DashboardWidgetSize } from "@mezan/domain";

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
export type DashboardPanelKind = (typeof DASHBOARD_WIDGET_KINDS)[number];

export enum CockpitWidgetKind {
  Pulse = "cockpitPulse",
  Runway = "cockpitRunway",
  Overdue = "cockpitOverdue",
  LowStock = "cockpitLowStock",
  Cash = "cockpitCash",
  Movers = "cockpitMovers",
  Margin = "cockpitMargin",
}

export type DashboardWidgetKind = DashboardPanelKind | CockpitWidgetKind;

export enum DashboardSection {
  Cockpit = "cockpit",
  Panels = "panels",
}

export enum DashboardAudience {
  Owner = "owner",
  Staff = "staff",
}

export const COCKPIT_PERMISSION = "accounting.cockpit.view";

export interface DashboardWidgetSpec {
  readonly kind: DashboardWidgetKind;
  readonly section: DashboardSection;
  readonly size: DashboardWidgetSize;
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

const PANEL_WIDGETS: readonly DashboardWidgetSpec[] = [
  { kind: "aging", section: DashboardSection.Panels, size: "md", titleKey: "dashboard.aging", permission: "reports.aging.read" },
  { kind: "expenses", section: DashboardSection.Panels, size: "md", titleKey: "dashboard.expenses", permission: "accounting.reports.view" },
  { kind: "topItems", section: DashboardSection.Panels, size: "md", titleKey: "dashboard.topItems", permission: "sales.invoice.view" },
  { kind: "activity", section: DashboardSection.Panels, size: "md", titleKey: "dashboard.activity", permission: "accounting.journal.view" },
];

const COCKPIT_WIDGETS: readonly DashboardWidgetSpec[] = [
  { kind: CockpitWidgetKind.Pulse, section: DashboardSection.Cockpit, size: "full", titleKey: "cockpit.pulse.title", permission: COCKPIT_PERMISSION },
  { kind: CockpitWidgetKind.Runway, section: DashboardSection.Cockpit, size: "sm", titleKey: "cockpit.runway.title", permission: "treasury.cash_forecast.view" },
  { kind: CockpitWidgetKind.Overdue, section: DashboardSection.Cockpit, size: "sm", titleKey: "cockpit.overdue.title", permission: COCKPIT_PERMISSION },
  { kind: CockpitWidgetKind.LowStock, section: DashboardSection.Cockpit, size: "sm", titleKey: "cockpit.lowStock.title", permission: COCKPIT_PERMISSION },
  { kind: CockpitWidgetKind.Cash, section: DashboardSection.Cockpit, size: "md", titleKey: "cockpit.cash.title", permission: COCKPIT_PERMISSION },
  { kind: CockpitWidgetKind.Movers, section: DashboardSection.Cockpit, size: "md", titleKey: "cockpit.movers.title", permission: COCKPIT_PERMISSION },
  { kind: CockpitWidgetKind.Margin, section: DashboardSection.Cockpit, size: "md", titleKey: "cockpit.margin.title", permission: COCKPIT_PERMISSION },
];

export const DASHBOARD_WIDGETS: readonly DashboardWidgetSpec[] = [...PANEL_WIDGETS, ...COCKPIT_WIDGETS];

const SPEC_BY_KIND = new Map<string, DashboardWidgetSpec>(DASHBOARD_WIDGETS.map((w) => [w.kind, w]));

export function dashboardWidgetSpec(kind: string): DashboardWidgetSpec | undefined {
  return SPEC_BY_KIND.get(kind);
}

/** The owner holds every right; everyone else starts from the staff arrangement. */
export function dashboardAudienceOf(permissions: readonly string[]): DashboardAudience {
  return permissions.includes("*") ? DashboardAudience.Owner : DashboardAudience.Staff;
}

/**
 * The order everyone gets before they have chosen one. The owner's puts the
 * live cockpit first; staff keep the panels they had and find the cockpit
 * after them, where their role grants it.
 */
export function defaultDashboardLayout(audience: DashboardAudience = DashboardAudience.Staff): DashboardLayout {
  const ordered = audience === DashboardAudience.Owner ? [...COCKPIT_WIDGETS, ...PANEL_WIDGETS] : [...PANEL_WIDGETS, ...COCKPIT_WIDGETS];
  return {
    columns: 2,
    widgets: ordered.map((spec, index) => ({
      id: spec.kind,
      kind: spec.kind,
      column: index % 2,
      order: index,
      size: spec.size,
      visible: true,
      settings: {},
    })),
  };
}

function resolveAll(
  layout: DashboardLayout | null | undefined,
  can: (permission: string) => boolean,
  audience: DashboardAudience,
): readonly DashboardWidget[] {
  const fallback = defaultDashboardLayout(audience).widgets;
  const stored = layout?.widgets && layout.widgets.length > 0 ? layout.widgets : fallback;
  const named = new Set(stored.map((w) => w.kind));
  const known = stored.filter((w) => SPEC_BY_KIND.has(w.kind));
  const last = known.reduce((max, w) => Math.max(max, w.order), -1);
  const appended = fallback.filter((w) => !named.has(w.kind)).map((w, i) => ({ ...w, order: last + 1 + i }));
  return [...known, ...appended]
    .filter((w) => w.visible)
    .filter((w) => can(SPEC_BY_KIND.get(w.kind)!.permission))
    .sort((a, b) => a.order - b.order);
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
  section: DashboardSection = DashboardSection.Panels,
  audience: DashboardAudience = DashboardAudience.Staff,
): readonly DashboardWidget[] {
  return resolveAll(layout, can, audience).filter((w) => SPEC_BY_KIND.get(w.kind)!.section === section);
}

/** Whether the cockpit comes before the classic panels in this user's arrangement. */
export function cockpitLeads(
  layout: DashboardLayout | null | undefined,
  can: (permission: string) => boolean,
  audience: DashboardAudience,
): boolean {
  const all = resolveAll(layout, can, audience);
  const first = all[0];
  return first !== undefined && SPEC_BY_KIND.get(first.kind)!.section === DashboardSection.Cockpit;
}

/** The widgets a user may choose from — the editor's list, permission-filtered. */
export function availableDashboardWidgets(can: (permission: string) => boolean): readonly DashboardWidgetSpec[] {
  return DASHBOARD_WIDGETS.filter((spec) => can(spec.permission));
}
