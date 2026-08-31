// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DocumentList, type DocumentListColumn, type DocumentListProps } from "./DocumentList";
import { LIST_NAV_EVENT, type ListNavAction } from "../lib/keys";

function nav(action: ListNavAction) {
  fireEvent(window, new CustomEvent(LIST_NAV_EVENT, { detail: { action } }));
}

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
  {
    key: "total",
    header: "الإجمالي",
    align: "end",
    sortable: true,
    total: (rs) => rs.reduce((sum, r) => sum + r.total, 0).toFixed(2),
    render: (r) => r.total.toFixed(2),
  },
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

beforeEach(() => {
  window.localStorage.clear();
});

describe("DocumentList — header", () => {
  it("renders no heading at all when title is an empty string", () => {
    renderList({ title: "" });
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows the description only when one is provided", () => {
    const { rerender } = renderList();
    expect(screen.queryByText("كل فواتير هذا الشهر")).not.toBeInTheDocument();
    rerender(
      <DocumentList<Row>
        title="فواتير المبيعات"
        description="كل فواتير هذا الشهر"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        page={1}
        pageCount={3}
      />,
    );
    expect(screen.getByText("كل فواتير هذا الشهر")).toBeInTheDocument();
  });

  it("shows the actions slot only when actions are provided", () => {
    renderList({ actions: <button type="button">فاتورة جديدة</button> });
    expect(screen.getByRole("button", { name: "فاتورة جديدة" })).toBeInTheDocument();
  });
});

describe("DocumentList — attention banners", () => {
  it("filters out a zero-count banner and keeps the ones with a count", () => {
    renderList({
      attentionBanners: [
        { key: "overdue", label: "فواتير متأخرة", count: 2, onApply: vi.fn() },
        { key: "draft", label: "مسودات معلقة", count: 0, onApply: vi.fn() },
      ],
    });
    expect(screen.getByText("فواتير متأخرة")).toBeInTheDocument();
    expect(screen.queryByText("مسودات معلقة")).not.toBeInTheDocument();
  });

  it("applies the danger tone for a danger banner and calls onApply when clicked", () => {
    const onApply = vi.fn();
    renderList({ attentionBanners: [{ key: "overdue", label: "فواتير متأخرة", count: 2, tone: "danger", onApply }] });
    const button = screen.getByText("فواتير متأخرة").closest("button")!;
    expect(button).toHaveClass("border-danger");
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("applies the default warning tone when no tone is given", () => {
    renderList({ attentionBanners: [{ key: "draft", label: "مسودات معلقة", count: 1, onApply: vi.fn() }] });
    const button = screen.getByText("مسودات معلقة").closest("button")!;
    expect(button).toHaveClass("border-warning");
  });
});

describe("DocumentList — stats", () => {
  it("renders no stats block when stats is empty", () => {
    renderList({ stats: [] });
    expect(screen.queryByText("عدد الفواتير")).not.toBeInTheDocument();
  });

  it("always shows the stats grid when statsCollapsible is not set", () => {
    renderList({ stats: [{ label: "عدد الفواتير", value: "2" }] });
    expect(screen.getByText("عدد الفواتير")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /التفاصيل/ })).not.toBeInTheDocument();
  });

  it("collapses the stats behind a toggle and expands them again on click", () => {
    renderList({ stats: [{ label: "عدد الفواتير", value: "2" }], statsCollapsible: true });
    expect(screen.getByText("عدد الفواتير")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "إخفاء التفاصيل" });
    fireEvent.click(toggle);
    expect(screen.queryByText("عدد الفواتير")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "عرض التفاصيل" }));
    expect(screen.getByText("عدد الفواتير")).toBeInTheDocument();
  });

  it("remembers a collapsed stats state across a remount when listKey is set", () => {
    const { unmount } = renderList({
      stats: [{ label: "عدد الفواتير", value: "2" }],
      statsCollapsible: true,
      listKey: "sales-invoices",
    });
    fireEvent.click(screen.getByRole("button", { name: "إخفاء التفاصيل" }));
    unmount();

    renderList({ stats: [{ label: "عدد الفواتير", value: "2" }], statsCollapsible: true, listKey: "sales-invoices" });
    expect(screen.queryByText("عدد الفواتير")).not.toBeInTheDocument();
  });

  it("applies the danger tone to a stat value when valueTone is danger", () => {
    renderList({ stats: [{ label: "متأخر", value: "500", valueTone: "danger" }] });
    expect(screen.getByText("500")).toHaveClass("text-danger-ink");
  });
});

