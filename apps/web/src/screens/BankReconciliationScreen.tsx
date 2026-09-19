import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../lib/error-message";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  readSpreadsheetAsCsv,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { BANK_STATEMENT_STATUS_DEFINITIONS, getBankStatementStatusLabel, parseCsv } from "@mezan/domain";
import {
  StatementFileFormatCode,
  StatementSourceCode,
  type BankStatementListItemDTO,
  type BankStatementStatusDTO,
  type StatementDateFormatDTO,
} from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import {
  useBankStatements,
  useImportBankStatement,
  useStatementColumnMapping,
  useTreasuryAccounts,
} from "../data/hooks";
import { useImportStatementFile } from "../data/bank-rec-hooks";
import { formatExactMoney, StatementWorkspace } from "./BankReconciliationWorkspace";
import { useAppTranslation } from "../i18n";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * تسوية كشوف البنك — Bank Statement Reconciliation (docs/archive/catalog/04, route
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

const PAGE_SIZES = [10, 25, 50, 100] as const;

const SOURCE_OPTIONS: readonly StatementSourceCode[] = [
  StatementSourceCode.Csv,
  StatementSourceCode.Excel,
  StatementSourceCode.Ofx,
  StatementSourceCode.Mt940,
];

const FILE_ACCEPT: Record<StatementSourceCode, string> = {
  [StatementSourceCode.Csv]: ".csv,text/csv",
  [StatementSourceCode.Excel]: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  [StatementSourceCode.Ofx]: ".ofx,.qfx,.xml",
  [StatementSourceCode.Mt940]: ".sta,.mt940,.940,.txt",
};

export function BankReconciliationScreen() {
  const { t } = useAppTranslation();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | BankStatementStatusDTO,
    (next: string) => void,
  ];
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
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
    () => (treasuryQuery.data ?? []).filter((account) => account.type === "bank" && account.status === "active"),
    [treasuryQuery.data],
  );
  const accountName = useMemo(() => {
    const map = new Map((treasuryQuery.data ?? []).map((account) => [account.id, account.name]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryQuery.data]);

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

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) + (treasuryAccountId ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const counts = useMemo(() => {
    const c = { all: statements.length, imported: 0, in_progress: 0, completed: 0 };
    for (const s of statements) c[s.status] += 1;
    return c;
  }, [statements]);

  /**
   * The rate across every listed statement — lines matched over lines seen, not
   * an average of per-statement rates, so a 200-line statement is not weighed
   * the same as a 3-line one. It reads "—" while there is nothing to divide.
   */
  const overall = useMemo(() => {
    let total = 0;
    let matched = 0;
    for (const s of statements) {
      total += s.matchSummary.total;
      matched += s.matchSummary.matched;
    }
    return total === 0 ? null : matched / total;
  }, [statements]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    ...BANK_STATEMENT_STATUS_DEFINITIONS.map((d) => ({ key: d.code, label: d.labelAr, count: counts[d.code] })),
  ];

  const columns: DocumentListColumn<BankStatementListItemDTO>[] = [
    {
      key: "account",
      header: t("bankRec.account"),
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{accountName(s.treasuryAccountId)}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{s.statementNumber ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "period",
      header: t("common.period"),
      render: (s) => (
        <span className="mz-num text-ink-muted">
          {s.periodStart} — {s.periodEnd}
        </span>
      ),
    },
    { key: "opening", header: t("bankRec.openingBalance"), align: "end", render: (s) => <span dir="ltr" className="mz-num">{formatExactMoney(s.openingBalance)}</span> },
    { key: "closing", header: t("bankRec.closingBalance"), align: "end", render: (s) => <span dir="ltr" className="mz-num">{formatExactMoney(s.closingBalance)}</span> },
    {
      key: "matchRate",
      header: t("bankRec.matched"),
      align: "end",
      render: (s) => (
        <span className="mz-num text-ink-muted">
          {s.matchSummary.total === 0 ? "—" : `${formatPercent(s.matchSummary.matchRate)} (${s.matchSummary.matched}/${s.matchSummary.total})`}
        </span>
      ),
    },
    { key: "status", header: t("common.status"), render: (s) => <StatusPill label={getBankStatementStatusLabel(s.status)} tone={STATUS_TONE[s.status]} /> },
  ];

  return (
    <div className="w-full">
      <DocumentList<BankStatementListItemDTO>
        title={t("bankRec.bankReconciliation")}
        description={t("bankRec.importBankStatementsAndMatch")}
        actions={
          <Button variant="primary" onClick={() => setImportOpen(true)}>
            {t("bankRec.importAStatement")}
          </Button>
        }
        listKey="bank-reconciliation"
        statsCollapsible
        stats={[
          { label: t("bankRec.totalStatements"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("bankRec.beingReconciled"), value: <span className="mz-num">{counts.in_progress}</span> },
          { label: t("bankRec.finished"), value: <span className="mz-num">{counts.completed}</span> },
          { label: t("bankRec.matched"), value: <span className="mz-num">{overall === null ? "—" : formatPercent(overall)}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | BankStatementStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("bankRec.searchByAccountReferenceOr")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[220px]">
              <EntityPicker
                label={t("bankRec.treasuryAccount")}
                value={bankAccounts.map((a) => ({ id: a.id, label: a.name })).find((o) => o.id === treasuryAccountId) ?? null}
                onChange={(o) => {
                  setTreasuryAccountId(o?.id ?? "");
                  setPage(1);
                }}
                options={bankAccounts.map((a) => ({ id: a.id, label: a.name }))}
                placeholder={t("bankRec.allAccounts")}
                emptyMessage={t("bankRec.noBankAccounts")}
              />
            </div>
            <div className="w-[150px]">
              <TextField
                label={t("common.of")}
                value={fromDate}
                onChange={(value) => {
                  setFromDate(value);
                  setPage(1);
                }}
                placeholder="YYYY-MM-DD"
              />
            </div>
            <div className="w-[150px]">
              <TextField
                label={t("bankRec.to")}
                value={toDate}
                onChange={(value) => {
                  setToDate(value);
                  setPage(1);
                }}
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(s) => s.id}
        onRowClick={(s) => setOpenStatementId(s.id)}
        rowAction={(s) => (
          <RowMenu
            items={[{ key: "open", label: t("bankRec.openReconciliation"), onSelect: () => setOpenStatementId(s.id) }]}
            label={t("common.rowActionsFor", { name: s.statementNumber ?? s.id })}
          />
        )}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("bankRec.statements")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : query.isError ? (
            <div className="p-8 text-center text-sm text-ink-muted">{query.error?.message ?? t("bankRec.bankStatementsCouldNotBe")}</div>
          ) : (
            <EmptyState
              title={t("bankRec.noBankStatementsYet")}
              description={t("bankRec.emptyBody")}
              action={{ label: t("bankRec.importAStatement"), onClick: () => setImportOpen(true) }}
            />
          )
        }
      />

      <ImportStatementDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={(id) => setOpenStatementId(id)} />

      <StatementWorkspace statementId={openStatementId} onClose={() => setOpenStatementId(null)} accountName={accountName} />
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
  const { t } = useAppTranslation();
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [source, setSource] = useState<StatementSourceCode>(StatementSourceCode.Csv);
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
    () => (treasuryQuery.data ?? []).filter((account) => account.type === "bank" && account.status === "active"),
    [treasuryQuery.data],
  );
  const bankOptions: EntityPickerOption[] = bankAccounts.map((a) => ({ id: a.id, label: `${a.name} (${a.code})` }));

  const savedMapping = useStatementColumnMapping(treasuryAccountId === "" ? null : treasuryAccountId);
  const importStatement = useImportBankStatement();
  const importFile = useImportStatementFile();
  const structured = source === StatementSourceCode.Ofx || source === StatementSourceCode.Mt940;

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
    setSource(StatementSourceCode.Csv);
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
    setHeaders([]);
    setRawCsv("");
    try {
      if (source === StatementSourceCode.Ofx || source === StatementSourceCode.Mt940) {
        setRawCsv(await file.text());
        return;
      }
      let text: string;
      try {
        text = source === StatementSourceCode.Excel ? await readSpreadsheetAsCsv(await file.arrayBuffer()) : await file.text();
      } catch {
        setError(t("bankRecX.excelReadFailed"));
        return;
      }
      setRawCsv(text);
      setHeaders([...parseCsv(text).headers]);
    } catch (err) {
      setHeaders([]);
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const hasFile = rawCsv !== "" && (structured || headers.length > 0);
  const mappingComplete =
    mapping.dateColumn !== "" &&
    mapping.descriptionColumn !== "" &&
    (mapping.amountColumn !== "" || (mapping.debitColumn !== "" && mapping.creditColumn !== ""));

  const canImport = structured
    ? treasuryAccountId !== "" && hasFile && !importFile.isPending
    : treasuryAccountId !== "" &&
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
      if (structured) {
        const result = await importFile.mutateAsync({
          treasuryAccountId,
          format: source === StatementSourceCode.Ofx ? StatementFileFormatCode.Ofx : StatementFileFormatCode.Mt940,
          content: rawCsv,
          periodStart: periodStart === "" ? null : periodStart,
          periodEnd: periodEnd === "" ? null : periodEnd,
          openingBalance: openingBalance === "" ? null : openingBalance,
          closingBalance: closingBalance === "" ? null : closingBalance,
          statementNumber: statementNumber.trim() === "" ? null : statementNumber.trim(),
        });
        onImported(result.id);
        reset();
        onClose();
        return;
      }
      const result = await importStatement.mutateAsync({
        source: source === StatementSourceCode.Excel ? StatementSourceCode.Excel : StatementSourceCode.Csv,
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
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const columnOptions = [{ value: "", label: t("bankRec.none") }, ...headers.map((h) => ({ value: h, label: h }))];

  return (
    <SidePanel open={open} onClose={onClose} title={t("bankRec.importAStatement")}>
      <div className="flex flex-col gap-4 p-5">
        <div>
          <EntityPicker
            label={t("bankRec.treasuryAccount2")}
            value={bankOptions.find((o) => o.id === treasuryAccountId) ?? null}
            onChange={(o) => setTreasuryAccountId(o?.id ?? "")}
            options={bankOptions}
            placeholder={t("bankRec.chooseABankAccount")}
            emptyMessage={t("bankRec.noBankAccounts")}
          />
        </div>

        <SelectField
          label={t("bankRec.source")}
          value={source}
          onChange={(v) => {
            setSource(SOURCE_OPTIONS.find((o) => o === v) ?? StatementSourceCode.Csv);
            setRawCsv("");
            setHeaders([]);
            setFileName("");
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
          options={[
            { value: StatementSourceCode.Csv, label: t("bankRec.csvFile") },
            { value: StatementSourceCode.Excel, label: t("bankRecX.sourceExcel") },
            { value: StatementSourceCode.Ofx, label: t("bankRecX.sourceOfx") },
            { value: StatementSourceCode.Mt940, label: t("bankRecX.sourceMt940") },
          ]}
        />

        <div>
          <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("bankRec.statementFile")}</div>
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_ACCEPT[source]}
            aria-label={t("bankRec.statementFile2")}
            onChange={onFileChange}
            className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-[12.5px] text-ink"
          />
          {fileName !== "" ? <div className="mt-[6px] text-[11.5px] text-ink-muted">{fileName}</div> : null}
        </div>

        <TextField label={t("bankRec.periodStart")} value={periodStart} onChange={setPeriodStart} placeholder="YYYY-MM-DD" hint={structured ? t("bankRecX.fromFileHint") : undefined} />
        <TextField label={t("bankRec.periodEnd")} value={periodEnd} onChange={setPeriodEnd} placeholder="YYYY-MM-DD" hint={structured ? t("bankRecX.fromFileHint") : undefined} />
        <TextField label={t("bankRec.openingBalance2")} value={openingBalance} onChange={setOpeningBalance} placeholder="0.00" hint={structured ? t("bankRecX.fromFileHint") : undefined} />
        <TextField label={t("bankRec.closingBalance2")} value={closingBalance} onChange={setClosingBalance} placeholder="0.00" hint={structured ? t("bankRecX.fromFileHint") : undefined} />
        <TextField label={t("bankRec.statementNumber")} value={statementNumber} onChange={setStatementNumber} />

        {structured ? null : (
        <Card className="flex flex-col gap-[12px] p-[14px]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-[13px] font-bold text-ink">{t("bankRec.columnMapping")}</h3>
            <Button size="sm" disabled={!hasFile} onClick={() => setMappingOpen((v) => !v)}>
              {t("bankRec.columnMapping2")}
            </Button>
          </div>
          <p className="text-[11.5px] text-ink-muted">
            {t("bankRec.chooseACsvFirstThen")}
          </p>

          {hasFile && mappingOpen ? (
            <div className="flex flex-col gap-[10px]">
              <SelectField
                label={t("bankRec.dateColumn")}
                value={mapping.dateColumn}
                onChange={(v) => setMapping((m) => ({ ...m, dateColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label={t("bankRec.descriptionColumn")}
                value={mapping.descriptionColumn}
                onChange={(v) => setMapping((m) => ({ ...m, descriptionColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label={t("bankRec.amountColumnSigned")}
                value={mapping.amountColumn}
                onChange={(v) => setMapping((m) => ({ ...m, amountColumn: v }))}
                options={columnOptions}
                hint={t("bankRec.useEitherOneSignedAmount")}
              />
              <SelectField
                label={t("bankRec.debitColumn")}
                value={mapping.debitColumn}
                onChange={(v) => setMapping((m) => ({ ...m, debitColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label={t("bankRec.creditColumn")}
                value={mapping.creditColumn}
                onChange={(v) => setMapping((m) => ({ ...m, creditColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label={t("bankRec.referenceColumn")}
                value={mapping.referenceColumn}
                onChange={(v) => setMapping((m) => ({ ...m, referenceColumn: v }))}
                options={columnOptions}
              />
              <SelectField
                label={t("bankRec.dateFormat")}
                value={mapping.dateFormat}
                onChange={(v) => setMapping((m) => ({ ...m, dateFormat: v as StatementDateFormatDTO }))}
                options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              />
            </div>
          ) : null}
        </Card>
        )}

        {error ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

        <div className="flex gap-2 pt-2">
          <Button onClick={() => { reset(); onClose(); }}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canImport} onClick={submit}>
            {t("bankRec.import")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
