import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { ContractDTO, PayBasisDTO, ContractStatusDTO, ContractTypeDTO, PayFrequencyDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { ApiError, useContracts, useCreateContract, useEmployees, useTerminateContract } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** العقود (Contracts) — docs/catalog/06 §"العقود". Formal employment contract per employee: type/pay-basis/frequency, salary, currency, allowances/deductions, leave-entitlement overrides. */

const TYPE_KEY: Record<ContractTypeDTO, AppTranslationKey> = {
  indefinite: "contracts.type.indefinite",
  fixed_term: "contracts.type.fixed_term",
  seasonal: "contracts.type.seasonal",
  probationary: "contracts.type.probationary",
};

const PAY_BASIS_KEY: Record<PayBasisDTO, AppTranslationKey> = { monthly: "contracts.payBasis.monthly", hourly: "contracts.payBasis.hourly", daily: "contracts.payBasis.daily" };
const PAY_FREQUENCY_KEY: Record<PayFrequencyDTO, AppTranslationKey> = { monthly: "contracts.payFreq.monthly", biweekly: "contracts.payFreq.biweekly", weekly: "contracts.payFreq.weekly" };
const STATUS_KEY: Record<ContractStatusDTO, AppTranslationKey> = { active: "contracts.status.active", terminated: "contracts.status.terminated" };
const STATUS_TONE: Record<ContractStatusDTO, PillTone> = { active: "success", terminated: "neutral" };
const CURRENCIES = ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "USD", "EUR", "GBP"];

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
    annualLeaveDays: null,
    sickLeaveDays: null,
    personalLeaveDays: null,
  };
}

export function ContractsScreen() {
  const { t } = useAppTranslation();
  const query = useContracts();
  const employeesQuery = useEmployees();
  const createContract = useCreateContract();
  const terminateContract = useTerminateContract();
  const contracts = query.data ?? [];
  const employees = employeesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContractStatusDTO | "expiring_soon">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ContractDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);

  function employeeName(employeeId: string): string {
    const e = employees.find((row) => row.id === employeeId);
    if (!e) return employeeId;
    const ar = [e.firstNameAr, e.lastNameAr].filter(Boolean).join(" ").trim();
    return ar || `${e.firstName} ${e.lastName}`;
  }

  const filtered = useMemo(() => {
    let rows = contracts;
    if (statusFilter === "expiring_soon") rows = rows.filter((c) => c.expiringSoon);
    else if (statusFilter !== "all") rows = rows.filter((c) => c.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((c) => c.number.toLowerCase().includes(q) || employeeName(c.employeeId).toLowerCase().includes(q));
    }
    return rows;
  }, [contracts, statusFilter, search, employees]);

  const selected = selectedId ? (contracts.find((c) => c.id === selectedId) ?? null) : null;

  const employeeOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: `${e.code} — ${employeeName(e.id)}` }));

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
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
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("contracts.theContractCouldNotBe"));
    }
  }

  async function runTerminate() {
    if (!selected || pendingAction) return;
    setPendingAction(true);
    setDetailError(null);
    try {
      await terminateContract.mutateAsync(selected.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("contracts.theContractCouldNotBe2"));
    } finally {
      setPendingAction(false);
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
    { key: "salary", header: t("contracts.basicSalary"), align: "end", render: (c) => <MoneyDisplay value={Number(c.monthlySalary)} /> },
    { key: "status", header: t("common.status"), render: (c) => <StatusPill label={t(STATUS_KEY[c.status])} tone={STATUS_TONE[c.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("contracts.contractsCouldNotBeLoaded")}</p>
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
            onApply: () => setStatusFilter("expiring_soon"),
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ContractStatusDTO | "expiring_soon")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("contracts.searchByContractNumberOr")}
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => {
          setDetailError(null);
          setSelectedId(c.id);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{contracts.length}</span> {t("contracts.contracts2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("contracts.nothingToShow")}</div>}
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
              <div className="text-[11px] font-semibold text-ink-faint">{t("contracts.monthlySalary2")}{selected.currency})</div>
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
              <Button variant="danger-outline" disabled={pendingAction} onClick={runTerminate}>
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
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("contracts.monthlySalary3")}</div>
            <MoneyInput aria-label={t("contracts.monthlySalary4")} value={draft.monthlySalary} onChange={(v) => setDraft((d) => ({ ...d, monthlySalary: v }))} />
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
