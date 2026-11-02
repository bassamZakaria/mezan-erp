import { useMemo, useState } from "react";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  Money as MoneyValue,
  RowMenu,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { RecognitionPreviewDTO, RecognitionRunDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useAccounts, useJournalEntry } from "../../../data/hooks";
import {
  usePostRecognitionRun,
  useRecognitionPreview,
  useRecognitionRun,
  useRecognitionRuns,
  useRecognitionStatus,
  useReverseRecognitionRun,
} from "../../../data/contracting-recognition-hooks";
import { SelectField } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { useSubPage } from "../../../navigation";
import { majorOf } from "../../../lib/money";
import { monthEndIsoOf } from "../../../lib/dates";
import { errorMessage } from "../../../lib/error-message";

/**
 * الاعتراف بالإيراد — the monthly EAS 48 cost-to-cost run (design D-03, D-12).
 *
 * The board answers one question per contract: is this month's revenue booked,
 * and if not, what would booking it do. Every figure on it is the server's —
 * nothing here computes a percentage or an amount.
 */

const VIEW_PERMISSION = "contracting.certificate.view";
const APPROVE_PERMISSION = "contracting.certificate.approve";
const PAGE_SIZES = [10, 25, 50, 100] as const;
const MONTH_CHOICES = 18;

/** The month ends a user may close, newest first, starting with last month. */
function monthEndChoices(today: Date): string[] {
  const choices: string[] = [];
  for (let back = 1; back <= MONTH_CHOICES; back += 1) {
    choices.push(monthEndIsoOf(today.getFullYear(), today.getMonth() - back));
  }
  return choices;
}

function statusTone(row: RecognitionPreviewDTO): PillTone {
  if (row.existingRunDocNo !== null) return "success";
  if (row.due) return "warning";
  return "neutral";
}

