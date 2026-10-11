import { BranchGatedAction } from "../../../branch-restriction";
import { useBranchGate } from "../../../shell/useBranchGate";
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  DocumentList,
  EmptyState,
  EntityPicker,
  IconButton,
  RowMenu,
  SidePanel,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type EntityPickerOption,
  type RowMenuItem,
} from "@mezan/ui";
import { Money } from "@mezan/domain";
import { RecurringJournalFrequencyDTO, RecurringJournalTemplateStatusDTO } from "@mezan/contracts";
import {
  useAccounts,
  useAllRecurringJournalSkips,
  useBranches,
  useCostCenters,
  useCreateRecurringJournalTemplate,
  useCustomers,
  useDueDepreciationPeriods,
  useDueRecurringJournals,
  useGenerateDueRecurringJournals,
  usePartyControlAccounts,
  useRecurringJournalRuns,
  useRecurringJournalSkips,
  useRecurringJournalTemplates,
  useSetRecurringJournalTemplateStatus,
  useSkipRecurringJournalOccurrence,
  useSuppliers,
  useUpdateRecurringJournalTemplate,
  type DueRecurringJournalDTO,
  type RecurringJournalRunDTO,
  type RecurringJournalSkipDTO,
  type RecurringJournalTemplateDTO,
  type RecurringJournalTemplateLineDTO,
} from "../../../data/hooks";
import { SelectField, TextField, ToggleField } from "../../../settings/form-controls";
import { errorMessage } from "../../../lib/error-message";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { useEntityName } from "../../../lib/entity-names";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { ScreenTabs } from "../../ScreenTabs";

const PAGE_SIZE = 25;

/* -------------------------------------------------------------------- */
/* Line draft                                                            */
/* -------------------------------------------------------------------- */

interface LineDraft {
  key: string;
  accountId: string;
  memo: string;
  debit: string;
  credit: string;
  costCenterId: string;
  branchId: string;
  partyId: string;
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `rl${lineSeq}`, accountId: "", memo: "", debit: "", credit: "", costCenterId: "", branchId: "", partyId: "" };
}

function lineFromDto(line: RecurringJournalTemplateLineDTO): LineDraft {
  lineSeq += 1;
  return {
    key: `rl${lineSeq}`,
    accountId: line.accountId,
    memo: line.memo ?? "",
    debit: Money.fromMajor(line.debit).equals(Money.zero()) ? "" : Money.fromMajor(line.debit).toString(),
    credit: Money.fromMajor(line.credit).equals(Money.zero()) ? "" : Money.fromMajor(line.credit).toString(),
    costCenterId: line.costCenterId ?? "",
    branchId: line.branchId ?? "",
    partyId: line.partyId ?? "",
  };
}

const AMOUNT_TEXT = /^\d{1,15}(\.\d{1,6})?$/;
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
  const m = amountOf(text);
  return m !== null && !m.equals(Money.zero());
}

const FREQUENCY_OPTIONS = [
  RecurringJournalFrequencyDTO.Monthly,
  RecurringJournalFrequencyDTO.Quarterly,
  RecurringJournalFrequencyDTO.Yearly,
];

/* -------------------------------------------------------------------- */
/* Template form (SidePanel body)                                        */
/* -------------------------------------------------------------------- */

