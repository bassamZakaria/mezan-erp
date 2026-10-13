import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  RowActionOutcome,
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
import type {
  ContractDTO,
  PayBasisDTO,
  ContractStatusDTO,
  ContractTypeDTO,
  PayFrequencyDTO,
  PayrollComponentDTO,
  PayrollComponentKindDTO,
} from "@mezan/contracts";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { ApiError, useContracts, useCreateContract, useEmployees, useTerminateContract } from "../data/hooks";
import { usePayrollComponents } from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { employeeDisplayName } from "./hr-employee-name";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** العقود (Contracts) — docs/archive/catalog/06 §"العقود". Formal employment contract per employee: type/pay-basis/frequency, salary, currency, allowances/deductions, leave-entitlement overrides. */

const TYPE_KEY: Record<ContractTypeDTO, AppTranslationKey> = {
  indefinite: "contracts.type.indefinite",
  fixed_term: "contracts.type.fixed_term",
  seasonal: "contracts.type.seasonal",
  probationary: "contracts.type.probationary",
};

// A contract's `monthlySalary` is its rate in the unit of its pay basis: the month's, the hour's or the day's.
const RATE_KEY: Record<Exclude<PayBasisDTO, "monthly">, AppTranslationKey> = { hourly: "contracts.rate.hourly", daily: "contracts.rate.daily" };
const PAY_BASIS_KEY: Record<PayBasisDTO, AppTranslationKey> = { monthly: "contracts.payBasis.monthly", hourly: "contracts.payBasis.hourly", daily: "contracts.payBasis.daily" };
const PAY_FREQUENCY_KEY: Record<PayFrequencyDTO, AppTranslationKey> = { monthly: "contracts.payFreq.monthly", biweekly: "contracts.payFreq.biweekly", weekly: "contracts.payFreq.weekly" };
const STATUS_KEY: Record<ContractStatusDTO, AppTranslationKey> = { active: "contracts.status.active", terminated: "contracts.status.terminated" };
const STATUS_TONE: Record<ContractStatusDTO, PillTone> = { active: "success", terminated: "neutral" };
const CURRENCIES = ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "USD", "EUR", "GBP"];
const PAGE_SIZES = [10, 25, 50, 100] as const;

interface ContractDraft {
  employeeId: string;
  type: ContractTypeDTO;
  payBasis: PayBasisDTO;
  payFrequency: PayFrequencyDTO;
  startDate: string;
  endDate: string;
  monthlySalary: number | null;
  currency: string;
  annualLeaveDays: number | null;
  sickLeaveDays: number | null;
  personalLeaveDays: number | null;
  lines: ContractLineDraft[];
}

interface ContractLineDraft {
  key: string;
  componentId: string;
  amount: number | null;
}

function blankDraft(): ContractDraft {
  return {
    employeeId: "",
    type: "indefinite",
    payBasis: "monthly",
    payFrequency: "monthly",
    startDate: "",
    endDate: "",
    monthlySalary: null,
    currency: "EGP",
    lines: [],
    annualLeaveDays: null,
    sickLeaveDays: null,
    personalLeaveDays: null,
  };
}

