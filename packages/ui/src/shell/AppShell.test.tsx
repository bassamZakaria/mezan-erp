// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AppShell } from "./AppShell";
import type { TopbarScopeOption } from "./Topbar";
import type { CommandItem, NavGroup, NavItem, ShellUser } from "./types";

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

const workspaces: NavItem[] = [
  { key: "sell", label: "البيع والتحصيل" },
  { key: "buy", label: "الشراء والتوريد" },
  { key: "stock", label: "المخزون والتصنيع" },
];

/** Two sections apiece: the first becomes chips, the rest become dropdowns. */
const workspaceGroups: NavGroup[] = [
  {
    key: "buy",
    label: "الشراء والتوريد",
    items: [{ key: "purchases-hub", label: "لوحة المشتريات" }],
    sections: [
      { key: "daily", label: "الشغل اليومي", items: [{ key: "purchase-orders", label: "أوامر الشراء" }] },
      { key: "reports", label: "التقارير", items: [{ key: "report-aging-suppliers", label: "أعمار الموردين" }] },
    ],
  },
  { key: "stock", label: "المخزون والتصنيع", items: [{ key: "inventory-hub", label: "لوحة المخزون" }] },
];

function renderShell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <AppShell user={user} workspaces={workspaces} workspaceGroups={workspaceGroups} activeWorkspaceKey="buy" {...props}>
      <div>محتوى الصفحة</div>
    </AppShell>,
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("AppShell — the two-row top bar", () => {
  it("renders the wordmark, the page children and no side rail", () => {
    renderShell();
    expect(screen.getByText("ميزان")).toBeInTheDocument();
    expect(screen.getByText("محتوى الصفحة")).toBeInTheDocument();
    // The rail is gone: nothing in the shell renders an <aside> any more.
    expect(document.querySelector("aside")).toBeNull();
  });

  it("gives row one and row two separate nav landmarks with distinct Arabic names", () => {
    renderShell();
    const rowOne = screen.getByRole("navigation", { name: "مساحات العمل" });
    const rowTwo = screen.getByRole("navigation", { name: "شاشات مساحة العمل — الشراء والتوريد" });
    expect(rowOne).not.toBe(rowTwo);
    expect(within(rowOne).getByRole("button", { name: "الشراء والتوريد" })).toBeInTheDocument();
    expect(within(rowTwo).getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
  });

  it("puts a skip link to <main> first in the tab order", () => {
    const { container } = renderShell();
    const focusable = Array.from(container.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex='0']"));
    const skip = screen.getByRole("link", { name: "تخطَّ إلى المحتوى" });
    expect(focusable[0]).toBe(skip);
    expect(skip.getAttribute("href")).toBe("#mz-main");
    expect(document.getElementById("mz-main")?.tagName).toBe("MAIN");
  });

  it("renders row two as the ACTIVE workspace's screens: hub + first section as chips, later sections as menus", () => {
    renderShell();
    const rowTwo = screen.getByRole("navigation", { name: /شاشات مساحة العمل/ });
    expect(within(rowTwo).getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    expect(within(rowTwo).getByRole("button", { name: "أوامر الشراء" })).toBeInTheDocument();
    // The second section is a dropdown, so its screens are not chips…
    expect(within(rowTwo).queryByRole("button", { name: "أعمار الموردين" })).toBeNull();
    const menu = within(rowTwo).getByRole("button", { name: "التقارير" });
    expect(menu).toHaveAttribute("aria-haspopup", "menu");
    // …until it is opened.
    fireEvent.click(menu);
    expect(screen.getByRole("menuitem", { name: "أعمار الموردين" })).toBeInTheDocument();
  });

  it("re-renders row two when the workspace changes", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    rerender(
      <AppShell user={user} workspaces={workspaces} workspaceGroups={workspaceGroups} activeWorkspaceKey="stock">
        <div>محتوى الصفحة</div>
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: "لوحة المشتريات" })).toBeNull();
    expect(screen.getByRole("button", { name: "لوحة المخزون" })).toBeInTheDocument();
  });

  it("marks the active workspace with aria-current and reports a tab click", () => {
    const onWorkspaceChange = vi.fn();
    renderShell({ onWorkspaceChange });
    const rowOne = screen.getByRole("navigation", { name: "مساحات العمل" });
    expect(within(rowOne).getByRole("button", { name: "الشراء والتوريد" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(rowOne).getByRole("button", { name: "المخزون والتصنيع" }));
    expect(onWorkspaceChange).toHaveBeenCalledWith("stock");
  });

  it("falls back to «كل الشاشات» filtered to the workspace when the tab has no hub to open", () => {
    renderShell({ allScreensGroups: workspaceGroups, onWorkspaceChange: () => false });
    const rowOne = screen.getByRole("navigation", { name: "مساحات العمل" });
    fireEvent.click(within(rowOne).getByRole("button", { name: "المخزون والتصنيع" }));
    const panel = screen.getByRole("dialog", { name: "كل الشاشات" });
    expect(within(panel).getByRole("button", { name: /لوحة المخزون/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /لوحة المشتريات/ })).toBeNull();
  });

  it("browses every destination from «كل الشاشات», grouped and searchable", () => {
    renderShell({ allScreensGroups: workspaceGroups });
    fireEvent.click(screen.getByRole("button", { name: /كل الشاشات/ }));
    const panel = screen.getByRole("dialog", { name: "كل الشاشات" });
    // Grouped by workspace, then by section — a report reachable from nowhere
    // else on row two is listed here.
    expect(within(panel).getByRole("heading", { name: "التقارير" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /أعمار الموردين/ })).toBeInTheDocument();
    fireEvent.change(within(panel).getByRole("searchbox", { name: "ابحث في كل الشاشات" }), { target: { value: "المخزون" } });
    expect(within(panel).getByRole("button", { name: /لوحة المخزون/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /أعمار الموردين/ })).toBeNull();
  });

  it("runs a destination's onClick from «كل الشاشات» and closes the panel", () => {
    const onClick = vi.fn();
    renderShell({ allScreensGroups: [{ key: "stock", label: "المخزون", items: [{ key: "items", label: "الأصناف", onClick }] }] });
    fireEvent.click(screen.getByRole("button", { name: /كل الشاشات/ }));
    fireEvent.click(screen.getByRole("button", { name: /الأصناف/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "كل الشاشات" })).toBeNull();
  });

  it("inverts the arrow keys in RTL — ArrowRight is the PREVIOUS tab, ArrowLeft the next", () => {
    renderShell();
    const rowOne = screen.getByRole("navigation", { name: "مساحات العمل" });
    const [first, second, third] = workspaces.map((w) => within(rowOne).getByRole("button", { name: w.label }));
    if (!first || !second || !third) throw new Error("the three workspace tabs must render");
    second.focus();

    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(third);

    // Wraps: one more "next" from the last lands on the first.
    fireEvent.keyDown(third, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(third);
    fireEvent.keyDown(third, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("keeps the workspace strip to one Tab stop via a roving tabindex", () => {
    renderShell();
    const rowOne = screen.getByRole("navigation", { name: "مساحات العمل" });
    expect(within(rowOne).getByRole("button", { name: "الشراء والتوريد" })).toHaveAttribute("tabindex", "0");
    expect(within(rowOne).getByRole("button", { name: "البيع والتحصيل" })).toHaveAttribute("tabindex", "-1");
    expect(within(rowOne).getByRole("button", { name: "المخزون والتصنيع" })).toHaveAttribute("tabindex", "-1");
  });

  it("opens the command palette from row one's command bar", () => {
    renderShell();
    expect(screen.queryByRole("listbox", { name: "لوحة الأوامر" })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox", { name: "لوحة الأوامر" }));
    expect(screen.getByRole("listbox", { name: "لوحة الأوامر" })).toBeInTheDocument();
  });

  it("opens the command palette on Ctrl+K and runs a command", () => {
    const onSelect = vi.fn();
    const commandItems: CommandItem[] = [{ id: "go-coa", label: "دليل الحسابات", group: "الانتقال إلى", onSelect }];
    renderShell({ commandItems });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("دليل الحسابات"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("carries the appearance toggle into row one and applies [data-theme]", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("carries the language switcher into row one", () => {
    renderShell();
    expect(screen.getByRole("button", { name: "التبديل إلى الإنجليزية" })).toBeInTheDocument();
  });

  it("lists a utility group's SECTION screens in the gear menu, not only its direct items", () => {
    const utilityGroups: NavGroup[] = [
      {
        key: "setup",
        label: "الإعداد والصلاحيات",
        items: [{ key: "settings-general", label: "الإعدادات العامة" }],
        sections: [{ key: "access", label: "الصلاحيات", items: [{ key: "users", label: "المستخدمون" }] }],
      },
    ];
    renderShell({ utilityGroups });
    fireEvent.click(screen.getByRole("button", { name: "الإعدادات والنظام" }));
    const menu = screen.getByRole("menu", { name: "الإعدادات والنظام" });
    expect(within(menu).getByRole("menuitem", { name: "الإعدادات العامة" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "المستخدمون" })).toBeInTheDocument();
  });

  it("wires the branch/warehouse switchers into row one, and there is no rail to hold them", () => {
    const branchOptions: TopbarScopeOption[] = [{ id: "BR-MAIN", label: "الفرع الرئيسي" }];
    const onSelectBranch = vi.fn();
    renderShell({ branchOptions, selectedBranchId: null, onSelectBranch });
    const branchSelect = screen.getByRole("combobox", { name: "الفرع الحالي" });
    expect(branchSelect.closest("aside")).toBeNull();
    expect(branchSelect.closest("header")).not.toBeNull();
    // `Select` is a portaled listbox, not a native <select>: choose by clicking
    // the option, which is the only path a real user has.
    fireEvent.click(branchSelect);
    fireEvent.mouseDown(screen.getByRole("option", { name: "الفرع الرئيسي" }));
    expect(onSelectBranch).toHaveBeenCalledWith("BR-MAIN");
  });

  it("names the notification count in the bell's accessible name", () => {
    renderShell({ notificationCount: 3 });
    expect(screen.getByRole("button", { name: "الإشعارات (3)" })).toBeInTheDocument();
  });
});
