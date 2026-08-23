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

/** سلف الموظفين (Employee Advances) — docs/catalog/06 §"سلف الموظفين". A cash advance is a DEBT on the employee (an asset, 1160), recovered from payroll in instalments — never an expense. */

const STATUS_LABEL: Record<EmployeeAdvanceStatusDTO, string> = {
  pending: "في انتظار الاعتماد",
  approved: "معتمدة",
  disbursed: "مصروفة",
  repaid: "مسددة",
  rejected: "مرفوضة",
};

const STATUS_TONE: Record<EmployeeAdvanceStatusDTO, PillTone> = {
  pending: "warning",
  approved: "info",
  disbursed: "success",
  repaid: "neutral",
  rejected: "danger",
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

export function EmployeeAdvancesScreen() {
  const query = useEmployeeAdvances();
  const balancesQuery = useEmployeeAdvanceBalances();
  const employeesQuery = useEmployees();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const requestAdvance = useRequestEmployeeAdvance();
  const decideAdvance = useDecideEmployeeAdvance();
  const disburseAdvance = useDisburseEmployeeAdvance();

  const advances = query.data ?? [];
  const employees = employeesQuery.data ?? [];
  const balances = balancesQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EmployeeAdvanceStatusDTO>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AdvanceDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState("");

  function employeeName(employeeId: string): string {
    const e = employees.find((row) => row.id === employeeId);
    if (!e) return employeeId;
    const ar = [e.firstNameAr, e.lastNameAr].filter(Boolean).join(" ").trim();
    return ar || `${e.firstName} ${e.lastName}`;
  }

  const filtered = useMemo(() => {
    let rows = advances;
    if (statusFilter !== "all") rows = rows.filter((a) => a.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.number.toLowerCase().includes(q) || employeeName(a.employeeId).toLowerCase().includes(q));
    }
    return rows;
  }, [advances, statusFilter, search, employees]);

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
      setFormError("الموظف والمبلغ وتاريخ أول خصم مطلوبة.");
      return;
    }
    if (!Number.isInteger(draft.installmentCount) || draft.installmentCount < 1) {
      setFormError("عدد الأقساط يجب أن يكون رقماً صحيحاً أكبر من صفر.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّر تسجيل طلب السلفة.");
    }
  }

  async function runDecision(advance: EmployeeAdvanceDTO, decision: "approve" | "reject") {
    if (pendingId !== null) return;
    setPendingId(advance.id);
    setDetailError(null);
    try {
      await decideAdvance.mutateAsync({ id: advance.id, decision });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر تنفيذ القرار.");
    } finally {
      setPendingId(null);
    }
  }

  async function runDisburse(advance: EmployeeAdvanceDTO) {
    if (pendingId !== null) return;
    if (treasuryAccountId === "" || branchId === "") {
      setDetailError("اختر الخزينة والفرع قبل الصرف.");
      return;
    }
    setPendingId(advance.id);
    setDetailError(null);
    try {
      await disburseAdvance.mutateAsync({ id: advance.id, body: { treasuryAccountId, branchId } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر صرف السلفة.");
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: advances.length },
    { key: "pending", label: STATUS_LABEL.pending, count: advances.filter((a) => a.status === "pending").length },
    { key: "approved", label: STATUS_LABEL.approved, count: advances.filter((a) => a.status === "approved").length },
    { key: "disbursed", label: STATUS_LABEL.disbursed, count: advances.filter((a) => a.status === "disbursed").length },
    { key: "repaid", label: STATUS_LABEL.repaid, count: advances.filter((a) => a.status === "repaid").length },
  ];

  const columns: DocumentListColumn<EmployeeAdvanceDTO>[] = [
    { key: "number", header: "رقم السلفة", render: (a) => <span className="mz-num font-semibold text-ink">{a.number}</span> },
    { key: "employee", header: "الموظف", render: (a) => employeeName(a.employeeId) },
    { key: "amount", header: "المبلغ", align: "end", render: (a) => <MoneyDisplay value={Number(a.amount)} /> },
    { key: "outstanding", header: "المتبقي", align: "end", render: (a) => <MoneyDisplay value={Number(a.outstanding)} /> },
    {
      key: "installments",
      header: "الأقساط",
      render: (a) => (
        <span className="mz-num">
          {a.installments.filter((i) => Number(i.recovered) >= Number(i.amount)).length} / {a.installmentCount}
        </span>
      ),
    },
    { key: "status", header: "الحالة", render: (a) => <StatusPill label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} /> },
  ];

  const totalOutstanding = balances.reduce((sum, b) => sum + Number(b.outstanding), 0);

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل السلف.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<EmployeeAdvanceDTO>
        eyebrow="HR · Advances"
        title="سلف الموظفين"
        description="السلفة دين على الموظف (أصل) — لا تحتسب مصروفاً إلا عند الشطب، وتُسترد بأقساط من الرواتب"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            طلب سلفة
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{advances.length}</span> },
          { label: "في انتظار الاعتماد", value: <span className="mz-num">{advances.filter((a) => a.status === "pending").length}</span> },
          { label: "مصروفة", value: <span className="mz-num">{advances.filter((a) => a.status === "disbursed").length}</span> },
          { label: "إجمالي المتبقي", value: <MoneyDisplay value={totalOutstanding} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | EmployeeAdvanceStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم السلفة أو اسم الموظف..."
        columns={columns}
        rows={filtered}
        rowKey={(a) => a.id}
        onRowClick={(a) => {
          setDetailError(null);
          setSelectedId(a.id);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{advances.length}</span> سلفة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد سلف — ابدأ بتسجيل طلب سلفة لموظف</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.number : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الموظف</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{employeeName(selected.employeeId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">المبلغ</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selected.amount)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">المتبقي على السلفة</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selected.outstanding)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">إجمالي رصيد سلف الموظف</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(selectedOutstanding)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">أول خصم</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.firstDeductionDate}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">عدد الأقساط</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.installmentCount}</div>
              </div>
            </Card>

            {selected.reason ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">السبب</div>
                <div className="mt-[5px] text-[13px] text-ink">{selected.reason}</div>
              </Card>
            ) : null}

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">جدول الأقساط</h3>
              <ul className="flex flex-col gap-[6px]">
                {selected.installments.map((i) => (
                  <li key={i.seq} className="flex items-center justify-between text-[12.5px]">
                    <span className="mz-num text-ink-muted">
                      {i.seq}. {i.dueDate}
                    </span>
                    <span className="flex items-center gap-[10px]">
                      <MoneyDisplay value={Number(i.amount)} />
                      <span className="text-[11px] text-ink-faint">
                        {Number(i.recovered) >= Number(i.amount) ? "مسدد" : `مسدد منه ${i.recovered}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {selected.disbursementVoucherId ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">سند الصرف</div>
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
                  اعتماد
                </Button>
                <Button variant="danger-outline" disabled={pendingId === selected.id} onClick={() => runDecision(selected, "reject")}>
                  رفض
                </Button>
              </div>
            ) : null}

            {selected.status === "approved" ? (
              <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px]">
                <h3 className="font-display text-[13px] font-bold text-ink">صرف السلفة</h3>
                <p className="text-[12px] text-ink-muted">يصدر سند صرف نقدي: مدين سلف الموظفين (1160) / دائن الخزينة.</p>
                <SelectField
                  label="الخزينة *"
                  value={treasuryAccountId}
                  onChange={setTreasuryAccountId}
                  options={[{ value: "", label: "اختر..." }, ...treasuryAccounts.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))]}
                />
                <SelectField
                  label="الفرع *"
                  value={branchId}
                  onChange={setBranchId}
                  options={[{ value: "", label: "اختر..." }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
                <Button variant="primary" disabled={pendingId === selected.id} onClick={() => runDisburse(selected)}>
                  صرف
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="طلب سلفة" description="السلفة دين على الموظف (أصل) — لا تحتسب مصروفاً إلا عند الشطب">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label="الموظف *"
            options={employeeOptions}
            value={draft.employeeId ? (employeeOptions.find((o) => o.id === draft.employeeId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
          />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">المبلغ *</div>
            <MoneyInput aria-label="المبلغ" value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
          </div>
          <NumberField
            label="عدد الأقساط *"
            value={draft.installmentCount}
            onChange={(v) => setDraft((d) => ({ ...d, installmentCount: Number.isNaN(v) ? 1 : v }))}
            min={1}
            hint="يُقسّم المبلغ بالتساوي بحيث يساوي مجموع الأقساط قيمة السلفة بالضبط"
          />
          <TextField
            label="أول خصم *"
            value={draft.firstDeductionDate}
            onChange={(v) => setDraft((d) => ({ ...d, firstDeductionDate: v }))}
            placeholder="YYYY-MM-DD"
          />
          <TextField label="السبب" value={draft.reason} onChange={(v) => setDraft((d) => ({ ...d, reason: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              إضافة
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}