export function RevenueRecognitionScreen() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const { session } = useApi();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;

  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(authContext, VIEW_PERMISSION);
  const mayApprove = can(authContext, APPROVE_PERMISSION);

  const months = useMemo(() => monthEndChoices(new Date()), []);
  const [periodEnd, setPeriodEnd] = useState<string>(() => months[0] ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [pendingContractId, setPendingContractId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const statusQuery = useRecognitionStatus(mayView ? periodEnd : null);
  const postRun = usePostRecognitionRun();

  const allRows = useMemo(() => statusQuery.data?.rows ?? [], [statusQuery.data]);
  const rows = useMemo(() => {
    const needle = searchText.trim();
    return allRows.filter((row) => {
      if (statusFilter === "due" && !row.due) return false;
      if (statusFilter === "run" && row.existingRunDocNo === null) return false;
      if (needle === "") return true;
      return `${row.contractDocNo} ${row.contractTitleAr}`.includes(needle);
    });
  }, [allRows, searchText, statusFilter]);

  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)));
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function runMonth(row: RecognitionPreviewDTO): Promise<RowActionOutcome | void> {
    if (pendingContractId !== null) return;
    setPendingContractId(row.contractId);
    setActionError(null);
    try {
      const run = await postRun.mutateAsync({ contractId: row.contractId, periodEnd: row.periodEnd });
      subPage.open(run.docNo);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("revenueRecognition.api.runFailedToPost"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingContractId(null);
    }
  }

  if (!mayView) {
    return <EmptyState title={t("revenueRecognition.noAccessTitle")} description={t("revenueRecognition.noAccessBody")} />;
  }

  if (firstSegment) {
    return <RunDetailPage docNo={firstSegment} mayApprove={mayApprove} onClose={() => subPage.close()} />;
  }

  const columns: DocumentListColumn<RecognitionPreviewDTO>[] = [
    {
      key: "contract",
      header: t("revenueRecognition.contract"),
      render: (row) => (
        <div className="min-w-0">
          <div className="mz-num text-[12.5px] font-semibold text-ink">{row.contractDocNo}</div>
          <div className="truncate text-[11.5px] text-ink-muted">{row.contractTitleAr}</div>
        </div>
      ),
    },
    {
      key: "costToDate",
      header: t("revenueRecognition.costToDate"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.costToDate)} />,
    },
    {
      key: "estimatedTotalCost",
      header: t("revenueRecognition.estimatedTotalCost"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.estimatedTotalCost)} />,
    },
    {
      key: "costToComplete",
      header: t("revenueRecognition.costToComplete"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.costToComplete)} />,
    },
    {
      key: "percentComplete",
      header: t("revenueRecognition.percentComplete"),
      align: "end",
      render: (row) => <span className="mz-num">{row.percentComplete}%</span>,
    },
    {
      key: "revenueToDate",
      header: t("revenueRecognition.revenueToDate"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.revenueToDate)} />,
    },
    {
      key: "revenueRecognisedPreviously",
      header: t("revenueRecognition.revenueRecognisedPreviously"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.revenueRecognisedPreviously)} />,
    },
    {
      key: "periodRevenue",
      header: t("revenueRecognition.periodRevenue"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.periodRevenue)} />,
    },
    {
      key: "billedToDate",
      header: t("revenueRecognition.billedToDate"),
      align: "end",
      render: (row) => <MoneyValue value={majorOf(row.billedToDate)} />,
    },
    {
      key: "position",
      header: t("revenueRecognition.contractPosition"),
      align: "end",
      render: (row) =>
        majorOf(row.contractLiability) > 0 ? (
          <MoneyValue value={-majorOf(row.contractLiability)} className="text-danger-ink" />
        ) : (
          <MoneyValue value={majorOf(row.contractAsset)} />
        ),
    },
    {
      key: "provision",
      header: t("revenueRecognition.provisionRequired"),
      align: "end",
      render: (row) => (
        <MoneyValue
          value={majorOf(row.provisionRequired)}
          className={majorOf(row.provisionRequired) > 0 ? "text-danger-ink" : undefined}
        />
      ),
    },
    {
      key: "state",
      header: t("common.status"),
      render: (row) => (
        <StatusPill
          label={
            row.existingRunDocNo !== null
              ? t("revenueRecognition.state.run", { docNo: row.existingRunDocNo })
              : row.due
                ? t("revenueRecognition.state.due")
                : t("revenueRecognition.state.notDue")
          }
          tone={statusTone(row)}
        />
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: allRows.length },
    { key: "due", label: t("revenueRecognition.chip.due"), count: allRows.filter((r) => r.due).length },
    {
      key: "run",
      label: t("revenueRecognition.chip.run"),
      count: allRows.filter((r) => r.existingRunDocNo !== null).length,
    },
  ];

  const dueCount = allRows.filter((r) => r.due).length;
  const totalPeriodRevenue = allRows.reduce((acc, r) => acc + majorOf(r.periodRevenue), 0);
  const totalWipToRelieve = allRows.reduce((acc, r) => acc + majorOf(r.wipRelieved), 0);
  const totalProvision = allRows.reduce((acc, r) => acc + majorOf(r.provisionRequired), 0);

  return (
    <div className="w-full">
      {actionError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{actionError}</p>
        </Card>
      ) : null}
      {statusQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{errorMessage(statusQuery.error, t("revenueRecognition.api.statusFailed"))}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => void statusQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<RecognitionPreviewDTO>
        title={t("revenueRecognition.title")}
        description={t("revenueRecognition.description")}
        listKey="contracting-revenue-recognition"
        stats={[
          {
            label: t("revenueRecognition.stat.due"),
            value: <span className="mz-num">{format.number(dueCount)}</span>,
            sub: t("revenueRecognition.stat.dueSub"),
            valueTone: dueCount > 0 ? "danger" : "default",
          },
          {
            label: t("revenueRecognition.stat.periodRevenue"),
            value: <MoneyValue value={totalPeriodRevenue} />,
            sub: t("revenueRecognition.stat.periodRevenueSub"),
          },
          {
            label: t("revenueRecognition.stat.wip"),
            value: <MoneyValue value={totalWipToRelieve} />,
            sub: t("revenueRecognition.stat.wipSub"),
          },
          {
            label: t("revenueRecognition.stat.provision"),
            value: <MoneyValue value={totalProvision} />,
            sub: t("revenueRecognition.stat.provisionSub"),
            valueTone: totalProvision > 0 ? "danger" : "default",
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("revenueRecognition.searchPlaceholder")}
        filterBarExtra={
          <SelectField
            label={t("revenueRecognition.periodEnd")}
            value={periodEnd}
            onChange={(value) => {
              setPeriodEnd(value);
              setPage(1);
            }}
            options={months.map((month) => ({ value: month, label: month }))}
          />
        }
        columns={columns}
        rows={pageRows}
        loading={statusQuery.isLoading}
        rowKey={(row) => row.contractId}
        onRowClick={(row) => {
          if (row.existingRunDocNo !== null) subPage.open(row.existingRunDocNo);
        }}
        rowAction={(row) => {
          const items: RowMenuItem[] = [];
          if (row.existingRunDocNo !== null) {
            items.push({
              key: "view",
              label: t("revenueRecognition.action.viewRun"),
              onSelect: () => subPage.open(row.existingRunDocNo as string),
            });
          }
          if (mayApprove) {
            items.push({
              key: "run",
              label: t("revenueRecognition.action.run"),
              disabled: pendingContractId === row.contractId || row.blockedReasonAr !== null,
              onSelect: () => runMonth(row),
            });
          }
          if (items.length === 0) return null;
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: row.contractDocNo })} />;
        }}
        renderExpandedRow={(row) =>
          row.blockedReasonAr === null ? null : (
            <div className="p-[13px_15px] text-[12.5px] text-ink-muted">{row.blockedReasonAr}</div>
          )
        }
        page={currentPage}
        pageCount={Math.max(1, Math.ceil(rows.length / pageSize))}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{format.number(pageRows.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{format.number(rows.length)}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("revenueRecognition.emptyTitle")}
            description={t("revenueRecognition.emptyBody")}
          />
        }
      />
    </div>
  );
}

