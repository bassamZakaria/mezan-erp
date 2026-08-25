import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  DocumentList,
  EntityPicker,
  SidePanel,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { ALL_SCOPE, type ScopeSelection } from "@mezan/domain";
import type { RoleDTO, ScopeSelectionDTO, UserDTO, UserStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

export interface StoreResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface UsersPageProps {
  users: UserDTO[];
  roles: RoleDTO[];
  branches: { id: string; name: string }[];
  warehouses: { id: string; name: string; branchId: string }[];
  employees: { id: string; name: string; position: string }[];
  onSave: (draft: UserFormDraft, editingId: string | null) => Promise<StoreResult<UserDTO>>;
  onToggleStatus: (userId: string, status: UserStatusDTO) => Promise<StoreResult<UserDTO>>;
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
  status: UserStatusDTO;
}

const STATUS_KEY: Record<UserStatusDTO, AppTranslationKey> = { active: "common.active", inactive: "common.inactive" };
const STATUS_TONE: Record<UserStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

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

function userToDraft(user: UserDTO, allBranchIds: string[], allWarehouseIds: string[]): UserFormDraft {
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
  const { t } = useAppTranslation();
  const [statusFilter, setStatusFilter] = useState<UserStatusDTO | "all">("all");
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

  function openEdit(user: UserDTO) {
    setEditingId(user.id);
    setDraft(userToDraft(user, allBranchIds, allWarehouseIds));
    setFormError(null);
    setPanelOpen(true);
  }

  async function handleSave() {
    setFormError(null);
    if (draft.fullName.trim() === "") {
      setFormError(t("users.theFullNameIsRequired"));
      return;
    }
    if (draft.email.trim() === "") {
      setFormError(t("users.theEmailAddressIsRequired"));
      return;
    }
    setSaving(true);
    const result = await onSave(draft, editingId);
    setSaving(false);
    if (result.ok) {
      setPanelOpen(false);
    } else {
      setFormError(result.error ?? t("users.couldNotSaveTheUser"));
    }
  }

  const roleOptions: EntityPickerOption[] = roles.map((r) => ({ id: r.id, label: r.name, sublabel: r.code }));
  const employeeOptions: EntityPickerOption[] = employees.map((e) => ({ id: e.id, label: e.name, sublabel: e.position }));

  const columns: DocumentListColumn<UserDTO>[] = [
    {
      key: "fullName",
      header: t("users.fullName"),
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
      header: t("users.role"),
      render: (row) => (
        <StatusPill
          label={row.isCompanyAdmin ? t("users.companyAdministrator") : (roleById.get(row.roleId ?? "")?.name ?? "—")}
          tone={row.isCompanyAdmin ? "info" : "neutral"}
        />
      ),
    },
    {
      key: "branches",
      header: t("users.branchesAvailable"),
      render: (row) =>
        row.branchScope === ALL_SCOPE
          ? t("users.allBranches")
          : branches
              .filter((b) => (row.branchScope as string[]).includes(b.id))
              .map((b) => b.name)
              .join(t("users.text")) || "—",
    },
    {
      key: "lastLogin",
      header: t("users.lastSignedIn"),
      render: (row) => (row.lastLoginAt ? row.lastLoginAt.slice(0, 10).split("-").reverse().join("/") : t("users.never")),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} />,
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
          {row.status === "active" ? t("users.disable") : t("users.enable")}
        </Button>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: users.length },
    { key: "active", label: t("common.active"), count: users.filter((u) => u.status === "active").length },
    { key: "inactive", label: t("common.inactive"), count: users.filter((u) => u.status === "inactive").length },
  ];

  return (
    <>
      <DocumentList<UserDTO>
        title={t("users.users")}
        description={t("users.manageTheUserAccountsTheir")}
        actions={<Button variant="primary" onClick={openCreate}>{t("users.addAUser")}</Button>}
        stats={[
          { label: t("users.totalUsers"), value: <span className="mz-num">{users.length}</span> },
          { label: t("users.activeUsers"), value: <span className="mz-num">{users.filter((u) => u.status === "active").length}</span> },
          { label: t("users.rolesInUse"), value: <span className="mz-num">{rolesInUse}</span> },
          { label: t("common.inactive"), value: <span className="mz-num">{users.filter((u) => u.status === "inactive").length}</span>, valueTone: "danger" },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as UserStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("users.searchByNameOrEmail")}
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{users.length}</span> {t("users.user")}</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("users.noMatchingUsers")}</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editingId ? t("users.editAUser") : t("users.addAUser")}
        description={t("users.theAccountDetailsTheRole")}
      >
        <div className="flex flex-col gap-[18px]">
          {formError ? (
            <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <FormSection title={t("users.accountDetails")}>
            <TextField label={t("users.fullName2")} value={draft.fullName} onChange={(v) => setDraft((d) => ({ ...d, fullName: v }))} />
            <TextField label={t("users.email")} type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
            <TextField label={t("common.phone")} value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="+20 1xx xxx xxxx" />
            <TextField
              label={editingId ? t("users.newPasswordLeaveEmptyTo") : t("users.temporaryPasswordAtLeast8")}
              type="password"
              value={draft.password}
              onChange={(v) => setDraft((d) => ({ ...d, password: v }))}
            />
            <TextField label={t("users.pinOptional46Digits")} value={draft.pin} onChange={(v) => setDraft((d) => ({ ...d, pin: v }))} placeholder="1234" />
          </FormSection>

          <FormSection title={t("users.roleAndRights")}>
            <div className="rounded-md border border-border bg-surface px-[12px] py-[10px]">
              <Checkbox
                checked={draft.isCompanyAdmin}
                onChange={(e) => setDraft((d) => ({ ...d, isCompanyAdmin: e.target.checked, roleId: e.target.checked ? null : d.roleId }))}
                label={
                  <>
                    <span className="block text-[12.5px] font-semibold text-ink">{t("users.companyAdministratorRights")}</span>
                    <span className="block text-[11px] text-ink-faint">{t("users.fullRightsOverEveryBranch")}</span>
                  </>
                }
              />
            </div>
            {!draft.isCompanyAdmin ? (
              <EntityPicker
                label={t("users.role2")}
                value={roleOptions.find((o) => o.id === draft.roleId) ?? null}
                onChange={(o) => setDraft((d) => ({ ...d, roleId: o?.id ?? null }))}
                options={roleOptions}
                placeholder={t("users.chooseARole")}
              />
            ) : null}
            <EntityPicker
              label={t("users.linkedEmployeeOptional")}
              value={employeeOptions.find((o) => o.id === draft.employeeId) ?? null}
              onChange={(o) => setDraft((d) => ({ ...d, employeeId: o?.id ?? null }))}
              options={employeeOptions}
              placeholder={t("users.linkToAnEmployeeRecord")}
            />
          </FormSection>

          <FormSection title={t("users.branchesAndWarehouses")}>
            <CheckboxGroup
              label={t("users.branchesAvailable2")}
              options={branches}
              selected={draft.branchIds}
              onChange={(ids) => setDraft((d) => ({ ...d, branchIds: ids }))}
            />
            <CheckboxGroup
              label={t("users.warehousesAvailable")}
              options={warehouses}
              selected={draft.warehouseIds}
              onChange={(ids) => setDraft((d) => ({ ...d, warehouseIds: ids }))}
            />
          </FormSection>

          <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
            <Button variant="ghost" onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? t("users.saving") : t("users.saveTheUser")}
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
      <TextInput type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
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
            <Checkbox
              key={opt.id}
              checked={checked}
              onChange={() => onChange(checked ? selected.filter((id) => id !== opt.id) : [...selected, opt.id])}
              label={opt.name}
              className="items-center"
            />
          );
        })}
      </div>
    </div>
  );
}
