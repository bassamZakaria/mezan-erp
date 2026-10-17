import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Chip, DocumentList, EmptyState, SidePanel, type DocumentListColumn } from "@mezan/ui";
import type { LeaveBalanceDTO, LeaveTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useEmployees, useLeaveBalances, useUpsertLeaveBalance } from "../data/hooks";
import { formatDays, LEAVE_TYPE_KEY, leaveTypeOptions } from "./hr-leave-labels";
import { useAppTranslation } from "../i18n";
import { employeeDisplayName } from "./hr-employee-name";
import { useUrlNumber } from "../lib/url-state";

/** أرصدة الإجازات (Leave Balances) — per-employee, per-leave-type position for a year: what accrual credited, what carried over, what approved leave consumed. */

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];
const PAGE_SIZES = [10, 25, 50, 100] as const;

interface BalanceDraft {
  employeeId: string;
  leaveType: LeaveTypeDTO;
  entitled: string;
  carriedOver: string;
  used: string;
}

export function LeaveBalancesScreen() {
  const { t, locale } = useAppTranslation();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [employeeId, setEmployeeId] = useState("");

  const employeesQuery = useEmployees();
  const employees = employeesQuery.data ?? [];
  const query = useLeaveBalances(employeeId || null, year);
  const upsertBalance = useUpsertLeaveBalance();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<BalanceDraft>({ employeeId: "", leaveType: "annual", entitled: "0", carriedOver: "0", used: "0" });
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const balances = query.data ?? [];
  const pageCount = Math.max(1, Math.ceil(balances.length / pageSize));
  const pageRows = balances.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = employeeId !== "" ? 1 : 0;
  const employeeName = (id: string) => {
    const employee = employees.find((e) => e.id === id);
    if (!employee) return id;
    return employeeDisplayName(employee, locale);
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
      setFormError(t("leaveBalances.anEmployeeIsRequired"));
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
      setFormError(err instanceof ApiError ? err.message : t("leaveBalances.theLeaveBalanceCouldNot"));
    }
  }

  const columns: DocumentListColumn<LeaveBalanceDTO>[] = [
    { key: "employee", header: t("leaveBalances.employee"), render: (b) => <span className="font-semibold text-ink">{employeeName(b.employeeId)}</span> },
    { key: "leaveType", header: t("leaveBalances.leaveType"), render: (b) => <span className="text-ink">{t(LEAVE_TYPE_KEY[b.leaveType])}</span> },
    { key: "entitled", header: t("leaveBalances.accrued"), align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.entitled)}</span> },
    { key: "carriedOver", header: t("leaveBalances.carriedOver"), align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.carriedOver)}</span> },
    { key: "used", header: t("leaveBalances.used"), align: "end", render: (b) => <span className="mz-num text-ink">{formatDays(b.used)}</span> },
    {
      key: "available",
      header: t("leaveBalances.available"),
      align: "end",
      render: (b) => <span className="mz-num font-semibold text-ink">{formatDays(b.available)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (b) => (
        <Button size="sm" onClick={() => openForm(b)}>
          {t("common.edit")}
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("leaveBalances.leaveBalancesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[6px]" role="radiogroup" aria-label={t("leaveBalances.year")}>
        {YEAR_OPTIONS.map((y) => (
          <Chip
            key={y}
            type="button"
            active={year === y}
            onClick={() => {
              setYear(y);
              setPage(1);
            }}
          >
            <span className="mz-num">{y}</span>
          </Chip>
        ))}
      </div>

      <DocumentList<LeaveBalanceDTO>
        title={t("leaveBalances.leaveBalances")}
        description={t("leaveBalances.eachEmployeeSBalanceBy")}
        actions={
          <Button variant="primary" onClick={() => openForm()}>
            {t("leaveBalances.adjustBalance")}
          </Button>
        }
        listKey="leave-balances"
        statsCollapsible
        stats={[{ label: t("leaveBalances.balances"), value: <span className="mz-num">{balances.length}</span> }]}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="min-w-[220px]">
            <SelectField
              label={t("leaveBalances.employee")}
              value={employeeId}
              onChange={(v) => {
                setEmployeeId(v);
                setPage(1);
              }}
              options={[{ value: "", label: t("leaveBalances.allEmployees") }, ...employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))]}
            />
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(b) => b.id}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{balances.length}</span> {t("leaveBalances.balancesFor")} <span className="mz-num">{year}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("leaveBalances.noLeaveBalancesRunAn")}
            description={t("leaveBalances.emptyBody")}
            action={{ label: t("leaveBalances.adjustBalance"), onClick: () => openForm() }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("leaveBalances.adjustLeaveBalance")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <SelectField
            label={t("leaveBalances.employee2")}
            value={draft.employeeId}
            onChange={(v) => setDraft((d) => ({ ...d, employeeId: v }))}
            options={employees.map((e) => ({ value: e.id, label: employeeName(e.id) }))}
          />
          <SelectField
            label={t("leaveBalances.leaveType2")}
            value={draft.leaveType}
            onChange={(v) => setDraft((d) => ({ ...d, leaveType: v as LeaveTypeDTO }))}
            options={leaveTypeOptions(t)}
          />
          <TextField label={t("leaveBalances.accrued")} value={draft.entitled} onChange={(v) => setDraft((d) => ({ ...d, entitled: v }))} placeholder="21" />
          <TextField label={t("leaveBalances.carriedOver")} value={draft.carriedOver} onChange={(v) => setDraft((d) => ({ ...d, carriedOver: v }))} placeholder="0" />
          <TextField label={t("leaveBalances.used")} value={draft.used} onChange={(v) => setDraft((d) => ({ ...d, used: v }))} placeholder="0" />
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
