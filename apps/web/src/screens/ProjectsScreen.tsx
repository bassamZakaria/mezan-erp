import { useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  Card,
  Button,
  SidePanel,
  MoneyInput,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { CreateProjectDTO, ProjectDTO, ProjectStatusDTO } from "@mezan/contracts";
import { ApiError, useCreateProject, useCustomers, useProjects, useUpdateProject, useUsers } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";

/** المشاريع والمقاولات (Projects & Contracting) — docs/catalog/07 §"المشاريع والمقاولات". List + detail + new-project panel. */

const STATUS_LABEL: Record<ProjectStatusDTO, string> = {
  planned: "مخطط",
  active: "نشط",
  on_hold: "متوقف مؤقتاً",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const STATUS_TONE: Record<ProjectStatusDTO, PillTone> = {
  planned: "info",
  active: "success",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
};

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ProjectStatusDTO[]).map((value) => ({ value, label: STATUS_LABEL[value] }));

const NO_CUSTOMER_OPTION: EntityPickerOption = { id: "__none__", label: "بدون عميل" };
const NO_MANAGER_OPTION: EntityPickerOption = { id: "__none__", label: "بدون مدير" };

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface ProjectDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  customerId: string | null;
  managerId: string | null;
  startDate: string;
  endDate: string;
  budget: number | null;
  siteAddress: string;
  notes: string;
}

function blankDraft(): ProjectDraft {
  return {
    code: "",
    nameAr: "",
    nameEn: "",
    customerId: null,
    managerId: null,
    startDate: "",
    endDate: "",
    budget: 0,
    siteAddress: "",
    notes: "",
  };
}

function validateDraft(draft: ProjectDraft, existing: ProjectDTO[]): string | null {
  const code = draft.code.trim();
  if (code === "") return "كود المشروع مطلوب.";
  if (existing.some((p) => p.code === code)) return `الكود "${code}" مستخدم بالفعل — اختر كوداً آخر.`;
  if (draft.nameAr.trim() === "") return "اسم المشروع مطلوب.";
  return null;
}

