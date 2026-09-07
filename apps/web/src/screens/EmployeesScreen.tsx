import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentDetailTab,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { ContractDTO, ContractTypeDTO, EmployeeDTO, EmployeeStatusDTO, GenderDTO, MaritalStatusDTO, OvertimeEligibilityDTO, WorkerCategoryDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  ApiError,
  useBranches,
  useContracts,
  useCreateEmployee,
  useDepartments,
  useEmployeeContracts,
  useEmployees,
  useJobTitles,
  useTerminateEmployee,
  useTransitionEmployee,
  useAttendance,
  useLeaveBalances,
  useLeaveRequests,
  useRehireEmployee,
} from "../data/hooks";
import { useEmployeeAdvances, useEmployeePayslips } from "../data/hr-payroll-hooks";
import { ATTENDANCE_STATUS_KEY, LEAVE_STATUS_KEY, LEAVE_STATUS_TONE, LEAVE_TYPE_KEY } from "./hr-leave-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { bilingualName, employeeDisplayName } from "./hr-employee-name";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** الموظفون (Employees) — docs/archive/catalog/06 §"الموظفون". The HR hub record: personal info, department/job-title/manager/branch, hire date, worker category, overtime/standard hours, probation end, prior-service years (Article 47), attendance clock-in flags. */

const STATUS_KEY: Record<EmployeeStatusDTO, AppTranslationKey> = {
  active: "employees.active",
  on_leave: "attendanceStatus.on_leave",
  suspended: "employees.suspended",
  terminated: "employees.terminated",
};

const STATUS_TONE: Record<EmployeeStatusDTO, PillTone> = {
  active: "success",
  on_leave: "warning",
  suspended: "danger",
  terminated: "neutral",
};

const CONTRACT_TYPE_KEY: Record<ContractTypeDTO, AppTranslationKey> = {
  indefinite: "contracts.type.indefinite",
  fixed_term: "contracts.type.fixed_term",
  seasonal: "contracts.type.seasonal",
  probationary: "contracts.type.probationary",
};

const GENDER_KEY: Record<GenderDTO, AppTranslationKey> = { male: "employees.male", female: "employees.female" };
const MARITAL_KEY: Record<MaritalStatusDTO, AppTranslationKey> = {
  single: "employees.single",
  married: "employees.married",
  divorced: "employees.divorced",
  widowed: "employees.widowed",
};
const PAGE_SIZES = [10, 25, 50, 100] as const;

const WORKER_CATEGORY_KEY: Record<WorkerCategoryDTO, AppTranslationKey> = { staff: "employees.employee", worker: "employees.worker" };
const OVERTIME_KEY: Record<OvertimeEligibilityDTO, AppTranslationKey> = {
  inherit_department: "employees.byDepartment",
  eligible: "employees.due",
  not_eligible: "employees.notDue",
};

function validTransitions(status: EmployeeStatusDTO): EmployeeStatusDTO[] {
  switch (status) {
    case "active":
      return ["on_leave", "suspended"];
    case "on_leave":
      return ["active", "suspended"];
    case "suspended":
      return ["active"];
    default:
      return [];
  }
}

interface EmployeeDraft {
  firstName: string;
  lastName: string;
  firstNameAr: string;
  lastNameAr: string;
  email: string;
  phone: string;
  birthDate: string;
  nationalId: string;
  gender: GenderDTO | "";
  maritalStatus: MaritalStatusDTO | "";
  departmentId: string;
  jobTitleId: string;
  managerId: string;
  branchId: string;
  hireDate: string;
  workerCategory: WorkerCategoryDTO;
  employmentType: "full_time" | "part_time";
  overtimeEligibility: OvertimeEligibilityDTO;
  standardWorkHours: number | null;
  probationEndDate: string;
  priorServiceYears: number;
  requireSelfieAtClockIn: boolean;
  requireBiometricAtClockIn: boolean;
  street: string;
  city: string;
  governorate: string;
  postalCode: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyAltPhone: string;
}

function blankDraft(): EmployeeDraft {
  return {
    firstName: "",
    lastName: "",
    firstNameAr: "",
    lastNameAr: "",
    email: "",
    phone: "",
    birthDate: "",
    nationalId: "",
    gender: "",
    maritalStatus: "",
    departmentId: "",
    jobTitleId: "",
    managerId: "",
    branchId: "",
    hireDate: "",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: null,
    probationEndDate: "",
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false,
    street: "",
    city: "",
    governorate: "",
    postalCode: "",
    emergencyName: "",
    emergencyRelationship: "",
    emergencyPhone: "",
    emergencyAltPhone: "",
  };
}

