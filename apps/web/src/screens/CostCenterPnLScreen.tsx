import { useEffect, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  StatCard,
  TextInput,
  formatNumber,
  type DocumentListColumn,
} from "@mezan/ui";
import type { CostCenterPnLRowDTO } from "@mezan/contracts";
import { useCostCenterPnL } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { monthEndIso, monthStartIso } from "../lib/dates";
import { useUrlNumber } from "../lib/url-state";

/** Display-only formatter for a 6-dp exact decimal string (ledger math stays in Money). */
function fmt(value: string): string {
  return formatNumber(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * أرباح مراكز التكلفة — Cost Center P&L (docs/archive/catalog/04). Groups posted
 * revenue/expense by the cost-center dimension carried on each journal line,
 * on the real `GET /cost-center-pl` route (packages/api/src/cost-center-pl-routes.ts),
 * which runs the SAME `computeCostCenterPnL` domain function server-side.
 */
const PAGE_SIZES = [10, 25, 50, 100] as const;

export function CostCenterPnLScreen() {
  const { t } = useAppTranslation();
  const [fromDate, setFromDate] = useState(monthStartIso());
  const [toDate, setToDate] = useState(monthEndIso());
  const query = useCostCenterPnL(fromDate, toDate);
  const report = query.data ?? null;
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const rows = report?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const columns: DocumentListColumn<CostCenterPnLRowDTO>[] = [
    { key: "code", header: t("common.code"), render: (r) => <span className="mz-num text-ink-muted">{r.code}</span> },
    { key: "name", header: t("costCenterPnl.costCentre"), render: (r) => <span className="font-semibold text-ink">{r.name}</span> },
    { key: "revenue", header: t("costCenterPnl.revenue"), render: (r) => <span className="mz-num text-ink">{fmt(r.revenue)}</span> },
    { key: "expense", header: t("costCenterPnl.expenses"), render: (r) => <span className="mz-num text-ink">{fmt(r.expense)}</span> },
    {
      key: "profit",
      header: t("costCenterPnl.netProfit"),
      render: (r) => <span className={`mz-num font-bold ${Number(r.profit) < 0 ? "text-danger-ink" : "text-success-ink"}`}>{fmt(r.profit)}</span>,
    },
    {
      key: "rollup",
      header: t("costCenterPnl.rollupProfit"),
      render: (r) =>
        r.rollup.profit === r.profit ? (
          <span className="text-ink-muted">—</span>
        ) : (
          <span className={`mz-num ${Number(r.rollup.profit) < 0 ? "text-danger-ink" : "text-ink"}`}>{fmt(r.rollup.profit)}</span>
        ),
    },
  ];

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("costCenterPnl.costCentrePL")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("costCenterPnl.theRevenueAndExpensesOf")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <label className="text-[12px] text-ink-muted">{t("common.of")}</label>
          <TextInput size="sm" className="w-[160px]" type="date" aria-label={t("costCenterPnl.from")} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <label className="text-[12px] text-ink-muted">{t("costCenterPnl.to")}</label>
          <TextInput size="sm" className="w-[160px]" type="date" aria-label={t("costCenterPnl.to2")} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("costCenterPnl.couldNotLoadTheCost")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="mb-[18px] grid grid-cols-1 gap-[14px] sm:grid-cols-3">
        <StatCard label={t("costCenterPnl.totalRevenue")} value={<span className="mz-num">{report ? fmt(report.totals.revenue) : "—"}</span>} />
        <StatCard label={t("costCenterPnl.totalExpenses")} value={<span className="mz-num">{report ? fmt(report.totals.expense) : "—"}</span>} />
        <StatCard label={t("costCenterPnl.netProfit")} value={<span className="mz-num">{report ? fmt(report.totals.profit) : "—"}</span>} valueTone={report && Number(report.totals.profit) < 0 ? "danger" : "default"} />
      </div>

      <DocumentList<CostCenterPnLRowDTO>
        title=""
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(r) => r.costCenterId ?? "unassigned"}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("costCenterPnl.costCentre2")}</>}
        emptyState={<EmptyState title={t("costCenterPnl.noMovementInThisPeriod")} description={t("costCenterPnl.emptyBody")} />}
      />
    </div>
  );
}
