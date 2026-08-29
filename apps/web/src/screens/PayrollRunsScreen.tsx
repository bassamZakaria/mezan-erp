import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { PayrollRunDTO, PayrollRunStatusDTO, PayslipDTO } from "@mezan/contracts";
import { PAYROLL_UNIMPLEMENTED_RULES } from "@mezan/domain";
import { NumberField, SelectField } from "../settings/form-controls";
import { ApiError, useBranches, useEmployees, useTreasuryAccounts } from "../data/hooks";
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
import { useUrlNumber, useUrlSearch } from "../lib/url-state";

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
} as const;

const PAGE_SIZES = [10, 25, 50, 100] as const;

const UNIVERSAL_UNIMPLEMENTED_RULES = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => r.appliesToEveryPayslip);
const SITUATIONAL_UNIMPLEMENTED_RULES = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => !r.appliesToEveryPayslip);

function NetPayQualifierBadge() {
  const { t } = useAppTranslation();
  return (
    <span className="rounded-full border border-info bg-info-soft px-[7px] py-[1px] text-[10.5px] font-semibold text-info-ink">
      {t("payroll.beforeTaxSocialInsuranceAnd")}
    </span>
  );
}

export function PayrollRunsScreen() {
  const nameOf = useEntityName();
  const { t, locale } = useAppTranslation();
  const query = usePayrollRuns();
  const employeesQuery = useEmployees();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const createRun = useCreatePayrollRun();
  const calculateRun = useCalculatePayrollRun();
  const approveRun = useApprovePayrollRun();
  const disburseRun = useDisbursePayrollRun();
  const cancelRun = useCancelPayrollRun();

  const runs = query.data ?? EMPTY;
  const employees = employeesQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const now = new Date();
  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useState<"all" | PayrollRunStatusDTO>("all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState("");

  const detailQuery = usePayrollRun(selectedId);
  const detail = detailQuery.data ?? null;

  function employeeName(employeeId: string): string {
    const e = employees.find((row) => row.id === employeeId);
    if (!e) return employeeId;
    return employeeDisplayName(e, locale);
  }

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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const run = await createRun.mutateAsync({ year, month });
      setFormOpen(false);
      setSelectedId(run.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("payroll.thePayrollRunCouldNot"));
    }
  }

  async function runAction(run: PayrollRunDTO, action: "calculate" | "approve" | "cancel") {
    if (pendingId !== null) return;
    setPendingId(run.id);
    setDetailError(null);
    try {
      if (action === "calculate") await calculateRun.mutateAsync(run.id);
      else if (action === "approve") await approveRun.mutateAsync(run.id);
      else await cancelRun.mutateAsync(run.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("payroll.thatActionCouldNotBe"));
    } finally {
      setPendingId(null);
    }
  }

  async function runDisburse(run: PayrollRunDTO) {
    if (pendingId !== null) return;
    if (treasuryAccountId === "" || branchId === "") {
      setDetailError(t("payroll.chooseTheTreasuryAccountAnd"));
      return;
    }
    setPendingId(run.id);
    setDetailError(null);
    try {
      await disburseRun.mutateAsync({ id: run.id, body: { treasuryAccountId, branchId } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("payroll.payrollCouldNotBePaid"));
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: runs.length },
    { key: "draft", label: t(STATUS_KEY.draft), count: runs.filter((r) => r.status === "draft").length },
    { key: "calculated", label: t(STATUS_KEY.calculated), count: runs.filter((r) => r.status === "calculated").length },
    { key: "approved", label: t(STATUS_KEY.approved), count: runs.filter((r) => r.status === "approved").length },
    { key: "disbursed", label: t(STATUS_KEY.disbursed), count: runs.filter((r) => r.status === "disbursed").length },
    { key: "cancelled", label: t(STATUS_KEY.cancelled), count: runs.filter((r) => r.status === "cancelled").length },
  ];

  const columns: DocumentListColumn<PayrollRunDTO>[] = [
    { key: "number", header: t("payroll.runNumber"), render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    {
      key: "period",
      header: t("common.period"),
      render: (r) => (
        <span>
          {monthName((r.month - 1) + 1, t)} <span className="mz-num">{r.year}</span>
        </span>
      ),
    },
    { key: "employees", header: t("payroll.employees"), align: "end", render: (r) => <span className="mz-num">{r.employeeCount}</span> },
    { key: "gross", header: t("payroll.grossPay"), align: "end", render: (r) => <MoneyDisplay value={Number(r.totalGross)} /> },
    { key: "net", header: t("payroll.netPay"), align: "end", render: (r) => <MoneyDisplay value={Number(r.totalNet)} /> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
  ];

  const yearTotalGross = sumMajor(runs.filter((r) => r.year === now.getUTCFullYear()).map((r) => r.totalGross));
  const yearTotalNet = sumMajor(runs.filter((r) => r.year === now.getUTCFullYear()).map((r) => r.totalNet));
  const yearDisbursed = sumMajor(
    runs.filter((r) => r.year === now.getUTCFullYear() && r.status === "disbursed").map((r) => r.totalNet),
  );

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("payroll.payrollRunsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {selectedId === null && detailError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {detailError}
        </div>
      ) : null}

      <DocumentList<PayrollRunDTO>
        title={t("payroll.payroll")}
        description={t("payroll.aMonthlyPayrollRunComputed")}
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
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
        onRowClick={(r) => {
          setDetailError(null);
          setSelectedId(r.id);
        }}
        rowAction={(r) => {
          const openRow = () => {
            setDetailError(null);
            setSelectedId(r.id);
          };
          const items: RowMenuItem[] = [{ key: "view", label: t("common.view"), onSelect: openRow }];
          if (r.status === "draft" || r.status === "calculated") {
            items.push({
              key: "calculate",
              label: t("payroll.calculatePayroll"),
              disabled: pendingId === r.id,
              onSelect: () => void runAction(r, "calculate"),
            });
          }
          if (r.status === "calculated") {
            items.push({
              key: "approve",
              label: t("payroll.approveAndPostTheEntry"),
              disabled: pendingId === r.id,
              onSelect: () => void runAction(r, "approve"),
            });
          }
          if (r.status === "draft" || r.status === "calculated") {
            items.push({
              key: "cancel",
              label: t("payroll.cancelRun"),
              tone: "danger",
              disabled: pendingId === r.id,
              onSelect: () => void runAction(r, "cancel"),
            });
          }
          // Disbursing needs a treasury account and a branch the row cannot supply — the menu opens the panel that collects them.
          if (r.status === "approved") {
            items.push({ key: "disburse", label: t("payroll.payOut"), onSelect: openRow });
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
        emptyState={
          <EmptyState
            title={t("payroll.nothingToShow")}
            description={t("payroll.emptyBody")}
            action={{ label: t("payroll.newPayrollRun"), onClick: () => setFormOpen(true) }}
          />
        }
      />

      <SidePanel open={selectedId !== null} onClose={() => setSelectedId(null)} title={detail ? detail.number : ""}>
        {detail ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[detail.status])} tone={STATUS_TONE[detail.status]} />

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.period")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">
                  {monthName((detail.month - 1) + 1, t)} <span className="mz-num">{detail.year}</span>
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("payroll.employees2")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{detail.employeeCount}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("payroll.totalEarnings")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalGross)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("payroll.totalDeductions")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalDeductions)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="flex flex-wrap items-center gap-[6px]">
                  <span className="text-[11px] font-semibold text-ink-faint">{t("payroll.netPayroll")}</span>
                  <NetPayQualifierBadge />
                </div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalNet)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("payroll.journalEntry")}</div>
                <div className="mz-num mt-[5px] text-[12.5px] text-ink">{detail.journalEntryId ?? "—"}</div>
              </div>
            </Card>

            <div role="note" className="rounded-lg border border-info bg-info-soft p-[14px] text-info-ink">
              <h3 className="mb-[6px] font-display text-[13px] font-bold">{t("payroll.whatWasCalculatedItemsThis")}</h3>
              <p className="text-[12.5px] leading-relaxed">
                {t("payroll.theNetAboveCoversContractual")}
                <span className="mz-num font-semibold">{detail.employeeCount}</span> {t("payroll.employees3")}
              </p>
              <ul className="mt-[8px] flex flex-col gap-[6px] text-[12px]">
                {UNIVERSAL_UNIMPLEMENTED_RULES.map((rule) => (
                  <li key={rule.code}>
                    <span className="font-semibold">{rule.labelAr}</span> — {rule.detailAr}
                  </li>
                ))}
              </ul>
              {SITUATIONAL_UNIMPLEMENTED_RULES.length > 0 ? (
                <p className="mt-[10px] text-[12px] leading-relaxed">
                  {t("payroll.otherUncalculatedItemsApplyOnly")}
                </p>
              ) : null}
            </div>

            {detail.unpaidLeaveSource === "none" ? (
              <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
                {t("payroll.noSourceForUnpaidLeave")}
              </div>
            ) : null}

            {detail.warnings.length > 0 ? (
              <div className="rounded-lg border border-border p-[14px]">
                <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("payroll.calculationNotes")}</h3>
                <ul className="flex flex-col gap-[5px] text-[12.5px] text-ink-muted">
                  {detail.warnings.map((w, index) => (
                    <li key={index}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("payroll.payslips")}</h3>
              {detail.payslips.length > 0 ? (
                <div className="flex flex-col gap-[12px]">
                  {detail.payslips.map((p: PayslipDTO) => (
                    <div key={p.id} className="rounded-md border border-border p-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-ink">{employeeName(p.employeeId)}</span>
                        <span className="mz-num text-[11.5px] text-ink-faint">{p.number}</span>
                      </div>
                      <div className="mz-num mt-[3px] text-[11.5px] text-ink-faint">
                        {p.paidDays} / {p.periodDays} {t("payroll.days")}
                      </div>
                      <ul className="mt-[8px] flex flex-col gap-[4px]">
                        {p.lines.map((l) => (
                          <li key={l.id} className="flex items-center justify-between text-[12px]">
                            <span className="text-ink-muted">
                              {l.nameAr} <span className="text-ink-faint">({t(LINE_KIND_KEY[l.kind])})</span>
                            </span>
                            <MoneyDisplay value={Number(l.amount)} />
                          </li>
                        ))}
                      </ul>
                      <div className="mt-[8px] flex items-center justify-between border-t border-border pt-[8px] text-[12.5px] font-bold text-ink">
                        <span className="flex flex-wrap items-center gap-[6px]">
                          <span>{t("payroll.net")}</span>
                          <NetPayQualifierBadge />
                        </span>
                        <MoneyDisplay value={Number(p.netPay)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-muted">{t("payroll.thisRunHasNotBeen")}</p>
              )}
            </div>

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-[9px]">
              {detail.status === "draft" || detail.status === "calculated" ? (
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runAction(detail, "calculate")}>
                  {t("payroll.calculatePayroll")}
                </Button>
              ) : null}
              {detail.status === "calculated" ? (
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runAction(detail, "approve")}>
                  {t("payroll.approveAndPostTheEntry")}
                </Button>
              ) : null}
              {detail.status === "draft" || detail.status === "calculated" ? (
                <Button variant="danger-outline" disabled={pendingId === detail.id} onClick={() => runAction(detail, "cancel")}>
                  {t("payroll.cancelRun")}
                </Button>
              ) : null}
            </div>

            {detail.status === "approved" ? (
              <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px]">
                <h3 className="font-display text-[13px] font-bold text-ink">{t("payroll.payOutPayroll")}</h3>
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
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runDisburse(detail)}>
                  {t("payroll.payOut")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("payroll.newPayrollRun")} description={t("payroll.chooseThePeriodThenCalculate")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <NumberField label={t("payroll.year")} value={year} onChange={(v) => setYear(Number.isNaN(v) ? now.getUTCFullYear() : v)} min={1900} />
          <SelectField
            label={t("payroll.month")}
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1, t) }))}
          />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("payroll.create")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
