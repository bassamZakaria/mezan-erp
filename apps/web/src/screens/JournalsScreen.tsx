import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  EmptyState,
  EntityPicker,
  IconButton,
  Money as MoneyDisplay,
  RowMenu,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentStatusStep,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { Money } from "@mezan/domain";
import type { CostCategoryDTO, CreateGlJournalEntryDTO, JournalEntryStatusDTO, JournalSourceModuleDTO, ProjectDTO } from "@mezan/contracts";
import {
  useAccounts,
  useCreateJournalEntry,
  useJournalEntries,
  useJournalEntryCounts,
  useJournalEntryStats,
  useProjects,
  useReverseJournalEntry,
  type JournalEntryDTO,
  type JournalEntryListFilter,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { errorMessage } from "../lib/error-message";
import { useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { useEntityName } from "../lib/entity-names";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";

/** القيود المحاسبية (Journal Entries) — docs/archive/catalog/04. List + detail + create, on the real GL posting engine (/gl). */

type JournalDoc = JournalEntryDTO;

const STATUS_KEY: Record<JournalEntryStatusDTO, AppTranslationKey> = {
  draft: "journals.status.draft",
  pending: "journals.status.pending",
  posted: "journals.status.posted",
  reversed: "journals.status.reversed",
};
const STATUS_TONE: Record<JournalEntryStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  reversed: "danger",
};

const MODULE_KEY: Record<JournalSourceModuleDTO, AppTranslationKey> = {
  sales: "journals.module.sales",
  purchases: "journals.module.purchases",
  inventory: "journals.module.inventory",
  treasury: "journals.module.treasury",
  manufacturing: "journals.module.manufacturing",
  payroll: "journals.module.payroll",
  assets: "journals.module.assets",
  manual: "journals.module.manual",
  unknown: "journals.module.unknown",
};

/** Keys, not copy — the stepper's labels are built with the translator at render. */
const STEPPER_KEYS = [
  { key: "draft", labelKey: "journals.status.draft" },
  { key: "pending", labelKey: "journals.status.pending" },
  { key: "posted", labelKey: "journals.status.posted" },
  { key: "reversed", labelKey: "journals.status.reversed" },
] as const;

function toMajor(value: string): number {
  return Number(value);
}

function docTotals(doc: JournalDoc): { debit: number; credit: number } {
  return {
    debit: sumMajor(doc.lines.map((l) => l.debit)),
    credit: sumMajor(doc.lines.map((l) => l.credit)),
  };
}

/* -------------------------------------------------------------------- */
/* Create form line state                                               */
/* -------------------------------------------------------------------- */

interface LineDraft {
  key: string;
  accountId: string;
  memo: string;
  debit: number;
  credit: number;
  projectId: string;
  costCategory: CostCategoryDTO | "";
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, accountId: "", memo: "", debit: 0, credit: 0, projectId: "", costCategory: "" };
}

/** Projects still open for new spend/income — a finished or cancelled project cannot take new lines. */
const OPEN_PROJECT_STATUSES = new Set<ProjectDTO["status"]>(["planned", "active", "on_hold"]);

