import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  ConfirmDialog,
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
import { RecurringJournalFrequencyDTO } from "@mezan/contracts";
import type { CostCategoryDTO, CreateGlJournalEntryDTO, JournalEntryStatusDTO, JournalSourceModuleDTO, ProjectDTO, UpdateGlJournalEntryDTO } from "@mezan/contracts";
import {
  useAccounts,
  useCostCenters,
  useCreateJournalEntry,
  useDeleteJournalEntry,
  useJournalEntries,
  useJournalEntry,
  useJournalEntryCounts,
  useJournalEntryStats,
  useBranches,
  useCustomers,
  usePartyControlAccounts,
  useProjects,
  useReverseJournalEntry,
  useSaveJournalEntryAsRecurringTemplate,
  useSuppliers,
  useUpdateJournalEntry,
  type JournalEntryDTO,
  type JournalEntryListFilter,
} from "../data/hooks";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { errorMessage } from "../lib/error-message";
import { JournalEntryPrintPage } from "../print/documents";
import { useNameSubPage, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { useEntityName } from "../lib/entity-names";
import { majorOf, scaledOf, sumMajor } from "../lib/money";
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
  contracting: "journals.module.contracting",
  accounting: "journals.module.accounting",
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
  /** Exact decimal text as typed. Never a float — `Money.fromMajor(String(300.29999999999995))` throws in render (B-1). */
  debit: string;
  credit: string;
  costCenterId: string;
  projectId: string;
  costCategory: CostCategoryDTO | "";
  branchId: string;
  partyId: string;
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return {
    key: `l${lineSeq}`,
    accountId: "",
    memo: "",
    debit: "",
    credit: "",
    costCenterId: "",
    projectId: "",
    costCategory: "",
    branchId: "",
    partyId: "",
  };
}

const AMOUNT_TEXT = /^\d{1,15}(\.\d{1,6})?$/;

/** A partially-typed amount ("", "12.") is zero, not a crash; anything else is rejected before it reaches `Money`. */
function amountOf(text: string): Money | null {
  const trimmed = text.trim();
  if (trimmed === "") return Money.zero();
  if (!AMOUNT_TEXT.test(trimmed)) return null;
  return Money.fromMajor(trimmed);
}

function amountOrZero(text: string): Money {
  return amountOf(text) ?? Money.zero();
}

function isPositiveAmount(text: string): boolean {
  const money = amountOf(text);
  return money !== null && !money.equals(Money.zero());
}

/** Projects still open for new spend/income — a finished or cancelled project cannot take new lines. */
const OPEN_PROJECT_STATUSES = new Set<ProjectDTO["status"]>(["planned", "active", "on_hold"]);

