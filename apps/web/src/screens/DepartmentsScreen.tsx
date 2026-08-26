import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { DepartmentDTO } from "@mezan/contracts";
import { NumberField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateDepartment, useDepartments, useEmployees, useUpdateDepartment } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { bilingualName } from "./hr-employee-name";

/** الأقسام (Departments) — docs/catalog/06 §"الأقسام". Thin master data: list + a combined edit/detail panel + create panel, no standalone detail page (matches the catalog's "no dedicated detail page" note). */

interface DepartmentDraft {
  code: string;
  name: string;
  nameAr: string;
  managerId: string;
  overtimeEligible: boolean;
  standardWorkHours: number | null;
}

function blankDraft(): DepartmentDraft {
  return { code: "", name: "", nameAr: "", managerId: "", overtimeEligible: true, standardWorkHours: null };
}

function draftFrom(d: DepartmentDTO): DepartmentDraft {
  return {
    code: d.code,
    name: d.name,
    nameAr: d.nameAr ?? "",
    managerId: d.managerId ?? "",
    overtimeEligible: d.overtimeEligible,
    standardWorkHours: d.standardWorkHours,
  };
}

export function DepartmentsScreen() {
  const { t, locale } = useAppTranslation();
  const query = useDepartments();
  const employeesQuery = useEmployees();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const departments = query.data ?? [];
  const employees = employeesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<DepartmentDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DepartmentDraft | null>(null);
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const headcountByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) {
      if (!e.departmentId || e.status === "terminated") continue;
      map.set(e.departmentId, (map.get(e.departmentId) ?? 0) + 1);
    }
    return map;
  }, [employees]);

  function managerName(managerId: string | null): string {
    if (!managerId) return t("departments.noManager");
    const emp = employees.find((e) => e.id === managerId);
    return emp ? `${emp.firstNameAr ?? emp.firstName} ${emp.lastNameAr ?? emp.lastName}` : managerId;
  }

  const filtered = useMemo(() => {
    let rows = departments;
    if (statusFilter !== "all") rows = rows.filter((d) => (statusFilter === "active" ? d.active : !d.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q));
    }
    return rows;
  }, [departments, statusFilter, search]);

  const selected = selectedId ? (departments.find((d) => d.id === selectedId) ?? null) : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(department: DepartmentDTO) {
    setSelectedId(department.id);
    setEditDraft(draftFrom(department));
    setEditActive(department.active);
    setEditError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (draft.code.trim() === "" || draft.name.trim() === "") {
      setFormError(t("departments.aDepartmentCodeAndName"));
      return;
    }
    setFormError(null);
    try {
      await createDepartment.mutateAsync({
        code: draft.code.trim(),
        name: draft.name.trim(),
        nameAr: draft.nameAr.trim() === "" ? null : draft.nameAr.trim(),
        managerId: draft.managerId === "" ? null : draft.managerId,
        overtimeEligible: draft.overtimeEligible,
        standardWorkHours: draft.standardWorkHours,
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("departments.theDepartmentCouldNotBe"));
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!selected || !editDraft) return;
    if (editDraft.name.trim() === "") {
      setEditError(t("departments.aDepartmentNameIsRequired"));
      return;
    }
    setEditError(null);
    try {
      await updateDepartment.mutateAsync({
        id: selected.id,
        body: {
          name: editDraft.name.trim(),
          nameAr: editDraft.nameAr.trim() === "" ? null : editDraft.nameAr.trim(),
          managerId: editDraft.managerId === "" ? null : editDraft.managerId,
          overtimeEligible: editDraft.overtimeEligible,
          standardWorkHours: editDraft.standardWorkHours,
          active: editActive,
        },
      });
      setSelectedId(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t("departments.theDepartmentCouldNotBe2"));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: departments.length },
    { key: "active", label: t("common.active"), count: departments.filter((d) => d.active).length },
    { key: "inactive", label: t("common.inactive"), count: departments.filter((d) => !d.active).length },
  ];

  const columns: DocumentListColumn<DepartmentDTO>[] = [
    { key: "code", header: t("departments.departmentCode"), render: (d) => <span className="mz-num font-semibold text-ink">{d.code}</span> },
    { key: "name", header: t("departments.departmentName"), render: (d) => <span className="font-semibold text-ink">{bilingualName(d, locale)}</span> },
    { key: "manager", header: t("departments.manager"), render: (d) => managerName(d.managerId) },
    { key: "headcount", header: t("departments.employees"), align: "end", render: (d) => <span className="mz-num">{headcountByDepartment.get(d.id) ?? 0}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => <StatusPill label={d.active ? t("common.active") : t("common.inactive")} tone={(d.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("departments.departmentsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<DepartmentDTO>
        title={t("departments.departments")}
        description={t("departments.coreDepartmentDetailsCodeManager")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("departments.addDepartment")}
          </Button>
        }
        stats={[
          { label: t("departments.totalDepartments"), value: <span className="mz-num">{departments.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{departments.filter((d) => d.active).length}</span> },
          { label: t("departments.totalEmployees"), value: <span className="mz-num">{employees.length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | "active" | "inactive")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("departments.searchByCodeOrName")}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{departments.length}</span> {t("departments.departments2")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("departments.noDepartmentsAddTheFirst")}</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("departments.editDepartment") : ""}>
        {selected && editDraft ? (
          <form onSubmit={handleEditSave} className="flex flex-col gap-[14px]">
            {editError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {editError}
              </div>
            ) : null}
            <TextField label={t("departments.departmentCode")} value={editDraft.code} onChange={() => {}} disabled />
            <TextField label={t("departments.departmentName2")} value={editDraft.name} onChange={(v) => setEditDraft((d) => (d ? { ...d, name: v } : d))} />
            <TextField label={t("departments.departmentNameArabic")} value={editDraft.nameAr} onChange={(v) => setEditDraft((d) => (d ? { ...d, nameAr: v } : d))} />
            <TextField label={t("departments.departmentManagerEmployeeId")} value={editDraft.managerId} onChange={(v) => setEditDraft((d) => (d ? { ...d, managerId: v } : d))} hint={t("departments.leaveEmptyToRemoveThe")} />
            <ToggleField
              label={t("departments.overtimeCounts")}
              checked={editDraft.overtimeEligible}
              onChange={(v) => setEditDraft((d) => (d ? { ...d, overtimeEligible: v } : d))}
            />
            <NumberField
              label={t("departments.standardWorkingHours")}
              value={editDraft.standardWorkHours ?? Number.NaN}
              onChange={(v) => setEditDraft((d) => (d ? { ...d, standardWorkHours: Number.isNaN(v) ? null : v } : d))}
              hint={t("departments.leaveEmptyToUseThe")}
            />
            <ToggleField label={t("common.active")} checked={editActive} onChange={setEditActive} />
            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setSelectedId(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary">
                {t("departments.saveChanges")}
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("departments.addDepartment")} description={t("departments.theDepartmentSCoreDetails")}>
        <form onSubmit={handleCreate} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label={t("departments.departmentCode2")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="SALES" />
          <TextField label={t("departments.departmentName2")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label={t("departments.departmentNameArabic")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("departments.departmentManagerEmployeeId")} value={draft.managerId} onChange={(v) => setDraft((d) => ({ ...d, managerId: v }))} />
          <ToggleField label={t("departments.overtimeCounts")} checked={draft.overtimeEligible} onChange={(v) => setDraft((d) => ({ ...d, overtimeEligible: v }))} />
          <NumberField
            label={t("departments.standardWorkingHours")}
            value={draft.standardWorkHours ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, standardWorkHours: Number.isNaN(v) ? null : v }))}
            hint={t("departments.leaveEmptyToUseThe")}
          />
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