export function ProjectsScreen() {
  const query = useProjects();
  const customersQuery = useCustomers();
  const usersQuery = useUsers();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const projects = query.data ?? [];
  const customers = customersQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<ProjectStatusDTO>("planned");
  const [statusError, setStatusError] = useState<string | null>(null);

  function customerName(customerId: string | null): string {
    if (customerId === null) return "بدون عميل";
    return customers.find((c) => c.id === customerId)?.nameAr ?? customerId;
  }

  function managerName(managerId: string | null): string {
    if (managerId === null) return "بدون مدير";
    return users.find((u) => u.id === managerId)?.fullName ?? managerId;
  }

  const filtered = useMemo(() => {
    let rows = projects;
    if (statusFilter !== "all") rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => p.code.toLowerCase().includes(q) || p.nameAr.toLowerCase().includes(q));
    }
    return rows;
  }, [projects, statusFilter, search]);

  const totalCount = projects.length;
  const activeCount = projects.filter((p) => p.status === "active").length;
  const plannedCount = projects.filter((p) => p.status === "planned").length;
  const completedCount = projects.filter((p) => p.status === "completed").length;

  const selected = selectedId ? projects.find((p) => p.id === selectedId) ?? null : null;

  const customerOptions: EntityPickerOption[] = [
    NO_CUSTOMER_OPTION,
    ...customers.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` })),
  ];
  const managerOptions: EntityPickerOption[] = [NO_MANAGER_OPTION, ...users.map((u) => ({ id: u.id, label: u.fullName }))];

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openDetail(project: ProjectDTO) {
    setSelectedId(project.id);
    setStatusDraft(project.status);
    setStatusError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, projects);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const body: CreateProjectDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      customerId: draft.customerId,
      managerId: draft.managerId,
      startDate: draft.startDate.trim() === "" ? null : draft.startDate.trim(),
      endDate: draft.endDate.trim() === "" ? null : draft.endDate.trim(),
      budget: (draft.budget ?? 0).toFixed(6),
      siteAddress: draft.siteAddress.trim() === "" ? null : draft.siteAddress.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    };
    try {
      await createProject.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة المشروع.");
    }
  }

  async function handleStatusSave() {
    if (!selected) return;
    setStatusError(null);
    try {
      await updateProject.mutateAsync({ id: selected.id, patch: { status: statusDraft } });
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : "تعذّر تحديث حالة المشروع.");
    }
  }

  const columns: DocumentListColumn<ProjectDTO>[] = [
    { key: "code", header: "كود المشروع", render: (p) => <span className="mz-num font-semibold text-ink">{p.code}</span> },
    { key: "nameAr", header: "اسم المشروع", render: (p) => <span className="font-semibold text-ink">{p.nameAr}</span> },
    { key: "customer", header: "العميل", render: (p) => customerName(p.customerId) },
    { key: "manager", header: "مدير المشروع", render: (p) => managerName(p.managerId) },
    { key: "budget", header: "الميزانية", align: "end", render: (p) => <MoneyDisplay value={toMajor(p.budget)} /> },
    { key: "status", header: "الحالة", render: (p) => <StatusPill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /> },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: totalCount },
    ...(Object.keys(STATUS_LABEL) as ProjectStatusDTO[]).map((status) => ({
      key: status,
      label: STATUS_LABEL[status],
      count: projects.filter((p) => p.status === status).length,
    })),
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل المشاريع.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<ProjectDTO>
        eyebrow="Projects · Contracting"
        title="المشاريع والمقاولات"
        description="تتبّع تكلفة كل مشروع وفوترته عبر مركز تكلفة مخصص له"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            مشروع جديد
          </Button>
        }
        stats={[
          { label: "إجمالي المشاريع", value: <span className="mz-num">{totalCount}</span> },
          { label: "نشط", value: <span className="mz-num">{activeCount}</span> },
          { label: "مخطط", value: <span className="mz-num">{plannedCount}</span> },
          { label: "مكتمل", value: <span className="mz-num">{completedCount}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={setStatusFilter}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث بالكود أو الاسم..."
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={openDetail}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{totalCount}</span> مشروع
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            لا توجد مشاريع — أنشئ أول مشروع لبدء تتبع التكاليف والفوترة لكل مشروع
          </div>
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `مشروع — ${selected.nameAr}` : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">كود المشروع</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الاسم بالإنجليزية</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.nameEn ?? "—"}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">العميل</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{customerName(selected.customerId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">مدير المشروع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{managerName(selected.managerId)}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ البدء</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.startDate ?? "—"}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الانتهاء</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.endDate ?? "—"}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">عنوان الموقع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.siteAddress ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">مركز التكلفة</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.costCenterId}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">الميزانية</div>
              <div className="mt-[6px]">
                <MoneyDisplay value={toMajor(selected.budget)} className="text-[18px] font-bold" />
              </div>
            </Card>
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}
            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">تغيير الحالة</h3>
              {statusError ? (
                <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                  {statusError}
                </div>
              ) : null}
              <div className="flex items-end gap-[10px]">
                <div className="flex-1">
                  <SelectField label="الحالة" value={statusDraft} onChange={(v) => setStatusDraft(v as ProjectStatusDTO)} options={STATUS_OPTIONS} />
                </div>
                <Button variant="primary" onClick={handleStatusSave}>
                  حفظ
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="مشروع جديد" description="بيانات المشروع الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField
            label="كود المشروع *"
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
            placeholder="TOWER-A"
            hint="يستخدم لإنشاء مركز تكلفة المشروع (PRJ-الكود)"
          />
          <TextField label="اسم المشروع *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label="الاسم بالإنجليزية" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <EntityPicker
            label="العميل"
            options={customerOptions}
            value={draft.customerId ? (customerOptions.find((o) => o.id === draft.customerId) ?? null) : NO_CUSTOMER_OPTION}
            onChange={(option) => setDraft((d) => ({ ...d, customerId: !option || option.id === NO_CUSTOMER_OPTION.id ? null : option.id }))}
          />
          <EntityPicker
            label="مدير المشروع"
            options={managerOptions}
            value={draft.managerId ? (managerOptions.find((o) => o.id === draft.managerId) ?? null) : NO_MANAGER_OPTION}
            onChange={(option) => setDraft((d) => ({ ...d, managerId: !option || option.id === NO_MANAGER_OPTION.id ? null : option.id }))}
          />
          <TextField label="تاريخ البدء" value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label="تاريخ الانتهاء" value={draft.endDate} onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))} placeholder="YYYY-MM-DD" />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">الميزانية (EGP)</div>
            <MoneyInput value={draft.budget} onChange={(v) => setDraft((d) => ({ ...d, budget: v }))} />
          </div>
          <TextField label="عنوان الموقع" value={draft.siteAddress} onChange={(v) => setDraft((d) => ({ ...d, siteAddress: v }))} />
          <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

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
