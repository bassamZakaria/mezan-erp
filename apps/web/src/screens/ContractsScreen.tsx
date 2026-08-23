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

/** العقود (Contracts) — docs/catalog/06 §"العقود". Formal employment contract per employee: type/pay-basis/frequency, salary, currency, allowances/deductions, leave-entitlement overrides. */

const TYPE_LABEL: Record<ContractTypeDTO, string> = {
  indefinite: "غير محدد المدة",
  fixed_term: "محدد المدة",
  seasonal: "موسمي",
  probationary: "تجريبي",
};

const PAY_BASIS_LABEL: Record<PayBasisDTO, string> = { monthly: "راتب شهري", hourly: "بالساعة", daily: "باليوم" };
const PAY_FREQUENCY_LABEL: Record<PayFrequencyDTO, string> = { monthly: "شهري", biweekly: "كل أسبوعين", weekly: "أسبوعي" };
const STATUS_LABEL: Record<ContractStatusDTO, string> = { active: "ساري", terminated: "مفسوخ" };
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
  const query = useContracts();
  const employeesQuery = useEmployees();
  const createContract = useCreateContract();
  const terminateContract = useTerminateContract();
  const contracts = query.data ?? [];
  const employees = employeesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ContractStatusDTO>("all");

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
    if (statusFilter !== "all") rows = rows.filter((c) => c.status === statusFilter);
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
      setFormError("الموظف وتاريخ البداية والراتب الشهري مطلوبة.");
      return;
    }
    if (draft.type !== "indefinite" && draft.endDate.trim() === "") {
      setFormError("تاريخ الانتهاء مطلوب للعقود محددة المدة/الموسمية/التجريبية.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة العقد.");
    }
  }

  async function runTerminate() {
    if (!selected || pendingAction) return;
    setPendingAction(true);
    setDetailError(null);
    try {
      await terminateContract.mutateAsync(selected.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر إنهاء العقد.");
    } finally {
      setPendingAction(false);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: contracts.length },
    { key: "active", label: "ساري", count: contracts.filter((c) => c.status === "active").length },
    { key: "terminated", label: "مفسوخ", count: contracts.filter((c) => c.status === "terminated").length },
  ];

  const columns: DocumentListColumn<ContractDTO>[] = [
    { key: "number", header: "رقم العقد", render: (c) => <span className="mz-num font-semibold text-ink">{c.number}</span> },
    { key: "employee", header: "اسم الموظف", render: (c) => employeeName(c.employeeId) },
    { key: "type", header: "نوع العقد", render: (c) => TYPE_LABEL[c.type] },
    { key: "startDate", header: "تاريخ البداية", render: (c) => <span className="mz-num">{c.startDate}</span> },
    { key: "endDate", header: "تاريخ الانتهاء", render: (c) => <span className="mz-num">{c.endDate ?? "—"}</span> },
    { key: "salary", header: "الراتب الأساسي", align: "end", render: (c) => <MoneyDisplay value={Number(c.monthlySalary)} /> },
    { key: "status", header: "الحالة", render: (c) => <StatusPill label={STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل العقود.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<ContractDTO>
        eyebrow="HR · Contracts"
        title="العقود"
        description="العقد الرسمي لكل موظف: نوع العقد، أساس وتكرار الدفع، الراتب، البدلات والاستقطاعات"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة عقد
          </Button>
        }
        stats={[
          { label: "إجمالي العقود", value: <span className="mz-num">{contracts.length}</span> },
          { label: "عقود سارية", value: <span className="mz-num">{contracts.filter((c) => c.status === "active").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ContractStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم العقد أو اسم الموظف..."
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
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{contracts.length}</span> عقد
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.number : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">اسم الموظف</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{employeeName(selected.employeeId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">نوع العقد</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{TYPE_LABEL[selected.type]}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">أساس الدفع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{PAY_BASIS_LABEL[selected.payBasis]}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تكرار الدفع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{PAY_FREQUENCY_LABEL[selected.payFrequency]}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ البداية</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.startDate}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الانتهاء</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.endDate ?? "—"}</div>
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">الراتب الشهري ({selected.currency})</div>
              <div className="mt-[6px]">
                <MoneyDisplay value={Number(selected.monthlySalary)} className="text-[18px] font-bold" />
              </div>
            </Card>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">استحقاق الإجازات</h3>
              <dl className="grid grid-cols-3 gap-[10px] text-[12.5px]">
                <div>
                  <dt className="text-ink-faint">الإجازة السنوية</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.annualLeaveDays ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">إجازة مرضية</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.sickLeaveDays ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">الإجازة الشخصية</dt>
                  <dd className="mz-num text-ink">{selected.leaveEntitlement.personalLeaveDays ?? "—"}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">البدلات</h3>
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
                <p className="text-[12.5px] text-ink-muted">لا توجد بدلات</p>
              )}
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">الاستقطاعات</h3>
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
                <p className="text-[12.5px] text-ink-muted">لا توجد خصومات</p>
              )}
            </div>

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            {selected.status === "active" ? (
              <Button variant="danger-outline" disabled={pendingAction} onClick={runTerminate}>
                إنهاء العقد
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="عقد جديد" description="بيانات العقد الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label="اسم الموظف *"
            options={employeeOptions}
            value={draft.employeeId ? (employeeOptions.find((o) => o.id === draft.employeeId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
          />
          <SelectField
            label="نوع العقد *"
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ContractTypeDTO }))}
            options={(Object.keys(TYPE_LABEL) as ContractTypeDTO[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
          />
          <SelectField
            label="أساس الدفع *"
            value={draft.payBasis}
            onChange={(v) => setDraft((d) => ({ ...d, payBasis: v as PayBasisDTO }))}
            options={(Object.keys(PAY_BASIS_LABEL) as PayBasisDTO[]).map((p) => ({ value: p, label: PAY_BASIS_LABEL[p] }))}
          />
          <SelectField
            label="تكرار الدفع *"
            value={draft.payFrequency}
            onChange={(v) => setDraft((d) => ({ ...d, payFrequency: v as PayFrequencyDTO }))}
            options={(Object.keys(PAY_FREQUENCY_LABEL) as PayFrequencyDTO[]).map((p) => ({ value: p, label: PAY_FREQUENCY_LABEL[p] }))}
          />
          <TextField label="تاريخ البداية *" value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField
            label="تاريخ الانتهاء"
            value={draft.endDate}
            onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
            placeholder="YYYY-MM-DD"
            disabled={draft.type === "indefinite"}
            hint={draft.type === "indefinite" ? "العقد غير محدد المدة لا يحتوي على تاريخ انتهاء" : undefined}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">الراتب الشهري *</div>
            <MoneyInput aria-label="الراتب الشهري" value={draft.monthlySalary} onChange={(v) => setDraft((d) => ({ ...d, monthlySalary: v }))} />
          </div>
          <SelectField
            label="العملة *"
            value={draft.currency}
            onChange={(v) => setDraft((d) => ({ ...d, currency: v }))}
            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
          />
          <NumberField
            label="الإجازة السنوية (أيام)"
            value={draft.annualLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, annualLeaveDays: Number.isNaN(v) ? null : v }))}
            hint="اتركه فارغاً لاستخدام قيمة سياسة الإجازة"
          />
          <NumberField
            label="إجازة مرضية (أيام)"
            value={draft.sickLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, sickLeaveDays: Number.isNaN(v) ? null : v }))}
          />
          <NumberField
            label="الإجازة الشخصية (أيام)"
            value={draft.personalLeaveDays ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, personalLeaveDays: Number.isNaN(v) ? null : v }))}
          />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              حفظ
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
