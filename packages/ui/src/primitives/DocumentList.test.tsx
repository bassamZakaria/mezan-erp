// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentList, type DocumentListColumn, type DocumentListProps } from "./DocumentList";

interface Row {
  id: string;
  number: string;
  total: number;
}

const rows: Row[] = [
  { id: "1", number: "INV-000123", total: 1150 },
  { id: "2", number: "INV-000122", total: 3420.5 },
];

const columns: DocumentListColumn<Row>[] = [
  { key: "number", header: "رقم الفاتورة", sortable: true, render: (r) => r.number },
  { key: "total", header: "الإجمالي", align: "end", sortable: true, render: (r) => r.total.toFixed(2) },
];

function renderList(overrides: Partial<DocumentListProps<Row>> = {}) {
  return render(
    <DocumentList<Row>
      title="فواتير المبيعات"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      page={1}
      pageCount={3}
      {...overrides}
    />,
  );
}

describe("DocumentList", () => {
  it("renders the title, columns, and row data", () => {
    renderList();
    expect(screen.getByRole("heading", { name: "فواتير المبيعات" })).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    expect(screen.getByText("INV-000122")).toBeInTheDocument();
  });

  it("renders in a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    renderList();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });

  it("calls onSortChange with the clicked column key", () => {
    const onSortChange = vi.fn();
    renderList({ onSortChange, sort: { key: "number", direction: "asc" } });
    fireEvent.click(screen.getByText("الإجمالي"));
    expect(onSortChange).toHaveBeenCalledWith("total");
  });

  it("calls onStatusChange when a status chip is clicked", () => {
    const onStatusChange = vi.fn();
    renderList({
      statusChips: [
        { key: "all", label: "الكل", count: 2 },
        { key: "paid", label: "مدفوع", count: 1 },
      ],
      activeStatusKey: "all",
      onStatusChange,
    });
    fireEvent.click(screen.getByText("مدفوع"));
    expect(onStatusChange).toHaveBeenCalledWith("paid");
  });

  it("calls onSearchChange as the user types", () => {
    const onSearchChange = vi.fn();
    renderList({ onSearchChange, searchValue: "" });
    fireEvent.change(screen.getByPlaceholderText("بحث…"), { target: { value: "INV-1" } });
    expect(onSearchChange).toHaveBeenCalledWith("INV-1");
  });

  it("calls onRowClick with the clicked row", () => {
    const onRowClick = vi.fn();
    renderList({ onRowClick });
    fireEvent.click(screen.getByText("INV-000123"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("calls onPageChange when a page button is clicked", () => {
    const onPageChange = vi.fn();
    renderList({ onPageChange, page: 1, pageCount: 3 });
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("shows the empty state when there are no rows", () => {
    renderList({ rows: [], emptyState: <div>لا توجد فواتير</div> });
    expect(screen.getByText("لا توجد فواتير")).toBeInTheDocument();
  });
});
