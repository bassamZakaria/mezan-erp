import type { ReactNode } from "react";

export interface NavTag {
  label: string;
  tone?: "pattern" | "soon";
}

export interface NavItem {
  key: string;
  label: string;
  href?: string;
  onClick?: () => void;
  onIntent?: () => void;
  tag?: NavTag;
  /** Rendered in the rail's glyph slot; without one the sidebar falls back to a monogram of the label. */
  icon?: ReactNode;
  /**
   * The permission code the destination's own routes check. Absent means the
   * screen is reachable by anyone signed in (the dashboard, a personal page).
   *
   * This hides a row the seat cannot use; it is NOT the enforcement. The
   * server resolves the caller's permissions from its own copy of the grant
   * on every request (see `sessionSchema.permissions` in @mezan/contracts).
   */
  permission?: string;
  /**
   * The ENTITLEMENT module id (`Entitlements.activeModules`) this destination
   * belongs to — "sales", "financial_papers", … Absent for platform surface
   * (settings, users, audit, backup), which no licence may switch off.
   */
  module?: string;
}

/**
 * A sub-group inside a nav group — the third level. The reference product
 * nests التقارير → المبيعات → «المبيعات حسب الفترة»; without this the reports
 * group is a flat list of 22 and Settings a flat list of 15.
 */
export interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
  defaultCollapsed?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  /** Items that hang directly off the group, rendered above any sections. */
  items: NavItem[];
  /** Sub-groups, rendered after `items`. A group may have either, or both. */
  sections?: NavSection[];
  defaultCollapsed?: boolean;
  /** Shown in place of the group label when the rail is collapsed; without one the header falls back to a monogram. */
  icon?: ReactNode;
  onIntent?: () => void;
}

/** Every item in a group, direct or nested — the flat view callers need for active-key lookups. */
export function navGroupItems(group: NavGroup): NavItem[] {
  return [...group.items, ...(group.sections ?? []).flatMap((section) => section.items)];
}

/** The tenant-admin grant: one code that satisfies every gate. */
export const WILDCARD_NAV_PERMISSION = "*";

export interface NavVisibility {
  /** The session's effective permission codes — `["*"]` for a company admin. */
  readonly permissions: readonly string[];
  /**
   * The licence's active module ids. `null` means "not resolved yet", and
   * every module row stays visible: a licence that has not loaded must not
   * blank the navigation for a second and then fill it back in.
   */
  readonly activeModules: readonly string[] | null;
}

/**
 * Whether one destination may appear for this seat (P-3).
 *
 * Two independent reasons to hide a row, and both have to pass: the seat's
 * permissions, and the licence's modules. A warehouse keeper is not shown
 * الرواتب; a tenant that never bought التصنيع is not shown أوامر التصنيع even
 * if its owner holds `*`.
 */
export function isNavItemVisible(item: NavItem, visibility: NavVisibility): boolean {
  const admin = visibility.permissions.includes(WILDCARD_NAV_PERMISSION);
  if (item.module && visibility.activeModules && !visibility.activeModules.includes(item.module)) return false;
  if (!item.permission || admin) return true;
  return visibility.permissions.includes(item.permission);
}

/**
 * The navigation this seat may actually reach. Empty sections and empty
 * groups drop out entirely — a shelf that opens onto nothing reads as a
 * broken screen, not as a permission.
 */
export function filterNavGroups(groups: readonly NavGroup[], visibility: NavVisibility): NavGroup[] {
  const keep = (items: readonly NavItem[]): NavItem[] => items.filter((item) => isNavItemVisible(item, visibility));
  return groups
    .map((group) => ({
      ...group,
      items: keep(group.items),
      sections: group.sections
        ?.map((section) => ({ ...section, items: keep(section.items) }))
        .filter((section) => section.items.length > 0),
    }))
    .filter((group) => navGroupItems(group).length > 0);
}

export interface ShellUser {
  name: string;
  role: string;
  initials: string;
  /** The profile photo, when one has been uploaded; initials stand in when not. */
  photoUrl?: string | null;
}

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: ReactNode;
  /**
   * Extra text this command should also match on.
   *
   * A report that lives INSIDE another screen has no nav label of its own —
   * «قائمة الدخل» sits inside «التقارير المالية» — so searching for it found
   * nothing at all (§8.4). The titles go here instead of inventing a nav entry
   * per statement.
   */
  keywords?: readonly string[];
  onSelect: () => void;
}


export interface UserMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}