const COST_CATEGORY_VALUES: readonly CostCategoryDTO[] = ["materials", "labour", "equipment", "subcontract", "indirect"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function JournalsScreen() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const accountsQuery = useAccounts();
  const projectsQuery = useProjects();
  const createJournalEntry = useCreateJournalEntry();
  const reverseJournalEntry = useReverseJournalEntry();
  const accounts = accountsQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // The open entry lives in the URL like every other document screen, so the
  // shell's breadcrumb (and the «رجوع» that sits beside it) can lead out of it.
  const subPage = useSubPage();
  const [selectedId] = subPage.segments;
  // The query is in the URL; see lib/url-state.ts for what belongs there. A
  // dated range over the ledger is exactly the thing an accountant sends to a
  // colleague — "look at these entries" is a link now, not instructions.
  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | JournalEntryStatusDTO,
    (next: string) => void,
  ];
  const [moduleFilter, setModuleFilter] = useUrlParam("module") as [
    "" | JournalSourceModuleDTO,
    (next: string) => void,
  ];
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  // One filter for the rows, the status chips and the KPI strip (R1.1): the
  // screen used to derive all three from one client-side fetch, so the header
  // numbers stayed at the grand total no matter which status tab was active.
  const filter = useMemo<JournalEntryListFilter>(
    () => ({
      status: statusFilter,
      sourceModule: moduleFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, moduleFilter, fromDate, toDate, search],
  );
  const query = useJournalEntries(filter);
  const counts = useJournalEntryCounts(filter).data ?? {};
  const stats = useJournalEntryStats(filter).data ?? {};

  const accountLabel = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, `${a.code} — ${nameOf(a)}`]));
    return (id: string) => map.get(id) ?? id;
  }, [accounts, nameOf]);

  const projectLabel = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, `${p.code} — ${nameOf(p)}`]));
    return (id: string | null | undefined) => (id ? (map.get(id) ?? id) : null);
  }, [projects, nameOf]);

  const documents = query.data ?? [];

  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const pageRows = documents.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) + (moduleFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const selected =
    selectedId && selectedId !== "new"
      ? documents.find((d) => d.id === selectedId || d.entryNo === selectedId) ?? null
      : null;

  const columns: DocumentListColumn<JournalDoc>[] = [
    {
      key: "entryNo",
      header: t("journals.entryNumber"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.entryNo ?? "—"}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "memo", header: t("journals.description"), render: (d) => <span className="text-ink">{d.memo}</span> },
    {
      key: "sourceModule",
      header: t("journals.col.sourceModule"),
      render: (d) => (
        <div className="flex flex-col gap-[2px]">
          <StatusPill label={t(MODULE_KEY[d.sourceModule])} tone={d.sourceModule === "manual" ? "neutral" : "info"} />
          {d.sourceDocNumber ? <span className="mz-num text-[11px] text-ink-faint">{d.sourceDocNumber}</span> : null}
        </div>
      ),
    },
    { key: "debit", header: t("journals.totalDebit"), align: "end", render: (d) => <MoneyDisplay value={docTotals(d).debit} /> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={t(STATUS_KEY[d.status])} tone={STATUS_TONE[d.status]} /> },
  ];

  function openDetail(id: string) {
    setRowError(null);
    const doc = documents.find((d) => d.id === id);
    subPage.open(doc?.entryNo ?? id);
  }

  async function reverseEntry(doc: JournalDoc) {
    if (pendingId) return;
    setPendingId(doc.id);
    setRowError(null);
    try {
      await reverseJournalEntry.mutateAsync({ id: doc.id });
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
    } finally {
      setPendingId(null);
    }
  }

  if (selectedId && selectedId !== "new" && !selected && !query.isLoading) {
    return (
      <div className="w-full p-[24px]">
        <EmptyState
          title={t("journals.notFoundTitle")}
          description={t("journals.notFoundBody", { id: selectedId })}
          action={{ label: t("common.back"), onClick: subPage.close }}
        />
      </div>
    );
  }

  if (selectedId === "new") {
    return (
      <CreateJournalView
        onPost={(body) => createJournalEntry.mutateAsync(body)}
        accountOptions={accounts.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))}
        onDone={subPage.close}
      />
    );
  }

  if (selected) {
    const totals = docTotals(selected);
    const balanced = Math.abs(totals.debit - totals.credit) < 0.005;
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.entryNo ?? t("journals.journalEntry")}
          statusLabel={t(STATUS_KEY[selected.status])}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={selected.status} tone={selected.status === "reversed" ? "danger" : "brand"} />}
          actions={
            <>
              {selected.status === "posted" ? (
                <Button
                  variant="danger-outline"
                  disabled={pendingId === selected.id}
                  onClick={() => void reverseEntry(selected)}
                >
                  {t("journals.reverseEntry")}
                </Button>
              ) : null}
            </>
          }
          summary={[
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("journals.source"), value: t("journals.manual") },
            { label: t("journals.lines"), value: <span className="mz-num">{selected.lines.length}</span> },
            { label: t("journals.totalDebit"), value: <MoneyDisplay value={totals.debit} /> },
            { label: t("journals.totalCredit"), value: <MoneyDisplay value={totals.credit} /> },
            { label: t("journals.balance"), value: balanced ? t("journals.balanced") : t("journals.outOfBalance"), valueTone: balanced ? "success" : "danger" },
          ]}
          tabs={[
            {
              key: "lines",
              label: t("journals.entryLines"),
              content: (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.description")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.project")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.costCategory")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{l.memo ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{projectLabel(l.projectId) ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{l.costCategory ? t(`costCategory.${l.costCategory}` as AppTranslationKey) : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.debit) !== 0 ? <MoneyDisplay value={toMajor(l.debit)} /> : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.credit) !== 0 ? <MoneyDisplay value={toMajor(l.credit)} /> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-surface-2 font-bold">
                          <td className="px-[15px] py-[11px]" colSpan={4}>
                            <StatusPill label={balanced ? t("journals.balanced") : t("journals.outOfBalance")} tone={balanced ? "success" : "danger"} />
                          </td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={totals.debit} /></td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={totals.credit} /></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              ),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("journals.journalEntriesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<JournalDoc>
        title={t("journals.journalEntries")}
        description={t("journals.theJournalRegisterDraftAwaiting")}
        actions={
          <>
            <Button onClick={() => window.print()}>{t("journals.print")}</Button>
            <Button variant="primary" onClick={() => subPage.open("new")}>
              {t("journals.newEntry")}
            </Button>
          </>
        }
        listKey="journals"
        statsCollapsible
        stats={[
          { label: t("journals.totalEntries"), value: <span className="mz-num">{Number(stats.count ?? 0)}</span> },
          { label: t("docStatus.posted"), value: <span className="mz-num">{Number(stats.posted ?? 0)}</span> },
          { label: t("docStatus.reversed"), value: <span className="mz-num">{Number(stats.reversed ?? 0)}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{Number(stats.draft ?? 0)}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: counts.all ?? 0 },
          { key: "draft", label: t("docStatus.draft"), count: counts.draft ?? 0 },
          { key: "posted", label: t("docStatus.posted"), count: counts.posted ?? 0 },
          { key: "reversed", label: t("docStatus.reversed"), count: counts.reversed ?? 0 },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | JournalEntryStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("journals.searchByEntryNumber")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-3">
            <SelectField
              label={t("journals.filter.module")}
              value={moduleFilter}
              onChange={(value) => {
                setModuleFilter(value as "" | JournalSourceModuleDTO);
                setPage(1);
              }}
              options={[
                { value: "", label: t("journals.filter.allModules") },
                ...(Object.keys(MODULE_KEY) as JournalSourceModuleDTO[]).map((key) => ({
                  value: key,
                  label: t(MODULE_KEY[key]),
                })),
              ]}
            />
            <TextField
              label={t("journals.filter.fromDate")}
              value={fromDate}
              onChange={(value) => {
                setFromDate(value);
                setPage(1);
              }}
              type="date"
            />
            <TextField
              label={t("journals.filter.toDate")}
              value={toDate}
              onChange={(value) => {
                setToDate(value);
                setPage(1);
              }}
              type="date"
            />
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        rowAction={(d) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => openDetail(d.id) },
            ...(d.status === "posted"
              ? [{ key: "reverse", label: t("journals.reverseEntry"), tone: "danger" as const, disabled: pendingId === d.id, onSelect: () => void reverseEntry(d) }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: d.entryNo ?? d.id })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{documents.length}</span> {t("journals.entries")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("journals.noMatchingEntries")}
            description={t("journals.emptyBody")}
            action={{ label: t("journals.newEntry"), onClick: () => subPage.open("new") }}
          />
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateJournalView({
  onPost,
  accountOptions,
  onDone,
}: {
  onPost: (body: CreateGlJournalEntryDTO) => Promise<unknown>;
  accountOptions: { value: string; label: string }[];
  onDone: () => void;
}) {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const projectsQuery = useProjects();
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectOptions: EntityPickerOption[] = (projectsQuery.data ?? [])
    .filter((p) => OPEN_PROJECT_STATUSES.has(p.status))
    .map((p) => ({ id: p.id, label: `${p.code} — ${nameOf(p)}` }));
  const costCategoryOptions = [
    { value: "", label: t("common.none") },
    ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(`costCategory.${c}` as AppTranslationKey) })),
  ];

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  // Exact balance check via Money (no float drift) — the same invariant the domain enforces.
  const balanced = Money.fromMajor(String(totalDebit)).equals(Money.fromMajor(String(totalCredit))) && totalDebit > 0;
  const allLinesValid = lines.every((l) => l.accountId !== "" && (l.debit > 0) !== (l.credit > 0));
  const canPost = balanced && allLinesValid && memo.trim() !== "" && !busy;

  const options = useMemo(() => [{ value: "", label: t("journals.chooseAnAccount") }, ...accountOptions], [accountOptions, t]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handlePost() {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await onPost({
        id: crypto.randomUUID(),
        date,
        memo: memo.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: String(l.debit || 0),
          credit: String(l.credit || 0),
          memo: l.memo.trim() === "" ? null : l.memo.trim(),
          projectId: l.projectId || null,
          costCategory: l.projectId && l.costCategory ? l.costCategory : null,
        })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("journals.theEntryCouldNotBe"));
    } finally {
      setBusy(false);
    }
  }

  const difference = Math.abs(totalDebit - totalCredit);

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("journals.createAJournalEntry")}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            {t("journals.postEntry")}
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-2">
            <TextField label={t("journals.entryDate")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label={t("journals.description2")} value={memo} onChange={setMemo} placeholder={t("journals.describeTheEntry")} />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.description")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.project")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.costCategory")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <Select
                          size="sm"
                          className="min-w-[160px]"
                          aria-label={t("journals.lineAccount", { number: i + 1 })}
                          value={line.accountId}
                          onChange={(value) => updateLine(i, { accountId: value })}
                          options={options}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          size="sm"
                          className="min-w-[120px]"
                          aria-label={t("journals.memoLabel", { n: String(i + 1) })}
                          value={line.memo}
                          onChange={(e) => updateLine(i, { memo: e.target.value })}
                          placeholder={t("journals.describeTheLine")}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <EntityPicker
                          className="min-w-[160px]"
                          value={projectOptions.find((o) => o.id === line.projectId) ?? null}
                          onChange={(o) => updateLine(i, { projectId: o?.id ?? "", costCategory: o ? line.costCategory : "" })}
                          options={projectOptions}
                          placeholder={t("common.noProject")}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <Select
                          size="sm"
                          className="min-w-[130px]"
                          aria-label={t("common.costCategory")}
                          disabled={!line.projectId}
                          value={line.costCategory}
                          onChange={(value) => updateLine(i, { costCategory: value as CostCategoryDTO | "" })}
                          options={costCategoryOptions}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("journals.debitLabel", { n: String(i + 1) })}
                          value={line.debit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { debit: e.target.valueAsNumber || 0, credit: 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("journals.creditLabel", { n: String(i + 1) })}
                          value={line.credit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { credit: e.target.valueAsNumber || 0, debit: 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={t("journals.removeLineLabel", { n: String(i + 1) })} disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                          ✕
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border p-[12px]">
              <Button size="sm" onClick={addLine}>
                {t("journals.addLine")}
              </Button>
            </div>
          </Card>
        </div>

        {/* Live balance + effects panel */}
        <div className="flex flex-col gap-[16px]">
          <Card className="p-[16px_18px]">
            <h3 className="mb-[12px] font-display text-[14px] font-bold text-ink">{t("journals.balance")}</h3>
            <dl className="flex flex-col gap-[8px] text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("journals.totalDebit")}</dt>
                <dd><MoneyDisplay value={totalDebit} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("journals.totalCredit")}</dt>
                <dd><MoneyDisplay value={totalCredit} /></dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-[8px]">
                <dt className="text-ink-muted">{t("journals.difference")}</dt>
                <dd className={difference === 0 ? "text-success-ink" : "text-danger-ink"}>
                  <MoneyDisplay value={difference} />
                </dd>
              </div>
            </dl>
            <div className="mt-[12px]">
              <StatusPill label={balanced ? t("journals.balanced") : t("journals.outOfBalance")} tone={balanced ? "success" : "danger"} />
            </div>
          </Card>

          <div
            className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
            style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
          >
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{t("journals.whatThisDocumentDoes")}</h3>
            <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("journals.postsAJournalEntryOf")} {lines.length} {t("journals.lines2")}
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("journals.updatesAccountBalancesInThe")}
              </li>
              {!balanced ? (
                <li className="flex items-start gap-[8px] text-danger-ink">
                  <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-danger" />
                  {t("journals.theEntryIsOutOf")}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