function TemplateForm({ editing, onClose }: { editing: RecurringJournalTemplateDTO | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const accounts = useAccounts().data ?? EMPTY;
  const costCenters = useCostCenters().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;
  const partyControls = usePartyControlAccounts().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;
  const suppliers = useSuppliers().data ?? EMPTY;
  const createTemplate = useCreateRecurringJournalTemplate();
  const updateTemplate = useUpdateRecurringJournalTemplate();

  const [nameAr, setNameAr] = useState(editing?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? "");
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [frequency, setFrequency] = useState<RecurringJournalFrequencyDTO>(editing?.frequency ?? RecurringJournalFrequencyDTO.Monthly);
  const [dayOfPeriod, setDayOfPeriod] = useState(String(editing?.dayOfPeriod ?? 1));
  const [yearlyMonth, setYearlyMonth] = useState(String(editing?.yearlyMonth ?? 1));
  const [startDate, setStartDate] = useState(editing?.startDate ?? todayIso());
  const [endDate, setEndDate] = useState(editing?.endDate ?? "");
  const [autoReverse, setAutoReverse] = useState(editing?.autoReverseNextPeriod ?? false);
  const [lines, setLines] = useState<LineDraft[]>(() => (editing ? editing.lines.map(lineFromDto) : [blankLine(), blankLine()]));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountOptions = useMemo(
    () => [{ value: "", label: t("journals.chooseAnAccount") }, ...accounts.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))],
    [accounts, nameOf, t],
  );
  const centerOptions = useMemo(
    () => [{ value: "", label: t("journals.noCostCenter") }, ...costCenters.map((c) => ({ value: c.id, label: `${c.code} — ${nameOf(c)}` }))],
    [costCenters, nameOf, t],
  );
  const branchOptions: EntityPickerOption[] = branches.filter((b) => b.active).map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }));
  const partyKindOf = useMemo(() => new Map(partyControls.map((row) => [row.accountId, row.partyKind])), [partyControls]);
  const customerOptions: EntityPickerOption[] = customers.map((c) => ({ id: c.id, label: `${c.code} — ${nameOf(c)}` }));
  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: `${s.code} — ${nameOf(s)}` }));

  const totalDebit = Money.sum(lines.map((l) => amountOrZero(l.debit)));
  const totalCredit = Money.sum(lines.map((l) => amountOrZero(l.credit)));
  const balanced = totalDebit.equals(totalCredit) && !totalDebit.equals(Money.zero());
  const allLinesValid = lines.every(
    (l) => l.accountId !== "" && amountOf(l.debit) !== null && amountOf(l.credit) !== null && isPositiveAmount(l.debit) !== isPositiveAmount(l.credit),
  );
  const missingParty = lines.some((l) => partyKindOf.has(l.accountId) && l.partyId === "");
  const canSave = balanced && allLinesValid && !missingParty && nameAr.trim() !== "" && memo.trim() !== "" && startDate !== "" && !busy;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const body = {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() === "" ? null : nameEn.trim(),
      memo: memo.trim(),
      frequency,
      dayOfPeriod: Number(dayOfPeriod),
      yearlyMonth: frequency === RecurringJournalFrequencyDTO.Yearly ? Number(yearlyMonth) : null,
      startDate,
      endDate: endDate.trim() === "" ? null : endDate.trim(),
      autoReverseNextPeriod: autoReverse,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: amountOrZero(l.debit).toString(),
        credit: amountOrZero(l.credit).toString(),
        memo: l.memo.trim() === "" ? null : l.memo.trim(),
        costCenterId: l.costCenterId === "" ? null : l.costCenterId,
        branchId: l.branchId === "" ? null : l.branchId,
        partyId: partyKindOf.has(l.accountId) && l.partyId ? l.partyId : null,
      })),
    };
    try {
      if (editing) await updateTemplate.mutateAsync({ id: editing.id, ...body });
      else await createTemplate.mutateAsync({ id: crypto.randomUUID(), ...body });
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("recurringJournals.templateCouldNotBeSaved")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <TextField label={t("recurringJournals.name")} value={nameAr} onChange={setNameAr} />
        <TextField label={`${t("recurringJournals.name")} EN`} value={nameEn} onChange={setNameEn} />
        <TextField label={t("recurringJournals.memo")} value={memo} onChange={setMemo} />
        <SelectField
          label={t("recurringJournals.frequency")}
          value={frequency}
          onChange={(v) => setFrequency(v as RecurringJournalFrequencyDTO)}
          options={FREQUENCY_OPTIONS.map((f) => ({ value: f, label: t(`recurringJournals.frequency.${f}`) }))}
        />
        <TextField label={t("recurringJournals.dayOfPeriod")} type="number" value={dayOfPeriod} onChange={setDayOfPeriod} />
        {frequency === RecurringJournalFrequencyDTO.Yearly ? (
          <SelectField
            label={t("recurringJournals.yearlyMonth")}
            value={yearlyMonth}
            onChange={setYearlyMonth}
            options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          />
        ) : null}
        <TextField label={t("recurringJournals.startDate")} type="date" value={startDate} onChange={setStartDate} />
        <TextField label={t("recurringJournals.endDate")} type="date" value={endDate} onChange={setEndDate} />
      </div>
      <ToggleField label={t("recurringJournals.autoReverse")} checked={autoReverse} onChange={setAutoReverse} />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.party")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.costCenter")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.branch")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                <th className="border-b border-border bg-surface-2 px-[10px] py-[8px]" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.key} className="border-b border-border last:border-b-0">
                  <td className="px-[10px] py-[6px]">
                    <Select size="sm" className="min-w-[160px]" aria-label={t("journals.lineAccount", { number: i + 1 })} value={line.accountId} onChange={(v) => updateLine(i, { accountId: v, partyId: "" })} options={accountOptions} />
                  </td>
                  <td className="px-[10px] py-[6px]">
                    {partyKindOf.has(line.accountId) ? (
                      <EntityPicker
                        className="min-w-[160px]"
                        ariaLabel={t("journals.partyLabel", { n: String(i + 1) })}
                        value={(partyKindOf.get(line.accountId) === "customer" ? customerOptions : supplierOptions).find((o) => o.id === line.partyId) ?? null}
                        onChange={(o) => updateLine(i, { partyId: o?.id ?? "" })}
                        options={partyKindOf.get(line.accountId) === "customer" ? customerOptions : supplierOptions}
                        placeholder={t(partyKindOf.get(line.accountId) === "customer" ? "journals.chooseCustomer" : "journals.chooseSupplier")}
                      />
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-[10px] py-[6px]">
                    <Select size="sm" className="min-w-[140px]" aria-label={t("journals.costCenterLabel", { n: String(i + 1) })} value={line.costCenterId} onChange={(v) => updateLine(i, { costCenterId: v })} options={centerOptions} />
                  </td>
                  <td className="px-[10px] py-[6px]">
                    <EntityPicker className="min-w-[140px]" value={branchOptions.find((o) => o.id === line.branchId) ?? null} onChange={(o) => updateLine(i, { branchId: o?.id ?? "" })} options={branchOptions} placeholder={t("journals.unattributedBranch")} />
                  </td>
                  <td className="px-[10px] py-[6px]">
                    <TextInput type="number" size="sm" numeric className="w-[100px] text-end" aria-label={t("journals.debitLabel", { n: String(i + 1) })} value={line.debit} min={0} onChange={(e) => updateLine(i, { debit: e.target.value, credit: "" })} />
                  </td>
                  <td className="px-[10px] py-[6px]">
                    <TextInput type="number" size="sm" numeric className="w-[100px] text-end" aria-label={t("journals.creditLabel", { n: String(i + 1) })} value={line.credit} min={0} onChange={(e) => updateLine(i, { credit: e.target.value, debit: "" })} />
                  </td>
                  <td className="px-[10px] py-[6px] text-center">
                    <IconButton aria-label={t("journals.removeLineLabel", { n: String(i + 1) })} disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                      ✕
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border p-[10px]">
          <Button size="sm" onClick={addLine}>
            {t("recurringJournals.addLine")}
          </Button>
        </div>
      </Card>

      {!balanced ? <p className="text-[12.5px] text-danger-ink">{t("recurringJournals.validation.balanced")}</p> : null}
      {missingParty ? <p className="text-[12.5px] text-danger-ink">{t("recurringJournals.validation.party")}</p> : null}

      <div className="flex justify-end gap-[10px]">
        <Button onClick={onClose}>{t("recurringJournals.cancel")}</Button>
        <Button variant="primary" disabled={!canSave} onClick={handleSubmit}>
          {t("recurringJournals.save")}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Templates tab                                                         */
/* -------------------------------------------------------------------- */

function TemplatesTab() {
  const { t } = useAppTranslation();
  const query = useRecurringJournalTemplates();
  const setStatus = useSetRecurringJournalTemplateStatus();
  const templates = query.data ?? EMPTY;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringJournalTemplateDTO | null>(null);
  const [page, setPage] = useState(1);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(templates.length / PAGE_SIZE));
  const pageRows = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(template: RecurringJournalTemplateDTO) {
    setEditing(template);
    setFormOpen(true);
  }

  async function toggleStatus(template: RecurringJournalTemplateDTO) {
    if (pendingId) return;
    setPendingId(template.id);
    setActionError(null);
    try {
      await setStatus.mutateAsync({
        id: template.id,
        status: template.status === RecurringJournalTemplateStatusDTO.Active ? RecurringJournalTemplateStatusDTO.Paused : RecurringJournalTemplateStatusDTO.Active,
      });
    } catch (err) {
      setActionError(errorMessage(err, t("recurringJournals.templateCouldNotBeSaved")));
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<RecurringJournalTemplateDTO>[] = [
    { key: "nameAr", header: t("recurringJournals.name"), render: (row) => <span className="font-semibold text-ink">{row.nameAr}</span> },
    { key: "frequency", header: t("recurringJournals.frequency"), render: (row) => t(`recurringJournals.frequency.${row.frequency}`) },
    { key: "dayOfPeriod", header: t("recurringJournals.dayOfPeriod"), render: (row) => <span className="mz-num">{row.dayOfPeriod}</span> },
    { key: "startDate", header: t("recurringJournals.startDate"), render: (row) => <span className="mz-num">{row.startDate}</span> },
    {
      key: "status",
      header: t("recurringJournals.status"),
      render: (row) => (
        <StatusPill
          label={t(`recurringJournals.status.${row.status}`)}
          tone={row.status === RecurringJournalTemplateStatusDTO.Active ? "success" : "neutral"}
        />
      ),
    },
  ];

  return (
    <div className="w-full">
      {actionError ? (
        <div role="alert" className="mb-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}
      <DocumentList<RecurringJournalTemplateDTO>
        title={t("recurringJournals.title")}
        description={t("recurringJournals.subtitle")}
        actions={<Button variant="primary" onClick={openCreate}>{t("recurringJournals.newTemplate")}</Button>}
        columns={columns}
        rows={pageRows}
        rowKey={(row) => row.id}
        loading={query.isLoading}
        loadFailed={query.isError}
        onRowClick={openEdit}
        rowAction={(row) => {
          const items: RowMenuItem[] = [
            { key: "edit", label: t("common.edit"), onSelect: () => openEdit(row) },
            {
              key: "toggle",
              label: t(row.status === RecurringJournalTemplateStatusDTO.Active ? "recurringJournals.pause" : "recurringJournals.resume"),
              disabled: pendingId === row.id,
              onSelect: () => void toggleStatus(row),
            },
          ];
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: row.nameAr })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        emptyState={<EmptyState title={t("recurringJournals.noTemplates")} description={t("recurringJournals.subtitle")} action={{ label: t("recurringJournals.newTemplate"), onClick: openCreate }} />}
      />
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t("recurringJournals.editTemplate") : t("recurringJournals.newTemplate")}>
        <TemplateForm editing={editing} onClose={() => setFormOpen(false)} />
      </SidePanel>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Due tab                                                                */
/* -------------------------------------------------------------------- */

/** One template's due periods, each individually skippable, plus the periods already skipped for it. */
function TemplateDueCard({ entry }: { entry: DueRecurringJournalDTO }) {
  const { t } = useAppTranslation();
  const skipsQuery = useRecurringJournalSkips(entry.templateId);
  const skipMutation = useSkipRecurringJournalOccurrence();
  const [skipTarget, setSkipTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const skipped = skipsQuery.data ?? EMPTY;

  function openSkip(period: string) {
    setSkipTarget(period);
    setNote("");
    setError(null);
  }

  async function confirmSkip() {
    if (!skipTarget) return;
    try {
      await skipMutation.mutateAsync({ templateId: entry.templateId, period: skipTarget, note: note.trim() === "" ? null : note.trim() });
      setSkipTarget(null);
    } catch (err) {
      setError(errorMessage(err, t("recurringJournals.skipFailed")));
    }
  }

  return (
    <div className="p-[14px_16px]">
      <div className="font-semibold text-ink">{entry.nameAr}</div>
      <div className="mt-[6px] flex flex-wrap gap-[8px]">
        {entry.periods.map((period) => (
          <span key={period} className="inline-flex items-center gap-[6px] rounded-full border border-border bg-surface-2 px-[10px] py-[4px] text-[11.5px]">
            <span className="mz-num text-ink">{period}</span>
            <button
              type="button"
              className="text-brand underline"
              onClick={() => openSkip(period)}
            >
              {t("recurringJournals.skip")}
            </button>
          </span>
        ))}
      </div>
      {skipped.length > 0 ? (
        <div className="mt-[8px] text-[11.5px] text-ink-muted">
          {t("recurringJournals.skippedPeriods")}: <span className="mz-num">{skipped.map((s) => s.period).join("، ")}</span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-[8px] rounded-md border border-danger bg-danger-soft px-[10px] py-[8px] text-[11.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <ConfirmDialog
        open={skipTarget !== null}
        title={t("recurringJournals.skipConfirmTitle")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("recurringJournals.skipConfirmBody", { period: skipTarget ?? "", name: entry.nameAr })}</p>
            <TextInput
              aria-label={t("recurringJournals.skipNote")}
              placeholder={t("recurringJournals.skipNote")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        }
        confirmLabel={t("recurringJournals.skip")}
        confirmDisabled={skipMutation.isPending}
        onConfirm={() => void confirmSkip()}
        onCancel={() => setSkipTarget(null)}
      />
    </div>
  );
}

function DueTab() {
  const { t } = useAppTranslation();
  const query = useDueRecurringJournals();
  const generate = useGenerateDueRecurringJournals();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const due = query.data?.due ?? EMPTY;

  async function handleGenerate() {
    setConfirmOpen(false);
    setError(null);
    setResultMessage(null);
    try {
      const result = await generate.mutateAsync({});
      setResultMessage(
        result.generated.length > 0
          ? t("recurringJournals.generatedCount", { count: String(result.generated.length) })
          : t("recurringJournals.generatedNone"),
      );
      // One bad template must never hide behind a silent partial success —
      // the sweep still generates everything else, but a failed period stays
      // due and needs a human to look at the template that produced it.
      if (result.failed.length > 0) {
        setError(
          result.failed.map((f) => t("recurringJournals.generateFailedFor", { name: f.templateNameAr, period: f.period, message: f.message })).join(" — "),
        );
      }
    } catch (err) {
      setError(errorMessage(err, t("recurringJournals.generateFailed")));
    }
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="rounded-lg border border-border bg-surface-2 p-[12px_14px] text-[12.5px] text-ink-muted">
        {t("recurringJournals.cloudScheduleNote")}
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {resultMessage ? (
        <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
          {resultMessage}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-bold text-ink">{t("recurringJournals.tab.due")}</h2>
        <Button variant="primary" disabled={generate.isPending} onClick={() => setConfirmOpen(true)}>
          {generate.isPending ? t("recurringJournals.generating") : t("recurringJournals.generateDue")}
        </Button>
      </div>
      {query.isLoading ? null : due.length === 0 ? (
        <EmptyState title={t("recurringJournals.noDue")} description={t("recurringJournals.subtitle")} />
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {due.map((entry) => (
            <TemplateDueCard key={entry.templateId} entry={entry} />
          ))}
        </Card>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={t("recurringJournals.generateDue")}
        consequence={t("recurringJournals.subtitle")}
        confirmLabel={t("recurringJournals.generateDue")}
        onConfirm={() => void handleGenerate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* History tab                                                           */
/* -------------------------------------------------------------------- */

enum RecurringJournalHistoryKind {
  Generated = "generated",
  Skipped = "skipped",
}

interface RecurringJournalHistoryRow {
  readonly key: string;
  readonly kind: RecurringJournalHistoryKind;
  readonly templateId: string;
  readonly period: string;
  readonly at: string;
  readonly run: RecurringJournalRunDTO | null;
  readonly skip: RecurringJournalSkipDTO | null;
}

const HISTORY_SKIPS_LIMIT = 200;

function HistoryTab() {
  const { t } = useAppTranslation();
  const runsQuery = useRecurringJournalRuns();
  const skipsQuery = useAllRecurringJournalSkips(HISTORY_SKIPS_LIMIT, useBranchGate().allows(BranchGatedAction.RecurringSkips));
  const templatesQuery = useRecurringJournalTemplates();
  const nav = useNavigation();
  const [page, setPage] = useState(1);
  const runs = runsQuery.data ?? EMPTY;
  const skips = skipsQuery.data ?? EMPTY;
  const nameById = useMemo(() => new Map((templatesQuery.data ?? []).map((tpl) => [tpl.id, tpl.nameAr])), [templatesQuery.data]);

  const rows: RecurringJournalHistoryRow[] = useMemo(() => {
    const generated = runs.map((run) => ({
      key: `run:${run.id}`,
      kind: RecurringJournalHistoryKind.Generated,
      templateId: run.templateId,
      period: run.period,
      at: run.generatedAt,
      run,
      skip: null,
    }));
    const skipped = skips.map((skip) => ({
      key: `skip:${skip.id}`,
      kind: RecurringJournalHistoryKind.Skipped,
      templateId: skip.templateId,
      period: skip.period,
      at: skip.skippedAt,
      run: null,
      skip,
    }));
    return [...generated, ...skipped].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [runs, skips]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: DocumentListColumn<RecurringJournalHistoryRow>[] = [
    { key: "templateId", header: t("recurringJournals.name"), render: (row) => nameById.get(row.templateId) ?? row.templateId },
    { key: "period", header: t("recurringJournals.period"), render: (row) => <span className="mz-num">{row.period}</span> },
    {
      key: "kind",
      header: t("recurringJournals.kind"),
      render: (row) => (
        <StatusPill
          label={t(`recurringJournals.kind.${row.kind}`)}
          tone={row.kind === RecurringJournalHistoryKind.Generated ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "journalEntryId",
      header: t("recurringJournals.entry"),
      render: (row) => {
        const run = row.run;
        if (!run) return <span className="text-ink-faint">{row.skip?.note ?? "—"}</span>;
        return (
          <button type="button" className="text-brand underline" onClick={() => nav.openScreenAt("journals", [run.journalEntryNo ?? run.journalEntryId])}>
            {run.journalEntryNo ?? run.journalEntryId}
          </button>
        );
      },
    },
    {
      key: "reversalJournalEntryId",
      header: t("recurringJournals.reversalEntry"),
      render: (row) => {
        const run = row.run;
        if (!run?.reversalJournalEntryId) return <span className="text-ink-faint">—</span>;
        return (
          <button type="button" className="text-brand underline" onClick={() => nav.openScreenAt("journals", [run.reversalJournalEntryNo ?? run.reversalJournalEntryId ?? ""])}>
            {run.reversalJournalEntryNo ?? run.reversalJournalEntryId}
          </button>
        );
      },
    },
    { key: "at", header: t("recurringJournals.generatedAt"), render: (row) => <span className="mz-num text-ink-muted">{row.at.slice(0, 10)}</span> },
  ];

  return (
    <DocumentList<RecurringJournalHistoryRow>
      title={t("recurringJournals.tab.history")}
      columns={columns}
      rows={pageRows}
      rowKey={(row) => row.key}
      loading={runsQuery.isLoading || skipsQuery.isLoading}
      loadFailed={runsQuery.isError || skipsQuery.isError}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={<EmptyState title={t("recurringJournals.noHistory")} description={t("recurringJournals.subtitle")} />}
    />
  );
}

/* -------------------------------------------------------------------- */
/* Depreciation-due tab                                                  */
/* -------------------------------------------------------------------- */

function DepreciationDueTab() {
  const { t } = useAppTranslation();
  const query = useDueDepreciationPeriods();
  const nav = useNavigation();
  const periods = query.data?.periods ?? EMPTY;

  if (query.isLoading) return null;
  if (periods.length === 0) {
    return <EmptyState title={t("recurringJournals.noDueDepreciation")} description={t("recurringJournals.subtitle")} />;
  }
  return (
    <Card className="divide-y divide-border overflow-hidden">
      {periods.map((period) => (
        <div key={period} className="flex items-center justify-between p-[14px_16px]">
          <span className="mz-num font-semibold text-ink">{period}</span>
          <Button size="sm" onClick={() => nav.navigate("depreciation-runs")}>
            {t("recurringJournals.goToDepreciationRuns")}
          </Button>
        </div>
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------------- */
/* Screen                                                                 */
/* -------------------------------------------------------------------- */

export function RecurringJournalsScreen() {
  const { t } = useAppTranslation();
  const branchGate = useBranchGate();
  return (
    <ScreenTabs
      ariaLabel={t("recurringJournals.title")}
      tabs={[
        { key: "templates", label: t("recurringJournals.tab.templates"), render: () => <TemplatesTab /> },
        ...(branchGate.allows(BranchGatedAction.RecurringDue) ? [{ key: "due", label: t("recurringJournals.tab.due"), render: () => <DueTab /> }] : []),
        { key: "history", label: t("recurringJournals.tab.history"), render: () => <HistoryTab /> },
        ...(branchGate.allows(BranchGatedAction.RecurringDepreciationDue)
          ? [{ key: "depreciation", label: t("recurringJournals.tab.depreciation"), render: () => <DepreciationDueTab /> }]
          : []),
      ]}
    />
  );
}
