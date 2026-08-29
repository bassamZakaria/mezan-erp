import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  StatusPill,
  Card,
  Button,
  RowMenu,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { CreateDepreciationRunDTO, DepreciationRunDTO, DepreciationRunStatusDTO } from "@mezan/contracts";
import { ApiError, useBranches, useCreateDepreciationRun, useDepreciationRuns, usePostDepreciationRun } from "../data/hooks";
import { NumberField, SelectField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber } from "../lib/url-state";

/** الإهلاك (Depreciation Runs) — docs/archive/catalog/07 §"الإهلاك". List + detail + run-creation panel. */

const STATUS_KEY: Record<DepreciationRunStatusDTO, AppTranslationKey> = { draft: "depreciation.status.draft", posted: "depreciation.status.posted", cancelled: "depreciation.status.cancelled" };
const STATUS_TONE: Record<DepreciationRunStatusDTO, PillTone> = { draft: "neutral", posted: "success", cancelled: "danger" };
const PAGE_SIZES = [10, 25, 50, 100] as const;

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface RunDraft {
  year: number;
  month: number;
  branchId: string;
}

function blankDraft(): RunDraft {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, branchId: "" };
}

function formatPeriod(draft: RunDraft): string {
  return `${draft.year}-${String(draft.month).padStart(2, "0")}`;
}

/** Returns a catalogue KEY, so the caller decides the locale. */
function validateDraft(draft: RunDraft): AppTranslationKey | null {
  if (!Number.isInteger(draft.year) || draft.year < 2000 || draft.year > 2100) return "depreciation.yearInvalid";
  if (!Number.isInteger(draft.month) || draft.month < 1 || draft.month > 12) return "depreciation.monthInvalid";
  return null;
}

export function DepreciationRunsScreen() {
  const { t } = useAppTranslation();
  const query = useDepreciationRuns();
  const branchesQuery = useBranches();
  const createRun = useCreateDepreciationRun();
  const postRun = usePostDepreciationRun();

  const runs = query.data ?? EMPTY;
  const branches = branchesQuery.data ?? [];

  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<RunDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function branchName(branchId: string | null): string {
    if (branchId === null) return t("depreciation.allBranches");
    return branches.find((b) => b.id === branchId)?.name ?? branchId;
  }

  const filtered = useMemo(() => {
    if (statusFilter === "all") return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const totalCount = runs.length;
  const draftCount = runs.filter((r) => r.status === "draft").length;
  const postedCount = runs.filter((r) => r.status === "posted").length;

  const selected = selectedId ? runs.find((r) => r.id === selectedId) ?? null : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(t(error));
      return;
    }
    setFormError(null);
    const body: CreateDepreciationRunDTO = { period: formatPeriod(draft), branchId: draft.branchId.trim() === "" ? null : draft.branchId.trim() };
    try {
      await createRun.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("depreciation.theDepreciationRunCouldNot"));
    }
  }

  async function handlePost(run: DepreciationRunDTO) {
    if (postingId !== null) return;
    setPostingId(run.id);
    setPostError(null);
    try {
      await postRun.mutateAsync(run.id);
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : t("depreciation.theDepreciationRunCouldNot2"));
    } finally {
      setPostingId(null);
    }
  }

  const columns: DocumentListColumn<DepreciationRunDTO>[] = [
    { key: "period", header: t("common.period"), render: (r) => <span className="mz-num font-semibold text-ink">{r.period}</span> },
    { key: "branch", header: t("common.branch"), render: (r) => branchName(r.branchId) },
    { key: "lines", header: t("depreciation.assets"), align: "end", render: (r) => <span className="mz-num">{r.lines.length}</span> },
    { key: "total", header: t("depreciation.totalAmount"), align: "end", render: (r) => <MoneyDisplay value={toMajor(r.totalAmount)} /> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: totalCount },
    { key: "draft", label: t("docStatus.draft"), count: draftCount },
    { key: "posted", label: t("docStatus.posted"), count: postedCount },
    { key: "cancelled", label: t("docStatus.cancelled"), count: runs.filter((r) => r.status === "cancelled").length },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("depreciation.depreciationRunsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {postError ? (
        <Card className="mb-[18px] p-[14px_18px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {postError}
          </p>
        </Card>
      ) : null}
      <DocumentList<DepreciationRunDTO>
        title={t("depreciation.depreciation")}
        description={t("depreciation.periodicRunsThatComputeAnd")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("depreciation.runDepreciation")}
          </Button>
        }
        listKey="depreciation-runs"
        statsCollapsible
        stats={[
          { label: t("depreciation.totalRuns"), value: <span className="mz-num">{totalCount}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{draftCount}</span> },
          { label: t("docStatus.posted"), value: <span className="mz-num">{postedCount}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key);
          setPage(1);
        }}
        columns={columns}
        rows={pageRows}
        loading={branchesQuery.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        rowAction={(r) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setSelectedId(r.id) },
            ...(r.status === "draft"
              ? [{ key: "post", label: t("depreciation.post"), disabled: postingId === r.id, onSelect: () => void handlePost(r) }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: r.period })} />;
        }}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("depreciation.runs")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("depreciation.noDepreciationRunsYet")}
            description={t("depreciation.emptyBody")}
            action={{ label: t("depreciation.runDepreciation"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("depreciation.detailTitle", { period: selected.period }) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.period")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.period}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.branch")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId)}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("depreciation.created")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.createdAt}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("depreciation.posted")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.postedAt ?? "—"}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("depreciation.totalAmount")}</div>
              <MoneyDisplay value={toMajor(selected.totalAmount)} className="mt-[6px] text-[18px] font-bold" />
              {selected.journalEntryId ? (
                <div className="mz-num mt-[8px] text-[11.5px] text-ink-faint">{t("depreciation.journalEntry")} {selected.journalEntryId}</div>
              ) : null}
            </Card>
            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("depreciation.depreciationDetail")}</h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12.5px]">
                  <thead className="bg-surface-2 text-ink-faint">
                    <tr>
                      <th className="p-[9px_12px] text-start font-semibold">{t("depreciation.asset")}</th>
                      <th className="p-[9px_12px] text-end font-semibold">{t("common.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={line.assetId} className="border-t border-border">
                        <td className="mz-num p-[9px_12px] text-ink">{line.assetId}</td>
                        <td className="p-[9px_12px] text-end">
                          <MoneyDisplay value={toMajor(line.amount)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("depreciation.runDepreciation")} description={t("depreciation.depreciationRunDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <NumberField label={t("depreciation.year")} value={draft.year} onChange={(v) => setDraft((d) => ({ ...d, year: v }))} min={2000} max={2100} step={1} />
          <NumberField label={t("depreciation.month")} value={draft.month} onChange={(v) => setDraft((d) => ({ ...d, month: v }))} min={1} max={12} step={1} />
          <SelectField
            label={t("common.branch")}
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={[{ value: "", label: t("depreciation.allBranches") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("depreciation.run")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
