import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { BANK_STATEMENT_STATUS_DEFINITIONS, getBankStatementStatusLabel, parseCsv } from "@mezan/domain";
import type { BankStatementDTO, BankStatementStatusDTO, StatementDateFormatDTO, StatementLineDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import {
  useAutoMatchStatement,
  useBankStatement,
  useBankStatements,
  useFinalizeBankStatement,
  useImportBankStatement,
  useMatchStatementLine,
  useStatementColumnMapping,
  useTreasuryAccounts,
  useUnmatchStatementLine,
} from "../data/hooks";

/**
 * تسوية كشوف البنك — Bank Statement Reconciliation (docs/catalog/04, route
 * `/treasury/bank-reconciliation`). Real data only: the list, the CSV import
 * with its per-account persisted column mapping, and every match/unmatch/
 * finalize action go through `/bank-statements`.
 *
 * The CSV file is read in the browser and its TEXT posted to the import
 * endpoint — the header row is parsed locally only to populate the column
 * mapping selects; the authoritative parse happens server-side with the same
 * `parseCsv` the domain owns.
 */

const STATUS_TONE: Record<BankStatementStatusDTO, PillTone> = {
  imported: "neutral",
  in_progress: "warning",
  completed: "success",
};

const DATE_FORMATS: StatementDateFormatDTO[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function BankReconciliationScreen() {
  const [statusFilter, setStatusFilter] = useState<"all" | BankStatementStatusDTO>("all");
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [openStatementId, setOpenStatementId] = useState<string | null>(null);

  const query = useBankStatements({
    status: statusFilter === "all" ? undefined : statusFilter,
    treasuryAccountId: treasuryAccountId === "" ? undefined : treasuryAccountId,
    fromDate: fromDate === "" ? undefined : fromDate,
    toDate: toDate === "" ? undefined : toDate,
  });
  const statements = useMemo(() => query.data ?? [], [query.data]);

  const treasuryQuery = useTreasuryAccounts();
  const bankAccounts = useMemo(
    () => (treasuryQuery.data ?? []).filter((t) => t.type === "bank" && t.status === "active"),
    [treasuryQuery.data],
  );
  const accountName = useMemo(() => {
    const map = new Map((treasuryQuery.data ?? []).map((t) => [t.id, t.name]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryQuery.data]);

  const detail = useBankStatement(openStatementId);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return statements;
    return statements.filter(
      (s) =>
        accountName(s.treasuryAccountId).toLowerCase().includes(q) ||
        (s.statementNumber ?? "").toLowerCase().includes(q) ||
        `${s.periodStart} ${s.periodEnd}`.includes(q),
    );
  }, [statements, search, accountName]);

  const counts = useMemo(() => {
    const c = { all: statements.length, imported: 0, in_progress: 0, completed: 0 };
    for (const s of statements) c[s.status] += 1;
    return c;
  }, [statements]);

  /**
   * The list endpoint returns statements without their lines, so the overall
   * match rate is only known for the statement currently open in the detail
   * panel — showing a fabricated aggregate instead would be worse than an
   * honest per-statement "—".
   */
  const openMatchRate = detail.data?.matchSummary.matchRate ?? 0;

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    ...BANK_STATEMENT_STATUS_DEFINITIONS.map((d) => ({ key: d.code, label: d.labelAr, count: counts[d.code] })),
  ];

  const columns: DocumentListColumn<BankStatementDTO>[] = [
    {
      key: "account",
      header: "الحساب",
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{accountName(s.treasuryAccountId)}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{s.statementNumber ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "period",
      header: "الفترة",
      render: (s) => (
        <span className="mz-num text-ink-muted">
          {s.periodStart} — {s.periodEnd}
        </span>
      ),
    },
    { key: "opening", header: "الرصيد الافتتاحي", align: "end", render: (s) => <MoneyDisplay value={Number(s.openingBalance)} /> },
    { key: "closing", header: "الرصيد الختامي", align: "end", render: (s) => <MoneyDisplay value={Number(s.closingBalance)} /> },
    {
      key: "matchRate",
      header: "نسبة المطابقة",
      align: "end",
      render: (s) => (
        <span className="mz-num text-ink-muted">{s.id === openStatementId ? formatPercent(openMatchRate) : "—"}</span>
      ),
    },
    { key: "status", header: "الحالة", render: (s) => <StatusPill label={getBankStatementStatusLabel(s.status)} tone={STATUS_TONE[s.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (s) => (
        <Button size="sm" variant="ghost" onClick={() => setOpenStatementId(s.id)}>
          فتح التسوية
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<BankStatementDTO>
        eyebrow="Treasury · Bank Reconciliation"
        title="تسوية كشوف البنك"
        description="استيراد كشوف البنك ومطابقتها مع معاملات النظام"
        actions={
          <Button variant="primary" onClick={() => setImportOpen(true)}>
            استيراد كشف بنك
          </Button>
        }
        stats={[
          { label: "إجمالي الكشوف", value: <span className="mz-num">{counts.all}</span> },
          { label: "قيد التسوية", value: <span className="mz-num">{counts.in_progress}</span> },
          { label: "منتهية", value: <span className="mz-num">{counts.completed}</span> },
          { label: "نسبة المطابقة", value: <span className="mz-num">{formatPercent(openMatchRate)}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | BankStatementStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالحساب أو المرجع أو الفترة..."
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[220px]">
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">حساب الخزينة</div>
              <EntityPicker
                value={bankAccounts.map((a) => ({ id: a.id, label: a.name })).find((o) => o.id === treasuryAccountId) ?? null}
                onChange={(o) => setTreasuryAccountId(o?.id ?? "")}
                options={bankAccounts.map((a) => ({ id: a.id, label: a.name }))}
                placeholder="جميع الحسابات"
                emptyMessage="لا توجد حسابات بنكية"
              />
            </div>
            <div className="w-[150px]">
              <TextField label="من" value={fromDate} onChange={setFromDate} placeholder="YYYY-MM-DD" />
            </div>
            <div className="w-[150px]">
              <TextField label="إلى" value={toDate} onChange={setToDate} placeholder="YYYY-MM-DD" />
            </div>
          </div>
        }
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        onRowClick={(s) => setOpenStatementId(s.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{rows.length}</span> من <span className="mz-num">{counts.all}</span> كشف
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : query.isError ? (query.error?.message ?? "تعذّر تحميل كشوف البنك.") : "لا توجد كشوف بنك بعد"}
          </div>
        }
      />

      <ImportStatementDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(id) => setOpenStatementId(id)} />

      <StatementMatchingPanel statementId={openStatementId} onClose={() => setOpenStatementId(null)} accountName={accountName} />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* استيراد كشف بنك — the import dialog with its column-mapping section    */
/* -------------------------------------------------------------------- */

interface MappingDraft {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  debitColumn: string;
  creditColumn: string;
  referenceColumn: string;
  dateFormat: StatementDateFormatDTO;
}

const BLANK_MAPPING: MappingDraft = {
  dateColumn: "",
  descriptionColumn: "",
  amountColumn: "",
  debitColumn: "",
  creditColumn: "",
  referenceColumn: "",
  dateFormat: "YYYY-MM-DD",
};

function ImportStatementDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (statementId: string) => void;
}) {
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [fileName, setFileName] = useState("");
  const [rawCsv, setRawCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [closingBalance, setClosingBalance] = useState("");
  const [statementNumber, setStatementNumber] = useState("");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mapping, setMapping] = useState<MappingDraft>(BLANK_MAPPING);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const treasuryQuery = useTreasuryAccounts();
  const bankAccounts = useMemo(
    () => (treasuryQuery.data ?? []).filter((t) => t.type === "bank" && t.status === "active"),
    [treasuryQuery.data],
  );
  const bankOptions: EntityPickerOption[] = bankAccounts.map((a) => ({ id: a.id, label: `${a.name} (${a.code})` }));

  const savedMapping = useStatementColumnMapping(treasuryAccountId === "" ? null : treasuryAccountId);
  const importStatement = useImportBankStatement();

  // Prefill from the account's saved mapping ("يحفظ التعيين لكل حساب") so a
  // repeat import of the same bank's format needs no re-mapping.
  const savedMappingData = savedMapping.data;
  useEffect(() => {
    if (!savedMappingData) return;
    setMapping({
      dateColumn: savedMappingData.dateColumn,
      descriptionColumn: savedMappingData.descriptionColumn,
      amountColumn: savedMappingData.amountColumn ?? "",
      debitColumn: savedMappingData.debitColumn ?? "",
      creditColumn: savedMappingData.creditColumn ?? "",
      referenceColumn: savedMappingData.referenceColumn ?? "",
      dateFormat: savedMappingData.dateFormat,
    });
  }, [savedMappingData]);

  function reset() {
    setTreasuryAccountId("");
    setFileName("");
    setRawCsv("");
    setHeaders([]);
    setPeriodStart("");
    setPeriodEnd("");
    setOpeningBalance("");
    setClosingBalance("");
    setStatementNumber("");
    setMappingOpen(false);
    setMapping(BLANK_MAPPING);
    setError(null);
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    const text = await file.text();
    setRawCsv(text);
    try {
      setHeaders([...parseCsv(text).headers]);
    } catch (err) {
      setHeaders([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const hasFile = rawCsv !== "" && headers.length > 0;
  const mappingComplete =
    mapping.dateColumn !== "" &&
    mapping.descriptionColumn !== "" &&
    (mapping.amountColumn !== "" || (mapping.debitColumn !== "" && mapping.creditColumn !== ""));

  const canImport =
    treasuryAccountId !== "" &&
    hasFile &&
    periodStart !== "" &&
    periodEnd !== "" &&
    openingBalance !== "" &&
    closingBalance !== "" &&
    mappingComplete &&
    !importStatement.isPending;

  async function submit() {
    if (!canImport) return;
    setError(null);
    try {
      const result = await importStatement.mutateAsync({
        treasuryAccountId,
        rawCsv,
        mapping: {
          dateColumn: mapping.dateColumn,
          descriptionColumn: mapping.descriptionColumn,
          amountColumn: mapping.amountColumn === "" ? null : mapping.amountColumn,
          debitColumn: mapping.debitColumn === "" ? null : mapping.debitColumn,
          creditColumn: mapping.creditColumn === "" ? null : mapping.creditColumn,
          referenceColumn: mapping.referenceColumn === "" ? null : mapping.referenceColumn,
          dateFormat: mapping.dateFormat,
        },
        periodStart,
        periodEnd,
        openingBalance,
        closingBalance,
        statementNumber: statementNumber.trim() === "" ? null : statementNumber.trim(),
      });
      onImported(result.id);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const columnOptions = [{ value: "", label: "— بدون —" }, ...headers.map((h) => ({ value: h, label: h }))];

  return (
    <SidePanel open={open} onClose={onClose} title="استيراد كشف بنك">
      <div className="flex flex-col gap-4 p-5">
        <div>
          <div className="mb-[6px] text-[12.5px] font-semibold text-ink">حساب الخزينة *</div>
          <EntityPicker
            value={bankOptions.find((o) => o.id === treasuryAccountId) ?? null}
            onChange={(o) => setTreasuryAccountId(o?.id ?? "")}
            options={bankOptions}
            placeholder="اختر حسابا بنكيا"
            emptyMessage="لا توجد حسابات بنكية"
          />
        </div>

        <SelectField label="المصدر *" value="csv" onChange={() => undefined} options={[{ value: "csv", label: "ملف CSV" }]} />

        <div>
          <div className="mb-[6px] text-[12.5px] font-semibold text-ink">ملف الكشف *</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="ملف الكشف"
            onChange={onFileChange}
            className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-[12.5px] text-ink"
          />
          {fileName !== "" ? <div className="mt-[6px] text-[11.5px] text-ink-muted">{fileName}</div> : null}
        </div>

        <TextField label="بداية الفترة *" value={periodStart} onChange={setPeriodStart} placeholder="YYYY-MM-DD" />
        <TextField label="نهاية الفترة *" value={periodEnd} onChange={setPeriodEnd} placeholder="YYYY-MM-DD" />
        <TextField label="الرصيد الافتتاحي *" value={openingBalance} onChange={setOpeningBalance} placeholder="0.00" />
        <TextField label="الرصيد الختامي *" value={closingBalance} onChange={setClosingBalance} placeholder="0.00" />
        <TextField label="رقم الكشف" value={statementNumber} onChange={setStatementNumber} />

        <Card className="flex flex-col gap-[12px] p-[14px]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[13px] font-bold text-ink">تعيين الأعمدة *</h3>
            <Button size="sm" disabled={!hasFile} onClick={() => setMappingOpen((v) => !v)}>
              تعيين الأعمدة
            </Button>
          </div>
          <p className="text-[11.5px] text-ink-muted">
            اختر ملف CSV أولاً ثم عين الأعمدة على الحقول القياسية. يحفظ التعيين لكل حساب
          </p>

          {hasFile && mappingOpen ? (
            <div className="flex flex-col gap-[10px]">
              <SelectField
                label="عمود التاريخ *"
                value={mapping.dateColumn}
                onChange={(v) => setMapping((m) => ({ ...m, dateColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label="عمود البيان *"
                value={mapping.descriptionColumn}
                onChange={(v) => setMapping((m) => ({ ...m, descriptionColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label="عمود المبلغ (بإشارة)"
                value={mapping.amountColumn}
                onChange={(v) => setMapping((m) => ({ ...m, amountColumn: v }))}
                options={columnOptions}
                hint="استخدم إما عمود مبلغ واحد بإشارة، أو عمودَي مدين ودائن"
              />
              <SelectField
                label="عمود المدين"
                value={mapping.debitColumn}
                onChange={(v) => setMapping((m) => ({ ...m, debitColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label="عمود الدائن"
                value={mapping.creditColumn}
                onChange={(v) => setMapping((m) => ({ ...m, creditColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label="عمود المرجع"
                value={mapping.referenceColumn}
                onChange={(v) => setMapping((m) => ({ ...m, referenceColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label="صيغة التاريخ"
                value={mapping.dateFormat}
                onChange={(v) => setMapping((m) => ({ ...m, dateFormat: v as StatementDateFormatDTO }))}
                options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              />
            </div>
          ) : null}
        </Card>

        {error ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

        <div className="flex gap-2 pt-2">
          <Button onClick={() => { reset(); onClose(); }}>إلغاء</Button>
          <Button variant="primary" disabled={!canImport} onClick={submit}>
            استيراد
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

/* -------------------------------------------------------------------- */
/* Statement detail — line-by-line matching                             */
/* -------------------------------------------------------------------- */

function StatementMatchingPanel({
  statementId,
  onClose,
  accountName,
}: {
  statementId: string | null;
  onClose: () => void;
  accountName: (id: string) => string;
}) {
  const detail = useBankStatement(statementId);
  const autoMatch = useAutoMatchStatement();
  const matchLine = useMatchStatementLine();
  const unmatchLine = useUnmatchStatementLine();
  const finalize = useFinalizeBankStatement();

  const [error, setError] = useState<string | null>(null);
  const [pendingLineId, setPendingLineId] = useState<string | null>(null);
  const [entryIdDraft, setEntryIdDraft] = useState<Record<string, string>>({});

  const statement = detail.data ?? null;
  const locked = statement?.status === "completed";

  async function run(lineId: string, fn: () => Promise<unknown>) {
    if (pendingLineId) return;
    setPendingLineId(lineId);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingLineId(null);
    }
  }

  async function runStatementAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SidePanel
      open={statementId !== null}
      onClose={onClose}
      title={statement ? `تسوية ${accountName(statement.treasuryAccountId)}` : "تسوية كشف بنك"}
    >
      {detail.isLoading ? <div className="p-5 text-[12.5px] text-ink-muted">جارِ التحميل…</div> : null}
      {statement ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center gap-[10px]">
            <StatusPill label={getBankStatementStatusLabel(statement.status)} tone={STATUS_TONE[statement.status]} />
            <span className="mz-num text-[12px] text-ink-muted">
              {statement.periodStart} — {statement.periodEnd}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div className="rounded-[8px] border border-border px-3 py-2">
              <div className="text-ink-muted">الرصيد الافتتاحي</div>
              <MoneyDisplay value={Number(statement.openingBalance)} />
            </div>
            <div className="rounded-[8px] border border-border px-3 py-2">
              <div className="text-ink-muted">الرصيد الختامي</div>
              <MoneyDisplay value={Number(statement.closingBalance)} />
            </div>
            <div className="rounded-[8px] border border-border px-3 py-2">
              <div className="text-ink-muted">مطابَق</div>
              <span className="mz-num">
                {statement.matchSummary.matched} / {statement.matchSummary.total}
              </span>
            </div>
            <div className="rounded-[8px] border border-border px-3 py-2">
              <div className="text-ink-muted">نسبة المطابقة</div>
              <span className="mz-num">{formatPercent(statement.matchSummary.matchRate)}</span>
            </div>
          </div>

          {error ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={locked || autoMatch.isPending}
              onClick={() => runStatementAction(() => autoMatch.mutateAsync(statement.id))}
            >
              مطابقة تلقائية
            </Button>
            <Button
              variant="default"
              disabled={locked || finalize.isPending}
              onClick={() => runStatementAction(() => finalize.mutateAsync(statement.id))}
            >
              إنهاء التسوية
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {statement.lines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-4 text-center text-[12.5px] text-ink-muted">
                لا توجد سطور في هذا الكشف
              </div>
            ) : (
              statement.lines.map((line) => (
                <StatementLineRow
                  key={line.id}
                  line={line}
                  locked={locked}
                  pending={pendingLineId === line.id}
                  entryIdDraft={entryIdDraft[line.id] ?? ""}
                  onEntryIdChange={(v) => setEntryIdDraft((prev) => ({ ...prev, [line.id]: v }))}
                  onMatch={() =>
                    run(line.id, () =>
                      matchLine.mutateAsync({ statementId: statement.id, lineId: line.id, entryId: (entryIdDraft[line.id] ?? "").trim() }),
                    )
                  }
                  onUnmatch={() => run(line.id, () => unmatchLine.mutateAsync({ statementId: statement.id, lineId: line.id }))}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}

function StatementLineRow({
  line,
  locked,
  pending,
  entryIdDraft,
  onEntryIdChange,
  onMatch,
  onUnmatch,
}: {
  line: StatementLineDTO;
  locked: boolean;
  pending: boolean;
  entryIdDraft: string;
  onEntryIdChange: (value: string) => void;
  onMatch: () => void;
  onUnmatch: () => void;
}) {
  const matched = line.status === "matched";
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] text-ink">{line.description}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">
            {line.date}
            {line.reference ? ` · ${line.reference}` : ""}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <span className={Number(line.amount) < 0 ? "text-danger-ink" : "text-success-ink"}>
            <MoneyDisplay value={Number(line.amount)} />
          </span>
          <StatusPill label={matched ? "مطابَق" : "غير مطابَق"} tone={matched ? "success" : "neutral"} />
        </div>
      </div>

      {matched ? (
        <div className="flex items-center justify-between gap-2">
          <span className="mz-num truncate text-[11.5px] text-ink-muted">القيد: {line.matchedEntryId}</span>
          <Button size="sm" variant="danger-outline" disabled={locked || pending} onClick={onUnmatch}>
            إلغاء المطابقة
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <TextField label="معرّف القيد" value={entryIdDraft} onChange={onEntryIdChange} disabled={locked} />
          </div>
          <Button size="sm" variant="primary" disabled={locked || pending || entryIdDraft.trim() === ""} onClick={onMatch}>
            مطابقة
          </Button>
        </div>
      )}
    </div>
  );
}
