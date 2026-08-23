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

/** الموظفون (Employees) — docs/catalog/06 §"الموظفون". The HR hub record: personal info, department/job-title/manager/branch, hire date, worker category, overtime/standard hours, probation end, prior-service years (Article 47), attendance clock-in flags. */

const STATUS_LABEL: Record<EmployeeStatusDTO, string> = {
  active: "نشط",
  on_leave: "في إجازة",
  suspended: "موقوف",
  terminated: "منتهية خدمته",
};

const STATUS_TONE: Record<EmployeeStatusDTO, PillTone> = {
  active: "success",
  on_leave: "warning",
  suspended: "danger",
  terminated: "neutral",
};

const GENDER_LABEL: Record<GenderDTO, string> = { male: "ذكر", female: "أنثى" };
const MARITAL_LABEL: Record<MaritalStatusDTO, string> = { single: "أعزب", married: "متزوج", divorced: "مطلق", widowed: "أرمل" };
const WORKER_CATEGORY_LABEL: Record<WorkerCategoryDTO, string> = { staff: "موظف", worker: "عامل" };
const OVERTIME_LABEL: Record<OvertimeEligibilityDTO, string> = {
  inherit_department: "حسب القسم",
  eligible: "مستحق",
  not_eligible: "غير مستحق",
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
      setFormError("الاسم الأول واسم العائلة والفرع وتاريخ التعيين مطلوبة.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة الموظف.");
    }
  }

  async function runTransition(status: EmployeeStatusDTO) {
    if (!selected || pendingAction) return;
    setPendingAction(true);
    setDetailError(null);
    try {
      await transitionEmployee.mutateAsync({ id: selected.id, body: { status } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر تحديث حالة الموظف.");
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
      setDetailError(err instanceof ApiError ? err.message : "تعذّر إنهاء خدمة الموظف.");
    } finally {
      setPendingAction(false);
    }
  }

  const departmentOptions: EntityPickerOption[] = departments.map((d) => ({ id: d.id, label: d.nameAr ?? d.name }));
  const jobTitleOptions: EntityPickerOption[] = departmentJobTitles.map((j) => ({ id: j.id, label: j.nameAr ?? j.name }));
  const managerOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: employeeName(e) }));
  const branchOptions: EntityPickerOption[] = branches.map((b) => ({ id: b.id, label: b.name }));

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: employees.length },
    ...(Object.keys(STATUS_LABEL) as EmployeeStatusDTO[]).map((s) => ({ key: s, label: STATUS_LABEL[s], count: employees.filter((e) => e.status === s).length })),
  ];

  const columns: DocumentListColumn<EmployeeDTO>[] = [
    {
      key: "name",
      header: "اسم الموظف",
      render: (e) => (
        <div>
          <div className="font-semibold text-ink">{employeeName(e)}</div>
          <div className="mz-num text-[11px] text-ink-faint">{e.code}</div>
        </div>
      ),
    },
    { key: "department", header: "القسم", render: (e) => departmentName(e.departmentId) },
    { key: "jobTitle", header: "المسمى الوظيفي", render: (e) => jobTitleName(e.jobTitleId) },
    { key: "hireDate", header: "تاريخ التعيين", render: (e) => <span className="mz-num">{e.hireDate}</span> },
    { key: "status", header: "الحالة", render: (e) => <StatusPill label={STATUS_LABEL[e.status]} tone={STATUS_TONE[e.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الموظفين.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<EmployeeDTO>
        eyebrow="HR · Employees"
        title="الموظفون"
        description="السجل المركزي للموظفين: البيانات الشخصية، القسم والمسمى الوظيفي والمدير والفرع"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة موظف
          </Button>
        }
        stats={[
          { label: "إجمالي الموظفين", value: <span className="mz-num">{employees.length}</span> },
          { label: "الموظفون النشطون", value: <span className="mz-num">{employees.filter((e) => e.status === "active").length}</span> },
          { label: "في إجازة", value: <span className="mz-num">{employees.filter((e) => e.status === "on_leave").length}</span> },
          { label: "المنتهية خدمتهم", value: <span className="mz-num">{employees.filter((e) => e.status === "terminated").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | EmployeeStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الرقم..."
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
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{employees.length}</span> موظف
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
        filterBarExtra={
          <SelectField
            label="القسم"
            value={departmentFilter}
            onChange={setDepartmentFilter}
            options={[{ value: "all", label: "جميع الأقسام" }, ...departments.map((d) => ({ value: d.id, label: d.nameAr ?? d.name }))]}
          />
        }
      />

      {/* -------- Employee detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? employeeName(selected) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex items-center gap-[10px]">
              <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
              <span className="mz-num text-[12px] text-ink-faint">{selected.code}</span>
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">القسم</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{departmentName(selected.departmentId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">المسمى الوظيفي</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{jobTitleName(selected.jobTitleId)}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الفرع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ التعيين</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.hireDate}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">فئة العامل</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{WORKER_CATEGORY_LABEL[selected.workerCategory]}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">احتساب العمل الإضافي</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{OVERTIME_LABEL[selected.overtimeEligibility]}</div>
              </div>
            </Card>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">المعلومات الشخصية</h3>
              <dl className="grid grid-cols-2 gap-[10px] text-[12.5px]">
                <div>
                  <dt className="text-ink-faint">تاريخ الميلاد</dt>
                  <dd className="mz-num text-ink">{selected.birthDate ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">الجنس</dt>
                  <dd className="text-ink">{selected.gender ? GENDER_LABEL[selected.gender] : "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">الحالة الاجتماعية</dt>
                  <dd className="text-ink">{selected.maritalStatus ? MARITAL_LABEL[selected.maritalStatus] : "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">نوع التوظيف</dt>
                  <dd className="text-ink">{selected.employmentType === "full_time" ? "دوام كامل" : "دوام جزئي"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">نهاية فترة التجربة</dt>
                  <dd className="mz-num text-ink">{selected.probationEndDate ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">سنوات الخدمة السابقة</dt>
                  <dd className="mz-num text-ink">{selected.priorServiceYears}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">العقود</h3>
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
                <p className="text-[12.5px] text-ink-muted">لا توجد عقود مرتبطة بهذا الموظف.</p>
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
                    {STATUS_LABEL[status]}
                  </Button>
                ))}
                <Button variant="danger-outline" disabled={pendingAction} onClick={runTerminate}>
                  إنهاء الخدمة
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Create employee panel -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="موظف جديد" description="بيانات الموظف الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <h3 className="font-display text-[13px] font-bold text-ink">المعلومات الشخصية</h3>
          <TextField label="الاسم الأول *" value={draft.firstName} onChange={(v) => setDraft((d) => ({ ...d, firstName: v }))} />
          <TextField label="اسم العائلة *" value={draft.lastName} onChange={(v) => setDraft((d) => ({ ...d, lastName: v }))} />
          <TextField label="الاسم الأول (عربي)" value={draft.firstNameAr} onChange={(v) => setDraft((d) => ({ ...d, firstNameAr: v }))} />
          <TextField label="اسم العائلة (عربي)" value={draft.lastNameAr} onChange={(v) => setDraft((d) => ({ ...d, lastNameAr: v }))} />
          <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
          <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
          <TextField label="تاريخ الميلاد" value={draft.birthDate} onChange={(v) => setDraft((d) => ({ ...d, birthDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label="رقم الهوية" value={draft.nationalId} onChange={(v) => setDraft((d) => ({ ...d, nationalId: v }))} />
          <SelectField
            label="الجنس"
            value={draft.gender}
            onChange={(v) => setDraft((d) => ({ ...d, gender: v as GenderDTO | "" }))}
            options={[{ value: "", label: "اختر..." }, ...(Object.keys(GENDER_LABEL) as GenderDTO[]).map((g) => ({ value: g, label: GENDER_LABEL[g] }))]}
          />
          <SelectField
            label="الحالة الاجتماعية"
            value={draft.maritalStatus}
            onChange={(v) => setDraft((d) => ({ ...d, maritalStatus: v as MaritalStatusDTO | "" }))}
            options={[{ value: "", label: "اختر..." }, ...(Object.keys(MARITAL_LABEL) as MaritalStatusDTO[]).map((m) => ({ value: m, label: MARITAL_LABEL[m] }))]}
          />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">معلومات التوظيف</h3>
          <EntityPicker
            label="القسم"
            options={departmentOptions}
            value={draft.departmentId ? (departmentOptions.find((o) => o.id === draft.departmentId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, departmentId: option?.id ?? "", jobTitleId: "" }))}
          />
          <EntityPicker
            label="المسمى الوظيفي"
            options={jobTitleOptions}
            value={draft.jobTitleId ? (jobTitleOptions.find((o) => o.id === draft.jobTitleId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, jobTitleId: option?.id ?? "" }))}
          />
          <EntityPicker
            label="المدير المباشر"
            options={managerOptions}
            value={draft.managerId ? (managerOptions.find((o) => o.id === draft.managerId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, managerId: option?.id ?? "" }))}
          />
          <EntityPicker
            label="الفرع *"
            options={branchOptions}
            value={draft.branchId ? (branchOptions.find((o) => o.id === draft.branchId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, branchId: option?.id ?? "" }))}
          />
          <TextField label="تاريخ التعيين *" value={draft.hireDate} onChange={(v) => setDraft((d) => ({ ...d, hireDate: v }))} placeholder="YYYY-MM-DD" />
          <SelectField
            label="فئة العامل *"
            value={draft.workerCategory}
            onChange={(v) => setDraft((d) => ({ ...d, workerCategory: v as WorkerCategoryDTO }))}
            options={(Object.keys(WORKER_CATEGORY_LABEL) as WorkerCategoryDTO[]).map((c) => ({ value: c, label: WORKER_CATEGORY_LABEL[c] }))}
          />
          <SelectField
            label="نوع التوظيف"
            value={draft.employmentType}
            onChange={(v) => setDraft((d) => ({ ...d, employmentType: v as "full_time" | "part_time" }))}
            options={[{ value: "full_time", label: "دوام كامل" }, { value: "part_time", label: "دوام جزئي" }]}
          />
          <SelectField
            label="احتساب العمل الإضافي"
            value={draft.overtimeEligibility}
            onChange={(v) => setDraft((d) => ({ ...d, overtimeEligibility: v as OvertimeEligibilityDTO }))}
            options={(Object.keys(OVERTIME_LABEL) as OvertimeEligibilityDTO[]).map((o) => ({ value: o, label: OVERTIME_LABEL[o] }))}
          />
          <NumberField
            label="ساعات العمل القياسية"
            value={draft.standardWorkHours ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, standardWorkHours: Number.isNaN(v) ? null : v }))}
            hint="حسب القسم / المنشأة"
          />
          <TextField label="نهاية فترة التجربة" value={draft.probationEndDate} onChange={(v) => setDraft((d) => ({ ...d, probationEndDate: v }))} placeholder="YYYY-MM-DD" />
          <NumberField
            label="سنوات الخدمة السابقة"
            value={draft.priorServiceYears}
            min={0}
            onChange={(v) => setDraft((d) => ({ ...d, priorServiceYears: Number.isNaN(v) ? 0 : v }))}
            hint="لاحتساب علاوة الأقدمية وفق المادة 47 من قانون العمل"
          />
          <ToggleField
            label="طلب صورة شخصية عند تسجيل الحضور"
            checked={draft.requireSelfieAtClockIn}
            onChange={(v) => setDraft((d) => ({ ...d, requireSelfieAtClockIn: v }))}
          />
          <ToggleField
            label="طلب التحقق بالبصمة عند تسجيل الحضور"
            checked={draft.requireBiometricAtClockIn}
            onChange={(v) => setDraft((d) => ({ ...d, requireBiometricAtClockIn: v }))}
          />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">العنوان</h3>
          <TextField label="الشارع" value={draft.street} onChange={(v) => setDraft((d) => ({ ...d, street: v }))} />
          <TextField label="المدينة" value={draft.city} onChange={(v) => setDraft((d) => ({ ...d, city: v }))} />
          <TextField label="المحافظة" value={draft.governorate} onChange={(v) => setDraft((d) => ({ ...d, governorate: v }))} />
          <TextField label="الرمز البريدي" value={draft.postalCode} onChange={(v) => setDraft((d) => ({ ...d, postalCode: v }))} />

          <h3 className="mt-[6px] font-display text-[13px] font-bold text-ink">جهة الاتصال في حالات الطوارئ</h3>
          <TextField label="الاسم" value={draft.emergencyName} onChange={(v) => setDraft((d) => ({ ...d, emergencyName: v }))} />
          <TextField label="صلة القرابة" value={draft.emergencyRelationship} onChange={(v) => setDraft((d) => ({ ...d, emergencyRelationship: v }))} />
          <TextField label="رقم الهاتف" value={draft.emergencyPhone} onChange={(v) => setDraft((d) => ({ ...d, emergencyPhone: v }))} />
          <TextField label="رقم هاتف آخر" value={draft.emergencyAltPhone} onChange={(v) => setDraft((d) => ({ ...d, emergencyAltPhone: v }))} />

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
