import { useState, type FormEvent } from "react";
import { Button, Card, Chip, DocumentList, SidePanel, type DocumentListColumn } from "@mezan/ui";
import type { LeaveBalanceDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useEmployees, useLeaveBalances, useUpsertLeaveBalance } from "../data/hooks";
import { formatDays, LEAVE_TYPE_LABEL, LEAVE_TYPE_OPTIONS } from "./hr-leave-labels";

/** أرصدة الإجازات (Leave Balances) — per-employee, per-leave-type position for a year: what accrual credited, what carried over, what approved leave consumed. */

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

interface BalanceDraft {
  employeeId: string;
  leaveType: LeaveTypeDTO;
  entitled: string;
  carriedOver: string;
  used: string;
}

export function LeaveBalancesScreen() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [employeeId, setEmployeeId] = useState("");

  const employeesQuery = useEmployees();
  const employees = employeesQuery.data ?? [];
  const query = useLeaveBalances(employeeId || null, year);
  const upsertBalance = useUpsertLeaveBalance();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<BalanceDraft>({ employeeId: "", leaveType: "annual", entitled: "0", carriedOver: "0", used: "0" });
  const [formError, setFormError] = useState<string | null>(null);

  const balances = query.data ?? [];
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return id;
    return [employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ").trim() || `${employee.firstName} ${employee.lastName}`.trim();
  };

  function openForm(balance?: LeaveBalanceDTO) {
    setDraft(
      balance
        ? {
            employeeId: balance.employeeId,
            leaveType: balance.leaveType,
            entitled: formatDays(balance.entitled),
            carriedOver: formatDays(balance.carriedOver),
            used: formatDays(balance.used),
          }
        : { employeeId: employeeId || (employees[0]?.id ?? ""), leaveType: "annual", entitled: "0", carriedOver: "0", used: "0" },
    );
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "") {
      setFormError("الموظف مطلوب.");
      return;
    }
    setFormError(null);
    try {
      await upsertBalance.mutateAsync({
        employeeId: draft.employeeId,
        leaveType: draft.leaveType,
        year,
        entitled: draft.entitled.trim(),
        carriedOver: draft.carriedOver.trim(),
        used: draft.used.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر حفظ رصيد الإجازة.");
    }
  }

  const columns: DocumentListColumn<LeaveBalanceDTO>[] = [
    { key: "employee", header: "الموظف", render: (b) => <span className="font-semibold text-ink">{employeeName(b.employeeId)}</span> },
    { key: "leaveType", header: "نوع الإجازة", render: (b) => <span className="text-ink">{LEAVE_TYPE_LABEL[b.leaveType]}</span> },
    { key: "entitled", header: "المستحق", align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.entitled)}</span> },
    { key: "carriedOver", header: "المرحّل", align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.carriedOver)}</span> },
    { key: "used", header: "المستخدم", align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.used)}</span> },
    {
      key: "available",
      header: "المتاح",
      align: "end",
      render: (b) => <span className="mz-num font-semibold text-ink">{formatDays(b.available)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (b) => (
        <Button size="sm" onClick={() => openForm(b)}>
          تعديل
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل أرصدة الإجازات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[6px]" role="group" aria-label="السنة">
        {YEAR_OPTIONS.map((y) => (
          <Chip key={y} type="button" active={year === y} onClick={() => setYear(y)}>
            <span className="mz-num">{y}</span>
          </Chip>
        ))}
      </div>

      <DocumentList<LeaveBalanceDTO>
        eyebrow="HR · Leave Balances"
        title="أرصدة الإجازات"
        description="رصيد كل موظف في كل نوع إجازة: المستحق والمرحّل والمستخدم والمتاح"
        actions={
          <Button variant="primary" onClick={() => openForm()}>
            تسوية رصيد
          </Button>
        }
        stats={[{ label: "عدد الأرصدة", value: <span className="mz-num">{balances.length}</span> }]}
        filterBarExtra={
          <div className="min-w-[220px]">
            <SelectField
              label="الموظف"
              value={employeeId}
              onChange={setEmployeeId}
              options={[{ value: "", label: "كل الموظفين" }, ...employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))]}
            />
          </div>
        }
        columns={columns}
        rows={balances}
        rowKey={(b) => b.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{balances.length}</span> رصيد لعام <span className="mz-num">{year}</span>
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أرصدة إجازات — شغّل دورة استحقاق لإنشائها</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تسوية رصيد إجازة">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label="الموظف *"
            value={draft.employeeId}
            onChange={(v) => setDraft((d) => ({ ...d, employeeId: v }))}
            options={employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))}
          />
          <SelectField
            label="نوع الإجازة *"
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={LEAVE_TYPE_OPTIONS}
          />
          <TextField label="المستحق" value={draft.entitled} onChange={(v) => setDraft((d) => ({ ...d, entitled: v }))} placeholder="21" />
          <TextField label="المرحّل" value={draft.carriedOver} onChange={(v) => setDraft((d) => ({ ...d, carriedOver: v }))} placeholder="0" />
          <TextField label="المستخدم" value={draft.used} onChange={(v) => setDraft((d) => ({ ...d, used: v }))} placeholder="0" />
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
