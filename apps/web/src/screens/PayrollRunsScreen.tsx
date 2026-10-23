import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { ReversalDocumentType } from "@mezan/contracts";
import { useReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ENGLISH_LOCALE,
  RowActionOutcome,
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  type DocumentDetailTab,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { PayrollRunDTO, PayrollRunStatusDTO, PayslipBasisDTO, PayslipDTO } from "@mezan/contracts";
import { STATUTORY_PAYSLIP_LINE_SOURCES, payrollUnimplementedRulesFor } from "@mezan/domain";
import { PayslipPrintPage } from "../print/PayslipPrintPage";
import { HrProvisionsPanel } from "./HrProvisionsPanel";
import { PayrollBankFilePanel } from "./PayrollBankFilePanel";
import { EntityHistoryPanel } from "./enh/audit-ledger/EntityHistoryPanel";
import { HrPermission, NEW_SEGMENT, useMayDo } from "./hr-permissions";
import { useUnverifiedStatutoryCodes } from "../data/hr-payroll-hooks";
import { NumberField, SelectField } from "../settings/form-controls";
import { ApiError, useBranches, useEmployees, useJournalEntry, useTreasuryAccounts } from "../data/hooks";
import { useNameSubPage, useNavigation, useSubPage } from "../navigation";
import {
  useApprovePayrollRun,
  useCalculatePayrollRun,
  useCancelPayrollRun,
  useCreatePayrollRun,
  useDisbursePayrollRun,
  usePayrollRun,
  usePayrollRuns,
} from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { sumMajor } from "../lib/money";
import { employeeDisplayName } from "./hr-employee-name";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

enum RunAction {
  Calculate = "calculate",
  Approve = "approve",
  Cancel = "cancel",
}

enum RunDetailTab {
  Payslips = "payslips",
  Calculation = "calculation",
  Disbursement = "disbursement",
  BankFile = "bank-file",
  History = "history",
}

const PAYSLIP_SEGMENT = "payslip";


/** الرواتب (Payroll) — docs/archive/catalog/06 §"الرواتب". A run covers one month: مسودة → محتسب → معتمد (قيد محاسبي متوازن) → مصروف. */

const STATUS_KEY: Record<PayrollRunStatusDTO, AppTranslationKey> = {
  draft: "payroll.status.draft",
  calculated: "payroll.status.calculated",
  approved: "payroll.status.approved",
  disbursed: "payroll.status.disbursed",
  cancelled: "payroll.status.cancelled",
};

const STATUS_TONE: Record<PayrollRunStatusDTO, PillTone> = {
  draft: "neutral",
  calculated: "info",
  approved: "warning",
  disbursed: "success",
  cancelled: "danger",
};

/** Month names come from the catalogue, keyed 1–12. */
function monthName(month: number, t: (key: AppTranslationKey) => string): string {
  return t(`month.${month}` as AppTranslationKey);
}

const LINE_KIND_KEY = {
  earning: "payroll.lineKind.earning",
  deduction: "payroll.lineKind.deduction",
  employer_contribution: "payroll.lineKind.employer_contribution",
  termination_adjustment: "payroll.lineKind.termination_adjustment",
} as const;

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** The run's posted entry by its human number (JE-…), opening it in the journal register. */
function PayrollJournalRef({ journalEntryId }: { journalEntryId: string }) {
  const { t } = useAppTranslation();
  const { openScreenAt } = useNavigation();
  const entry = useJournalEntry(journalEntryId);
  if (!entry.data) {
    return <span className="text-ink-muted">{entry.isError ? "—" : t("common.loading")}</span>;
  }
  const entryNo = entry.data.entryNo ?? entry.data.id;
  return (
    <button
      type="button"
      className="mz-num text-[12.5px] font-semibold text-brand underline"
      onClick={() => openScreenAt("journals", [entryNo])}
    >
      {entryNo}
    </button>
  );
}

const PAY_BASIS_KEY = {
  monthly: "payroll.basis.monthly",
  hourly: "payroll.basis.hourly",
  daily: "payroll.basis.daily",
} as const;

function PayslipBasisSummary({ basis, runCurrency }: { basis: PayslipBasisDTO; runCurrency: string }) {
  const { t } = useAppTranslation();
  const foreign = basis.fxRate !== null;
  const unit = basis.payBasis === "hourly" ? t("payroll.hours") : t("payroll.days");
  if (basis.payBasis === "monthly" && !foreign) return null;
  return (
    <div className="mt-[6px] flex flex-col gap-[3px] text-[11.5px] text-ink-faint">
      <span className="flex flex-wrap items-center gap-[4px]">
        {t("payroll.payBasis")}: {t(PAY_BASIS_KEY[basis.payBasis])}
        {basis.quantity !== null ? (
          <span className="flex items-center gap-[4px]">
            — <span className="mz-num">{basis.quantity}</span> {unit} ×
          </span>
        ) : (
          <span>—</span>
        )}
        <MoneyDisplay value={Number(basis.rate)} currencyLabel={foreign ? basis.contractCurrency : undefined} />
      </span>
      {foreign ? (
        <>
          <span className="flex flex-wrap items-center gap-[4px]">
            {t("payroll.contractCurrency")}: <span className="mz-num">{basis.contractCurrency}</span> · {t("payroll.fxRate")}:{" "}
            <span className="mz-num" dir="ltr">
              1 {basis.contractCurrency} = {basis.fxRate} {runCurrency}
            </span>
            {basis.fxRateDate ? <span className="mz-num">({basis.fxRateDate})</span> : null}
          </span>
          <span className="flex flex-wrap items-center gap-x-[16px] gap-y-[3px]">
            {basis.grossInContractCurrency !== null ? (
              <span className="flex items-center gap-[4px]">
                {t("payroll.grossInContractCurrency")} <MoneyDisplay value={Number(basis.grossInContractCurrency)} currencyLabel={basis.contractCurrency} />
              </span>
            ) : null}
            {basis.netInContractCurrency !== null ? (
              <span className="flex items-center gap-[4px]">
                {t("payroll.netInContractCurrency")} <MoneyDisplay value={Number(basis.netInContractCurrency)} currencyLabel={basis.contractCurrency} />
              </span>
            ) : null}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** Which caveat the net carries depends on how THIS run was computed, not on today's switch. */
function NetPayQualifierBadge({ statutory }: { statutory: boolean }) {
  const { t } = useAppTranslation();
  return (
    <span className="rounded-full border border-info bg-info-soft px-[7px] py-[1px] text-[10.5px] font-semibold text-info-ink">
      {statutory ? t("payroll.beforeAnnualTaxSettlement") : t("payroll.beforeTaxSocialInsuranceAnd")}
    </span>
  );
}


interface RunDetailProps {
  readonly run: PayrollRunDTO;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onAction: (run: PayrollRunDTO, action: RunAction) => void;
  readonly onDisburse: (run: PayrollRunDTO, treasuryAccountId: string, branchId: string) => void;
  readonly onPrintPayslip: (payslip: PayslipDTO) => void;
  readonly reverseItems: RowMenuItem[];
}

function PayrollRunDetail({ run, pending, error, onBack, onAction, onDisburse, onPrintPayslip, reverseItems }: RunDetailProps) {
  const { t, locale } = useAppTranslation();
  const nameOf = useEntityName();
  const detailQuery = usePayrollRun(run.id);
  const detail = detailQuery.data ?? null;
  const employees = useEmployees().data ?? EMPTY;
  const treasuryAccounts = useTreasuryAccounts().data ?? EMPTY;
  const branches = useBranches().data ?? EMPTY;
  const unverifiedCodes = useUnverifiedStatutoryCodes();
  const mayExportBankFile = useMayDo(HrPermission.PayrollBankFile);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState(run.branchId ?? "");
  const [tab, setTab] = useState(RunDetailTab.Payslips);
  useNameSubPage(run.number, run.number);

  const statutoryRun = (detail?.statutoryTableCodes.length ?? 0) > 0;
  const rules = detail ? payrollUnimplementedRulesFor(detail) : [];
  const universalRules = rules.filter((r) => r.appliesToEveryPayslip);
  const situationalRules = rules.filter((r) => !r.appliesToEveryPayslip);
  const shown = detail ?? run;
  const payable = run.status === "approved" || run.status === "disbursed";

  function employeeName(employeeId: string): string {
    const e = employees.find((row) => row.id === employeeId);
    return e ? employeeDisplayName(e, locale) : employeeId;
  }

  const payslipsTab = detail ? (
    detail.payslips.length > 0 ? (
      <div className="grid gap-[12px] lg:grid-cols-2">
        {detail.payslips.map((p: PayslipDTO) => (
          <div key={p.id} className="rounded-md border border-border p-[12px]">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="text-[13px] font-bold text-ink">{employeeName(p.employeeId)}</span>
              <span className="mz-num text-[11.5px] text-ink-faint">{p.number}</span>
            </div>
            <div className="mz-num mt-[3px] text-[11.5px] text-ink-faint">
              {p.paidDays} / {p.periodDays} {t("payroll.days")}
            </div>
            {p.partMonthTaxNotice ? (
              <div role="note" className="mt-[6px] rounded-md border border-warning bg-warning-soft px-[10px] py-[7px] text-[11.5px] text-warning-ink">
                {locale === ENGLISH_LOCALE ? (p.partMonthTaxNoticeEn ?? p.partMonthTaxNotice) : p.partMonthTaxNotice}
              </div>
            ) : null}
            {p.basis ? <PayslipBasisSummary basis={p.basis} runCurrency={p.currency} /> : null}
            {statutoryRun ? (
              <div className="mt-[6px] flex flex-wrap gap-x-[16px] gap-y-[3px] text-[11.5px] text-ink-faint">
                <span className="flex items-center gap-[4px]">
                  {t("payroll.insurableWage")} <MoneyDisplay value={Number(p.insurableWage)} />
                  {p.insurableWageCapped ? (
                    <span className="rounded-full border border-warning bg-warning-soft px-[6px] py-[1px] text-[10px] font-semibold text-warning-ink">{t("payroll.atCeiling")}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-[4px]">
                  {t("payroll.employerCost")}{" "}
                  {p.totalEmployerCost === null ? <span className="text-ink-faint">{t("payroll.notComputed")}</span> : <MoneyDisplay value={Number(p.totalEmployerCost)} />}
                </span>
              </div>
            ) : null}
            <ul className="mt-[8px] flex flex-col gap-[4px]">
              {p.lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-[8px] text-[12px]">
                  <span className="text-ink-muted">
                    {l.nameAr} <span className="text-ink-faint">({t(LINE_KIND_KEY[l.kind])})</span>
                    {STATUTORY_PAYSLIP_LINE_SOURCES.includes(l.source) && l.referenceId !== null && unverifiedCodes.has(l.referenceId) ? (
                      <span className="ms-[6px] rounded-full border border-warning bg-warning-soft px-[6px] py-[1px] text-[10px] font-semibold text-warning-ink">{t("statutory.unverified")}</span>
                    ) : null}
                  </span>
                  <MoneyDisplay value={Number(l.amount)} />
                </li>
              ))}
            </ul>
            <div className="mt-[8px] flex items-center justify-between border-t border-border pt-[8px] text-[12.5px] font-bold text-ink">
              <span className="flex flex-wrap items-center gap-[6px]">
                <span>{t("payroll.net")}</span>
                <NetPayQualifierBadge statutory={statutoryRun} />
              </span>
              <MoneyDisplay value={Number(p.netPay)} />
            </div>
            <div className="mt-[8px] flex justify-end">
              <Button size="sm" onClick={() => onPrintPayslip(p)}>
                {t("payslipPrint.print")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-[12.5px] text-ink-muted">{t("payroll.thisRunHasNotBeen")}</p>
    )
  ) : (
    <p className="text-[12.5px] text-ink-muted">{detailQuery.isError ? detailQuery.error.message : t("common.loading")}</p>
  );

  const calculationTab = (
    <div className="flex flex-col gap-[14px]">
      <div role="note" className="rounded-lg border border-info bg-info-soft p-[14px] text-info-ink">
        <h3 className="mb-[6px] font-display text-[13px] font-bold">{t("payroll.whatWasCalculatedItemsThis")}</h3>
        <p className="text-[12.5px] leading-relaxed">
          {statutoryRun ? t("payroll.theNetAboveIncludesStatutory") : t("payroll.theNetAboveCoversContractual")}
          <span className="mz-num font-semibold">{run.employeeCount}</span> {t("payroll.employees3")}
        </p>
        <ul className="mt-[8px] flex flex-col gap-[6px] text-[12px]">
          {universalRules.map((rule) => (
            <li key={rule.code}>
              <span className="font-semibold">{rule.labelAr}</span> — {rule.detailAr}
            </li>
          ))}
        </ul>
        {situationalRules.length > 0 ? <p className="mt-[10px] text-[12px] leading-relaxed">{t("payroll.otherUncalculatedItemsApplyOnly")}</p> : null}
      </div>
      {detail?.unpaidLeaveSource === "none" ? (
        <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {t("payroll.noSourceForUnpaidLeave")}
        </div>
      ) : null}
      {statutoryRun && detail?.overtimeSource === "none" ? (
        <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {t("payroll.noSourceForOvertime")}
        </div>
      ) : null}
      {statutoryRun && detail ? (
        <div className="rounded-lg border border-border p-[14px]">
          <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("payroll.statutoryTablesUsed")}</h3>
          <ul className="flex flex-wrap gap-[6px]" dir="ltr">
            {detail.statutoryTableCodes.map((code) => (
              <li key={code} className="mz-num rounded-full border border-border px-[8px] py-[2px] text-[11px] text-ink-muted">
                {code}
                {unverifiedCodes.has(code) ? <span className="ms-[4px] text-warning-ink">· {t("statutory.unverified")}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {detail && detail.warnings.length > 0 ? (
        <div className="rounded-lg border border-border p-[14px]">
          <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("payroll.calculationNotes")}</h3>
          <ul className="flex flex-col gap-[5px] text-[12.5px] text-ink-muted">
            {detail.warnings.map((w, index) => (
              <li key={index}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  const disbursementTab =
    run.status === "approved" ? (
      <div className="flex max-w-[560px] flex-col gap-[10px]">
        <p className="text-[12px] text-ink-muted">{t("payroll.thisIssuesACashDisbursement")}</p>
        <SelectField
          label={t("payroll.treasuryAccount")}
          value={treasuryAccountId}
          onChange={setTreasuryAccountId}
          options={[{ value: "", label: t("payroll.choose") }, ...treasuryAccounts.map((account) => ({ value: account.id, label: `${account.code} — ${nameOf(account)}` }))]}
        />
        <SelectField
          label={t("payroll.branch")}
          value={branchId}
          onChange={setBranchId}
          options={[{ value: "", label: t("payroll.choose") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
        />
        <div className="flex justify-end">
          <Button variant="primary" disabled={pending} onClick={() => onDisburse(run, treasuryAccountId, branchId)}>
            {t("payroll.payOut")}
          </Button>
        </div>
      </div>
    ) : (
      <p className="text-[12.5px] text-ink-muted">{run.disbursedAt ? t("hrPages.run.disbursedOn", { date: run.disbursedAt.slice(0, 10) }) : t("hrPages.run.notYetPayable")}</p>
    );

  const tabs: DocumentDetailTab[] = [
    { key: RunDetailTab.Payslips, label: t("hrPages.run.tabPayslips", { count: detail?.payslips.length ?? run.employeeCount }), content: payslipsTab },
    { key: RunDetailTab.Calculation, label: t("hrPages.run.tabCalculation"), content: calculationTab },
    ...(payable ? [{ key: RunDetailTab.Disbursement, label: t("hrPages.run.tabDisbursement"), content: disbursementTab }] : []),
    ...(payable && mayExportBankFile ? [{ key: RunDetailTab.BankFile, label: t("hrPages.run.tabBankFile"), content: <PayrollBankFilePanel run={run} /> }] : []),
    { key: RunDetailTab.History, label: t("hrPages.employee.tabHistory"), content: <EntityHistoryPanel entityType="PAYROLL_RUN" entityId={run.id} /> },
  ];

  return (
    <div className="w-full">
      <DocumentDetail
        title={t("hrPages.run.title", { number: run.number })}
        statusLabel={t(STATUS_KEY[run.status])}
        statusTone={STATUS_TONE[run.status]}
        subtitle={
          <span>
            {monthName(run.month, t)} <span className="mz-num">{run.year}</span>
          </span>
        }
        actions={
          <>
            <Button onClick={onBack}>{t("hrPages.backToList")}</Button>
            {run.status === "draft" || run.status === "calculated" ? (
              <Button variant="primary" disabled={pending} onClick={() => onAction(run, RunAction.Calculate)}>
                {t("payroll.calculatePayroll")}
              </Button>
            ) : null}
            {run.status === "calculated" ? (
              <Button variant="primary" disabled={pending} onClick={() => onAction(run, RunAction.Approve)}>
                {t("payroll.approveAndPostTheEntry")}
              </Button>
            ) : null}
            {run.status === "draft" || run.status === "calculated" ? (
              <Button variant="danger-outline" disabled={pending} onClick={() => onAction(run, RunAction.Cancel)}>
                {t("payroll.cancelRun")}
              </Button>
            ) : null}
            {reverseItems.length > 0 ? <RowMenu items={reverseItems} label={t("common.rowActionsFor", { name: run.number })} /> : null}
          </>
        }
        summary={[
          { label: t("common.period"), value: <span>{monthName(run.month, t)} <span className="mz-num">{run.year}</span></span> },
          { label: t("payroll.employees2"), value: <span className="mz-num">{shown.employeeCount}</span> },
          { label: t("payroll.totalEarnings"), value: <MoneyDisplay value={Number(shown.totalGross)} /> },
          { label: t("payroll.totalDeductions"), value: <MoneyDisplay value={Number(shown.totalDeductions)} /> },
          {
            label: t("payroll.netPayroll"),
            value: (
              <span className="flex flex-wrap items-center gap-[6px]">
                <MoneyDisplay value={Number(shown.totalNet)} />
                <NetPayQualifierBadge statutory={statutoryRun} />
              </span>
            ),
          },
          { label: t("payroll.journalEntry"), value: shown.journalEntryId ? <PayrollJournalRef journalEntryId={shown.journalEntryId} /> : "—" },
        ]}
        tabs={tabs}
        activeTabKey={tabs.some((x) => x.key === tab) ? tab : RunDetailTab.Payslips}
        onTabChange={(key) => setTab(key as RunDetailTab)}
      />
      {error ? (
        <div role="alert" className="mt-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function PayrollRunCreatePage({ onCancel, onCreated }: { onCancel: () => void; onCreated: (run: PayrollRunDTO) => void }) {
  const { t } = useAppTranslation();
  const createRun = useCreatePayrollRun();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (createRun.isPending) return;
    setFormError(null);
    try {
      onCreated(await createRun.mutateAsync({ year, month }));
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("payroll.thePayrollRunCouldNot"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.hr.payroll")}</div>
        <h1 className="font-display text-xl font-bold text-ink">{t("payroll.newPayrollRun")}</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("payroll.chooseThePeriodThenCalculate")}</p>
      </div>
      <Card className="max-w-[560px] p-[18px_20px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <NumberField label={t("payroll.year")} value={year} onChange={(v) => setYear(Number.isNaN(v) ? now.getFullYear() : v)} min={1900} />
          <SelectField
            label={t("payroll.month")}
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1, t) }))}
          />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={createRun.isPending}>
              {t("payroll.create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function PayrollRunsScreen() {
  const branchGate = useBranchGate();
  const reversal = useReverseDocumentAction(ReversalDocumentType.PayrollRun);
  const { t } = useAppTranslation();
  const query = usePayrollRuns();
  const calculateRun = useCalculatePayrollRun();
  const approveRun = useApprovePayrollRun();
  const disburseRun = useDisbursePayrollRun();
  const cancelRun = useCancelPayrollRun();
  const subPage = useSubPage();
  const [firstSegment, secondSegment, thirdSegment] = subPage.segments;

  const runs = query.data ?? EMPTY;
  const now = new Date();
  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as ["all" | PayrollRunStatusDTO, (next: string) => void];
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const selected = firstSegment !== undefined && firstSegment !== NEW_SEGMENT ? (runs.find((r) => r.id === firstSegment || r.number === firstSegment) ?? null) : null;
  const printingQuery = usePayrollRun(selected && secondSegment === PAYSLIP_SEGMENT ? selected.id : null);

  const filtered = useMemo(() => {
    let rows = runs;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q) || `${r.year}-${r.month}`.includes(q));
    }
    return rows;
  }, [runs, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  function openRun(run: PayrollRunDTO) {
    setActionError(null);
    subPage.open(run.number);
  }

  async function runAction(run: PayrollRunDTO, action: RunAction) {
    if (pendingId !== null) return;
    setPendingId(run.id);
    setActionError(null);
    try {
      if (action === RunAction.Calculate) await calculateRun.mutateAsync(run.id);
      else if (action === RunAction.Approve) await approveRun.mutateAsync(run.id);
      else await cancelRun.mutateAsync(run.id);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("payroll.thatActionCouldNotBe"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  async function runDisburse(run: PayrollRunDTO, treasuryAccountId: string, branchId: string) {
    if (pendingId !== null) return;
    if (treasuryAccountId === "" || branchId === "") {
      setActionError(t("payroll.chooseTheTreasuryAccountAnd"));
      return;
    }
    setPendingId(run.id);
    setActionError(null);
    try {
      await disburseRun.mutateAsync({ id: run.id, body: { treasuryAccountId, branchId } });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("payroll.payrollCouldNotBePaid"));
    } finally {
      setPendingId(null);
    }
  }

  if (firstSegment === NEW_SEGMENT) {
    return <PayrollRunCreatePage onCancel={() => subPage.close()} onCreated={(run) => subPage.open(run.number)} />;
  }

  if (firstSegment !== undefined && !selected) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] text-ink-muted">{query.isLoading ? t("common.loading") : t("hrPages.run.notFound", { ref: firstSegment })}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => subPage.close()}>
          {t("hrPages.backToList")}
        </Button>
      </Card>
    );
  }

  if (selected && secondSegment === PAYSLIP_SEGMENT) {
    const payslip = printingQuery.data?.payslips.find((p) => p.number === thirdSegment || p.id === thirdSegment) ?? null;
    if (!printingQuery.data || !payslip) return <p className="text-[12.5px] text-ink-muted">{t("common.loading")}</p>;
    return (
      <div className="w-full">
        <div className="mb-[14px] print:hidden">
          <Button onClick={() => subPage.open(selected.number)}>{t("common.back")}</Button>
        </div>
        <PayslipPrintPage payslip={payslip} run={printingQuery.data} />
      </div>
    );
  }

  if (selected) {
    return (
      <>
        <PayrollRunDetail
          run={selected}
          pending={pendingId === selected.id}
          error={actionError}
          onBack={() => subPage.close()}
          onAction={(run, action) => void runAction(run, action)}
          onDisburse={(run, treasuryAccountId, branchId) => void runDisburse(run, treasuryAccountId, branchId)}
          onPrintPayslip={(p) => subPage.open(selected.number, PAYSLIP_SEGMENT, p.number)}
          reverseItems={selected.status === "approved" ? reversal.menuItems({ id: selected.id, params: { id: selected.id }, subject: selected.number }) : []}
        />
        {reversal.dialog}
      </>
    );
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: runs.length },
    ...(Object.keys(STATUS_KEY) as PayrollRunStatusDTO[]).map((s) => ({ key: s, label: t(STATUS_KEY[s]), count: runs.filter((r) => r.status === s).length })),
  ];

  const columns: DocumentListColumn<PayrollRunDTO>[] = [
    { key: "number", header: t("payroll.runNumber"), render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    {
      key: "period",
      header: t("common.period"),
      render: (r) => (
        <span>
          {monthName(r.month, t)} <span className="mz-num">{r.year}</span>
        </span>
      ),
    },
    { key: "employees", header: t("payroll.employees"), align: "end", render: (r) => <span className="mz-num">{r.employeeCount}</span> },
    { key: "gross", header: t("payroll.grossPay"), align: "end", render: (r) => <MoneyDisplay value={Number(r.totalGross)} /> },
    { key: "net", header: t("payroll.netPay"), align: "end", render: (r) => <MoneyDisplay value={Number(r.totalNet)} /> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
  ];

  const yearTotalGross = sumMajor(runs.filter((r) => r.year === now.getFullYear()).map((r) => r.totalGross));
  const yearTotalNet = sumMajor(runs.filter((r) => r.year === now.getFullYear()).map((r) => r.totalNet));
  const yearDisbursed = sumMajor(runs.filter((r) => r.year === now.getFullYear() && r.status === "disbursed").map((r) => r.totalNet));

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("payroll.payrollRunsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}

      <DocumentList<PayrollRunDTO>
        title={t("payroll.payroll")}
        description={t("payroll.aMonthlyPayrollRunComputed")}
        actions={
          <Button variant="primary" onClick={() => subPage.open(NEW_SEGMENT)}>
            {t("payroll.newPayrollRun")}
          </Button>
        }
        listKey="payroll-runs"
        statsCollapsible
        stats={[
          { label: t("payroll.totalRuns"), value: <span className="mz-num">{runs.length}</span> },
          { label: t("payroll.grossPayThisYear"), value: <MoneyDisplay value={yearTotalGross} /> },
          { label: t("payroll.netPayThisYear"), value: <MoneyDisplay value={yearTotalNet} /> },
          { label: t("payroll.netPaidOutThisYear"), value: <MoneyDisplay value={yearDisbursed} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | PayrollRunStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("payroll.searchByRunNumberOr")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(r) => r.id}
        onRowClick={openRun}
        rowAction={(r) => {
          const items: RowMenuItem[] = [{ key: "view", label: t("common.view"), onSelect: () => openRun(r) }];
          if (r.status === "draft" || r.status === "calculated") {
            items.push({ key: "calculate", label: t("payroll.calculatePayroll"), disabled: pendingId === r.id, onSelect: () => runAction(r, RunAction.Calculate) });
          }
          if (r.status === "calculated") {
            items.push({ key: "approve", label: t("payroll.approveAndPostTheEntry"), disabled: pendingId === r.id, onSelect: () => runAction(r, RunAction.Approve) });
          }
          if (r.status === "draft" || r.status === "calculated") {
            items.push({ key: "cancel", label: t("payroll.cancelRun"), tone: "danger", disabled: pendingId === r.id, onSelect: () => runAction(r, RunAction.Cancel) });
          }
          if (r.status === "approved") {
            items.push({ key: "disburse", label: t("payroll.payOut"), onSelect: () => openRun(r) });
            items.push(...reversal.menuItems({ id: r.id, params: { id: r.id }, subject: r.number }));
          }
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: r.number })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{runs.length}</span> {t("payroll.runs")}
          </>
        }
        emptyState={<EmptyState title={t("payroll.nothingToShow")} description={t("payroll.emptyBody")} action={{ label: t("payroll.newPayrollRun"), onClick: () => subPage.open(NEW_SEGMENT) }} />}
      />
      {reversal.dialog}

      {branchGate.allows(BranchGatedAction.PayrollProvisions) ? (
        <div className="mt-[18px]">
          <HrProvisionsPanel />
        </div>
      ) : null}
    </div>
  );
}
