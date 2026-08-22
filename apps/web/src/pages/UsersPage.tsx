import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  DocumentList,
  EntityPicker,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { ALL_SCOPE, type Role, type ScopeSelection, type User, type UserStatus } from "@mezan/domain";
import type { StoreResult } from "../store/useUsersRolesStore";

export interface UsersPageProps {
  users: User[];
  roles: Role[];
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string }[];
  employees: { id: string; name: string; position: string }[];
  onSave: (draft: UserFormDraft, editingId: string | null) => Promise<StoreResult<User>>;
  onToggleStatus: (userId: string, status: UserStatus) => Promise<StoreResult<User>>;
}

export interface UserFormDraft {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  pin: string;
  roleId: string | null;
  isCompanyAdmin: boolean;
  employeeId: string | null;
  branchIds: string[];
  warehouseIds: string[];
  status: UserStatus;
}

const STATUS_LABEL: Record<UserStatus, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<UserStatus, PillTone> = { active: "success", inactive: "neutral" };

function emptyDraft(): UserFormDraft {
  return {
    fullName: "",
    email: "",
    phone: "",
    password: "",
    pin: "",
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchIds: [],
    warehouseIds: [],
    status: "active",
  };
}

function scopeToIds(scope: ScopeSelection, all: string[]): string[] {
  return scope === ALL_SCOPE ? all : [...scope];
}

function userToDraft(user: User, allBranchIds: string[], allWarehouseIds: string[]): UserFormDraft {
  return {
    fullName: user.fullName,
    email: user.email,
    phone: user.phone ?? "",
    password: "",
    pin: "",
    roleId: user.roleId,
    isCompanyAdmin: user.isCompanyAdmin,
    employeeId: user.employeeId,
    branchIds: scopeToIds(user.branchScope, allBranchIds),
    warehouseIds: scopeToIds(user.warehouseScope, allWarehouseIds),
    status: user.status,
  };
}