export function ContractsScreen() {
  const { t, locale } = useAppTranslation();
  const query = useContracts();
  const employeesQuery = useEmployees();
  const createContract = useCreateContract();
  const terminateContract = useTerminateContract();
  const components = usePayrollComponents().data ?? [];
  const contracts = query.data ?? EMPTY;
  const employees = employeesQuery.data ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | ContractStatusDTO | "expiring_soon",
    (next: string) => void,
  ];
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ContractDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const employeeName = useCallback(
    (employeeId: string): string => {
      const e = employees.find((row) => row.id === employeeId);
      if (!e) return employeeId;
      return employeeDisplayName(e, locale);
    },
    [employees, locale],
  );

  const filtered = useMemo(() => {
    let rows = contracts;
    if (statusFilter === "expiring_soon") rows = rows.filter((c) => c.expiringSoon);
    else if (statusFilter !== "all") rows = rows.filter((c) => c.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => c.number.toLowerCase().includes(q) || employeeName(c.employeeId).toLowerCase().includes(q));
    }
    return rows;
  }, [contracts, statusFilter, search, employeeName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const selected = selectedId ? (contracts.find((c) => c.id === selectedId) ?? null) : null;

  const employeeOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: `${e.code} — ${employeeName(e.id)}` }));
  const componentOptions: EntityPickerOption[] = components
    .filter((component) => component.active && component.kind !== "employer_contribution")
    .map((component) => ({
      id: component.id,
      label: locale === "ar" ? component.nameAr : (component.nameEn ?? component.nameAr),
      sublabel: `${component.code} · ${t(component.kind === "earning" ? "payrollComponents.earning" : "payrollComponents.deduction")}`,
    }));

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function componentOf(componentId: string): PayrollComponentDTO | undefined {
    return components.find((component) => component.id === componentId);
  }

  // The line's NAME comes from the bound component, never from free text: the
  // component is what carries the GL account the payslip line posts to.
  function linePayload(kind: PayrollComponentKindDTO) {
    return draft.lines
      .filter((line) => line.componentId !== "" && line.amount !== null && componentOf(line.componentId)?.kind === kind)
      .map((line) => ({
        name: componentOf(line.componentId)!.nameAr,
        amount: (line.amount ?? 0).toFixed(6),
        componentId: line.componentId,
      }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "" || draft.startDate.trim() === "" || draft.monthlySalary === null) {
      setFormError(t("contracts.theEmployeeTheStartDate"));
      return;
    }
    if (draft.type !== "indefinite" && draft.endDate.trim() === "") {
      setFormError(t("contracts.anEndDateIsRequired"));
      return;
    }
    setFormError(null);
    try {
      await createContract.mutateAsync({
        employeeId: draft.employeeId,
        type: draft.type,
        payBasis: draft.payBasis,
        payFrequency: draft.payFrequency,
        startDate: draft.startDate.trim(),
        endDate: draft.type === "indefinite" ? null : draft.endDate.trim(),
        monthlySalary: draft.monthlySalary.toFixed(6),
        currency: draft.currency,
        leaveEntitlement: {
          annualLeaveDays: draft.annualLeaveDays,
          sickLeaveDays: draft.sickLeaveDays,
          personalLeaveDays: draft.personalLeaveDays,
        },
        allowances: linePayload("earning"),
        deductions: linePayload("deduction"),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("contracts.theContractCouldNotBe"));
    }
  }

  async function runTerminate(contract: ContractDTO) {
    if (pendingId) return;
    setPendingId(contract.id);
    setDetailError(null);
    try {
      await terminateContract.mutateAsync(contract.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("contracts.theContractCouldNotBe2"));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  const expiringSoonCount = contracts.filter((c) => c.expiringSoon).length;

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: contracts.length },
    { key: "active", label: t("contracts.active"), count: contracts.filter((c) => c.status === "active").length },
    { key: "terminated", label: t("contracts.terminated"), count: contracts.filter((c) => c.status === "terminated").length },
    { key: "expiring_soon", label: t("contracts.expiringSoon"), count: expiringSoonCount },
  ];

  const columns: DocumentListColumn<ContractDTO>[] = [
    { key: "number", header: t("contracts.contractNumber"), render: (c) => <span className="mz-num font-semibold text-ink">{c.number}</span> },
    { key: "employee", header: t("contracts.employee"), render: (c) => employeeName(c.employeeId) },
    { key: "type", header: t("contracts.contractType"), render: (c) => t(TYPE_KEY[c.type]) },
    { key: "startDate", header: t("contracts.startDate"), render: (c) => <span className="mz-num">{c.startDate}</span> },
    {
      key: "endDate",
      header: t("contracts.endDate"),
      render: (c) => (
        <span className="flex items-center gap-[6px]">
          <span className="mz-num">{c.endDate ?? "—"}</span>
          {c.expiringSoon ? <StatusPill label={t("contracts.expiringSoon")} tone="warning" /> : null}
        </span>
      ),
    },
    {
      key: "salary",
      header: t("contracts.basicSalary"),
      align: "end",
      render: (c) => (
        <span className="inline-flex items-baseline gap-[4px]">
          <MoneyDisplay value={Number(c.monthlySalary)} currencyLabel={c.currency === "EGP" ? undefined : c.currency} />
          {c.payBasis === "monthly" ? null : <span className="text-[11px] text-ink-faint">{t(c.payBasis === "hourly" ? "contracts.perHour" : "contracts.perDay")}</span>}
        </span>
      ),
    },
    { key: "status", header: t("common.status"), render: (c) => <StatusPill label={t(STATUS_KEY[c.status])} tone={STATUS_TONE[c.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("contracts.contractsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<ContractDTO>
        title={t("contracts.contracts")}
        description={t("contracts.eachEmployeeSFormalContract")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("contracts.addContract")}
          </Button>
        }
        listKey="contracts"
        statsCollapsible
        stats={[
          { label: t("contracts.totalContracts"), value: <span className="mz-num">{contracts.length}</span> },
          { label: t("contracts.activeContracts"), value: <span className="mz-num">{contracts.filter((c) => c.status === "active").length}</span> },
          {
            label: t("contracts.expiringWithin30Days"),
            value: <span className="mz-num">{expiringSoonCount}</span>,
            valueTone: expiringSoonCount > 0 ? ("danger" as const) : ("default" as const),
          },
        ]}
        attentionBanners={[
          {
            key: "expiring-soon",
            label: t("contracts.contractsEndingWithin30", { count: expiringSoonCount }),
            count: expiringSoonCount,
            tone: "warning",
            onApply: () => {
              setStatusFilter("expiring_soon");
              setPage(1);
            },
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | ContractStatusDTO | "expiring_soon");
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("contracts.searchByContractNumberOr")}
        columns={columns}
        rows={pageRows}
        loading={employeesQuery.isLoading}
        rowKey={(c) => c.id}
        onRowClick={(c) => {
          setDetailError(null);
          setSelectedId(c.id);
        }}
        rowAction={(c) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => { setDetailError(null); setSelectedId(c.id); } },
            ...(c.status === "active"
              ? [{ key: "terminate", label: t("contracts.endContract"), tone: "danger" as const, disabled: pendingId === c.id, onSelect: () => runTerminate(c) }]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: c.number })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{contracts.length}</span> {t("contracts.contracts2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("contracts.nothingToShow")}
            description={t("contracts.emptyBody")}
            action={{ label: t("contracts.addContract"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.number : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.employee")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{employeeName(selected.employeeId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.contractType")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(TYPE_KEY[selected.type])}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.payBasis")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(PAY_BASIS_KEY[selected.payBasis])}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.payFrequency")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(PAY_FREQUENCY_KEY[selected.payFrequency])}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.startDate")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.startDate}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.endDate")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.endDate ?? "—"}</div>
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">
                {selected.payBasis === "monthly" ? t("contracts.monthlySalary2") : `${t(RATE_KEY[selected.payBasis])} (`}
                {selected.currency})
              </div>
              <div className="mt-[6px]">
                <MoneyDisplay value={Number(selected.monthlySalary)} className="text-[18px] font-bold" />
              </div>
            </Card>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("contracts.leaveEntitlement")}</h3>
              <dl className="grid grid-cols-3 gap-[10px] text-[12.5px]">
                <div>
                  <dt className="text-ink-faint">{t("contracts.annualLeave")}</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.annualLeaveDays ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("contracts.sickLeave")}</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.sickLeaveDays ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">{t("contracts.personalLeave")}</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.personalLeaveDays ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("contracts.allowances")}</h3>
              {selected.allowances.length > 0 ? (
                <ul className="flex flex-col gap-[6px]">
                  {selected.allowances.map((a) => (
                    <li key={a.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-ink">{a.name}</span>
                      <MoneyDisplay value={Number(a.amount)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-muted">{t("contracts.noAllowances")}</p>
              )}
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("contracts.deductions")}</h3>
              {selected.deductions.length > 0 ? (
                <ul className="flex flex-col gap-[6px]">
                  {selected.deductions.map((d) => (
                    <li key={d.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-ink">{d.name}</span>
                      <MoneyDisplay value={Number(d.amount)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-muted">{t("contracts.noDeductions")}</p>
              )}
            </div>

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            {selected.status === "active" ? (
              <Button variant="danger-outline" disabled={pendingId === selected.id} onClick={() => void runTerminate(selected)}>
                {t("contracts.endContract")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("contracts.newContract")} description={t("contracts.theContractSCoreDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label={t("contracts.employee2")}
            options={employeeOptions}
            value={draft.employeeId ? (employeeOptions.find((o) => o.id === draft.employeeId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
          />
          <SelectField
            label={t("contracts.contractType2")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ContractTypeDTO }))}
            options={(Object.keys(TYPE_KEY) as ContractTypeDTO[]).map((code) => ({ value: code, label: t(TYPE_KEY[code]) }))}
          />
          <SelectField
            label={t("contracts.payBasis2")}
            value={draft.payBasis}
            onChange={(v) => setDraft((d) => ({ ...d, payBasis: v as PayBasisDTO }))}
            options={(Object.keys(PAY_BASIS_KEY) as PayBasisDTO[]).map((p) => ({ value: p, label: t(PAY_BASIS_KEY[p]) }))}
          />
          <SelectField
            label={t("contracts.payFrequency2")}
            value={draft.payFrequency}
            onChange={(v) => setDraft((d) => ({ ...d, payFrequency: v as PayFrequencyDTO }))}
            options={(Object.keys(PAY_FREQUENCY_KEY) as PayFrequencyDTO[]).map((p) => ({ value: p, label: t(PAY_FREQUENCY_KEY[p]) }))}
          />
          <TextField label={t("contracts.startDate2")} value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField
            label={t("contracts.endDate")}
            value={draft.endDate}
            onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            placeholder="YYYY-MM-DD"
            disabled={draft.type === "indefinite"}
            hint={draft.type === "indefinite" ? t("contracts.anOpenEndedContractHas") : undefined}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">
              {draft.payBasis === "monthly" ? t("contracts.monthlySalary3") : `${t(RATE_KEY[draft.payBasis])} *`}
            </div>
            <MoneyInput
              aria-label={draft.payBasis === "monthly" ? t("contracts.monthlySalary4") : t(RATE_KEY[draft.payBasis])}
              value={draft.monthlySalary}
              onChange={(v) => setDraft((d) => ({ ...d, monthlySalary: v }))}
            />
          </div>
          <SelectField
            label={t("contracts.currency")}
            value={draft.currency}
            onChange={(v) => setDraft((d) => ({ ...d, currency: v }))}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          <NumberField
            label={t("contracts.annualLeaveDays")}
            value={draft.annualLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, annualLeaveDays: Number.isNaN(v) ? null : v }))}
            hint={t("contracts.leaveEmptyToUseThe")}
          />
          <NumberField
            label={t("contracts.sickLeaveDays")}
            value={draft.sickLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, sickLeaveDays: Number.isNaN(v) ? null : v }))}
          />
          <NumberField
            label={t("contracts.personalLeaveDays")}
            value={draft.personalLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, personalLeaveDays: Number.isNaN(v) ? null : v }))}
          />
          <div className="flex flex-col gap-[10px] rounded-md border border-border p-[12px]">
            <div className="flex items-center justify-between gap-[10px]">
              <span className="text-[12.5px] font-semibold text-ink">{t("contracts.allowancesAndDeductions")}</span>
              <Button
                type="button"
                size="sm"
                onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { key: `line-${Date.now()}`, componentId: "", amount: null }] }))}
              >
                {t("contracts.addLine")}
              </Button>
            </div>
            {draft.lines.length === 0 ? (
              <p className="text-[12px] text-ink-muted">{t("contracts.noAllowanceOrDeductionLines")}</p>
            ) : null}
            {draft.lines.map((line, index) => (
              <div key={line.key} className="flex flex-wrap items-end gap-[10px]">
                <div className="min-w-[220px] flex-1">
                  <EntityPicker
                    label={t("contracts.component")}
                    options={componentOptions}
                    value={componentOptions.find((option) => option.id === line.componentId) ?? null}
                    onChange={(option) =>
                      setDraft((d) => ({
                        ...d,
                        lines: d.lines.map((row, i) => (i === index ? { ...row, componentId: option?.id ?? "" } : row)),
                      }))
                    }
                    placeholder={t("contracts.pickAComponent")}
                  />
                </div>
                <div className="min-w-[140px]">
                  <span className="mb-[4px] block text-[11.5px] font-semibold text-ink-muted">{t("contracts.amount")}</span>
                  <MoneyInput
                    aria-label={t("contracts.amount")}
                    value={line.amount}
                    onChange={(value) =>
                      setDraft((d) => ({ ...d, lines: d.lines.map((row, i) => (i === index ? { ...row, amount: value } : row)) }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  aria-label={t("contracts.removeLine")}
                  onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }))}
                >
                  {t("contracts.removeLine")}
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
