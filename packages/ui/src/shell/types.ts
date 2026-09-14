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
  tag?: NavTag;
  /** Rendered in the rail's glyph slot; without one the sidebar falls back to a monogram of the label. */
  icon?: ReactNode;
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
}

/** Every item in a group, direct or nested — the flat view callers need for active-key lookups. */
export function navGroupItems(group: NavGroup): NavItem[] {
  return [...group.items, ...(group.sections ?? []).flatMap((section) => section.items)];
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
