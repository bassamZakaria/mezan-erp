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

  /**
   * D123: a failed load and an empty list both arrive as `rows: []`. Showing
   * «لا توجد فواتير» over a failure tells the operator the opposite of the
   * truth — that the records are gone — and hides the retry above it.
   */
  it("suppresses the empty state when the load FAILED, so an empty list never speaks for a broken one", () => {
    renderList({ rows: [], emptyState: <div>لا توجد فواتير</div>, loadFailed: true });
    expect(screen.queryByText("لا توجد فواتير")).not.toBeInTheDocument();
  });

  it("still shows the empty state once a retry succeeds with nothing to show", () => {
    const { rerender } = renderList({ rows: [], emptyState: <div>لا توجد فواتير</div>, loadFailed: true });
    expect(screen.queryByText("لا توجد فواتير")).not.toBeInTheDocument();
    rerender(
      <DocumentList<Row>
        title="الفواتير"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        page={1}
        pageCount={1}
        emptyState={<div>لا توجد فواتير</div>}
        loadFailed={false}
      />,
    );
    expect(screen.getByText("لا توجد فواتير")).toBeInTheDocument();
  });

  it("keeps showing the rows it already has when a REFETCH fails, rather than blanking the table", () => {
    renderList({ loadFailed: true, emptyState: <div>لا توجد فواتير</div> });
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
  });
});

/**
 * Q-9: no list virtualization anywhere. A page of 200 rows rendered 200 table
 * rows into the DOM; it now renders the visible window plus overscan, with a
 * spacer holding the scroll height so the pager and the scrollbar are unmoved.
 */
describe("DocumentList — windowed rows (guards Q-9)", () => {
  const many: Row[] = Array.from({ length: 200 }, (_, i) => ({
    id: `r-${i}`,
    number: `INV-${String(i).padStart(6, "0")}`,
    total: i,
  }));

  function dataRows(container: HTMLElement) {
    return container.querySelectorAll("tbody tr[data-mz-row-index]");
  }

  it("renders far fewer rows than the page holds, and the first row is one of them", () => {
    const { container } = renderList({ rows: many });
    const rendered = dataRows(container);
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(many.length);
    expect(screen.getByText("INV-000000")).toBeInTheDocument();
    // A row far below the fold is not in the DOM at all.
    expect(screen.queryByText("INV-000199")).toBeNull();
  });

  it("keeps the scroll height with spacer rows, so the scrollbar does not lie", () => {
    const { container } = renderList({ rows: many });
    const spacers = [...container.querySelectorAll('tbody tr[aria-hidden="true"] > td')] as HTMLTableCellElement[];
    const spacerPx = spacers.reduce((sum, td) => sum + Number.parseInt(td.style.height || "0", 10), 0);
    const renderedPx = dataRows(container).length * 36;
    expect(spacerPx + renderedPx).toBe(many.length * 36);
  });

  it("renders a short page whole — no spacers, no window", () => {
    const { container } = renderList({ rows: many.slice(0, 40) });
    expect(dataRows(container)).toHaveLength(40);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(0);
  });

  it("renders whole when a row can expand, because an expanded row is not 36px", () => {
    const { container } = renderList({ rows: many, renderExpandedRow: () => <div>تفاصيل</div> });
    expect(dataRows(container)).toHaveLength(many.length);
    expect(container.querySelectorAll('tbody tr[aria-hidden="true"]')).toHaveLength(0);
  });
});
