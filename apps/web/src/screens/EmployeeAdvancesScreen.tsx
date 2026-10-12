import { ReversalDocumentType } from "@mezan/contracts";
import { useReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  MoneyInput,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { EmployeeAdvanceDTO, EmployeeAdvanceStatusDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { ApiError, useBranches, useEmployees, useTreasuryAccounts } from "../data/hooks";
import {
  useDecideEmployeeAdvance,
  useDisburseEmployeeAdvance,
  useEmployeeAdvanceBalances,
  useEmployeeAdvances,
  useRequestEmployeeAdvance,
} from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { majorOf, sumMajor } from "../lib/money";
import { employeeDisplayName } from "./hr-employee-name";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { AdvanceRepaymentPanel } from "./AdvanceRepaymentPanel";

/** سلف الموظفين (Employee Advances) — docs/archive/catalog/06 §"سلف الموظفين". A cash advance is a DEBT on the employee (an asset, 1160), recovered from payroll in instalments — never an expense. */

const STATUS_KEY: Record<EmployeeAdvanceStatusDTO, AppTranslationKey> = {
  pending: "advances.status.pending",
  approved: "advances.status.approved",
  disbursed: "advances.status.disbursed",
  repaid: "advances.status.repaid",
  rejected: "advances.status.rejected",
  cancelled: "advances.status.cancelled",
};

const STATUS_TONE: Record<EmployeeAdvanceStatusDTO, PillTone> = {
  pending: "warning",
  approved: "info",
  disbursed: "success",
  repaid: "neutral",
  rejected: "danger",
  cancelled: "neutral",
};

interface AdvanceDraft {
  employeeId: string;
  amount: number | null;
  installmentCount: number;
  firstDeductionDate: string;
  reason: string;
}

function blankDraft(): AdvanceDraft {
  return { employeeId: "", amount: null, installmentCount: 3, firstDeductionDate: "", reason: "" };
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function EmployeeAdvancesScreen() {
  const reversal = useReverseDocumentAction(ReversalDocumentType.EmployeeAdvance);
  const nameOf = useEntityName();
  const { t, locale } = useAppTranslation();
  const query = useEmployeeAdvances();
  const balancesQuery = useEmployeeAdvanceBalances();
  const employeesQuery = useEmployees();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const requestAdvance = useRequestEmployeeAdvance();
  const decideAdvance = useDecideEmployeeAdvance();
  const disburseAdvance = useDisburseEmployeeAdvance();

  const advances = query.data ?? EMPTY;
  const employees = employeesQuery.data ?? EMPTY;
  const balances = balancesQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | EmployeeAdvanceStatusDTO,
    (next: string) => void,
  ];
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AdvanceDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState("");

  const employeeName = useCallback(
    (employeeId: string): string => {
      const e = employees.find((row) => row.id === employeeId);
      if (!e) return employeeId;
      return employeeDisplayName(e, locale);
    },
    [employees, locale],
  );

  const filtered = useMemo(() => {
    let rows = advances;
    if (statusFilter !== "all") rows = rows.filter((a) => a.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.number.toLowerCase().includes(q) || employeeName(a.employeeId).toLowerCase().includes(q));
    }
    return rows;
  }, [advances, statusFilter, search, employeeName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const selected = selectedId ? (advances.find((a) => a.id === selectedId) ?? null) : null;
  const employeeOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: `${e.code} — ${employeeName(e.id)}` }));
  const selectedOutstanding = selected ? (balances.find((b) => b.employeeId === selected.employeeId)?.outstanding ?? "0") : "0";

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "" || draft.amount === null || draft.firstDeductionDate.trim() === "") {
      setFormError(t("advances.theEmployeeTheAmountAnd"));
      return;
    }
    if (!Number.isInteger(draft.installmentCount) || draft.installmentCount < 1) {
      setFormError(t("advances.theNumberOfInstalmentsMust"));
      return;
    }
    setFormError(null);
    try {
      await requestAdvance.mutateAsync({
        employeeId: draft.employeeId,
        amount: draft.amount.toFixed(6),
        installmentCount: draft.installmentCount,
        firstDeductionDate: draft.firstDeductionDate.trim(),
        reason: draft.reason.trim() === "" ? null : draft.reason.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("advances.theAdvanceRequestCouldNot"));
    }
  }

  async function runDecision(advance: EmployeeAdvanceDTO, decision: "approve" | "reject") {
    if (pendingId !== null) return;
    setPendingId(advance.id);
    setDetailError(null);
    try {
      await decideAdvance.mutateAsync({ id: advance.id, decision });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("advances.theDecisionCouldNotBe"));
    } finally {
      setPendingId(null);
    }
  }

  async function runDisburse(advance: EmployeeAdvanceDTO) {
    if (pendingId !== null) return;
    if (treasuryAccountId === "" || branchId === "") {
      setDetailError(t("advances.chooseTheTreasuryAccountAnd"));
      return;
    }
    setPendingId(advance.id);
    setDetailError(null);
    try {
      await disburseAdvance.mutateAsync({ id: advance.id, body: { treasuryAccountId, branchId } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("advances.theAdvanceCouldNotBe"));
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: advances.length },
    { key: "pending", label: t(STATUS_KEY.pending), count: advances.filter((a) => a.status === "pending").length },
    { key: "approved", label: t(STATUS_KEY.approved), count: advances.filter((a) => a.status === "approved").length },
    { key: "disbursed", label: t(STATUS_KEY.disbursed), count: advances.filter((a) => a.status === "disbursed").length },
    { key: "repaid", label: t(STATUS_KEY.repaid), count: advances.filter((a) => a.status === "repaid").length },
  ];

  const columns: DocumentListColumn<EmployeeAdvanceDTO>[] = [
    { key: "number", header: t("advances.advanceNumber"), render: (a) => <span className="mz-num font-semibold text-ink">{a.number}</span> },
    { key: "employee", header: t("advances.employee"), render: (a) => employeeName(a.employeeId) },
    { key: "amount", header: t("common.amount"), align: "end", render: (a) => <MoneyDisplay value={Number(a.amount)} /> },
    { key: "outstanding", header: t("advances.remaining"), align: "end", render: (a) => <MoneyDisplay value={Number(a.outstanding)} /> },
    {
      key: "installments",
      header: t("advances.instalments"),
      render: (a) => (
        <span className="mz-num">
          {a.installments.filter((i) => Number(i.recovered) >= Number(i.amount)).length} / {a.installmentCount}
        </span>
      ),
    },
    { key: "status", header: t("common.status"), render: (a) => <StatusPill label={t(STATUS_KEY[a.status])} tone={STATUS_TONE[a.status]} /> },
  ];

  const totalOutstanding = sumMajor(balances.map((b) => b.outstanding));

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("advances.advancesCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<EmployeeAdvanceDTO>
        title={t("advances.employeeAdvances")}
        description={t("advances.anAdvanceIsADebt")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("advances.requestAnAdvance")}
          </Button>
        }
        listKey="employee-advances"
        statsCollapsible
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{advances.length}</span> },
          { label: t("advances.awaitingApproval"), value: <span className="mz-num">{advances.filter((a) => a.status === "pending").length}</span> },
          { label: t("advances.paidOut"), value: <span className="mz-num">{advances.filter((a) => a.status === "disbursed").length}</span> },
          { label: t("advances.totalOutstanding"), value: <MoneyDisplay value={totalOutstanding} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | EmployeeAdvanceStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("advances.searchByAdvanceNumberOr")}
        columns={columns}
        rows={pageRows}
        loading={branchesQuery.isLoading}
        rowKey={(a) => a.id}
        onRowClick={(a) => {
          setDetailError(null);
          setSelectedId(a.id);
        }}
        rowAction={(a) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => { setDetailError(null); setSelectedId(a.id); } },
            ...(a.status === "pending"
              ? [
                  { key: "approve", label: t("advances.approve"), disabled: pendingId === a.id, onSelect: () => void runDecision(a, "approve") },
                  { key: "reject", label: t("advances.reject"), tone: "danger" as const, disabled: pendingId === a.id, onSelect: () => void runDecision(a, "reject") },
                ]
              : []),
            // Paying out needs a treasury account the row cannot supply, so the
            // entry opens the detail panel that collects it rather than guessing.
            ...(a.status === "disbursed"
              ? [
                  {
                    key: "repay",
                    label: t("advances.repay"),
                    onSelect: () => {
                      setDetailError(null);
                      setSelectedId(a.id);
                    },
                  },
                ]
              : []),
            ...(a.status === "approved"
              ? [
                  {
                    key: "disburse",
                    label: t("advances.payOut"),
                    disabled: pendingId === a.id,
                    onSelect: () => {
                      setDetailError(null);
                      setSelectedId(a.id);
                    },
                  },
                ]
              : []),
            ...(a.status === "pending" || a.status === "approved" || a.status === "disbursed" ? reversal.menuItems({ id: a.id, params: { id: a.id }, subject: a.number }) : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: a.number })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{advances.length}</span> {t("advances.advances")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("advances.noAdvancesStartByRecording")}
            description={t("advances.emptyBody")}
            action={{ label: t("advances.requestAnAdvance"), onClick: openCreateForm }}
          />
        }
      />
      {reversal.dialog}

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.number : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.employee")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{employeeName(selected.employeeId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.amount")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selected.amount)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.outstandingOnThisAdvance")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selected.outstanding)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.theEmployeeSTotalAdvance")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selectedOutstanding)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.firstDeduction")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.firstDeductionDate}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.instalments2")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.installmentCount}</div>
              </div>
            </Card>

            {selected.reason ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.reason")}</div>
                <div className="mt-[5px] text-[13px] text-ink">{selected.reason}</div>
              </Card>
            ) : null}

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("advances.instalmentSchedule")}</h3>
              <ul className="flex flex-col gap-[6px]">
                {selected.installments.map((i) => (
                  <li key={i.seq} className="flex items-center justify-between text-[12.5px]">
                    <span className="mz-num text-ink-muted">
                      {i.seq}. {i.dueDate}
                    </span>
                    <span className="flex items-center gap-[10px]">
                      <MoneyDisplay value={Number(i.amount)} />
                      <span className="text-[11px] text-ink-faint">
                        {Number(i.recovered) >= Number(i.amount) ? t("advances.repaid2") : t("advances.repaidOf", { amount: i.recovered })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {(selected.repayments ?? []).length > 0 ? (
              <div className="rounded-lg border border-border p-[14px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("advances.repaymentsHistory")}</h3>
                <ul className="flex flex-col gap-[6px]">
                  {(selected.repayments ?? []).map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-[10px] text-[12.5px]">
                      <span className="mz-num text-ink-muted">
                        {r.date} · {t("advances.repaymentVoucher", { voucher: r.voucherNo ?? r.voucherId })}
                      </span>
                      <MoneyDisplay value={majorOf(r.amount)} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selected.status === "disbursed" ? (
              <AdvanceRepaymentPanel key={selected.id} advance={selected} treasuryAccounts={treasuryAccounts.map((account) => ({ value: account.id, label: `${account.code} — ${nameOf(account)}` }))} branches={branches.map((b) => ({ value: b.id, label: b.name }))} />
            ) : null}

            {selected.disbursementVoucherId ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("advances.disbursementVoucher")}</div>
                <div className="mz-num mt-[5px] text-[12.5px] text-ink">{selected.disbursementVoucherId}</div>
              </Card>
            ) : null}

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            {selected.status === "pending" ? (
              <div className="flex gap-[9px]">
                <Button variant="primary" disabled={pendingId === selected.id} onClick={() => runDecision(selected, "approve")}>
                  {t("advances.approve")}
                </Button>
                <Button variant="danger-outline" disabled={pendingId === selected.id} onClick={() => runDecision(selected, "reject")}>
                  {t("advances.reject")}
                </Button>
              </div>
            ) : null}

            {selected.status === "approved" ? (
              <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px]">
                <h3 className="font-display text-[13px] font-bold text-ink">{t("advances.payOutAdvance")}</h3>
                <p className="text-[12px] text-ink-muted">{t("advances.thisIssuesACashDisbursement")}</p>
                <SelectField
                  label={t("advances.treasuryAccount")}
                  value={treasuryAccountId}
                  onChange={setTreasuryAccountId}
                  options={[{ value: "", label: t("advances.choose") }, ...treasuryAccounts.map((account) => ({ value: account.id, label: `${account.code} — ${nameOf(account)}` }))]}
                />
                <SelectField
                  label={t("advances.branch")}
                  value={branchId}
                  onChange={setBranchId}
                  options={[{ value: "", label: t("advances.choose") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
                <Button variant="primary" disabled={pendingId === selected.id} onClick={() => runDisburse(selected)}>
                  {t("advances.payOut")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("advances.requestAnAdvance")} description={t("advances.anAdvanceIsADebt2")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label={t("advances.employee2")}
            options={employeeOptions}
            value={draft.employeeId ? (employeeOptions.find((o) => o.id === draft.employeeId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("advances.amount")}</div>
            <MoneyInput aria-label={t("common.amount")} value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
          </div>
          <NumberField
            label={t("advances.numberOfInstalments")}
            value={draft.installmentCount}
            onChange={(v) => setDraft((d) => ({ ...d, installmentCount: Number.isNaN(v) ? 1 : v }))}
            min={1}
            hint={t("advances.theAmountIsSplitEvenly")}
          />
          <TextField
            label={t("advances.firstDeduction2")}
            value={draft.firstDeductionDate}
            onChange={(v) => setDraft((d) => ({ ...d, firstDeductionDate: v }))}
            placeholder="YYYY-MM-DD"
          />
          <TextField label={t("advances.reason")} value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
