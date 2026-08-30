// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountTree, type AccountTreeRow } from "./AccountTree";

const rows: AccountTreeRow[] = [
  {
    id: "1000",
    code: "1000",
    nameAr: "الأصول",
    typeLabel: "أصول",
    natureLabel: "رئيسي",
    statusLabel: "نشط",
    level: 0,
    hasChildren: true,
    expanded: true,
  },
  {
    id: "1300-1",
    code: "1300-1",
    nameAr: "صندوق نقدي الفرع الرئيسي",
    typeLabel: "أصول",
    natureLabel: "تفصيلي",
    statusLabel: "نشط",
    level: 1,
    hasChildren: false,
    expanded: false,
  },
];

describe("AccountTree", () => {
  it("renders every row's name and code", () => {
    render(<AccountTree rows={rows} onToggle={vi.fn()} />);
    expect(screen.getByText("الأصول")).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("1300-1")).toBeInTheDocument();
  });

  it("renders a toggle button only for rows with children", () => {
    render(<AccountTree rows={rows} onToggle={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /توسيع|طي/ })).toHaveLength(1);
  });

  it("calls onToggle with the row id when the toggle is clicked, without triggering onRowClick", () => {
    const onToggle = vi.fn();
    const onRowClick = vi.fn();
    render(<AccountTree rows={rows} onToggle={onToggle} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByRole("button", { name: "طي" }));
    expect(onToggle).toHaveBeenCalledWith("1000");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("calls onRowClick with the row id when a row is clicked", () => {
    const onRowClick = vi.fn();
    render(<AccountTree rows={rows} onToggle={vi.fn()} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("صندوق نقدي الفرع الرئيسي"));
    expect(onRowClick).toHaveBeenCalledWith("1300-1");
  });

  it("renders the empty state when there are no rows", () => {
    render(<AccountTree rows={[]} onToggle={vi.fn()} emptyState={<div>لا توجد حسابات</div>} />);
    expect(screen.getByText("لا توجد حسابات")).toBeInTheDocument();
  });

  it("suppresses the empty state when the load FAILED, so 'no accounts' never stands in for 'could not load' (D123)", () => {
    render(<AccountTree rows={[]} onToggle={vi.fn()} emptyState={<div>لا توجد حسابات</div>} loadFailed />);
    expect(screen.queryByText("لا توجد حسابات")).not.toBeInTheDocument();
  });

  it("renders row actions when provided", () => {
    render(<AccountTree rows={rows} onToggle={vi.fn()} rowActions={(row) => <span>menu-{row.id}</span>} />);
    expect(screen.getByText("menu-1000")).toBeInTheDocument();
    expect(screen.getByText("menu-1300-1")).toBeInTheDocument();
  });
});
