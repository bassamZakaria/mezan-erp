// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { AppShell } from "./AppShell";
import type { TopbarScopeOption } from "./ScopeSwitcher";
import type { CommandItem, NavGroup, ShellUser } from "./types";

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

/**
 * The column carries the workspace names only; row two carries the active
 * workspace's hub as a chip and each of its sections as a dropdown.
 */
const workspaceGroups: NavGroup[] = [
  {
    key: "sell",
    label: "البيع والتحصيل",
    items: [{ key: "sales-hub", label: "لوحة المبيعات" }],
    sections: [{ key: "daily", label: "الشغل اليومي", items: [{ key: "quotes", label: "عروض الأسعار" }] }],
  },
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
    <AppShell user={user} workspaceGroups={workspaceGroups} activeWorkspaceKey="buy" {...props}>
      <div>محتوى الصفحة</div>
    </AppShell>,
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("AppShell — workspace column plus a two-row bar", () => {
  it("renders the wordmark, the page children and the two navigation landmarks", () => {
    renderShell();
    expect(screen.getByText("ميزان")).toBeInTheDocument();
    expect(screen.getByText("محتوى الصفحة")).toBeInTheDocument();
    const names = screen.getAllByRole("navigation").map((nav) => nav.getAttribute("aria-label"));
    expect(names).toEqual(["التنقل بين مساحات العمل", "شاشات مساحة العمل — الشراء والتوريد"]);
    // Every name distinct — two landmarks called the same thing name neither.
    expect(new Set(names).size).toBe(2);
  });

  it("makes the logo and wordmark one named link to the dashboard", () => {
    const onNavigateHome = vi.fn();
    renderShell({ onNavigateHome });
    const home = screen.getByRole("button", { name: "ميزان — الذهاب إلى لوحة التحكم" });
    expect(home).toContainElement(screen.getByText("ميزان"));
    expect(home.querySelector("svg")).not.toBeNull();
    fireEvent.click(home);
    expect(onNavigateHome).toHaveBeenCalledOnce();
  });

  it("draws a one-screen destination beside the wordmark, not as a workspace tab", () => {
    const onClick = vi.fn();
    renderShell({
      directNavItems: [{ key: "approvals", label: "الموافقات", tag: { label: "3" }, onClick }],
      activeNavKey: "approvals",
    });
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    const approvals = screen.getByRole("button", { name: "الموافقات (3)" });
    // Not a workspace tab: it opens one screen and has no second row of its own.
    expect(approvals).toHaveAttribute("aria-current", "page");
    expect(rail).toContainElement(approvals);
    // It sits in the column's brand header, NOT in the workspace list beneath it.
    expect(approvals.closest("li")).toBeNull();
    expect(within(rail).getByRole("button", { name: "الشراء والتوريد" }).closest("li")).not.toBeNull();
    fireEvent.click(approvals);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("drops row two entirely when the open screen belongs to no workspace", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("navigation", { name: /شاشات مساحة العمل/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    // Off-workspace (an approvals or settings screen): the bar's claim is
    // "these are the screens of the workspace you are in", and here the user is
    // in none — an honest empty beats the last workspace's unrelated chips, and
    // no tab may claim to be current either.
    rerender(
      <AppShell user={user} workspaceGroups={workspaceGroups} activeNavKey="approvals">
        <div>محتوى الصفحة</div>
      </AppShell>,
    );
    expect(screen.queryByRole("navigation", { name: /شاشات مساحة العمل/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "لوحة المشتريات" })).toBeNull();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    expect(within(rail).queryByRole("button", { current: "page" })).toBeNull();
  });

  it("puts the workspaces in the column and their screens in row two", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    const rowTwo = screen.getByRole("navigation", { name: "شاشات مساحة العمل — الشراء والتوريد" });
    // The column lists the workspaces, all of them, in the nav config's order.
    expect(
      within(rail)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["البيع والتحصيل", "الشراء والتوريد", "المخزون والتصنيع"]);
    expect(within(rail).getByRole("button", { name: "الشراء والتوريد" })).toBeInTheDocument();
    expect(within(rowTwo).getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    // «كل الشاشات» lives under the column's divider, not on row two.
    expect(within(rail).getByRole("button", { name: /كل الشاشات/ })).toBeInTheDocument();
    expect(within(rowTwo).queryByRole("button", { name: /كل الشاشات/ })).toBeNull();
  });

  it("puts a skip link to <main> first in the tab order", () => {
    const { container } = renderShell();
    const focusable = Array.from(container.querySelectorAll<HTMLElement>("a[href], button, input, [tabindex='0']"));
    const skip = screen.getByRole("link", { name: "تخطَّ إلى المحتوى" });
    expect(focusable[0]).toBe(skip);
    expect(skip.getAttribute("href")).toBe("#mz-main");
    expect(document.getElementById("mz-main")?.tagName).toBe("MAIN");
  });

  it("renders row two as the ACTIVE workspace's hub, short shelves flattened, التقارير always a menu", () => {
    renderShell();
    const rowTwo = screen.getByRole("navigation", { name: /شاشات مساحة العمل/ });
    expect(within(rowTwo).getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    // A shelf this short reads as tabs: its screens sit on the bar, and the
    // section name is NOT drawn as a caret hiding one row.
    const purchaseOrders = within(rowTwo).getByRole("button", { name: "أوامر الشراء" });
    expect(purchaseOrders).not.toHaveAttribute("aria-haspopup");
    expect(within(rowTwo).queryByRole("button", { name: "الشغل اليومي" })).toBeNull();
    // التقارير never flattens, however few reports the workspace has today.
    const reports = within(rowTwo).getByRole("button", { name: "التقارير" });
    expect(reports).toHaveAttribute("aria-haspopup", "menu");
    expect(within(rowTwo).queryByRole("button", { name: "أعمار الموردين" })).toBeNull();
    // …until it is opened.
    fireEvent.click(reports);
    expect(screen.getByRole("menuitem", { name: "أعمار الموردين" })).toBeInTheDocument();
  });

  it("keeps the sections OUT of the column — it lists workspaces only", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    expect(within(rail).queryByRole("button", { name: "التقارير" })).toBeNull();
    expect(within(rail).queryByRole("button", { name: "الشغل اليومي" })).toBeNull();
    expect(within(rail).getByRole("button", { name: "الشراء والتوريد" })).toBeInTheDocument();
  });

  it("marks the section's own menu when the open screen is one of its rows", () => {
    renderShell({ activeNavKey: "report-aging-suppliers" });
    const rowTwo = screen.getByRole("navigation", { name: /شاشات مساحة العمل/ });
    const reports = within(rowTwo).getByRole("button", { name: "التقارير" });
    expect(reports).toHaveAttribute("tabindex", "0");
    fireEvent.click(reports);
    expect(screen.getByRole("menuitem", { name: "أعمار الموردين" })).toHaveAttribute("aria-current", "page");
  });

  it("re-renders row two when the workspace changes", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("button", { name: "لوحة المشتريات" })).toBeInTheDocument();
    rerender(
      <AppShell user={user} workspaceGroups={workspaceGroups} activeWorkspaceKey="stock">
        <div>محتوى الصفحة</div>
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: "لوحة المشتريات" })).toBeNull();
    expect(screen.getByRole("button", { name: "لوحة المخزون" })).toBeInTheDocument();
  });

  it("marks the active workspace with aria-current and reports a tab click", () => {
    const onWorkspaceChange = vi.fn();
    renderShell({ onWorkspaceChange });
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    expect(within(rail).getByRole("button", { name: "الشراء والتوريد" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(rail).getByRole("button", { name: "المخزون والتصنيع" }));
    expect(onWorkspaceChange).toHaveBeenCalledWith("stock");
  });

  it("falls back to «كل الشاشات» filtered to the workspace when the tab has no hub to open", () => {
    renderShell({ allScreensGroups: workspaceGroups, onWorkspaceChange: () => false });
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    fireEvent.click(within(rail).getByRole("button", { name: "المخزون والتصنيع" }));
    const panel = screen.getByRole("dialog", { name: "كل الشاشات" });
    expect(within(panel).getByRole("button", { name: /لوحة المخزون/ })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /لوحة المشتريات/ })).toBeNull();
  });

  it("browses every destination from «كل الشاشات», grouped and searchable", () => {
    renderShell({ allScreensGroups: workspaceGroups });
    fireEvent.click(screen.getByRole("button", { name: "كل الشاشات" }));
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
    fireEvent.click(screen.getByRole("button", { name: "كل الشاشات" }));
    fireEvent.click(screen.getByRole("button", { name: /الأصناف/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "كل الشاشات" })).toBeNull();
  });

  it("inverts the arrow keys on ROW TWO — ArrowRight is the PREVIOUS chip, ArrowLeft the next", () => {
    renderShell();
    const rowTwo = screen.getByRole("navigation", { name: /شاشات مساحة العمل/ });
    const hub = within(rowTwo).getByRole("button", { name: "لوحة المشتريات" });
    const daily = within(rowTwo).getByRole("button", { name: "أوامر الشراء" });
    const reports = within(rowTwo).getByRole("button", { name: "التقارير" });
    hub.focus();

    fireEvent.keyDown(hub, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(daily);
    fireEvent.keyDown(daily, { key: "ArrowRight" });
    expect(document.activeElement).toBe(hub);
    // Wraps backwards onto the last cell — the section dropdown's trigger.
    fireEvent.keyDown(hub, { key: "ArrowRight" });
    expect(document.activeElement).toBe(reports);

    fireEvent.keyDown(reports, { key: "Home" });
    expect(document.activeElement).toBe(hub);
    fireEvent.keyDown(hub, { key: "End" });
    expect(document.activeElement).toBe(reports);
  });

  it("does NOT invert the arrow keys in the workspace column — a vertical list reads the same in both directions", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    const sell = within(rail).getByRole("button", { name: "البيع والتحصيل" });
    const buy = within(rail).getByRole("button", { name: "الشراء والتوريد" });
    const stock = within(rail).getByRole("button", { name: "المخزون والتصنيع" });
    buy.focus();

    fireEvent.keyDown(buy, { key: "ArrowDown" });
    expect(document.activeElement).toBe(stock);
    fireEvent.keyDown(stock, { key: "ArrowUp" });
    expect(document.activeElement).toBe(buy);
    fireEvent.keyDown(buy, { key: "Home" });
    expect(document.activeElement).toBe(sell);
    fireEvent.keyDown(sell, { key: "End" });
    expect(document.activeElement).toBe(stock);
    // A horizontal key means nothing on a vertical list; focus must not move.
    fireEvent.keyDown(stock, { key: "ArrowRight" });
    expect(document.activeElement).toBe(stock);
  });

  it("keeps the column and row two to one Tab stop each via a roving tabindex", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    expect(within(rail).getByRole("button", { name: "الشراء والتوريد" })).toHaveAttribute("tabindex", "0");
    expect(within(rail).getByRole("button", { name: "البيع والتحصيل" })).toHaveAttribute("tabindex", "-1");
    const rowTwo = screen.getByRole("navigation", { name: /شاشات مساحة العمل/ });
    expect(within(rowTwo).getByRole("button", { name: "لوحة المشتريات" })).toHaveAttribute("tabindex", "0");
    expect(within(rowTwo).getByRole("button", { name: "أوامر الشراء" })).toHaveAttribute("tabindex", "-1");
  });

  it("opens the command palette from the column's search control", () => {
    renderShell();
    expect(screen.queryByRole("listbox", { name: "لوحة الأوامر" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "بحث وأوامر (CtrlK)" });
    // The shortcut is announced, not folklore.
    expect(trigger).toHaveAttribute("aria-keyshortcuts", "Meta+K Control+K");
    fireEvent.click(trigger);
    expect(screen.getByRole("combobox", { name: "لوحة الأوامر" })).toBeInTheDocument();
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

  it("wires the branch switcher into the workspace column's foot — row one is gone", () => {
    const branchOptions: TopbarScopeOption[] = [
      { id: "BR-MAIN", label: "الفرع الرئيسي" },
      { id: "BR-GIZA", label: "فرع الجيزة" },
    ];
    const onSelectBranch = vi.fn();
    renderShell({ branchOptions, selectedBranchId: null, onSelectBranch });
    const branchSelect = screen.getByRole("combobox", { name: "الفرع الحالي" });
    expect(branchSelect.closest("header")).toBeNull();
    expect(branchSelect.closest("nav")?.getAttribute("aria-label")).toBe("التنقل بين مساحات العمل");
    // `Select` is a portaled listbox, not a native <select>: choose by clicking
    // the option, which is the only path a real user has.
    fireEvent.click(branchSelect);
    fireEvent.mouseDown(screen.getByRole("option", { name: "الفرع الرئيسي" }));
    expect(onSelectBranch).toHaveBeenCalledWith("BR-MAIN");
  });

  /**
   * ONE option is not a choice: a shop with a single branch met a dropdown
   * offering «كل الفروع» and the only branch there is — two labels for one
   * scope. It reads as a static label instead.
   */
  it("draws a single-branch scope as a label, not as a dropdown", () => {
    renderShell({ branchOptions: [{ id: "BR-MAIN", label: "الفرع الرئيسي" }], selectedBranchId: null, onSelectBranch: vi.fn() });
    expect(screen.queryByRole("combobox", { name: "الفرع الحالي" })).toBeNull();
    expect(screen.getByTitle("الفرع الحالي: الفرع الرئيسي")).toBeInTheDocument();
  });

  // The bell is gone: notifications are صندوق الوارد, a pinned destination at
  // the top of the column, and the slot it held now signs the user out.
  it("signs out from the column's foot", () => {
    const onSignOut = vi.fn();
    renderShell({ onSignOut });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("opens the profile from the user chip, with no menu in between", () => {
    const onOpenProfile = vi.fn();
    renderShell({ onOpenProfile });
    fireEvent.click(screen.getByRole("button", { name: /محمد/ }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });
});

describe("AppShell — the phone drawer closes on every navigation from it", () => {
  function openDrawer() {
    const toggle = screen.getByRole("button", { name: "فتح قائمة التنقل" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    return toggle;
  }

  it.each(["لوحة التحكم", "صندوق الوارد", "الموافقات"])("closes after «%s» beside the wordmark", (label) => {
    const onClick = vi.fn();
    renderShell({
      directNavItems: [
        { key: "dashboard", label: "لوحة التحكم", onClick: label === "لوحة التحكم" ? onClick : undefined },
        { key: "inbox", label: "صندوق الوارد", onClick: label === "صندوق الوارد" ? onClick : undefined },
        { key: "approvals", label: "الموافقات", onClick: label === "الموافقات" ? onClick : undefined },
      ],
    });
    const toggle = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("closes after the wordmark, a workspace, the profile and the search", () => {
    const onNavigateHome = vi.fn();
    const onOpenProfile = vi.fn();
    renderShell({ onNavigateHome, onOpenProfile });

    let toggle = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "ميزان — الذهاب إلى لوحة التحكم" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle = openDrawer();
    const rail = screen.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    fireEvent.click(within(rail).getByRole("button", { name: "البيع والتحصيل" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: /محمد/ }));
    expect(onOpenProfile).toHaveBeenCalledOnce();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "بحث وأوامر (CtrlK)" }));
    expect(screen.getByRole("combobox", { name: "لوحة الأوامر" })).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