export function UsersPage({ users, roles, branches, warehouses, employees, onSave, onToggleStatus }: UsersPageProps) {
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserFormDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const allBranchIds = useMemo(() => branches.map((b) => b.id), [branches]);
  const allWarehouseIds = useMemo(() => warehouses.map((w) => w.id), [warehouses]);

  const filtered = useMemo(() => {
    let rows = users;
    if (statusFilter !== "all") rows = rows.filter((u) => u.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return rows;
  }, [users, statusFilter, search]);

  const rolesInUse = new Set(users.map((u) => (u.isCompanyAdmin ? "__admin__" : u.roleId))).size;

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setFormError(null);
    setPanelOpen(true);
  }

  function openEdit(user: User) {
    setEditingId(user.id);
    setDraft(userToDraft(user, allBranchIds, allWarehouseIds));
    setFormError(null);
    setPanelOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (draft.fullName.trim() === "") {
      setFormError("الاسم الكامل مطلوب.");
      return;
    }
    if (draft.email.trim() === "") {
      setFormError("البريد الإلكتروني مطلوب.");
      return;
    }
    setSaving(true);
    const result = await onSave(draft, editingId);
    setSaving(false);
    if (result.ok) {
      setPanelOpen(false);
    } else {
      setFormError(result.error ?? "تعذر حفظ المستخدم");
    }
  }

  const roleOptions: EntityPickerOption[] = roles.map((r) => ({ id: r.id, label: r.name, sublabel: r.code }));
  const employeeOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: e.name, sublabel: e.position }));

  const columns: DocumentListColumn<User>[] = [
    {
      key: "fullName",
      header: "الاسم الكامل",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-[10px]">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-gradient-to-br from-brand to-brand-strong font-display text-[11px] font-bold text-brand-ink">
            {initials(row.fullName)}
          </span>
          <div>
            <div className="font-semibold text-ink">{row.fullName}</div>
            <div className="text-[11px] text-ink-faint">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "الدور",
      render: (row) => (
        <StatusPill
          label={row.isCompanyAdmin ? "مدير المنشأة" : (roleById.get(row.roleId ?? "")?.name ?? "—")}
          tone={row.isCompanyAdmin ? "info" : "neutral"}
        />
      ),
    },
    {
      key: "branches",
      header: "الفروع المتاحة",
      render: (row) =>
        row.branchScope === ALL_SCOPE
          ? "كل الفروع"
          : branches
              .filter((b) => (row.branchScope as string[]).includes(b.id))
              .map((b) => b.name)
              .join("، ") || "—",
    },
    {
      key: "lastLogin",
      header: "آخر دخول",
      render: (row) => (row.lastLoginAt ? row.lastLoginAt.slice(0, 10).split("-").reverse().join("/") : "لم يسجل بعد"),
    },
    {
      key: "status",
      header: "الحالة",
      render: (row) => <StatusPill label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            void onToggleStatus(row.id, row.status === "active" ? "inactive" : "active");
          }}
        >
          {row.status === "active" ? "تعطيل" : "تفعيل"}
        </Button>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: users.length },
    { key: "active", label: "نشط", count: users.filter((u) => u.status === "active").length },
    { key: "inactive", label: "غير نشط", count: users.filter((u) => u.status === "inactive").length },
  ];

  return (
    <>
      <DocumentList<User>
        eyebrow="Settings · Users"
        title="المستخدمون"
        description="إدارة حسابات المستخدمين وأدوارهم ونطاق الفروع/المستودعات المتاحة لهم."
        actions={<Button variant="primary" onClick={openCreate}>إضافة مستخدم</Button>}
        stats={[
          { label: "إجمالي المستخدمين", value: <span className="mz-num">{users.length}</span> },
          { label: "مستخدمون نشطون", value: <span className="mz-num">{users.filter((u) => u.status === "active").length}</span> },
          { label: "الأدوار المستخدمة", value: <span className="mz-num">{rolesInUse}</span> },
          { label: "غير نشط", value: <span className="mz-num">{users.filter((u) => u.status === "inactive").length}</span>, valueTone: "danger" },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as UserStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو البريد الإلكتروني…"
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{users.length}</span> مستخدم</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا يوجد مستخدمون مطابقون</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editingId ? "تعديل مستخدم" : "إضافة مستخدم"}
        description="معلومات الحساب، الدور والصلاحيات، ونطاق الفروع والمستودعات."
      >
        <div className="flex flex-col gap-[18px]">
          {formError ? (
            <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <FormSection title="معلومات الحساب">
            <TextField label="الاسم الكامل *" value={draft.fullName} onChange={(v) => setDraft((d) => ({ ...d, fullName: v }))} />
            <TextField label="البريد الإلكتروني *" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
            <TextField label="الهاتف" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="+20 1xx xxx xxxx" />
            <TextField
              label={editingId ? "كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)" : "كلمة مرور مؤقتة * (٨ أحرف على الأقل)"}
              type="password"
              value={draft.password}
              onChange={(v) => setDraft((d) => ({ ...d, password: v }))}
            />
            <TextField label="رمز PIN (اختياري، ٤-٦ أرقام)" value={draft.pin} onChange={(v) => setDraft((d) => ({ ...d, pin: v }))} placeholder="1234" />
          </FormSection>

          <FormSection title="الدور والصلاحيات">
            <label className="flex items-center gap-[9px] rounded-md border border-border bg-surface px-[12px] py-[10px]">
              <input
                type="checkbox"
                checked={draft.isCompanyAdmin}
                onChange={(e) => setDraft((d) => ({ ...d, isCompanyAdmin: e.target.checked, roleId: e.target.checked ? null : d.roleId }))}
                className="h-[15px] w-[15px] accent-brand"
              />
              <span>
                <span className="block text-[12.5px] font-semibold text-ink">صلاحيات مدير المنشأة</span>
                <span className="block text-[11px] text-ink-faint">صلاحيات كاملة لجميع الفروع والمستودعات والإعدادات</span>
              </span>
            </label>
            {!draft.isCompanyAdmin ? (
              <EntityPicker
                label="الدور *"
                value={roleOptions.find((o) => o.id === draft.roleId) ?? null}
                onChange={(o) => setDraft((d) => ({ ...d, roleId: o?.id ?? null }))}
                options={roleOptions}
                placeholder="اختر دورًا…"
              />
            ) : null}
            <EntityPicker
              label="الموظف المرتبط (اختياري)"
              value={employeeOptions.find((o) => o.id === draft.employeeId) ?? null}
              onChange={(o) => setDraft((d) => ({ ...d, employeeId: o?.id ?? null }))}
              options={employeeOptions}
              placeholder="ربط بسجل موظف…"
            />
          </FormSection>

          <FormSection title="الفروع والمستودعات">
            <CheckboxGroup
              label="الفروع المتاحة *"
              options={branches}
              selected={draft.branchIds}
              onChange={(ids) => setDraft((d) => ({ ...d, branchIds: ids }))}
            />
            <CheckboxGroup
              label="المستودعات المتاحة"
              options={warehouses}
              selected={draft.warehouseIds}
              onChange={(ids) => setDraft((d) => ({ ...d, warehouseIds: ids }))}
            />
          </FormSection>

          <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
            <Button variant="ghost" onClick={() => setPanelOpen(false)}>إلغاء</Button>
            <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "جارٍ الحفظ…" : "حفظ المستخدم"}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]).join("");
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-[15px]">
      <h3 className="mb-[12px] text-[12.5px] font-bold text-ink">{title}</h3>
      <div className="flex flex-col gap-[12px]">{children}</div>
    </Card>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand"
      />
    </label>
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div>
      <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{label}</span>
      <div className="flex flex-col gap-[6px]">
        {options.map((opt) => {
          const checked = selected.includes(opt.id);
          return (
            <label key={opt.id} className="flex items-center gap-[8px] text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(checked ? selected.filter((id) => id !== opt.id) : [...selected, opt.id])
                }
                className="h-[14px] w-[14px] accent-brand"
              />
              {opt.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}
