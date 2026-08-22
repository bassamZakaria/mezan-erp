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
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
  defaultCollapsed?: boolean;
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