const COST_CATEGORY_VALUES: readonly CostCategoryDTO[] = ["materials", "labour", "equipment", "subcontract", "indirect"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function JournalsScreen() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const accountsQuery = useAccounts();
  const costCentersQuery = useCostCenters();
  const projectsQuery = useProjects();
  const branchesQuery = useBranches();
  const createJournalEntry = useCreateJournalEntry();
  const updateJournalEntry = useUpdateJournalEntry();
  const deleteJournalEntry = useDeleteJournalEntry();
  const reverseJournalEntry = useReverseJournalEntry();
  const accounts = accountsQuery.data ?? EMPTY;
  const costCenters = costCentersQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;
  const branches = branchesQuery.data ?? EMPTY;

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JournalDoc | null>(null);
  const [reverseTarget, setReverseTarget] = useState<JournalDoc | null>(null);
  const [reverseDate, setReverseDate] = useState(todayIso());
  const [templateTarget, setTemplateTarget] = useState<JournalDoc | null>(null);
  const [templateNameAr, setTemplateNameAr] = useState("");
  const [templateFrequency, setTemplateFrequency] = useState<RecurringJournalFrequencyDTO>(RecurringJournalFrequencyDTO.Monthly);
  const [templateStartDate, setTemplateStartDate] = useState(todayIso());
  const [templateAutoReverse, setTemplateAutoReverse] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const saveAsTemplate = useSaveJournalEntryAsRecurringTemplate();
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
  // The ROWS query carries the page; the chips and the KPI strip must not, or
  // they would report the page instead of the filtered set (Q-9). The register
  // used to fetch every entry ever posted and slice it here.
  const query = useJournalEntries({ ...filter, page, pageSize });
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

  const branchLabel = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, `${b.code} — ${b.name}`]));
    return (id: string | null | undefined) => (id ? (map.get(id) ?? id) : null);
  }, [branches]);

  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const partyLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersQuery.data ?? []) map.set(c.id, `${c.code} — ${nameOf(c)}`);
    for (const s of suppliersQuery.data ?? []) map.set(s.id, `${s.code} — ${nameOf(s)}`);
    return (id: string | null | undefined) => (id ? (map.get(id) ?? id) : null);
  }, [customersQuery.data, suppliersQuery.data, nameOf]);

  // What the server returned IS the page; `counts.all` is the filtered total
  // the pager needs, since the rows on screen no longer are it.
  const pageRows = query.data ?? [];
  const totalRows = counts.all ?? pageRows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) + (moduleFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const onPage =
    selectedId && selectedId !== "new"
      ? pageRows.find((d) => d.id === selectedId || d.entryNo === selectedId) ?? null
      : null;
  const needsFetch = Boolean(selectedId) && selectedId !== "new" && onPage === null && !query.isLoading;
  const single = useJournalEntry(needsFetch && selectedId ? selectedId : null);
  const selected = onPage ?? (needsFetch ? (single.data ?? null) : null);
  useNameSubPage(selectedId && selectedId !== "new" ? selectedId : null, selected ? (selected.entryNo ?? t("docStatus.draft")) : null);

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
    const doc = pageRows.find((d) => d.id === id);
    subPage.open(doc?.entryNo ?? id);
  }

  function openReverseConfirm(doc: JournalDoc) {
    if (pendingId) return;
    setReverseDate(todayIso());
    setReverseTarget(doc);
  }

  async function reverseEntry(doc: JournalDoc, date: string) {
    if (pendingId) return;
    setPendingId(doc.id);
    setRowError(null);
    try {
      await reverseJournalEntry.mutateAsync({ id: doc.id, body: { date } });
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
    } finally {
      setPendingId(null);
    }
  }

  function openSaveAsTemplate(doc: JournalDoc) {
    if (pendingId) return;
    setTemplateNameAr(doc.memo);
    setTemplateFrequency(RecurringJournalFrequencyDTO.Monthly);
    setTemplateStartDate(todayIso());
    setTemplateAutoReverse(false);
    setTemplateError(null);
    setTemplateTarget(doc);
  }

  async function submitSaveAsTemplate() {
    const doc = templateTarget;
    if (!doc || templateNameAr.trim() === "") return;
    setTemplateError(null);
    try {
      await saveAsTemplate.mutateAsync({
        entryId: doc.id,
        id: crypto.randomUUID(),
        nameAr: templateNameAr.trim(),
        nameEn: null,
        frequency: templateFrequency,
        dayOfPeriod: Number(doc.date.slice(8, 10)),
        yearlyMonth: templateFrequency === RecurringJournalFrequencyDTO.Yearly ? Number(doc.date.slice(5, 7)) : null,
        startDate: templateStartDate,
        endDate: null,
        autoReverseNextPeriod: templateAutoReverse,
      });
      setTemplateTarget(null);
    } catch (err) {
      setTemplateError(errorMessage(err, t("recurringJournals.templateCouldNotBeSaved")));
    }
  }

  async function deleteEntry(doc: JournalDoc) {
    if (pendingId) return;
    setPendingId(doc.id);
    setRowError(null);
    try {
      await deleteJournalEntry.mutateAsync({ id: doc.id });
      if (selectedId) subPage.close();
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
    } finally {
      setPendingId(null);
    }
  }

  if (selectedId && selectedId !== "new" && !selected && !query.isLoading && !single.isLoading) {
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

  const accountOptions = accounts.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }));
  const costCenterOptions = costCenters
    .filter((c) => c.status === "active")
    .map((c) => ({ value: c.id, label: `${c.code} — ${nameOf(c)}` }));

  if (selectedId === "new") {
    return (
      <CreateJournalView
        onPost={(body) => createJournalEntry.mutateAsync({ id: crypto.randomUUID(), ...body })}
        accountOptions={accountOptions}
        costCenterOptions={costCenterOptions}
        onDone={subPage.close}
      />
    );
  }

  // `#/money/journals/<id>/edit` — a DRAFT only; a posted/reversed entry never offers it (D226).
  if (selected && selected.status === "draft" && subPage.segments[1] === "edit") {
    return (
      <CreateJournalView
        mode="edit"
        initial={selected}
        onPost={(body) => updateJournalEntry.mutateAsync({ id: selected.id, ...body })}
        accountOptions={accountOptions}
        costCenterOptions={costCenterOptions}
        onDone={() => subPage.open(selected.id)}
      />
    );
  }

  // `#/money/journals/<entryNo>/print` — the entry as a document (P-6).
  if (selected && subPage.segments[1] === "print") return <JournalEntryPrintPage entry={selected} />;

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
              {selected.status === "posted" && selected.reversibleFromJournal !== false ? (
                <Button
                  variant="danger-outline"
                  disabled={pendingId === selected.id}
                  onClick={() => openReverseConfirm(selected)}
                >
                  {t("journals.reverseEntry")}
                </Button>
              ) : null}
              {selected.status === "draft" ? (
                <>
                  <Button
                    variant="danger-outline"
                    disabled={pendingId === selected.id}
                    onClick={() => setDeleteTarget(selected)}
                  >
                    {t("journals.deleteEntry")}
                  </Button>
                  <Button disabled={pendingId === selected.id} onClick={() => subPage.open(selected.id, "edit")}>
                    {t("journals.editEntry")}
                  </Button>
                </>
              ) : null}
              <Button onClick={() => subPage.open(selected.entryNo ?? selected.id, "print")}>{t("journals.print")}</Button>
              <Button disabled={pendingId === selected.id} onClick={() => openSaveAsTemplate(selected)}>
                {t("recurringJournals.saveAsTemplate")}
              </Button>
            </>
          }
          summary={[
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("journals.source"), value: t(MODULE_KEY[selected.sourceModule]) },
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
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.branch")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.project")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.costCategory")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">
                              {accountLabel(l.accountId)}
                              {l.partyId ? <span className="block text-[12px] text-ink-muted">{partyLabel(l.partyId)}</span> : null}
                            </td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{l.memo ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{branchLabel(l.branchId) ?? t("journals.unattributedBranch")}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{projectLabel(l.projectId) ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{l.costCategory ? t(`costCategory.${l.costCategory}` as AppTranslationKey) : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.debit) !== 0 ? <MoneyDisplay value={toMajor(l.debit)} /> : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.credit) !== 0 ? <MoneyDisplay value={toMajor(l.credit)} /> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-surface-2 font-bold">
                          <td className="px-[15px] py-[11px]" colSpan={5}>
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
        <ConfirmDialog
          open={deleteTarget?.id === selected.id}
          title={t("journals.deleteConfirmTitle")}
          consequence={t("journals.deleteConfirmBody")}
          confirmLabel={t("journals.deleteEntry")}
          tone="danger"
          onConfirm={() => {
            setDeleteTarget(null);
            void deleteEntry(selected);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
        <ConfirmDialog
          open={reverseTarget?.id === selected.id}
          title={t("journals.reverseConfirmTitle")}
          consequence={
            <div className="flex flex-col gap-[10px]">
              <p>{t("journals.reverseConfirmBody")}</p>
              <TextField label={t("journals.reversalDate")} value={reverseDate} onChange={setReverseDate} type="date" />
            </div>
          }
          confirmLabel={t("journals.reverseEntry")}
          tone="danger"
          onConfirm={() => {
            const target = reverseTarget;
            setReverseTarget(null);
            if (target) void reverseEntry(target, reverseDate);
          }}
          onCancel={() => setReverseTarget(null)}
        />
        <ConfirmDialog
          open={templateTarget?.id === selected.id}
          title={t("recurringJournals.saveAsTemplateTitle")}
          consequence={
            <div className="flex flex-col gap-[10px]">
              <p>{t("recurringJournals.saveAsTemplateBody")}</p>
              <TextField label={t("recurringJournals.name")} value={templateNameAr} onChange={setTemplateNameAr} />
              <SelectField
                label={t("recurringJournals.frequency")}
                value={templateFrequency}
                onChange={(v) => setTemplateFrequency(v as RecurringJournalFrequencyDTO)}
                options={[
                  { value: RecurringJournalFrequencyDTO.Monthly, label: t("recurringJournals.frequency.monthly") },
                  { value: RecurringJournalFrequencyDTO.Quarterly, label: t("recurringJournals.frequency.quarterly") },
                  { value: RecurringJournalFrequencyDTO.Yearly, label: t("recurringJournals.frequency.yearly") },
                ]}
              />
              <TextField label={t("recurringJournals.startDate")} value={templateStartDate} onChange={setTemplateStartDate} type="date" />
              <ToggleField label={t("recurringJournals.autoReverse")} checked={templateAutoReverse} onChange={setTemplateAutoReverse} />
              {templateError ? <p className="text-[12.5px] text-danger-ink">{templateError}</p> : null}
            </div>
          }
          confirmLabel={t("recurringJournals.save")}
          confirmDisabled={templateNameAr.trim() === "" || saveAsTemplate.isPending}
          onConfirm={() => void submitSaveAsTemplate()}
          onCancel={() => setTemplateTarget(null)}
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
            {/*
              NOT `window.print()`. It printed the browser's view of the
              register — chrome, filters, the paging widget — instead of a
              document. A journal entry prints as a document, from its own
              page; the register itself exports (P-6).
            */}
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
            // The row menu's own generic danger-tone confirmation handles this
            // one (RowMenu.tsx `select()`), so the reversal is dated today
            // (D270) and posts immediately on confirm; the detail page's
            // dedicated button opens the date-picking dialog below instead,
            // since embedding a live date field in the row menu's frozen
            // `pending` snapshot would not stay editable.
            ...(d.status === "posted" && d.reversibleFromJournal !== false
              ? [{ key: "reverse", label: t("journals.reverseEntry"), tone: "danger" as const, disabled: pendingId === d.id, onSelect: () => void reverseEntry(d, todayIso()) }]
              : []),
            ...(d.status === "draft"
              ? [
                  { key: "edit", label: t("journals.editEntry"), disabled: pendingId === d.id, onSelect: () => subPage.open(d.id, "edit") },
                  { key: "delete", label: t("journals.deleteEntry"), tone: "danger" as const, disabled: pendingId === d.id, onSelect: () => deleteEntry(d) },
                ]
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{totalRows}</span> {t("journals.entries")}
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

/** What a create/edit submit sends — an `id` accompanies it only when creating (D226). */
interface JournalFormPayload {
  readonly date: string;
  readonly memo: string;
  readonly lines: CreateGlJournalEntryDTO["lines"];
}

/** The decimal wire string trimmed for editing, never touched by a float — "" means zero, matching {@link blankLine}. */
function amountText(value: string): string {
  if (scaledOf(value) === 0n) return "";
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

function linesFromEntry(entry: JournalDoc): LineDraft[] {
  return entry.lines.map((l) => {
    lineSeq += 1;
    return {
      key: `l${lineSeq}`,
      accountId: l.accountId,
      memo: l.memo ?? "",
      debit: amountText(l.debit),
      credit: amountText(l.credit),
      costCenterId: l.costCenterId ?? "",
      projectId: l.projectId ?? "",
      costCategory: (l.costCategory ?? "") as CostCategoryDTO | "",
      branchId: l.branchId ?? "",
      partyId: l.partyId ?? "",
    };
  });
}

function CreateJournalView({
  mode = "create",
  initial,
  onPost,
  accountOptions,
  costCenterOptions,
  onDone,
}: {
  /** "edit" only for a DRAFT entry (D226) — a posted/reversed entry is corrected by reversal, never edited. */
  mode?: "create" | "edit";
  initial?: JournalDoc;
  onPost: (body: JournalFormPayload) => Promise<unknown>;
  accountOptions: { value: string; label: string }[];
  costCenterOptions: { value: string; label: string }[];
  onDone: () => void;
}) {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const projectsQuery = useProjects();
  const branchesQuery = useBranches();
  const partyControlsQuery = usePartyControlAccounts();
  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const [date, setDate] = useState(initial?.date ?? todayIso());
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => (initial ? linesFromEntry(initial) : [blankLine(), blankLine()]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const projectOptions: EntityPickerOption[] = (projectsQuery.data ?? [])
    .filter((p) => OPEN_PROJECT_STATUSES.has(p.status))
    .map((p) => ({ id: p.id, label: `${p.code} — ${nameOf(p)}` }));
  const branchOptions: EntityPickerOption[] = (branchesQuery.data ?? [])
    .filter((b) => b.active)
    .map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }));
  const partyKindOf = useMemo(
    () => new Map((partyControlsQuery.data ?? []).map((row) => [row.accountId, row.partyKind])),
    [partyControlsQuery.data],
  );
  const customerOptions: EntityPickerOption[] = (customersQuery.data ?? []).map((c) => ({ id: c.id, label: `${c.code} — ${nameOf(c)}` }));
  const supplierOptions: EntityPickerOption[] = (suppliersQuery.data ?? []).map((s) => ({ id: s.id, label: `${s.code} — ${nameOf(s)}` }));
  const costCategoryOptions = [
    { value: "", label: t("common.none") },
    ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(`costCategory.${c}` as AppTranslationKey) })),
  ];

  // Exact balance check via Money (no float drift) — the same invariant the domain enforces.
  const totalDebit = Money.sum(lines.map((l) => amountOrZero(l.debit)));
  const totalCredit = Money.sum(lines.map((l) => amountOrZero(l.credit)));
  const balanced = totalDebit.equals(totalCredit) && !totalDebit.equals(Money.zero());
  const allLinesValid = lines.every(
    (l) =>
      l.accountId !== "" &&
      amountOf(l.debit) !== null &&
      amountOf(l.credit) !== null &&
      isPositiveAmount(l.debit) !== isPositiveAmount(l.credit),
  );
  const missingParty = lines.some((l) => partyKindOf.has(l.accountId) && l.partyId === "");
  const canPost = balanced && allLinesValid && !missingParty && memo.trim() !== "" && !busy;

  const options = useMemo(() => [{ value: "", label: t("journals.chooseAnAccount") }, ...accountOptions], [accountOptions, t]);
  const centerOptions = useMemo(
    () => [{ value: "", label: t("journals.noCostCenter") }, ...costCenterOptions],
    [costCenterOptions, t],
  );

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
        date,
        memo: memo.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: amountOrZero(l.debit).toString(),
          credit: amountOrZero(l.credit).toString(),
          memo: l.memo.trim() === "" ? null : l.memo.trim(),
          costCenterId: l.costCenterId === "" ? null : l.costCenterId,
          projectId: l.projectId || null,
          costCategory: l.projectId && l.costCategory ? l.costCategory : null,
          branchId: l.branchId || null,
          partyId: partyKindOf.has(l.accountId) && l.partyId ? l.partyId : null,
        })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(mode === "edit" ? "journals.theEntryCouldNotBeSaved" : "journals.theEntryCouldNotBe"));
    } finally {
      setBusy(false);
    }
  }

  const debitMajor = majorOf(totalDebit.toString());
  const creditMajor = majorOf(totalCredit.toString());
  const difference = Math.abs(majorOf(totalDebit.add(totalCredit.negate()).toString()));

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">
            {t(mode === "edit" ? "journals.editJournalEntry" : "journals.createAJournalEntry")}
          </h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            {t(mode === "edit" ? "journals.saveChanges" : "journals.postEntry")}
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
              <table className="w-full min-w-[1220px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.party")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.description")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.costCenter")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.branch")}</th>
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
                          onChange={(value) => updateLine(i, { accountId: value, partyId: "" })}
                          options={options}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        {partyKindOf.has(line.accountId) ? (
                          <EntityPicker
                            className="min-w-[170px]"
                            ariaLabel={t("journals.partyLabel", { n: String(i + 1) })}
                            value={
                              (partyKindOf.get(line.accountId) === "customer" ? customerOptions : supplierOptions).find(
                                (o) => o.id === line.partyId,
                              ) ?? null
                            }
                            onChange={(o) => updateLine(i, { partyId: o?.id ?? "" })}
                            options={partyKindOf.get(line.accountId) === "customer" ? customerOptions : supplierOptions}
                            placeholder={t(partyKindOf.get(line.accountId) === "customer" ? "journals.chooseCustomer" : "journals.chooseSupplier")}
                          />
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
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
                        <Select
                          size="sm"
                          className="min-w-[150px]"
                          aria-label={t("journals.costCenterLabel", { n: String(i + 1) })}
                          value={line.costCenterId}
                          onChange={(value) => updateLine(i, { costCenterId: value })}
                          options={centerOptions}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <EntityPicker
                          className="min-w-[150px]"
                          value={branchOptions.find((o) => o.id === line.branchId) ?? null}
                          onChange={(o) => updateLine(i, { branchId: o?.id ?? "" })}
                          options={branchOptions}
                          placeholder={t("journals.unattributedBranch")}
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
                          value={line.debit}
                          min={0}
                          onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("journals.creditLabel", { n: String(i + 1) })}
                          value={line.credit}
                          min={0}
                          onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })}
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
                <dd><MoneyDisplay value={debitMajor} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("journals.totalCredit")}</dt>
                <dd><MoneyDisplay value={creditMajor} /></dd>
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
              {missingParty ? (
                <li className="flex items-start gap-[8px] text-danger-ink">
                  <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-danger" />
                  {t("journals.partyRequired")}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
