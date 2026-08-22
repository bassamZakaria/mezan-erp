// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { NavGroup, NavItem, ShellUser } from "./types";

const topItem: NavItem = { key: "dashboard", label: "لوحة التحكم" };

const groups: NavGroup[] = [
  {
    key: "sales",
    label: "المبيعات",
    items: [
      { key: "invoices", label: "فواتير المبيعات", tag: { label: "نمط", tone: "pattern" } },
      { key: "customers", label: "العملاء", tag: { label: "قريباً", tone: "soon" } },
    ],
  },
  {
    key: "settings",
    label: "الإعدادات",
    defaultCollapsed: true,
    items: [{ key: "general", label: "عام" }],
  },
];

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

describe("Sidebar", () => {
  it("renders the brand, top item, groups, and user footer", () => {
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} user={user} />);
    expect(screen.getByText("ميزان")).toBeInTheDocument();
    expect(screen.getByText("لوحة التحكم")).toBeInTheDocument();
    expect(screen.getByText("فواتير المبيعات")).toBeInTheDocument();
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
  });

  it("marks the active nav link with aria-current", () => {
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} user={user} />);
    expect(screen.getByText("فواتير المبيعات").closest("button")).toHaveAttribute("aria-current", "page");
  });

  it("hides items belonging to a group with defaultCollapsed", () => {
    render(<Sidebar topItem={topItem} groups={groups} user={user} />);
    expect(screen.queryByText("عام")).not.toBeInTheDocument();
  });

  it("toggles a group's items on click", () => {
    render(<Sidebar topItem={topItem} groups={groups} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: /الإعدادات/ }));
    expect(screen.getByText("عام")).toBeInTheDocument();
  });

  it("calls onClick for a nav item", () => {
    const onClick = vi.fn();
    const groupsWithHandler: NavGroup[] = [
      { key: "sales", label: "المبيعات", items: [{ key: "invoices", label: "فواتير المبيعات", onClick }] },
    ];
    render(<Sidebar topItem={topItem} groups={groupsWithHandler} user={user} />);
    fireEvent.click(screen.getByText("فواتير المبيعات"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} user={user} />);
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