describe("DocumentList — views and status chips", () => {
  it("prefers `views` over `statusChips` when both are supplied", () => {
    renderList({
      views: [{ key: "open", label: "مفتوحة" }],
      statusChips: [{ key: "all", label: "الكل", count: 2 }],
      activeStatusKey: "open",
      onStatusChange: vi.fn(),
    });
    expect(screen.getByText("مفتوحة")).toBeInTheDocument();
    expect(screen.queryByText("الكل")).not.toBeInTheDocument();
  });

  it("hides the view-tabs row entirely when there are none to show", () => {
    renderList({ views: [] });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

describe("DocumentList — search and filter bar", () => {
  it("renders no filter-bar row when there is neither a search handler nor extra filters", () => {
    renderList();
    expect(screen.queryByPlaceholderText("بحث…")).not.toBeInTheDocument();
  });

  it("shows filterBarExtra directly, with no toggle, when filterBarCollapsible is off", () => {
    renderList({ filterBarExtra: <div>حقول إضافية</div> });
    expect(screen.getByText("حقول إضافية")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /تصفية النتائج/ })).not.toBeInTheDocument();
  });

  it("starts the filter bar open (there are filters to show) and lets the toggle close and reopen it", () => {
    renderList({ filterBarExtra: <div>حقول إضافية</div>, filterBarCollapsible: true });
    expect(screen.getByText("حقول إضافية")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "تصفية النتائج" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(screen.queryByText("حقول إضافية")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByText("حقول إضافية")).toBeInTheDocument();
  });

  it("shows the active-filter-count badge only when it is greater than zero", () => {
    const { rerender } = renderList({
      filterBarExtra: <div>حقول إضافية</div>,
      filterBarCollapsible: true,
      activeFilterCount: 0,
    });
    const toggle = () => screen.getByRole("button", { name: /تصفية النتائج/ });
    expect(within(toggle()).queryByText("0")).not.toBeInTheDocument();

    rerender(
      <DocumentList<Row>
        title="فواتير المبيعات"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        page={1}
        pageCount={3}
        filterBarExtra={<div>حقول إضافية</div>}
        filterBarCollapsible
        activeFilterCount={4}
      />,
    );
    expect(within(toggle()).getByText("4")).toBeInTheDocument();
  });

  it("keeps the filter toggle highlighted while collapsed when active filters already exist", () => {
    renderList({
      filterBarExtra: <div>حقول إضافية</div>,
      filterBarCollapsible: true,
      activeFilterCount: 2,
    });
    expect(screen.getByRole("button", { name: /تصفية النتائج/ })).toHaveClass("border-brand");
  });

  it("remembers a closed filter bar across a remount when listKey is set", () => {
    const { unmount } = renderList({
      filterBarExtra: <div>حقول إضافية</div>,
      filterBarCollapsible: true,
      listKey: "sales-invoices-filters",
    });
    fireEvent.click(screen.getByRole("button", { name: "تصفية النتائج" }));
    expect(screen.queryByText("حقول إضافية")).not.toBeInTheDocument();
    unmount();

    renderList({ filterBarExtra: <div>حقول إضافية</div>, filterBarCollapsible: true, listKey: "sales-invoices-filters" });
    expect(screen.queryByText("حقول إضافية")).not.toBeInTheDocument();
  });
});

describe("DocumentList — applied filters", () => {
  it("shows applied filters only when there is at least one", () => {
    const { rerender } = renderList({ appliedFilters: [] });
    expect(screen.queryByText("مسح الكل")).not.toBeInTheDocument();

    rerender(
      <DocumentList<Row>
        title="فواتير المبيعات"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        page={1}
        pageCount={3}
        appliedFilters={[{ key: "status", label: "الحالة: مدفوعة", onRemove: vi.fn() }]}
        onClearAllFilters={vi.fn()}
      />,
    );
    expect(screen.getByText("الحالة: مدفوعة")).toBeInTheDocument();
  });
});

describe("DocumentList — sortable column header", () => {
  it("marks the ascending and descending sorted column with aria-sort", () => {
    const { rerender } = renderList({ sort: { key: "number", direction: "asc" } });
    expect(screen.getByText("رقم الفاتورة").closest("th")).toHaveAttribute("aria-sort", "ascending");

    rerender(
      <DocumentList<Row> title="فواتير المبيعات" columns={columns} rows={rows} rowKey={(r) => r.id} page={1} pageCount={3} sort={{ key: "number", direction: "desc" }} />,
    );
    expect(screen.getByText("رقم الفاتورة").closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("toggles sort on Enter and on Space, but ignores other keys", () => {
    const onSortChange = vi.fn();
    renderList({ onSortChange });
    const header = screen.getByText("رقم الفاتورة").closest("th")!;
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    fireEvent.keyDown(header, { key: "a" });
    expect(onSortChange).toHaveBeenCalledTimes(2);
    expect(onSortChange).toHaveBeenCalledWith("number");
  });

  it("attaches no click or keydown handler, and no sort caret, to a non-sortable column", () => {
    const nonSortableColumns: DocumentListColumn<Row>[] = [{ key: "number", header: "رقم الفاتورة", render: (r) => r.number }];
    const onSortChange = vi.fn();
    render(
      <DocumentList<Row> title="فواتير" columns={nonSortableColumns} rows={rows} rowKey={(r) => r.id} page={1} pageCount={1} onSortChange={onSortChange} />,
    );
    const header = screen.getByText("رقم الفاتورة").closest("th")!;
    fireEvent.click(header);
    expect(onSortChange).not.toHaveBeenCalled();
    expect(header).not.toHaveAttribute("tabindex");
  });
});

describe("DocumentList — row action column", () => {
  it("renders no row-action column when there is neither onRowClick nor rowAction", () => {
    renderList();
    expect(screen.queryByText("عرض")).not.toBeInTheDocument();
  });

  it("renders a custom rowAction instead of the default view button", () => {
    renderList({ rowAction: (row) => <button type="button">فتح {row.number}</button> });
    expect(screen.getByRole("button", { name: "فتح INV-000123" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عرض" })).not.toBeInTheDocument();
  });

  it("calls onRowClick exactly once when the default row-action button is clicked", () => {
    const onRowClick = vi.fn();
    renderList({ onRowClick });
    const buttons = screen.getAllByRole("button", { name: "عرض" });
    fireEvent.click(buttons[0]!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});

describe("DocumentList — row expansion", () => {
  it("renders no expanded row when renderExpandedRow returns null for it", () => {
    renderList({ renderExpandedRow: () => null, expandedKeys: ["1"] });
    expect(screen.queryByText("تفاصيل إضافية")).not.toBeInTheDocument();
  });

  it("shows the expanded content only for keys included in expandedKeys", () => {
    renderList({
      renderExpandedRow: (row) => <span>تفاصيل {row.number}</span>,
      expandedKeys: ["1"],
    });
    expect(screen.getByText("تفاصيل INV-000123")).toBeInTheDocument();
    expect(screen.queryByText("تفاصيل INV-000122")).not.toBeInTheDocument();
  });
});

describe("DocumentList — footer totals", () => {
  it("shows no footer row when no column defines a total", () => {
    const plainColumns: DocumentListColumn<Row>[] = [{ key: "number", header: "رقم الفاتورة", render: (r) => r.number }];
    render(<DocumentList<Row> title="فواتير" columns={plainColumns} rows={rows} rowKey={(r) => r.id} page={1} pageCount={1} />);
    expect(screen.queryByText("إجمالي الصفحة")).not.toBeInTheDocument();
  });

  it("computes a column's total and labels the remaining column with the page-total caption", () => {
    renderList();
    expect(screen.getByText("إجمالي الصفحة")).toBeInTheDocument();
    expect(screen.getByText("4570.50")).toBeInTheDocument();
  });

  it("shows no footer row when rows are empty even though columns define totals", () => {
    renderList({ rows: [] });
    expect(screen.queryByText("إجمالي الصفحة")).not.toBeInTheDocument();
  });
});

describe("DocumentList — loading and empty states", () => {
  it("shows a skeleton instead of rows while loading with nothing yet", () => {
    renderList({ rows: [], loading: true });
    expect(screen.queryByText("INV-000123")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeInTheDocument();
  });

  it("keeps the empty state hidden while still loading", () => {
    renderList({ rows: [], loading: true, emptyState: <div>لا توجد فواتير</div> });
    expect(screen.queryByText("لا توجد فواتير")).not.toBeInTheDocument();
  });

  it("does not show a skeleton once rows have arrived, even if loading is still true", () => {
    renderList({ loading: true });
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
  });
});

describe("DocumentList — page size and pagination", () => {
  it("hides the page-size selector when onPageSizeChange is not given", () => {
    renderList({ pageSize: 25 });
    expect(screen.queryByRole("combobox", { name: "صفوف لكل صفحة" })).not.toBeInTheDocument();
  });

  it("calls onPageSizeChange with the numeric size the reader picked", () => {
    const onPageSizeChange = vi.fn();
    renderList({ pageSize: 25, onPageSizeChange });
    fireEvent.click(screen.getByRole("combobox", { name: "صفوف لكل صفحة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "50" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("hides the pagination nav entirely when there is only one page", () => {
    renderList({ pageCount: 1 });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("renders an ellipsis between distant page numbers for a long page list", () => {
    renderList({ page: 6, pageCount: 12 });
    const navEl = screen.getByRole("navigation", { name: "ترقيم الصفحات" });
    expect(within(navEl).getAllByText("…").length).toBeGreaterThan(0);
    expect(within(navEl).getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(within(navEl).getByRole("button", { name: "12" })).toBeInTheDocument();
  });

  it("marks the current page button with aria-current", () => {
    renderList({ page: 2, pageCount: 3 });
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "1" })).not.toHaveAttribute("aria-current");
  });
});

describe("DocumentList — keyboard list navigation", () => {
  it("moves the selection down and up with next/prev nav events, and opens the selected row on 'open'", () => {
    const onRowClick = vi.fn();
    renderList({ onRowClick });
    nav("next");
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("aria-selected", "true");

    nav("next");
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");

    nav("prev");
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("aria-selected", "true");

    nav("open");
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("selects the last row when 'prev' is emitted with nothing selected yet", () => {
    renderList();
    nav("prev");
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");
  });

  it("does nothing on a nav event when there are no rows", () => {
    renderList({ rows: [] });
    expect(() => nav("next")).not.toThrow();
  });

  it("does nothing on an 'open' event when nothing is selected", () => {
    const onRowClick = vi.fn();
    renderList({ onRowClick });
    nav("open");
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("only the most recently mounted list responds to nav events when two are mounted", () => {
    const onRowClickOuter = vi.fn();
    const onRowClickInner = vi.fn();
    const { unmount: unmountOuter } = renderList({ onRowClick: onRowClickOuter });

    const inner = render(
      <DocumentList<Row>
        title="لوحة جانبية"
        columns={columns}
        rows={rows}
        rowKey={(r) => `inner-${r.id}`}
        page={1}
        pageCount={1}
        onRowClick={onRowClickInner}
      />,
    );

    nav("next");
    nav("open");
    expect(onRowClickInner).toHaveBeenCalledWith(rows[0]);
    expect(onRowClickOuter).not.toHaveBeenCalled();

    inner.unmount();
    unmountOuter();
  });

  it("clears the selection when the page changes", () => {
    const { rerender } = renderList();
    nav("next");
    expect(screen.getAllByRole("row")[1]).toHaveAttribute("aria-selected", "true");

    rerender(<DocumentList<Row> title="فواتير المبيعات" columns={columns} rows={rows} rowKey={(r) => r.id} page={2} pageCount={3} />);
    expect(screen.getAllByRole("row")[1]).not.toHaveAttribute("aria-selected");
  });
});
