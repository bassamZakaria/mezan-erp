import { useEffect, useState } from "react";
import { DocumentList, EmptyState, StatusPill, Chip, Button, Card, Money as MoneyValue, Qty as QtyDisplay, formatNumber, type DocumentListColumn } from "@mezan/ui";
import { StockPositionFaultCode, type ReconciliationRowDTO, type UnlinkedEntryLineDTO } from "@mezan/contracts";
import { useReconciliation } from "../data/hooks";
import { OpeningBalanceDuplicatesCard } from "./OpeningBalanceDuplicatesCard";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { codedLabel } from "../domain-labels";

const STOCK_POSITION_FAULT_KEY: Record<StockPositionFaultCode, AppTranslationKey> = {
  [StockPositionFaultCode.ValueWithoutQuantity]: "reconciliation.stockPositions.valueWithoutQuantity",
  [StockPositionFaultCode.NegativeValue]: "reconciliation.stockPositions.negativeValue",
};

function fmt(value: string): string {
  return formatNumber(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * مطابقة الأرصدة — Balance Reconciliation (docs/archive/catalog/04). Cross-checks each
 * sub-ledger balance against its GL control account and flags journal lines
 * posted directly to a control account (القيود غير المرتبطة), on the real
 * `GET /reconciliation` route (packages/api/src/reconciliation-routes.ts),
 * which runs the SAME `computeBalanceReconciliation` / `findUnlinkedControlLines`
 * domain functions server-side.
 */
const PAGE_SIZES = [10, 25, 50, 100] as const;

export function ReconciliationScreen() {
  const { t } = useAppTranslation();
  const query = useReconciliation();
  const [tab, setTab] = useState<"summary" | "unlinked">("summary");
  const report = query.data ?? null;
  const [summaryPage, setSummaryPage] = useState(1);
  const [summaryPageSize, setSummaryPageSize] = useState<number>(25);
  const [unlinkedPage, setUnlinkedPage] = useState(1);
  const [unlinkedPageSize, setUnlinkedPageSize] = useState<number>(25);

  const misdated = report?.stockLedgerDates?.rows ?? [];
  const faultyPositions = report?.stockPositions?.rows ?? [];
  const everythingTies = (report?.allMatched ?? false) && misdated.length === 0 && faultyPositions.length === 0;
  const summaryRows = report?.rows ?? [];
  const summaryPageCount = Math.max(1, Math.ceil(summaryRows.length / summaryPageSize));
  const summaryPageRows = summaryRows.slice((summaryPage - 1) * summaryPageSize, summaryPage * summaryPageSize);
  useEffect(() => {
    if (summaryPage > summaryPageCount) setSummaryPage(1);
  }, [summaryPage, summaryPageCount]);

  const unlinkedRows = report?.unlinked ?? [];
  const unlinkedPageCount = Math.max(1, Math.ceil(unlinkedRows.length / unlinkedPageSize));
  const unlinkedPageRows = unlinkedRows.slice((unlinkedPage - 1) * unlinkedPageSize, unlinkedPage * unlinkedPageSize);
  useEffect(() => {
    if (unlinkedPage > unlinkedPageCount) setUnlinkedPage(1);
  }, [unlinkedPage, unlinkedPageCount]);

  const summaryColumns: DocumentListColumn<ReconciliationRowDTO>[] = [
    { key: "label", header: t("reconciliation.reconciliation"), render: (r) => <span className="font-semibold text-ink">{codedLabel("periodClose.tie", r.key, r.label, t)}</span> },
    { key: "sub", header: t("reconciliation.subLedgerBalance"), render: (r) => <span className="mz-num">{fmt(r.subLedgerBalance)}</span> },
    { key: "gl", header: t("reconciliation.ledgerBalance"), render: (r) => <span className="mz-num">{fmt(r.glBalance)}</span> },
    { key: "diff", header: t("reconciliation.difference"), render: (r) => <span className={`mz-num ${r.matched ? "text-ink-muted" : "text-danger-ink font-bold"}`}>{fmt(r.difference)}</span> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={r.matched ? t("reconciliation.matched") : t("reconciliation.notMatched")} tone={r.matched ? "success" : "danger"} /> },
  ];

  const unlinkedColumns: DocumentListColumn<UnlinkedEntryLineDTO>[] = [
    { key: "no", header: t("reconciliation.entryNumber"), render: (u) => <span className="mz-num text-ink">{u.entryNo ?? u.entryId}</span> },
    { key: "date", header: t("common.date"), render: (u) => <span className="mz-num text-ink-muted">{u.date}</span> },
    { key: "account", header: t("reconciliation.account"), render: (u) => <span className="text-ink">{u.accountId}</span> },
    { key: "memo", header: t("reconciliation.description"), render: (u) => <span className="text-ink-muted">{u.memo ?? "—"}</span> },
    { key: "debit", header: t("common.debit"), render: (u) => <span className="mz-num">{fmt(u.debit)}</span> },
    { key: "credit", header: t("common.credit"), render: (u) => <span className="mz-num">{fmt(u.credit)}</span> },
  ];

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("reconciliation.balanceReconciliation")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("reconciliation.reconcilingSubLedgerBalancesAgainst")}</p>
        </div>
        <Button onClick={() => query.refetch()}>{t("reconciliation.refresh")}</Button>
      </div>

      {query.isError ? (
        <Card className="mb-[16px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("reconciliation.theReconciliationCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      {report ? (
        <div className={`mb-[16px] rounded-md border px-[12px] py-[10px] text-[12.5px] ${everythingTies ? "border-success bg-success-soft text-success-ink" : "border-warning bg-warning-soft text-warning-ink"}`}>
          {everythingTies ? t("reconciliation.everyBalanceMatches") : t("reconciliation.thereAreDifferencesThatNeed")}
        </div>
      ) : null}

      <OpeningBalanceDuplicatesCard />

      {misdated.length > 0 ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          <p className="font-semibold">{t("reconciliation.stockLedgerDates.title", { count: String(misdated.length) })}</p>
          <ul className="mt-[6px] flex flex-col gap-[3px]">
            {misdated.map((row) => (
              <li key={`${row.docId} ${row.movedOn}`}>
                <span className="mz-num font-semibold">{row.docNo ?? row.docId}</span>
                {" — "}
                {t("reconciliation.stockLedgerDates.row", { moved: row.movedOn, posted: row.postedOn.join("، ") })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {faultyPositions.length > 0 ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          <p className="font-semibold">{t("reconciliation.stockPositions.title", { count: String(faultyPositions.length) })}</p>
          <ul className="mt-[6px] flex flex-col gap-[3px]">
            {faultyPositions.map((row) => (
              <li key={`${row.itemId} ${row.warehouseId}`}>
                <span className="mz-num font-semibold">{row.itemId}</span>
                {" · "}
                <span className="mz-num">{row.warehouseId}</span>
                {" — "}
                {t(STOCK_POSITION_FAULT_KEY[row.fault])}
                {" — "}
                <QtyDisplay value={row.onHand} />
                {row.totalValue !== undefined ? <>{" / "} <MoneyValue value={row.totalValue} /></> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-[16px] flex flex-wrap gap-[8px]" role="radiogroup">
        <Chip active={tab === "summary"} onClick={() => setTab("summary")}>{t("reconciliation.reconciliationSummary")}</Chip>
        <Chip active={tab === "unlinked"} onClick={() => setTab("unlinked")}>{t("reconciliation.unlinkedEntries")}{report?.unlinked.length ?? 0})</Chip>
      </div>

      {tab === "summary" ? (
        <DocumentList<ReconciliationRowDTO>
          title=""
          columns={summaryColumns}
          rows={summaryPageRows}
          loading={query.isLoading}
          rowKey={(r) => r.key}
          page={summaryPage}
          pageCount={summaryPageCount}
          onPageChange={setSummaryPage}
          pageSize={summaryPageSize}
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={(size) => {
            setSummaryPageSize(size);
            setSummaryPage(1);
          }}
          pageSummary={<>{t("common.show")} <span className="mz-num">{summaryPageRows.length}</span> {t("reconciliation.reconciliations")}</>}
          emptyState={<EmptyState title={t("reconciliation.noControlAccounts")} description={t("reconciliation.emptyBody")} />}
        />
      ) : (
        <>
          {report && report.unlinked.length === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-muted">{t("reconciliation.everyControlAccountLineIs")}</Card>
          ) : (
            <DocumentList<UnlinkedEntryLineDTO>
              title=""
              columns={unlinkedColumns}
              rows={unlinkedPageRows}
              loading={query.isLoading}
              rowKey={(u) => `${u.entryId}-${u.accountId}`}
              page={unlinkedPage}
              pageCount={unlinkedPageCount}
              onPageChange={setUnlinkedPage}
              pageSize={unlinkedPageSize}
              pageSizeOptions={PAGE_SIZES}
              onPageSizeChange={(size) => {
                setUnlinkedPageSize(size);
                setUnlinkedPage(1);
              }}
              pageSummary={<>{t("common.show")} <span className="mz-num">{unlinkedPageRows.length}</span> {t("reconciliation.unlinkedLines")}</>}
              emptyState={<EmptyState title={t("reconciliation.noLines")} />}
            />
          )}
        </>
      )}
    </div>
  );
}
