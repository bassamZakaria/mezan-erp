import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { DepartmentDTO } from "@mezan/contracts";
import { NumberField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateDepartment, useDepartments, useEmployees, useUpdateDepartment } from "../data/hooks";

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
    if (!managerId) return "بدون مدير";
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
      setFormError("كود القسم والاسم مطلوبان.");
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
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة القسم.");
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!selected || !editDraft) return;
    if (editDraft.name.trim() === "") {
      setEditError("اسم القسم مطلوب.");
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
      setEditError(err instanceof ApiError ? err.message : "تعذّر تعديل القسم.");
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: departments.length },
    { key: "active", label: "نشط", count: departments.filter((d) => d.active).length },
    { key: "inactive", label: "غير نشط", count: departments.filter((d) => !d.active).length },
  ];

  const columns: DocumentListColumn<DepartmentDTO>[] = [
    { key: "code", header: "كود القسم", render: (d) => <span className="mz-num font-semibold text-ink">{d.code}</span> },
    { key: "name", header: "اسم القسم", render: (d) => <span className="font-semibold text-ink">{d.nameAr ?? d.name}</span> },
    { key: "manager", header: "المدير", render: (d) => managerName(d.managerId) },
    { key: "headcount", header: "الموظفون", align: "end", render: (d) => <span className="mz-num">{headcountByDepartment.get(d.id) ?? 0}</span> },
    {
      key: "status",
      header: "الحالة",
      render: (d) => <StatusPill label={d.active ? "نشط" : "غير نشط"} tone={(d.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الأقسام.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<DepartmentDTO>
        eyebrow="HR · Departments"
        title="الأقسام"
        description="بيانات الأقسام الأساسية: الكود، المدير، وسياسات العمل الإضافي وساعات العمل الافتراضية"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة قسم
          </Button>
        }
        stats={[
          { label: "إجمالي الأقسام", value: <span className="mz-num">{departments.length}</span> },
          { label: "نشط", value: <span className="mz-num">{departments.filter((d) => d.active).length}</span> },
          { label: "إجمالي الموظفين", value: <span className="mz-num">{employees.length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | "active" | "inactive")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالكود أو الاسم..."
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{departments.length}</span> قسم
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أقسام — أضف أول قسم لبدء تنظيم الموظفين</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? "تعديل القسم" : ""}>
        {selected && editDraft ? (
          <form onSubmit={handleEditSave} className="flex flex-col gap-[14px]">
            {editError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {editError}
              </div>
            ) : null}
            <TextField label="كود القسم" value={editDraft.code} onChange={() => {}} disabled />
            <TextField label="اسم القسم *" value={editDraft.name} onChange={(v) => setEditDraft((d) => (d ? { ...d, name: v } : d))} />
            <TextField label="اسم القسم (عربي)" value={editDraft.nameAr} onChange={(v) => setEditDraft((d) => (d ? { ...d, nameAr: v } : d))} />
            <TextField label="مدير القسم (معرّف الموظف)" value={editDraft.managerId} onChange={(v) => setEditDraft((d) => (d ? { ...d, managerId: v } : d))} hint="اترك فارغاً لإزالة المدير" />
            <ToggleField
              label="احتساب العمل الإضافي"
              checked={editDraft.overtimeEligible}
              onChange={(v) => setEditDraft((d) => (d ? { ...d, overtimeEligible: v } : d))}
            />
            <NumberField
              label="ساعات العمل القياسية"
              value={editDraft.standardWorkHours ?? Number.NaN}
              onChange={(v) => setEditDraft((d) => (d ? { ...d, standardWorkHours: Number.isNaN(v) ? null : v } : d))}
              hint="اتركه فارغاً لاستخدام إعداد المنشأة (8 ساعات)"
            />
            <ToggleField label="نشط" checked={editActive} onChange={setEditActive} />
            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setSelectedId(null)}>
                إلغاء
              </Button>
              <Button type="submit" variant="primary">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="إضافة قسم" description="بيانات القسم الأساسية">
        <form onSubmit={handleCreate} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label="كود القسم *" value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="SALES" />
          <TextField label="اسم القسم *" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label="اسم القسم (عربي)" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label="مدير القسم (معرّف الموظف)" value={draft.managerId} onChange={(v) => setDraft((d) => ({ ...d, managerId: v }))} />
          <ToggleField label="احتساب العمل الإضافي" checked={draft.overtimeEligible} onChange={(v) => setDraft((d) => ({ ...d, overtimeEligible: v }))} />
          <NumberField
            label="ساعات العمل القياسية"
            value={draft.standardWorkHours ?? Number.NaN}
            onChange={(v) => setDraft((d) => ({ ...d, standardWorkHours: Number.isNaN(v) ? null : v }))}
            hint="اتركه فارغاً لاستخدام إعداد المنشأة (8 ساعات)"
          />
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