export function EmployeesScreen() {
  const { t, locale } = useAppTranslation();
  const query = useEmployees();
  const departmentsQuery = useDepartments();
  const jobTitlesQuery = useJobTitles();
  const branchesQuery = useBranches();
  const allContractsQuery = useContracts();
  const createEmployee = useCreateEmployee();
  const transitionEmployee = useTransitionEmployee();
  const terminateEmployee = useTerminateEmployee();

  const employees = query.data ?? EMPTY;
  const departments = departmentsQuery.data ?? [];
  const jobTitles = jobTitlesQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const allContracts = allContractsQuery.data ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | EmployeeStatusDTO,
    (next: string) => void,
  ];
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<EmployeeDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const selected = selectedId ? (employees.find((e) => e.id === selectedId) ?? null) : null;
  const contractsQuery = useEmployeeContracts(selectedId);
  const [detailTab, setDetailTab] = useState("personal");
  const [rehireOpen, setRehireOpen] = useState(false);
  const [rehireDate, setRehireDate] = useState("");
  const rehireEmployee = useRehireEmployee();

  const currentYear = new Date().getUTCFullYear();
  const leaveBalancesQuery = useLeaveBalances(selectedId, currentYear);
  const leaveRequestsQuery = useLeaveRequests({ employeeId: selectedId, status: null, leaveType: null, from: null, to: null });
  const payslipsQuery = useEmployeePayslips(selectedId);
  const advancesQuery = useEmployeeAdvances();
  const attendanceQuery = useAttendance({ employeeId: selectedId, from: null, to: null, status: null });

  const employeeName = useCallback(
    (e: Pick<EmployeeDTO, "firstNameAr" | "lastNameAr" | "firstName" | "lastName">): string => employeeDisplayName(e, locale),
    [locale],
  );

  function departmentName(id: string | null): string {
    if (!id) return "—";
    const d = departments.find((row) => row.id === id);
    return d ? bilingualName(d, locale) : id;
  }

  function jobTitleName(id: string | null): string {
    if (!id) return "—";
    const j = jobTitles.find((row) => row.id === id);
    return j ? bilingualName(j, locale) : id;
  }

  function branchName(id: string): string {
    return branches.find((b) => b.id === id)?.name ?? id;
  }

  const activeContractByEmployee = useMemo(() => {
    const map = new Map<string, ContractDTO>();
    for (const contract of allContracts) {
      if (contract.status !== "active") continue;
      const current = map.get(contract.employeeId);
      if (!current || contract.startDate > current.startDate) map.set(contract.employeeId, contract);
    }
    return map;
  }, [allContracts]);

  const filtered = useMemo(() => {
    let rows = employees;
    if (statusFilter !== "all") rows = rows.filter((e) => e.status === statusFilter);
    if (departmentFilter !== "all") rows = rows.filter((e) => e.departmentId === departmentFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((e) => employeeName(e).toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
    }
    return rows;
  }, [employees, statusFilter, departmentFilter, search, employeeName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = (statusFilter === "all" ? 0 : 1) + (departmentFilter === "all" ? 0 : 1);

  const departmentJobTitles = jobTitles.filter((j) => j.departmentId === draft.departmentId);

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.firstName.trim() === "" || draft.lastName.trim() === "" || draft.branchId === "" || draft.hireDate.trim() === "") {
      setFormError(t("employees.firstNameLastNameBranch"));
      return;
    }
    setFormError(null);
    const hasAddress = [draft.street, draft.city, draft.governorate, draft.postalCode].some((v) => v.trim() !== "");
    const hasEmergency = [draft.emergencyName, draft.emergencyRelationship, draft.emergencyPhone, draft.emergencyAltPhone].some((v) => v.trim() !== "");
    try {
      await createEmployee.mutateAsync({
        firstName: draft.firstName.trim(),
        lastName: draft.lastName.trim(),
        firstNameAr: draft.firstNameAr.trim() === "" ? null : draft.firstNameAr.trim(),
        lastNameAr: draft.lastNameAr.trim() === "" ? null : draft.lastNameAr.trim(),
        email: draft.email.trim() === "" ? null : draft.email.trim(),
        phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
        birthDate: draft.birthDate.trim() === "" ? null : draft.birthDate.trim(),
        nationalId: draft.nationalId.trim() === "" ? null : draft.nationalId.trim(),
        gender: draft.gender === "" ? null : draft.gender,
        maritalStatus: draft.maritalStatus === "" ? null : draft.maritalStatus,
        departmentId: draft.departmentId === "" ? null : draft.departmentId,
        jobTitleId: draft.jobTitleId === "" ? null : draft.jobTitleId,
        managerId: draft.managerId === "" ? null : draft.managerId,
        branchId: draft.branchId,
        hireDate: draft.hireDate.trim(),
        workerCategory: draft.workerCategory,
        employmentType: draft.employmentType,
        overtimeEligibility: draft.overtimeEligibility,
        standardWorkHours: draft.standardWorkHours,
        probationEndDate: draft.probationEndDate.trim() === "" ? null : draft.probationEndDate.trim(),
        priorServiceYears: draft.priorServiceYears,
        requireSelfieAtClockIn: draft.requireSelfieAtClockIn,
        requireBiometricAtClockIn: draft.requireBiometricAtClockIn,
        address: hasAddress
          ? {
              street: draft.street.trim() === "" ? null : draft.street.trim(),
              city: draft.city.trim() === "" ? null : draft.city.trim(),
              governorate: draft.governorate.trim() === "" ? null : draft.governorate.trim(),
              postalCode: draft.postalCode.trim() === "" ? null : draft.postalCode.trim(),
            }
          : null,
        emergencyContact: hasEmergency
          ? {
              name: draft.emergencyName.trim() === "" ? null : draft.emergencyName.trim(),
              relationship: draft.emergencyRelationship.trim() === "" ? null : draft.emergencyRelationship.trim(),
              phone: draft.emergencyPhone.trim() === "" ? null : draft.emergencyPhone.trim(),
              altPhone: draft.emergencyAltPhone.trim() === "" ? null : draft.emergencyAltPhone.trim(),
            }
          : null,
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("employees.couldnTAddTheEmployee"));
    }
  }

  async function runTransition(employee: EmployeeDTO, status: EmployeeStatusDTO) {
    if (pendingId) return;
    setPendingId(employee.id);
    setDetailError(null);
    try {
      await transitionEmployee.mutateAsync({ id: employee.id, body: { status } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("employees.couldnTUpdateTheEmployee"));
    } finally {
      setPendingId(null);
    }
  }

  async function runTerminate(employee: EmployeeDTO) {
    if (pendingId) return;
    setPendingId(employee.id);
    setDetailError(null);
    try {
      await terminateEmployee.mutateAsync(employee.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("employees.couldnTTerminateTheEmployee"));
    } finally {
      setPendingId(null);
    }
  }

  const departmentOptions: EntityPickerOption[] = departments.map((d) => ({ id: d.id, label: bilingualName(d, locale) }));
  const jobTitleOptions: EntityPickerOption[] = departmentJobTitles.map((j) => ({ id: j.id, label: bilingualName(j, locale) }));
  const managerOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: employeeName(e) }));
  const branchOptions: EntityPickerOption[] = branches.map((b) => ({ id: b.id, label: b.name }));

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: employees.length },
    ...(Object.keys(STATUS_KEY) as EmployeeStatusDTO[]).map((s) => ({ key: s, label: t(STATUS_KEY[s]), count: employees.filter((e) => e.status === s).length })),
  ];

  const employeeAdvances = (advancesQuery.data ?? []).filter((a) => a.employeeId === selectedId);

  async function runRehire(employee: EmployeeDTO) {
    if (pendingId) return;
    if (rehireDate.trim() === "") {
      setDetailError(t("employees.aRehireDateIsRequired"));
      return;
    }
    setPendingId(employee.id);
    setDetailError(null);
    try {
      await rehireEmployee.mutateAsync({ id: employee.id, hireDate: rehireDate.trim() });
      setRehireOpen(false);
      setRehireDate("");
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("employees.theEmployeeCouldNotBe"));
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<EmployeeDTO>[] = [
    {
      key: "name",
      header: t("employees.employeeName"),
      render: (e) => (
        <div>
          <div className="font-semibold text-ink">{employeeName(e)}</div>
          <div className="mz-num text-[11px] text-ink-faint">{e.code}</div>
        </div>
      ),
    },
    { key: "department", header: t("employees.department"), render: (e) => departmentName(e.departmentId) },
    { key: "jobTitle", header: t("employees.jobTitle"), render: (e) => jobTitleName(e.jobTitleId) },
    { key: "branch", header: t("employees.branchColumn"), render: (e) => branchName(e.branchId) },
    {
      key: "contract",
      header: t("employees.contract"),
      render: (e) => {
        const contract = activeContractByEmployee.get(e.id);
        if (!contract) return <span className="text-ink-faint">{t("employees.noActiveContract")}</span>;
        return (
          <span className="flex items-center gap-[6px]">
            <span className="text-ink">{t(CONTRACT_TYPE_KEY[contract.type])}</span>
            <span className="mz-num text-[11px] text-ink-faint">{contract.number}</span>
            {contract.expiringSoon ? <StatusPill label={t("employees.contractExpiringSoon")} tone="warning" /> : null}
          </span>
        );
      },
    },
    { key: "hireDate", header: t("employees.hireDate"), render: (e) => <span className="mz-num">{e.hireDate}</span> },
    { key: "status", header: t("common.status"), render: (e) => <StatusPill label={t(STATUS_KEY[e.status])} tone={STATUS_TONE[e.status]} /> },
  ];

  const rehirePanel = (
      <SidePanel open={rehireOpen} onClose={() => setRehireOpen(false)} title={t("employees.rehire")} description={t("employees.theYearsAlreadyServedAre")}>
      <div className="flex flex-col gap-[14px]">
        <TextField label={t("employees.rehireDate")} value={rehireDate} onChange={setRehireDate} placeholder="YYYY-MM-DD" />
        <div className="flex justify-end gap-[9px]">
          <Button type="button" onClick={() => setRehireOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" disabled={selected !== null && pendingId === selected.id} onClick={() => selected && void runRehire(selected)}>
            {t("employees.rehire")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  const detailTabs: DocumentDetailTab[] = selected
    ? [
        {
          key: "personal",
          label: t("employees.personalInformation"),
          content: (
            <dl className="grid grid-cols-1 gap-[12px] text-[12.5px] sm:grid-cols-3">
              <div>
                <dt className="text-ink-faint">{t("employees.dateOfBirth")}</dt>
                <dd className="mz-num text-ink">{selected.birthDate ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.gender")}</dt>
                <dd className="text-ink">{selected.gender ? t(GENDER_KEY[selected.gender]) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.maritalStatus")}</dt>
                <dd className="text-ink">{selected.maritalStatus ? t(MARITAL_KEY[selected.maritalStatus]) : "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.employmentType")}</dt>
                <dd className="text-ink">{selected.employmentType === "full_time" ? t("employees.fullTime") : t("employees.partTime")}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.probationEndDate")}</dt>
                <dd className="mz-num text-ink">{selected.probationEndDate ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.priorYearsOfService")}</dt>
                <dd className="mz-num text-ink">{selected.priorServiceYears}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.overtimeCalculation")}</dt>
                <dd className="text-ink">{t(OVERTIME_KEY[selected.overtimeEligibility])}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.workerCategory")}</dt>
                <dd className="text-ink">{t(WORKER_CATEGORY_KEY[selected.workerCategory])}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">{t("employees.phone")}</dt>
                <dd className="mz-num text-ink">{selected.phone ?? "—"}</dd>
              </div>
            </dl>
          ),
        },
        {
          key: "contract",
          label: t("employees.contracts"),
          content:
            (contractsQuery.data ?? []).length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("employees.noContractsLinkedToThis")}</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("contracts.contractNumber")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("contracts.contractType")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.period")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("contracts.basicSalary")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(contractsQuery.data ?? []).map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-[8px] py-[7px]"><span className="mz-num font-semibold text-ink">{c.number}</span></td>
                      <td className="px-[8px] py-[7px] text-ink">{t(CONTRACT_TYPE_KEY[c.type])}</td>
                      <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{c.startDate} — {c.endDate ?? "—"}</span></td>
                      <td className="px-[8px] py-[7px] text-end"><MoneyDisplay value={Number(c.monthlySalary)} /></td>
                      <td className="px-[8px] py-[7px]">
                        <StatusPill
                          label={c.status === "active" ? t("contracts.active") : t("contracts.terminated")}
                          tone={c.status === "active" ? "success" : "neutral"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
        },
        {
          key: "leave",
          label: t("employees.leave"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <div>
                <h4 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("employees.leaveBalances")}</h4>
                {(leaveBalancesQuery.data ?? []).length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted">{t("employees.noLeaveBalanceForThis")}</p>
                ) : (
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border text-ink-faint">
                        <th className="px-[8px] py-[7px] text-start font-semibold">{t("hrDashboard.leaveType")}</th>
                        <th className="px-[8px] py-[7px] text-end font-semibold">{t("hrDashboard.entitled")}</th>
                        <th className="px-[8px] py-[7px] text-end font-semibold">{t("hrDashboard.taken")}</th>
                        <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.remaining")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leaveBalancesQuery.data ?? []).map((b) => (
                        <tr key={b.id} className="border-b border-border last:border-0">
                          <td className="px-[8px] py-[7px] font-semibold text-ink">{t(LEAVE_TYPE_KEY[b.leaveType])}</td>
                          <td className="px-[8px] py-[7px] text-end"><span className="mz-num text-ink">{Number(b.entitled) + Number(b.carriedOver)}</span></td>
                          <td className="px-[8px] py-[7px] text-end"><span className="mz-num text-ink">{Number(b.used)}</span></td>
                          <td className="px-[8px] py-[7px] text-end">
                            <span className="mz-num font-semibold text-ink">{Number(b.entitled) + Number(b.carriedOver) - Number(b.used)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("leaveRequests.leaveRequests")}</h4>
                {(leaveRequestsQuery.data ?? []).length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted">{t("employees.noLeaveRequestsForThis")}</p>
                ) : (
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-border text-ink-faint">
                        <th className="px-[8px] py-[7px] text-start font-semibold">{t("leaveRequests.requestNumber")}</th>
                        <th className="px-[8px] py-[7px] text-start font-semibold">{t("leaveRequests.leaveType")}</th>
                        <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.period")}</th>
                        <th className="px-[8px] py-[7px] text-end font-semibold">{t("leaveRequests.days")}</th>
                        <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(leaveRequestsQuery.data ?? []).map((r) => (
                        <tr key={r.id} className="border-b border-border last:border-0">
                          <td className="px-[8px] py-[7px]"><span className="mz-num font-semibold text-ink">{r.number}</span></td>
                          <td className="px-[8px] py-[7px] text-ink">{t(LEAVE_TYPE_KEY[r.leaveType])}</td>
                          <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{r.startDate} — {r.endDate}</span></td>
                          <td className="px-[8px] py-[7px] text-end"><span className="mz-num text-ink">{r.days}</span></td>
                          <td className="px-[8px] py-[7px]"><StatusPill label={t(LEAVE_STATUS_KEY[r.status])} tone={LEAVE_STATUS_TONE[r.status]} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ),
        },
        {
          key: "payslips",
          label: t("employees.payslips"),
          content:
            (payslipsQuery.data ?? []).length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("employees.noPayslipsForThisEmployee")}</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("employees.payslipNumber")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.period")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.gross")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.deductions")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(payslipsQuery.data ?? []).map((slip) => (
                    <tr key={slip.id} className="border-b border-border last:border-0">
                      <td className="px-[8px] py-[7px]"><span className="mz-num font-semibold text-ink">{slip.number}</span></td>
                      <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{slip.periodStart} — {slip.periodEnd}</span></td>
                      <td className="px-[8px] py-[7px] text-end"><MoneyDisplay value={Number(slip.grossEarnings)} /></td>
                      <td className="px-[8px] py-[7px] text-end"><MoneyDisplay value={Number(slip.totalDeductions)} /></td>
                      <td className="px-[8px] py-[7px] text-end font-semibold"><MoneyDisplay value={Number(slip.netPay)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
        },
        {
          key: "advances",
          label: t("employees.advances"),
          content:
            employeeAdvances.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("employees.noAdvancesForThisEmployee")}</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("employees.advanceNumber")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.advanceAmount")}</th>
                    <th className="px-[8px] py-[7px] text-end font-semibold">{t("employees.outstanding")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {employeeAdvances.map((advance) => (
                    <tr key={advance.id} className="border-b border-border last:border-0">
                      <td className="px-[8px] py-[7px]"><span className="mz-num font-semibold text-ink">{advance.number}</span></td>
                      <td className="px-[8px] py-[7px] text-end"><MoneyDisplay value={Number(advance.amount)} /></td>
                      <td className="px-[8px] py-[7px] text-end"><MoneyDisplay value={Number(advance.outstanding)} /></td>
                      <td className="px-[8px] py-[7px] text-ink">{advance.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
        },
        {
          key: "attendance",
          label: t("employees.attendance"),
          content:
            (attendanceQuery.data ?? []).length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("employees.noAttendanceForThisEmployee")}</p>
            ) : (
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("employees.attendanceDate")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("employees.checkIn")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("employees.checkOut")}</th>
                    <th className="px-[8px] py-[7px] text-start font-semibold">{t("common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(attendanceQuery.data ?? [])]
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .slice(0, 60)
                    .map((entry) => (
                      <tr key={entry.id} className="border-b border-border last:border-0">
                        <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{entry.date}</span></td>
                        <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{entry.checkIn ?? "—"}</span></td>
                        <td className="px-[8px] py-[7px]"><span className="mz-num text-ink">{entry.checkOut ?? "—"}</span></td>
                        <td className="px-[8px] py-[7px] text-ink">{t(ATTENDANCE_STATUS_KEY[entry.status])}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ),
        },
      ]
    : [];

  if (selected) {
    return (
      <div className="w-full">
        <DocumentDetail
          title={employeeName(selected)}
          statusLabel={t(STATUS_KEY[selected.status])}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<span className="mz-num">{selected.code}</span>}
          actions={
            <>
              <Button onClick={() => setSelectedId(null)}>{t("employees.backToTheList")}</Button>
              {selected.status === "terminated" ? (
                <Button variant="primary" disabled={pendingId === selected.id} onClick={() => setRehireOpen(true)}>
                  {t("employees.rehire")}
                </Button>
              ) : (
                <>
                  {validTransitions(selected.status).map((status) => (
                    <Button key={status} disabled={pendingId === selected.id} onClick={() => void runTransition(selected, status)}>
                      {t(STATUS_KEY[status])}
                    </Button>
                  ))}
                  <Button variant="danger-outline" disabled={pendingId === selected.id} onClick={() => void runTerminate(selected)}>
                    {t("employees.terminate")}
                  </Button>
                </>
              )}
            </>
          }
          summary={[
            { label: t("employees.department"), value: departmentName(selected.departmentId) },
            { label: t("employees.jobTitle"), value: jobTitleName(selected.jobTitleId) },
            { label: t("common.branch"), value: branchName(selected.branchId) },
            { label: t("employees.hireDate"), value: <span className="mz-num">{selected.hireDate}</span> },
            {
              label: t("employees.outstanding"),
              value: <MoneyDisplay value={employeeAdvances.reduce((sum, a) => sum + Number(a.outstanding), 0)} />,
            },
          ]}
          tabs={detailTabs}
          activeTabKey={detailTab}
          onTabChange={setDetailTab}
        />
        {detailError ? (
          <div role="alert" className="mt-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {detailError}
          </div>
        ) : null}
        {rehirePanel}
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("employees.couldnTLoadEmployees")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {detailError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {detailError}
        </div>
      ) : null}

      <DocumentList<EmployeeDTO>
        title={t("employees.employees")}
        description={t("employees.theCentralEmployeeRecordPersonal")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("employees.addEmployee")}
          </Button>
        }
        listKey="employees"
        statsCollapsible
        stats={[
          { label: t("employees.totalEmployees"), value: <span className="mz-num">{employees.length}</span> },
          { label: t("employees.activeEmployees"), value: <span className="mz-num">{employees.filter((e) => e.status === "active").length}</span> },
          { label: t("attendanceStatus.on_leave"), value: <span className="mz-num">{employees.filter((e) => e.status === "on_leave").length}</span> },
          { label: t("employees.terminated2"), value: <span className="mz-num">{employees.filter((e) => e.status === "terminated").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | EmployeeStatusDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("employees.searchByNameOrNumber")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        columns={columns}
        rows={pageRows}
        loading={attendanceQuery.isLoading}
        rowKey={(e) => e.id}
        onRowClick={(e) => {
          setDetailError(null);
          setSelectedId(e.id);
        }}
        rowAction={(e) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => { setDetailError(null); setSelectedId(e.id); } },
            // Rehiring needs a hire date, so the entry opens the panel that asks for it.
            ...(e.status === "terminated"
              ? [
                  {
                    key: "rehire",
                    label: t("employees.rehire"),
                    disabled: pendingId === e.id,
                    onSelect: () => {
                      setDetailError(null);
                      setSelectedId(e.id);
                      setRehireOpen(true);
                    },
                  },
                ]
              : [
                  ...validTransitions(e.status).map((status) => ({
                    key: `transition-${status}`,
                    label: t(STATUS_KEY[status]),
                    disabled: pendingId === e.id,
                    onSelect: () => void runTransition(e, status),
                  })),
                  { key: "terminate", label: t("employees.terminate"), tone: "danger" as const, disabled: pendingId === e.id, onSelect: () => void runTerminate(e) },
                ]),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: e.code })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{employees.length}</span> {t("employees.employee")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("employees.noData")}
            description={t("employees.emptyBody")}
            action={{ label: t("employees.addEmployee"), onClick: openCreateForm }}
          />
        }
        filterBarExtra={
          <SelectField
            label={t("employees.department")}
            value={departmentFilter}
            onChange={(v) => {
              setDepartmentFilter(v);
              setPage(1);
            }}
            options={[{ value: "all", label: t("employees.allDepartments") }, ...departments.map((d) => ({ value: d.id, label: bilingualName(d, locale) }))]}
          />
        }
      />


      {/* -------- Create employee panel -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("employees.newEmployee")} description={t("employees.basicEmployeeDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <h3 className="font-display text-[13px] font-bold text-ink">{t("employees.personalInformation")}</h3>
          <TextField label={t("employees.firstName")} value={draft.firstName} onChange={(v) => setDraft((d) => ({ ...d, firstName: v }))} />
          <TextField label={t("employees.lastName")} value={draft.lastName} onChange={(v) => setDraft((d) => ({ ...d, lastName: v }))} />
          <TextField label={t("employees.firstNameArabic")} value={draft.firstNameAr} onChange={(v) => setDraft((d) => ({ ...d, firstNameAr: v }))} />
          <TextField label={t("employees.lastNameArabic")} value={draft.lastNameAr} onChange={(v) => setDraft((d) => ({ ...d, lastNameAr: v }))} />
          <TextField label={t("common.email")} type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
          <TextField label={t("common.phone")} type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
          <TextField label={t("employees.dateOfBirth")} value={draft.birthDate} onChange={(v) => setDraft((d) => ({ ...d, birthDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label={t("employees.nationalId")} value={draft.nationalId} onChange={(v) => setDraft((d) => ({ ...d, nationalId: v }))} />
          <SelectField
            label={t("employees.gender")}
            value={draft.gender}
            onChange={(v) => setDraft((d) => ({ ...d, gender: v as GenderDTO | "" }))}
            options={[{ value: "", label: t("employees.select") }, ...(Object.keys(GENDER_KEY) as GenderDTO[]).map((g) => ({ value: g, label: t(GENDER_KEY[g]) }))]}
          />
          <SelectField
            label={t("employees.maritalStatus")}
            value={draft.maritalStatus}
            onChange={(v) => setDraft((d) => ({ ...d, maritalStatus: v as MaritalStatusDTO | "" }))}
            options={[{ value: "", label: t("employees.select") }, ...(Object.keys(MARITAL_KEY) as MaritalStatusDTO[]).map((m) => ({ value: m, label: t(MARITAL_KEY[m]) }))]}
          />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">{t("employees.employmentInformation")}</h3>
          <EntityPicker
            label={t("employees.department")}
            options={departmentOptions}
            value={draft.departmentId ? (departmentOptions.find((o) => o.id === draft.departmentId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, departmentId: option?.id ?? "", jobTitleId: "" }))}
          />
          <EntityPicker
            label={t("employees.jobTitle")}
            options={jobTitleOptions}
            value={draft.jobTitleId ? (jobTitleOptions.find((o) => o.id === draft.jobTitleId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, jobTitleId: option?.id ?? "" }))}
          />
          <EntityPicker
            label={t("employees.directManager")}
            options={managerOptions}
            value={draft.managerId ? (managerOptions.find((o) => o.id === draft.managerId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, managerId: option?.id ?? "" }))}
          />
          <EntityPicker
            label={t("employees.branch")}
            options={branchOptions}
            value={draft.branchId ? (branchOptions.find((o) => o.id === draft.branchId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, branchId: option?.id ?? "" }))}
          />
          <TextField label={t("employees.hireDate2")} value={draft.hireDate} onChange={(v) => setDraft((d) => ({ ...d, hireDate: v }))} placeholder="YYYY-MM-DD" />
          <SelectField
            label={t("employees.workerCategory2")}
            value={draft.workerCategory}
            onChange={(v) => setDraft((d) => ({ ...d, workerCategory: v as WorkerCategoryDTO }))}
            options={(Object.keys(WORKER_CATEGORY_KEY) as WorkerCategoryDTO[]).map((c) => ({ value: c, label: t(WORKER_CATEGORY_KEY[c]) }))}
          />
          <SelectField
            label={t("employees.employmentType")}
            value={draft.employmentType}
            onChange={(v) => setDraft((d) => ({ ...d, employmentType: v as "full_time" | "part_time" }))}
            options={[{ value: "full_time", label: t("employees.fullTime") }, { value: "part_time", label: t("employees.partTime") }]}
          />
          <SelectField
            label={t("employees.overtimeCalculation")}
            value={draft.overtimeEligibility}
            onChange={(v) => setDraft((d) => ({ ...d, overtimeEligibility: v as OvertimeEligibilityDTO }))}
            options={(Object.keys(OVERTIME_KEY) as OvertimeEligibilityDTO[]).map((o) => ({ value: o, label: t(OVERTIME_KEY[o]) }))}
          />
          <NumberField
            label={t("employees.standardWorkingHours")}
            value={draft.standardWorkHours ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, standardWorkHours: Number.isNaN(v) ? null : v }))}
            hint={t("employees.byDepartmentCompany")}
          />
          <TextField label={t("employees.probationEndDate")} value={draft.probationEndDate} onChange={(v) => setDraft((d) => ({ ...d, probationEndDate: v }))} placeholder="YYYY-MM-DD" />
          <NumberField
            label={t("employees.priorYearsOfService")}
            value={draft.priorServiceYears}
            min={0}
            onChange={(v) => setDraft((d) => ({ ...d, priorServiceYears: Number.isNaN(v) ? 0 : v }))}
            hint={t("employees.usedToCalculateTheSeniority")}
          />
          <ToggleField
            label={t("employees.requireAPhotoWhenClocking")}
            checked={draft.requireSelfieAtClockIn}
            onChange={(v) => setDraft((d) => ({ ...d, requireSelfieAtClockIn: v }))}
          />
          <ToggleField
            label={t("employees.requireFingerprintVerificationWhenClocking")}
            checked={draft.requireBiometricAtClockIn}
            onChange={(v) => setDraft((d) => ({ ...d, requireBiometricAtClockIn: v }))}
          />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">{t("employees.address")}</h3>
          <TextField label={t("employees.street")} value={draft.street} onChange={(v) => setDraft((d) => ({ ...d, street: v }))} />
          <TextField label={t("employees.city")} value={draft.city} onChange={(v) => setDraft((d) => ({ ...d, city: v }))} />
          <TextField label={t("employees.governorate")} value={draft.governorate} onChange={(v) => setDraft((d) => ({ ...d, governorate: v }))} />
          <TextField label={t("employees.postalCode")} value={draft.postalCode} onChange={(v) => setDraft((d) => ({ ...d, postalCode: v }))} />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">{t("employees.emergencyContact")}</h3>
          <TextField label={t("common.name")} value={draft.emergencyName} onChange={(v) => setDraft((d) => ({ ...d, emergencyName: v }))} />
          <TextField label={t("employees.relationship")} value={draft.emergencyRelationship} onChange={(v) => setDraft((d) => ({ ...d, emergencyRelationship: v }))} />
          <TextField label={t("employees.phoneNumber")} value={draft.emergencyPhone} onChange={(v) => setDraft((d) => ({ ...d, emergencyPhone: v }))} />
          <TextField label={t("employees.alternatePhoneNumber")} value={draft.emergencyAltPhone} onChange={(v) => setDraft((d) => ({ ...d, emergencyAltPhone: v }))} />

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
