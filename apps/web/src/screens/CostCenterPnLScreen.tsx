import { useEffect, useMemo, useState } from "react";
import { DocumentList, StatCard, type DocumentListColumn } from "@mezan/ui";
import type { CostCenterPnLReportDTO, CostCenterPnLRowDTO } from "@mezan/contracts";
import { createAccountingDepthStore } from "../store/accounting-depth-store";

/** Display-only formatter for a 6-dp exact decimal string (ledger math stays in Money). */
function fmt(value: string): string {
  return Number(value).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * أرباح مراكز التكلفة — Cost Center P&L (docs/catalog/04). Groups posted
 * revenue/expense by the cost-center dimension carried on each journal line,
 * running the REAL `computeCostCenterPnL` domain function over the seeded
 * ledger (see store/accounting-depth-store.ts).
 */
export function CostCenterPnLScreen() {
  const store = useMemo(() => createAccountingDepthStore(), []);
  const [fromDate, setFromDate] = useState("2026-08-01");
  const [toDate, setToDate] = useState("2026-08-31");
  const [report, setReport] = useState<CostCenterPnLReportDTO | null>(null);

  useEffect(() => {
    let live = true;
    store.costCenterPnL(fromDate, toDate).then((r) => {
      if (!live) return;
      setReport({
        rows: r.rows.map((row) => ({ costCenterId: row.costCenterId, code: row.code, name: row.name, revenue: row.revenue.toString(), expense: row.expense.toString(), profit: row.profit.toString() })),
        totals: { revenue: r.totals.revenue.toString(), expense: r.totals.expense.toString(), profit: r.totals.profit.toString() },
      });
    });
    return () => {
      live = false;
    };
  }, [store, fromDate, toDate]);

  const columns: DocumentListColumn<CostCenterPnLRowDTO>[] = [
    { key: "code", header: "الكود", render: (r) => <span className="mz-num text-ink-muted">{r.code}</span> },
    { key: "name", header: "مركز التكلفة", render: (r) => <span className="font-semibold text-ink">{r.name}</span> },
    { key: "revenue", header: "الإيرادات", render: (r) => <span className="mz-num text-ink">{fmt(r.revenue)}</span> },
    { key: "expense", header: "المصروفات", render: (r) => <span className="mz-num text-ink">{fmt(r.expense)}</span> },
    {
      key: "profit",
      header: "صافي الربح",
      render: (r) => <span className={`mz-num font-bold ${Number(r.profit) < 0 ? "text-danger-ink" : "text-success-ink"}`}>{fmt(r.profit)}</span>,
    },
  ];

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Accounting · Cost Center P&L</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">أرباح مراكز التكلفة</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">أرباح ومصروفات كل مركز تكلفة من بنود القيود التي تحمل بُعد مركز التكلفة</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <label className="text-[12px] text-ink-muted">من</label>
          <input type="date" aria-label="من تاريخ" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
          <label className="text-[12px] text-ink-muted">إلى</label>
          <input type="date" aria-label="إلى تاريخ" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink" />
        </div>
      </div>

      <div className="mb-[18px] grid grid-cols-1 gap-[14px] sm:grid-cols-3">
        <StatCard label="إجمالي الإيرادات" value={<span className="mz-num">{report ? fmt(report.totals.revenue) : "—"}</span>} />
        <StatCard label="إجمالي المصروفات" value={<span className="mz-num">{report ? fmt(report.totals.expense) : "—"}</span>} />
        <StatCard label="صافي الربح" value={<span className="mz-num">{report ? fmt(report.totals.profit) : "—"}</span>} valueTone={report && Number(report.totals.profit) < 0 ? "danger" : "default"} />
      </div>

      <DocumentList<CostCenterPnLRowDTO>
        eyebrow="Accounting · Cost Center P&L"
        title=""
        columns={columns}
        rows={report?.rows ?? []}
        rowKey={(r) => r.costCenterId ?? "unassigned"}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{report?.rows.length ?? 0}</span> مركز تكلفة</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد حركات في هذه الفترة</div>}
      />
    </div>
  );
}
