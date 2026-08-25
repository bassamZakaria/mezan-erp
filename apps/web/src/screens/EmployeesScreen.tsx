import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { EmployeeDTO, EmployeeStatusDTO, GenderDTO, MaritalStatusDTO, OvertimeEligibilityDTO, WorkerCategoryDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  ApiError,
  useBranches,
  useCreateEmployee,
  useDepartments,
  useEmployeeContracts,
  useEmployees,
  useJobTitles,
  useTerminateEmployee,
  useTransitionEmployee,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** الموظفون (Employees) — docs/catalog/06 §"الموظفون". The HR hub record: personal info, department/job-title/manager/branch, hire date, worker category, overtime/standard hours, probation end, prior-service years (Article 47), attendance clock-in flags. */

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

const GENDER_KEY: Record<GenderDTO, AppTranslationKey> = { male: "employees.male", female: "employees.female" };
const MARITAL_KEY: Record<MaritalStatusDTO, AppTranslationKey> = {
  single: "employees.single",
  married: "employees.married",
  divorced: "employees.divorced",
  widowed: "employees.widowed",
};
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
  const { t } = useAppTranslation();
  const query = useEmployees();
  const departmentsQuery = useDepartments();
  const jobTitlesQuery = useJobTitles();
  const branchesQuery = useBranches();
  const createEmployee = useCreateEmployee();
  const transitionEmployee = useTransitionEmployee();
  const terminateEmployee = useTerminateEmployee();

  const employees = query.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const jobTitles = jobTitlesQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EmployeeStatusDTO>("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<EmployeeDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);

  const selected = selectedId ? (employees.find((e) => e.id === selectedId) ?? null) : null;
  const contractsQuery = useEmployeeContracts(selectedId);

  function employeeName(e: Pick<EmployeeDTO, "firstNameAr" | "lastNameAr" | "firstName" | "lastName">): string {
    const ar = [e.firstNameAr, e.lastNameAr].filter(Boolean).join(" ").trim();
    return ar || `${e.firstName} ${e.lastName}`.trim();
  }

  function departmentName(id: string | null): string {
    if (!id) return "—";
    const d = departments.find((row) => row.id === id);
    return d ? (d.nameAr ?? d.name) : id;
  }

  function jobTitleName(id: string | null): string {
    if (!id) return "—";
    const j = jobTitles.find((row) => row.id === id);
    return j ? (j.nameAr ?? j.name) : id;
  }

  function branchName(id: string): string {
    return branches.find((b) => b.id === id)?.name ?? id;
  }

  const filtered = useMemo(() => {
    let rows = employees;
    if (statusFilter !== "all") rows = rows.filter((e) => e.status === statusFilter);
    if (departmentFilter !== "all") rows = rows.filter((e) => e.departmentId === departmentFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((e) => employeeName(e).toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
    }
    return rows;
  }, [employees, statusFilter, departmentFilter, search]);

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

  async function runTransition(status: EmployeeStatusDTO) {
    if (!selected || pendingAction) return;
    setPendingAction(true);
    setDetailError(null);
    try {
      await transitionEmployee.mutateAsync({ id: selected.id, body: { status } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("employees.couldnTUpdateTheEmployee"));
    } finally {
      setPendingAction(false);
    }
  }

  async function runTerminate() {
    if (!selected || pendingAction) return;
    setPendingAction(true);
    setDetailError(null);
    try {
      await terminateEmployee.mutateAsync(selected.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t("employees.couldnTTerminateTheEmployee"));
    } finally {
      setPendingAction(false);
    }
  }

  const departmentOptions: EntityPickerOption[] = departments.map((d) => ({ id: d.id, label: d.nameAr ?? d.name }));
  const jobTitleOptions: EntityPickerOption[] = departmentJobTitles.map((j) => ({ id: j.id, label: j.nameAr ?? j.name }));
  const managerOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: employeeName(e) }));
  const branchOptions: EntityPickerOption[] = branches.map((b) => ({ id: b.id, label: b.name }));

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: employees.length },
    ...(Object.keys(STATUS_KEY) as EmployeeStatusDTO[]).map((s) => ({ key: s, label: t(STATUS_KEY[s]), count: employees.filter((e) => e.status === s).length })),
  ];

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
    { key: "hireDate", header: t("employees.hireDate"), render: (e) => <span className="mz-num">{e.hireDate}</span> },
    { key: "status", header: t("common.status"), render: (e) => <StatusPill label={t(STATUS_KEY[e.status])} tone={STATUS_TONE[e.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("employees.couldnTLoadEmployees")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<EmployeeDTO>
        eyebrow={t("eyebrow.hr.employees")}
        title={t("employees.employees")}
        description={t("employees.theCentralEmployeeRecordPersonal")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("employees.addEmployee")}
          </Button>
        }
        stats={[
          { label: t("employees.totalEmployees"), value: <span className="mz-num">{employees.length}</span> },
          { label: t("employees.activeEmployees"), value: <span className="mz-num">{employees.filter((e) => e.status === "active").length}</span> },
          { label: t("attendanceStatus.on_leave"), value: <span className="mz-num">{employees.filter((e) => e.status === "on_leave").length}</span> },
          { label: t("employees.terminated2"), value: <span className="mz-num">{employees.filter((e) => e.status === "terminated").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | EmployeeStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("employees.searchByNameOrNumber")}
        columns={columns}
        rows={filtered}
        rowKey={(e) => e.id}
        onRowClick={(e) => {
          setDetailError(null);
          setSelectedId(e.id);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{employees.length}</span> {t("employees.employee")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("employees.noData")}</div>}
        filterBarExtra={
          <SelectField
            label={t("employees.department")}
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={[{ value: "all", label: t("employees.allDepartments") }, ...departments.map((d) => ({ value: d.id, label: d.nameAr ?? d.name }))]}
          />
        }
      />

      {/* -------- Employee detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? employeeName(selected) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex items-center gap-[10px]">
              <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
              <span className="mz-num text-[12px] text-ink-faint">{selected.code}</span>
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("employees.department")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{departmentName(selected.departmentId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("employees.jobTitle")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{jobTitleName(selected.jobTitleId)}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.branch")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("employees.hireDate")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.hireDate}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("employees.workerCategory")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(WORKER_CATEGORY_KEY[selected.workerCategory])}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("employees.overtimeCalculation")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(OVERTIME_KEY[selected.overtimeEligibility])}</div>
              </div>
            </Card>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("employees.personalInformation")}</h3>
              <dl className="grid grid-cols-2 gap-[10px] text-[12.5px]">
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
              </dl>
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("employees.contracts")}</h3>
              {contractsQuery.data && contractsQuery.data.length > 0 ? (
                <ul className="flex flex-col gap-[8px]">
                  {contractsQuery.data.map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-[12.5px]">
                      <span className="mz-num text-ink">{c.number}</span>
                      <MoneyDisplay value={Number(c.monthlySalary)} className="text-[12.5px] font-semibold" />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-muted">{t("employees.noContractsLinkedToThis")}</p>
              )}
            </div>

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            {selected.status !== "terminated" ? (
              <div className="flex flex-col gap-[8px]">
                {validTransitions(selected.status).map((status) => (
                  <Button key={status} disabled={pendingAction} onClick={() => runTransition(status)}>
                    {t(STATUS_KEY[status])}
                  </Button>
                ))}
                <Button variant="danger-outline" disabled={pendingAction} onClick={runTerminate}>
                  {t("employees.terminate")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

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