function RunDetailPage({
  docNo,
  mayApprove,
  onClose,
}: {
  docNo: string;
  mayApprove: boolean;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const runQuery = useRecognitionRun(docNo);
  const run = runQuery.data ?? null;
  const siblingsQuery = useRecognitionRuns(run?.contractId ?? null);
  const previewQuery = useRecognitionPreview(run?.contractId ?? null, run?.periodEnd ?? null);
  const recomputed = previewQuery.data?.divergent ? (previewQuery.data.recomputed ?? null) : null;
  const entryQuery = useJournalEntry(run?.journalEntryId ?? null);
  const accountsQuery = useAccounts();
  const reverseRun = useReverseRecognitionRun();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountName = useMemo(() => {
    const byId = new Map((accountsQuery.data ?? []).map((a) => [a.id, a.nameAr]));
    return (id: string) => byId.get(id) ?? id;
  }, [accountsQuery.data]);

  const isLatest = useMemo(() => {
    const live = (siblingsQuery.data ?? []).filter((r) => r.status === "posted");
    if (live.length === 0 || run === null) return false;
    const latest = live.reduce((a, b) => (a.periodEnd >= b.periodEnd ? a : b));
    return latest.id === run.id;
  }, [siblingsQuery.data, run]);

  if (runQuery.isLoading) {
    return <EmptyState title={t("common.loading")} description={t("revenueRecognition.loadingRun")} />;
  }
  if (run === null) {
    return (
      <EmptyState
        title={t("revenueRecognition.runNotFound")}
        description={t("revenueRecognition.runNotFoundBody")}
        action={{ label: t("common.back"), onClick: onClose }}
      />
    );
  }

  async function reverse(current: RecognitionRunDTO): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await reverseRun.mutateAsync({ id: current.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("revenueRecognition.api.reverseFailed"));
    } finally {
      setPending(false);
    }
  }

  const wipBalances = majorOf(run.wipClosing);

  return (
    <div className="w-full">
      {error ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}
      {recomputed ? (
        <Card className="mb-[18px] border-s-4 border-danger p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("revenueRecognition.divergenceTitle")}</p>
          <p className="mt-[6px] text-[12.5px] text-ink-muted">{t("revenueRecognition.divergenceBody")}</p>
          <div className="mt-[10px] grid grid-cols-1 gap-[6px] sm:grid-cols-3">
            <Figure
              label={t("revenueRecognition.costToDate")}
              value={<MoneyValue value={majorOf(recomputed.costToDate)} className="text-danger-ink" />}
            />
            <Figure
              label={t("revenueRecognition.wipStranded")}
              value={<MoneyValue value={majorOf(recomputed.wipRelieved)} className="text-danger-ink" />}
            />
            <Figure
              label={t("revenueRecognition.revenueToDate")}
              value={<MoneyValue value={majorOf(recomputed.revenueToDate)} className="text-danger-ink" />}
            />
          </div>
        </Card>
      ) : null}
      <DocumentDetail
        title={run.docNo}
        statusLabel={run.status === "posted" ? t("revenueRecognition.status.posted") : t("revenueRecognition.status.reversed")}
        statusTone={run.status === "posted" ? "success" : "danger"}
        subtitle={
          <span className="mz-num">
            {run.contractDocNo} · {run.periodEnd}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-[9px]">
            <Button variant="ghost" onClick={onClose}>
              {t("common.back")}
            </Button>
            {mayApprove && run.status === "posted" && isLatest ? (
              <Button variant="danger-outline" disabled={pending} onClick={() => void reverse(run)}>
                {t("revenueRecognition.action.reverse")}
              </Button>
            ) : null}
          </div>
        }
        summary={[
          { label: t("revenueRecognition.percentComplete"), value: <span className="mz-num">{run.percentComplete}%</span> },
          { label: t("revenueRecognition.costToDate"), value: <MoneyValue value={majorOf(run.costToDate)} /> },
          { label: t("revenueRecognition.costToComplete"), value: <MoneyValue value={majorOf(run.costToComplete)} /> },
          { label: t("revenueRecognition.periodRevenue"), value: <MoneyValue value={majorOf(run.periodRevenue)} /> },
          { label: t("revenueRecognition.billedToDate"), value: <MoneyValue value={majorOf(run.billedToDate)} /> },
          {
            label: t("revenueRecognition.contractPosition"),
            value:
              majorOf(run.contractLiability) > 0 ? (
                <MoneyValue value={-majorOf(run.contractLiability)} className="text-danger-ink" />
              ) : (
                <MoneyValue value={majorOf(run.contractAsset)} />
              ),
          },
        ]}
        tabs={[
          {
            key: "figures",
            label: t("revenueRecognition.tab.figures"),
            content: (
              <Card className="grid grid-cols-1 sm:grid-cols-2">
                <Figure label={t("revenueRecognition.contractValue")} value={<MoneyValue value={majorOf(run.contractValue)} />} />
                <Figure label={t("revenueRecognition.estimatedTotalCost")} value={<MoneyValue value={majorOf(run.estimatedTotalCost)} />} />
                <Figure label={t("revenueRecognition.revenueToDate")} value={<MoneyValue value={majorOf(run.revenueToDate)} />} />
                <Figure
                  label={t("revenueRecognition.revenueRecognisedPreviously")}
                  value={<MoneyValue value={majorOf(run.revenueRecognisedPreviously)} />}
                />
                <Figure label={t("revenueRecognition.billedInPeriod")} value={<MoneyValue value={majorOf(run.billedInPeriod)} />} />
                <Figure label={t("revenueRecognition.foreseeableLoss")} value={<MoneyValue value={majorOf(run.foreseeableLoss)} />} />
                <Figure label={t("revenueRecognition.provisionRequired")} value={<MoneyValue value={majorOf(run.provisionRequired)} />} />
                <Figure label={t("revenueRecognition.provisionMovement")} value={<MoneyValue value={majorOf(run.provisionMovement)} />} />
                <Figure label={t("projects.advanceOutstanding")} value={<MoneyValue value={majorOf(run.advanceOutstanding)} />} />
                <Figure label={t("projects.retentionHeld")} value={<MoneyValue value={majorOf(run.retentionHeld)} />} />
              </Card>
            ),
          },
          {
            key: "wip",
            label: t("revenueRecognition.tab.wip"),
            content: (
              <Card className="divide-y divide-border">
                <Figure label={t("revenueRecognition.wipOpening")} value={<MoneyValue value={majorOf(run.wipOpening)} />} />
                <Figure label={t("revenueRecognition.wipIncurred")} value={<MoneyValue value={majorOf(run.wipIncurred)} />} />
                <Figure label={t("revenueRecognition.wipRelieved")} value={<MoneyValue value={majorOf(run.wipRelieved)} />} />
                <Figure
                  label={t("revenueRecognition.wipClosing")}
                  value={<MoneyValue value={wipBalances} className={wipBalances === 0 ? undefined : "text-danger-ink"} />}
                />
                <div className="p-[13px_15px] text-[11.5px] text-ink-muted">{t("revenueRecognition.wipIdentity")}</div>
                {run.wipByCategory.length === 0 ? (
                  <div className="p-[13px_15px] text-[12.5px] text-ink-muted">{t("revenueRecognition.noWipToRelieve")}</div>
                ) : (
                  run.wipByCategory.map((bucket, index) => (
                    <Figure
                      key={`${bucket.costCategory ?? "uncategorised"}-${index}`}
                      label={
                        bucket.costCategory === null
                          ? t("revenueRecognition.uncategorisedWip")
                          : t(`costCategory.${bucket.costCategory}` as never)
                      }
                      value={<MoneyValue value={majorOf(bucket.amount)} />}
                    />
                  ))
                )}
              </Card>
            ),
          },
          {
            key: "entry",
            label: t("revenueRecognition.tab.entry"),
            content:
              run.journalEntryId === null ? (
                <EmptyState title={t("revenueRecognition.noEntryTitle")} description={t("revenueRecognition.noEntryBody")} />
              ) : entryQuery.data ? (
                <Card className="divide-y divide-border">
                  <div className="mz-num p-[13px_15px] text-[12.5px] font-bold text-ink">
                    {entryQuery.data.entryNo ?? entryQuery.data.id} · {entryQuery.data.date}
                  </div>
                  {entryQuery.data.lines.map((line, index) => (
                    <div key={index} className="flex flex-wrap items-center justify-between gap-3 p-[13px_15px]">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-ink">{accountName(line.accountId)}</div>
                        <div className="mz-num text-[11.5px] text-ink-muted">
                          {line.accountId}
                          {line.memo ? ` · ${line.memo}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-[18px]">
                        <Figure label={t("common.debit")} value={<MoneyValue value={majorOf(line.debit)} />} inline />
                        <Figure label={t("common.credit")} value={<MoneyValue value={majorOf(line.credit)} />} inline />
                      </div>
                    </div>
                  ))}
                </Card>
              ) : (
                <EmptyState title={t("common.loading")} description={t("revenueRecognition.loadingEntry")} />
              ),
          },
        ]}
      />
    </div>
  );
}

function Figure({ label, value, inline }: { label: string; value: React.ReactNode; inline?: boolean }) {
  if (inline) {
    return (
      <div className="text-end">
        <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
        <div className="mt-[3px] text-[13px] font-bold text-ink">{value}</div>
      </div>
    );
  }
  return (
    <div className="border-b border-border p-[13px_15px] last:border-b-0">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[5px] text-[13.5px] font-bold text-ink">{value}</div>
    </div>
  );
}
