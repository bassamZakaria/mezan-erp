// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("DocumentList — the collapse state it remembers between visits", () => {
  it("reopens the KPI strip a reader left open, and leaves the one they closed shut", () => {
    const first = renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });
    const toggle = screen.getByRole("button", { name: /التفاصيل/ });
    fireEvent.click(toggle);
    const openedByReader = toggle.getAttribute("aria-expanded");
    first.unmount();

    renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });
    expect(screen.getByRole("button", { name: /التفاصيل/ })).toHaveAttribute("aria-expanded", openedByReader!);
  });

  it("opens by default with nothing stored, and reads anything but «1» as closed", () => {
    const fresh = renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });
    expect(screen.getByRole("button", { name: /التفاصيل/ })).toHaveAttribute("aria-expanded", "true");
    fresh.unmount();

    window.localStorage.setItem("mezan.list.stats.sales-invoices", "maybe");
    renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });
    expect(screen.getByRole("button", { name: /التفاصيل/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("still toggles for this session when the browser refuses to read storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });

    const toggle = screen.getByRole("button", { name: /التفاصيل/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("still toggles for this session when the browser refuses to write storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderList({ listKey: "sales-invoices", statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });

    const toggle = screen.getByRole("button", { name: /التفاصيل/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the toggle working with no listKey to remember it by", () => {
    renderList({ statsCollapsible: true, stats: [{ label: "الإجمالي", value: "1,000" }] });

    const toggle = screen.getByRole("button", { name: /التفاصيل/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("DocumentList — views take precedence over status chips", () => {
  it("renders the views control and reports the key the reader picked", () => {
    const onStatusChange = vi.fn();
    renderList({
      views: [
        { key: "all", label: "الكل", count: 12 },
        { key: "draft", label: "مسودات", count: 3 },
      ],
      statusChips: [{ key: "posted", label: "مرحّلة", count: 9 }],
      activeStatusKey: "all",
      onStatusChange,
    });

    expect(screen.queryByRole("button", { name: /مرحّلة/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /مسودات/ }));
    expect(onStatusChange).toHaveBeenCalledWith("draft");
  });

  it("treats no active key as no view selected rather than crashing", () => {
    renderList({ views: [{ key: "all", label: "الكل", count: 12 }] });
    expect(screen.getByRole("tab", { name: /الكل/ })).toHaveAttribute("aria-selected", "false");
  });

  it("survives a view pick when the caller wired no handler", () => {
    renderList({ views: [{ key: "all", label: "الكل", count: 12 }, { key: "draft", label: "مسودات", count: 3 }] });
    fireEvent.click(screen.getByRole("tab", { name: /مسودات/ }));
    expect(screen.getByRole("tab", { name: /مسودات/ })).toBeInTheDocument();
  });
});

describe("DocumentList — the search field", () => {
  it("starts empty when the caller passes no value, and reports what is typed", () => {
    const onSearchChange = vi.fn();
    renderList({ onSearchChange, searchPlaceholder: "ابحث" });

    const search = screen.getByRole("searchbox");
    expect(search).toHaveValue("");
    fireEvent.change(search, { target: { value: "INV-1" } });
    expect(onSearchChange).toHaveBeenCalledWith("INV-1");
  });
});

describe("DocumentList — the page total footer", () => {
  it("sums the column that asks for a total and labels the row once", () => {
    renderList({
      columns: [
        columns[0]!,
        {
          ...columns[1]!,
          total: (rs) => rs.reduce((sum, r) => sum + r.total, 0).toFixed(2),
        },
      ],
    });

    expect(screen.getByText("4570.50")).toBeInTheDocument();
    expect(screen.getByText("إجمالي الصفحة")).toBeInTheDocument();
  });

  it("renders no footer when the page has no rows to total", () => {
    renderList({
      rows: [],
      columns: [columns[0]!, { ...columns[1]!, total: () => "0.00" }],
    });
    expect(screen.queryByText("إجمالي الصفحة")).not.toBeInTheDocument();
  });

  it("leaves room for the row-action column in the footer when one is shown", () => {
    const { container } = renderList({
      onRowClick: vi.fn(),
      columns: [columns[0]!, { ...columns[1]!, total: () => "4570.50" }],
    });

    const footerCells = container.querySelectorAll("tfoot td");
    expect(footerCells).toHaveLength(columns.length + 1);
  });
});

describe("DocumentList — an expanded row", () => {
  it("spans the panel across every column including the action one", () => {
    const { container } = renderList({
      onRowClick: vi.fn(),
      expandedKeys: ["1"],
      renderExpandedRow: (row) => <div>تفاصيل {row.number}</div>,
    });

    expect(screen.getByText("تفاصيل INV-000123")).toBeInTheDocument();
    const panelCell = container.querySelector("tbody tr + tr td") as HTMLTableCellElement;
    expect(panelCell.colSpan).toBe(columns.length + 1);
  });
});
