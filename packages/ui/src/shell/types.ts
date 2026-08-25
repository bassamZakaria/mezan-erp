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

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
  defaultCollapsed?: boolean;
  /** Shown in place of the group label when the rail is collapsed; without one the header falls back to a monogram. */
  icon?: ReactNode;
}

export interface ShellUser {
  name: string;
  role: string;
  initials: string;
}

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: ReactNode;
  onSelect: () => void;
}


export interface UserMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
}
