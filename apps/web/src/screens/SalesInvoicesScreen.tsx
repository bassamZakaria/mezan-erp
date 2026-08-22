import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  Money,
  StatusPill,
  type DocumentListColumn,
  type DocumentListSort,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { demoInvoices, type DemoInvoice } from "../sample-data";

const STATUS_LABEL: Record<DemoInvoice["status"], string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  partial: "مدفوع جزئياً",
  paid: "مدفوع",
  cancelled: "ملغي",
};

const STATUS_TONE: Record<DemoInvoice["status"], PillTone> = {
  draft: "neutral",
  confirmed: "success",
  partial: "warning",
  paid: "success",
  cancelled: "danger",
};

const PAGE_SIZE = 5;

/** The pattern-gallery Sales Invoices demo screen (unchanged behavior, moved out of App.tsx so App.tsx can route between screens). */
export function SalesInvoicesScreen() {
  const [statusFilter, setStatusFilter] = useState<DemoInvoice["status"] | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DocumentListSort>({ key: "date", direction: "desc" });
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = demoInvoices;
    if (statusFilter !== "all") rows = rows.filter((row) => row.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => row.number.toLowerCase().includes(q) || row.customer.includes(search.trim()));
    }
    const sorted = [...rows].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "total") return (a.total - b.total) * dir;
      if (sort.key === "number") return a.number.localeCompare(b.number) * dir;
      return a.date.localeCompare(b.date) * dir;
    });
    return sorted;
  }, [statusFilter, search, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: demoInvoices.length },
    ...(Object.keys(STATUS_LABEL) as DemoInvoice["status"][]).map((status) => ({
      key: status,
      label: STATUS_LABEL[status],
      count: demoInvoices.filter((row) => row.status === status).length,
    })),
  ];

  const columns: DocumentListColumn<DemoInvoice>[] = [
    { key: "number", header: "رقم الفاتورة", sortable: true, render: (row) => <span className="mz-num font-semibold text-ink">{row.number}</span> },
    { key: "date", header: "التاريخ", sortable: true, render: (row) => <span className="mz-num">{row.date.split("-").reverse().join("/")}</span> },
    { key: "customer", header: "العميل", render: (row) => row.customer },
    {
      key: "status",
      header: "الحالة",
      render: (row) => <StatusPill label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />,
    },
    { key: "total", header: "الإجمالي", align: "end", sortable: true, render: (row) => <Money value={row.total} /> },
    { key: "remaining", align: "end", header: "المتبقي", render: (row) => <Money value={row.remaining} /> },
  ];

  const overdueCount = demoInvoices.filter((row) => row.status !== "paid" && row.status !== "cancelled" && new Date(row.dueDate) < new Date("2026-08-21")).length;
  const overdueTotal = demoInvoices
    .filter((row) => row.status !== "paid" && row.status !== "cancelled" && new Date(row.dueDate) < new Date("2026-08-21"))
    .reduce((sum, row) => sum + row.remaining, 0);

  return (
    <DocumentList<DemoInvoice>
      eyebrow="Sales · Invoices"
      title="فواتير المبيعات"
      description="مثال حي على نمط قائمة المستندات: شريط مؤشرات، رقاقات حالة، بحث وتصفية، جدول قابل للفرز، وترقيم صفحات"
      actions={
        <>
          <Button>طباعة</Button>
          <Button variant="primary">فاتورة جديدة</Button>
        </>
      }
      stats={[
        { label: "إجمالي الفواتير", value: <span className="mz-num">{demoInvoices.length}</span> },
        { label: "مؤكدة", value: <span className="mz-num">{demoInvoices.filter((r) => r.status === "confirmed").length}</span> },
        { label: "مدفوعة بالكامل", value: <span className="mz-num">{demoInvoices.filter((r) => r.status === "paid").length}</span> },
        {
          label: "متأخرة",
          value: <span className="mz-num">{overdueCount}</span>,
          valueTone: "danger",
          sub: (
            <>
              <span>·</span>
              <Money value={overdueTotal} showUnit={false} />
              <span>ج.م</span>
            </>
          ),
        },
      ]}
      statusChips={statusChips}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => {
        setStatusFilter(key as DemoInvoice["status"] | "all");
        setPage(1);
      }}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value);
        setPage(1);
      }}
      searchPlaceholder="بحث برقم الفاتورة أو اسم العميل…"
      columns={columns}
      rows={pageRows}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={(key) =>
        setSort((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }))
      }
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      pageSummary={
        <>
          عرض <span className="mz-num">{pageRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</span>{" "}
          من <span className="mz-num">{filtered.length}</span> فاتورة
        </>
      }
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فواتير مطابقة</div>}
    />
  );
}
