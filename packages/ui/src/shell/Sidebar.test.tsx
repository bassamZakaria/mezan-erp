// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { TopbarScopeOption } from "./Topbar";
import type { NavGroup, NavItem } from "./types";

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

describe("Sidebar", () => {
  it("renders the brand, top item and groups — the user chip lives in the topbar", () => {
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} />);
    expect(screen.getByText("ميزان")).toBeInTheDocument();
    expect(screen.getByText("لوحة التحكم")).toBeInTheDocument();
    expect(screen.getByText("فواتير المبيعات")).toBeInTheDocument();
    expect(screen.queryByText("محمد الشهابي")).not.toBeInTheDocument();
  });

  it("marks the active nav link with aria-current", () => {
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} />);
    expect(screen.getByText("فواتير المبيعات").closest("button")).toHaveAttribute("aria-current", "page");
  });

  it("hides items belonging to a group with defaultCollapsed", () => {
    render(<Sidebar topItem={topItem} groups={groups} />);
    expect(screen.queryByText("عام")).not.toBeInTheDocument();
  });

  it("toggles a group's items on click", () => {
    render(<Sidebar topItem={topItem} groups={groups} />);
    fireEvent.click(screen.getByRole("button", { name: /الإعدادات/ }));
    expect(screen.getByText("عام")).toBeInTheDocument();
  });

  it("calls onClick for a nav item", () => {
    const onClick = vi.fn();
    const groupsWithHandler: NavGroup[] = [
      { key: "sales", label: "المبيعات", items: [{ key: "invoices", label: "فواتير المبيعات", onClick }] },
    ];
    render(<Sidebar topItem={topItem} groups={groupsWithHandler} />);
    fireEvent.click(screen.getByText("فواتير المبيعات"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Sidebar activeKey="invoices" topItem={topItem} groups={groups} />);
    expect(screen.getByText("فواتير المبيعات")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the branch and warehouse switchers as real selects and narrows on change", () => {
    const branchOptions: TopbarScopeOption[] = [{ id: "BR-MAIN", label: "الفرع الرئيسي" }];
    const warehouseOptions: TopbarScopeOption[] = [{ id: "WH-MAIN", label: "المستودع الرئيسي" }];
    const onSelectBranch = vi.fn();
    render(
      <Sidebar
        topItem={topItem}
        groups={groups}
        branchOptions={branchOptions}
        warehouseOptions={warehouseOptions}
        selectedBranchId={null}
        selectedWarehouseId={null}
        onSelectBranch={onSelectBranch}
      />,
    );
    const branchSelect = screen.getByRole("combobox", { name: "الفرع الحالي" });
    expect(screen.getByRole("combobox", { name: "المخزن الحالي" })).toBeInTheDocument();
    fireEvent.change(branchSelect, { target: { value: "BR-MAIN" } });
    expect(onSelectBranch).toHaveBeenCalledWith("BR-MAIN");
  });

  it("omits the scope switchers when no branch options are supplied — never a fabricated list", () => {
    render(<Sidebar topItem={topItem} groups={groups} />);
    expect(screen.queryByRole("combobox", { name: "الفرع الحالي" })).not.toBeInTheDocument();
  });
});
