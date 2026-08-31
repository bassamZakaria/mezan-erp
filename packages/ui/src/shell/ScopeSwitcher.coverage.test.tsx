// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScopeSwitchers, type TopbarScopeOption } from "./ScopeSwitcher";

const BRANCHES: TopbarScopeOption[] = [
  { id: "br-1", label: "الفرع الرئيسي" },
  { id: "br-2", label: "فرع المعادي" },
];

const WAREHOUSES: TopbarScopeOption[] = [
  { id: "wh-1", label: "المستودع الرئيسي" },
  { id: "wh-2", label: "مستودع العبور" },
];

const LABELS = {
  branchAriaLabel: "الفرع",
  warehouseAriaLabel: "المستودع",
  allBranchesLabel: "كل الفروع",
  allWarehousesLabel: "كل المستودعات",
};

function open(ariaLabel: string) {
  fireEvent.click(screen.getByRole("combobox", { name: ariaLabel }));
}

describe("ScopeSwitchers — the controls a session with nothing to narrow never sees", () => {
  it("renders nothing at all when the caller has no branch list yet", () => {
    const { container } = render(<ScopeSwitchers {...LABELS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the branch list came back empty", () => {
    const { container } = render(<ScopeSwitchers {...LABELS} branchOptions={[]} warehouseOptions={WAREHOUSES} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the warehouse control when the session sees no warehouse", () => {
    render(<ScopeSwitchers {...LABELS} branchOptions={BRANCHES} />);
    expect(screen.getByRole("combobox", { name: "الفرع" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "المستودع" })).not.toBeInTheDocument();
  });
});

describe("ScopeSwitchers — one option is a label, not a choice", () => {
  it("shows a single branch as static text rather than a dropdown offering it beside «كل الفروع»", () => {
    render(<ScopeSwitchers {...LABELS} branchOptions={[BRANCHES[0]!]} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByTitle("الفرع: الفرع الرئيسي")).toBeInTheDocument();
  });

  it("never fires a selection change for that lone branch — the narrowed and unnarrowed sets are identical", () => {
    const onSelectBranch = vi.fn();
    render(<ScopeSwitchers {...LABELS} branchOptions={[BRANCHES[0]!]} onSelectBranch={onSelectBranch} />);
    expect(onSelectBranch).not.toHaveBeenCalled();
  });

  it("drops the lone branch's name when the rail is collapsed, keeping it in the title", () => {
    render(<ScopeSwitchers {...LABELS} expanded={false} branchOptions={[BRANCHES[0]!]} />);

    expect(screen.queryByText("الفرع الرئيسي")).not.toBeInTheDocument();
    expect(screen.getByTitle("الفرع: الفرع الرئيسي")).toBeInTheDocument();
  });

  it("collapses a lone warehouse the same way while the branch stays a real dropdown", () => {
    render(<ScopeSwitchers {...LABELS} branchOptions={BRANCHES} warehouseOptions={[WAREHOUSES[0]!]} />);

    expect(screen.getByRole("combobox", { name: "الفرع" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "المستودع" })).not.toBeInTheDocument();
    expect(screen.getByTitle("المستودع: المستودع الرئيسي")).toBeInTheDocument();
  });
});

describe("ScopeSwitchers — choosing a scope", () => {
  it("reports the chosen branch id, and null for «كل الفروع»", () => {
    const onSelectBranch = vi.fn();
    render(<ScopeSwitchers {...LABELS} branchOptions={BRANCHES} selectedBranchId="br-2" onSelectBranch={onSelectBranch} />);

    open("الفرع");
    fireEvent.mouseDown(screen.getByRole("option", { name: "فرع المعادي" }));
    expect(onSelectBranch).toHaveBeenLastCalledWith("br-2");

    open("الفرع");
    fireEvent.mouseDown(screen.getByRole("option", { name: "كل الفروع" }));
    expect(onSelectBranch).toHaveBeenLastCalledWith(null);
  });

  it("reports the chosen warehouse id, and null for «كل المستودعات»", () => {
    const onSelectWarehouse = vi.fn();
    render(<ScopeSwitchers {...LABELS} branchOptions={BRANCHES} warehouseOptions={WAREHOUSES} onSelectWarehouse={onSelectWarehouse} />);

    open("المستودع");
    fireEvent.mouseDown(screen.getByRole("option", { name: "مستودع العبور" }));
    expect(onSelectWarehouse).toHaveBeenLastCalledWith("wh-2");

    open("المستودع");
    fireEvent.mouseDown(screen.getByRole("option", { name: "كل المستودعات" }));
    expect(onSelectWarehouse).toHaveBeenLastCalledWith(null);
  });

  it("survives a pick with no handler wired", () => {
    render(<ScopeSwitchers {...LABELS} branchOptions={BRANCHES} warehouseOptions={WAREHOUSES} />);

    open("الفرع");
    fireEvent.mouseDown(screen.getByRole("option", { name: "فرع المعادي" }));
    expect(screen.getByRole("combobox", { name: "الفرع" })).toBeInTheDocument();
  });
});

describe("ScopeSwitchers — the collapsed rail, the expanded rail and the header", () => {
  it("moves the chosen scope into the title when the rail is collapsed, and out of it when expanded", () => {
    const { rerender } = render(
      <ScopeSwitchers {...LABELS} expanded={false} branchOptions={BRANCHES} selectedBranchId="br-2" />,
    );
    expect(screen.getByTitle("الفرع: فرع المعادي")).toBeInTheDocument();

    rerender(<ScopeSwitchers {...LABELS} expanded branchOptions={BRANCHES} selectedBranchId="br-2" />);
    expect(screen.queryByTitle("الفرع: فرع المعادي")).not.toBeInTheDocument();
  });

  it("falls back to «كل الفروع» in the collapsed title when nothing is chosen, and when the chosen id is gone", () => {
    const { rerender } = render(<ScopeSwitchers {...LABELS} expanded={false} branchOptions={BRANCHES} />);
    expect(screen.getByTitle("الفرع: كل الفروع")).toBeInTheDocument();

    rerender(<ScopeSwitchers {...LABELS} expanded={false} branchOptions={BRANCHES} selectedBranchId="br-gone" />);
    expect(screen.getByTitle("الفرع: كل الفروع")).toBeInTheDocument();
  });

  it("keeps both header triggers expanded even though the rail is collapsed", () => {
    render(
      <ScopeSwitchers
        {...LABELS}
        orientation="header"
        expanded={false}
        branchOptions={BRANCHES}
        warehouseOptions={WAREHOUSES}
        selectedBranchId="br-1"
      />,
    );

    expect(screen.queryByTitle("الفرع: الفرع الرئيسي")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الفرع" })).toHaveTextContent("الفرع الرئيسي");
    expect(screen.getByRole("combobox", { name: "المستودع" })).toHaveTextContent("كل المستودعات");
  });
});
