import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, EntityPicker, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type EntityPickerOption, type PillTone } from "@mezan/ui";
import type { JobTitleDTO } from "@mezan/contracts";
import { TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateJobTitle, useDepartments, useEmployees, useJobTitles, useUpdateJobTitle } from "../data/hooks";

/** المسميات الوظيفية (Job Titles) — docs/catalog/06 §"المسميات الوظيفية". Department-scoped master data; department is locked once created. */

interface JobTitleDraft {
  departmentId: string;
  name: string;
  nameAr: string;
}

function blankDraft(): JobTitleDraft {
  return { departmentId: "", name: "", nameAr: "" };
}

export function JobTitlesScreen() {
  const query = useJobTitles();
  const departmentsQuery = useDepartments();
  const employeesQuery = useEmployees();
  const createJobTitle = useCreateJobTitle();
  const updateJobTitle = useUpdateJobTitle();
  const jobTitles = query.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<JobTitleDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const departmentOptions: EntityPickerOption[] = departments.map((d) => ({ id: d.id, label: d.nameAr ?? d.name }));

  function departmentName(departmentId: string): string {
    return departments.find((d) => d.id === departmentId)?.nameAr ?? departments.find((d) => d.id === departmentId)?.name ?? departmentId;
  }

  const headcountByJobTitle = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) {
      if (!e.jobTitleId || e.status === "terminated") continue;
      map.set(e.jobTitleId, (map.get(e.jobTitleId) ?? 0) + 1);
    }
    return map;
  }, [employees]);

  const filtered = useMemo(() => {
    let rows = jobTitles;
    if (statusFilter !== "all") rows = rows.filter((j) => (statusFilter === "active" ? j.active : !j.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((j) => j.name.toLowerCase().includes(q) || (j.nameAr ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [jobTitles, statusFilter, search]);

  const selected = selectedId ? (jobTitles.find((j) => j.id === selectedId) ?? null) : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(jobTitle: JobTitleDTO) {
    setSelectedId(jobTitle.id);
    setEditName(jobTitle.name);
    setEditNameAr(jobTitle.nameAr ?? "");
    setEditActive(jobTitle.active);
    setEditError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (draft.departmentId === "" || draft.name.trim() === "") {
      setFormError("القسم واسم المسمى الوظيفي مطلوبان.");
      return;
    }
    setFormError(null);
    try {
      await createJobTitle.mutateAsync({
        departmentId: draft.departmentId,
        name: draft.name.trim(),
        nameAr: draft.nameAr.trim() === "" ? null : draft.nameAr.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة المسمى الوظيفي.");
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (editName.trim() === "") {
      setEditError("اسم المسمى الوظيفي مطلوب.");
      return;
    }
    setEditError(null);
    try {
      await updateJobTitle.mutateAsync({
        id: selected.id,
        body: { name: editName.trim(), nameAr: editNameAr.trim() === "" ? null : editNameAr.trim(), active: editActive },
      });
      setSelectedId(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "تعذّر تعديل المسمى الوظيفي.");
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: jobTitles.length },
    { key: "active", label: "نشط", count: jobTitles.filter((j) => j.active).length },
    { key: "inactive", label: "غير نشط", count: jobTitles.filter((j) => !j.active).length },
  ];

  const columns: DocumentListColumn<JobTitleDTO>[] = [
    { key: "name", header: "اسم المسمى الوظيفي", render: (j) => <span className="font-semibold text-ink">{j.nameAr ?? j.name}</span> },
    { key: "department", header: "القسم", render: (j) => departmentName(j.departmentId) },
    { key: "headcount", header: "الموظفون", align: "end", render: (j) => <span className="mz-num">{headcountByJobTitle.get(j.id) ?? 0}</span> },
    {
      key: "status",
      header: "الحالة",
      render: (j) => <StatusPill label={j.active ? "نشط" : "غير نشط"} tone={(j.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل المسميات الوظيفية.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<JobTitleDTO>
        eyebrow="HR · Job Titles"
        title="المسميات الوظيفية"
        description="مسميات وظيفية مرتبطة بقسم واحد، تُستخدم في نموذج إضافة/تعديل الموظف"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة مسمى وظيفي
          </Button>
        }
        stats={[
          { label: "إجمالي المسميات", value: <span className="mz-num">{jobTitles.length}</span> },
          { label: "نشط", value: <span className="mz-num">{jobTitles.filter((j) => j.active).length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | "active" | "inactive")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم..."
        columns={columns}
        rows={filtered}
        rowKey={(j) => j.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{jobTitles.length}</span> مسمى وظيفي
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد مسميات وظيفية — أضف أول مسمى وظيفي</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? "تعديل المسمى الوظيفي" : ""}>
        {selected ? (
          <form onSubmit={handleEditSave} className="flex flex-col gap-[14px]">
            {editError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {editError}
              </div>
            ) : null}
            <TextField label="القسم" value={departmentName(selected.departmentId)} onChange={() => {}} disabled />
            <TextField label="اسم المسمى الوظيفي *" value={editName} onChange={setEditName} />
            <TextField label="الاسم (عربي)" value={editNameAr} onChange={setEditNameAr} />
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

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="إضافة مسمى وظيفي" description="بيانات المسمى الوظيفي الأساسية">
        <form onSubmit={handleCreate} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label="القسم *"
            options={departmentOptions}
            value={draft.departmentId ? (departmentOptions.find((o) => o.id === draft.departmentId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, departmentId: option?.id ?? "" }))}
          />
          <TextField label="اسم المسمى الوظيفي *" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label="الاسم (عربي)" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
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
