import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Chip, DocumentList, EmptyState, SidePanel, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { LeaveAccrualBatchDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useLeaveAccrualBatches, useRunLeaveAccrual } from "../data/hooks";
import { formatDays } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";
import { useUrlNumber } from "../lib/url-state";

/** استحقاقات الإجازات (Leave Accrual Batches) — docs/archive/catalog/06 §"استحقاقات الإجازات". Manual and scheduled runs that credit entitlement across every eligible employee; a period already run is never credited twice. */

const RUN_TYPE_FILTERS: Array<{ key: string; labelKey: AppTranslationKey }> = [
  { key: "", labelKey: "leaveAccrual.filterAll" },
  { key: "scheduled", labelKey: "leaveAccrual.filterScheduled" },
  { key: "manual", labelKey: "leaveAccrual.filterManual" },
];

interface RunDraft {
  runDate: string;
  frequency: "monthly" | "annual";
  notes: string;
}

function today(): string {
  return todayIso();
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function LeaveAccrualBatchesScreen() {
  const { t } = useAppTranslation();
  const [runType, setRunType] = useState("");
  const query = useLeaveAccrualBatches(runType || null);
  const runAccrual = useRunLeaveAccrual();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<RunDraft>({ runDate: today(), frequency: "monthly", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const batches = query.data ?? [];
  const pageCount = Math.max(1, Math.ceil(batches.length / pageSize));
  const pageRows = batches.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  function openForm() {
    setDraft({ runDate: today(), frequency: "monthly", notes: "" });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.runDate.trim() === "") {
      setFormError(t("leaveAccrual.aRunDateIsRequired"));
      return;
    }
    setFormError(null);
    try {
      const result = await runAccrual.mutateAsync({
        runDate: draft.runDate.trim(),
        frequency: draft.frequency,
        runType: "manual",
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setBanner(
        result.created
          ? t("leaveAccrual.batchRan", { number: result.batch.number, period: result.batch.periodKey })
          : t("leaveAccrual.batchAlreadyRan", { period: result.batch.periodKey, number: result.batch.number }),
      );
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("leaveAccrual.theAccrualBatchCouldNot"));
    }
  }

  const columns: DocumentListColumn<LeaveAccrualBatchDTO>[] = [
    { key: "number", header: t("leaveAccrual.batchNumber"), render: (b) => <span className="mz-num font-semibold text-ink">{b.number}</span> },
    { key: "runDate", header: t("leaveAccrual.runDate"), render: (b) => <span className="mz-num text-ink">{b.runDate}</span> },
    { key: "period", header: t("common.period"), render: (b) => <span className="mz-num text-ink">{b.periodKey}</span> },
    {
      key: "runType",
      header: t("leaveAccrual.runType"),
      render: (b) => <StatusPill label={b.runType === "manual" ? t("leaveAccrual.manual") : t("leaveAccrual.scheduled")} tone={b.runType === "manual" ? "neutral" : "info"} />,
    },
    { key: "notes", header: t("common.notes"), render: (b) => <span className="text-ink-muted">{b.notes ?? "—"}</span> },
    { key: "employees", header: t("leaveAccrual.employees"), align: "end", render: (b) => <span className="mz-num text-ink">{b.employeeCount}</span> },
    { key: "totalDays", header: t("leaveAccrual.totalDays"), align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.totalDays)}</span> },
    { key: "runBy", header: t("leaveAccrual.runBy"), render: (b) => <span className="text-ink-muted">{b.runBy ?? "—"}</span> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("leaveAccrual.accrualBatchesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {banner ? (
        <div role="status" className="mb-[14px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
          {banner}
        </div>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[6px]" role="radiogroup" aria-label={t("leaveAccrual.runType")}>
        {RUN_TYPE_FILTERS.map((filter) => (
          <Chip
            key={filter.key}
            type="button"
            active={runType === filter.key}
            onClick={() => {
              setRunType(filter.key);
              setPage(1);
            }}
          >
            {t(filter.labelKey)}
          </Chip>
        ))}
      </div>

      <DocumentList<LeaveAccrualBatchDTO>
        title={t("leaveAccrual.leaveAccruals")}
        description={t("leaveAccrual.theScheduledAndManualAccrual")}
        actions={
          <Button variant="primary" onClick={openForm}>
            {t("leaveAccrual.runAccrualNow")}
          </Button>
        }
        listKey="leave-accrual-batches"
        statsCollapsible
        stats={[
          { label: t("leaveAccrual.batches"), value: <span className="mz-num">{batches.length}</span> },
          {
            label: t("leaveAccrual.totalDays"),
            value: <span className="mz-num">{formatDays(String(sumMajor(batches.map((b) => b.totalDays))))}</span>,
          },
        ]}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(b) => b.id}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{batches.length}</span> {t("leaveAccrual.batches2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("leaveAccrual.noAccrualBatchesYetScheduled")}
            description={t("leaveAccrual.emptyBody")}
            action={{ label: t("leaveAccrual.runAccrualNow"), onClick: openForm }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("leaveAccrual.runAccrualNow")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <p className="text-[12.5px] text-ink-muted">
            {t("leaveAccrual.runALeaveAccrualBy")}
          </p>
          <TextField label={t("leaveAccrual.runDate2")} value={draft.runDate} onChange={(v) => setDraft((d) => ({ ...d, runDate: v }))} placeholder="YYYY-MM-DD" />
          <SelectField
            label={t("leaveAccrual.accrualFrequency")}
            value={draft.frequency}
            onChange={(v) => setDraft((d) => ({ ...d, frequency: v as "monthly" | "annual" }))}
            options={[
              { value: "monthly", label: t("accrualFrequency.monthly") },
              { value: "annual", label: t("accrualFrequency.annual") },
            ]}
            hint={t("leaveAccrual.onlyPoliciesWithTheSame")}
          />
          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("leaveAccrual.run")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
