import { useMemo, useState } from "react";
import { Button, DocumentList, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { Role } from "@mezan/domain";

export interface RolesPageProps {
  roles: Role[];
  usersByRoleId: Map<string, number>;
  onCreate: () => void;
  onEdit: (role: Role) => void;
  onDelete: (roleId: string) => Promise<{ ok: boolean; error?: string }>;
}

type RoleKind = "system" | "custom";

const KIND_LABEL: Record<RoleKind, string> = { system: "نظام", custom: "مخصص" };
const KIND_TONE: Record<RoleKind, PillTone> = { system: "info", custom: "neutral" };

export function RolesPage({ roles, usersByRoleId, onCreate, onEdit, onDelete }: RolesPageProps) {
  const [kindFilter, setKindFilter] = useState<RoleKind | "all">("all");
  const [search, setSearch] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = roles;
    if (kindFilter !== "all") rows = rows.filter((r) => (r.isSystem ? "system" : "custom") === kindFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    }
    return rows;
  }, [roles, kindFilter, search]);

  async function handleDelete(role: Role) {
    setDeleteError(null);
    const result = await onDelete(role.id);
    if (!result.ok) setDeleteError(result.error ?? "تعذر حذف الدور");
  }

  const columns: DocumentListColumn<Role>[] = [
    { key: "name", header: "اسم الدور", sortable: true, render: (row) => <span className="font-semibold text-ink">{row.name}</span> },
    { key: "code", header: "الكود", render: (row) => <span className="mz-lat font-mono text-[11.5px] text-ink-faint">{row.code}</span> },
    { key: "count", header: "عدد الصلاحيات", align: "end", render: (row) => <span className="mz-num">{row.permissions.length}</span> },
    {
      key: "kind",
      header: "الحالة",
      render: (row) => {
        const kind: RoleKind = row.isSystem ? "system" : "custom";
        return <StatusPill label={KIND_LABEL[kind]} tone={KIND_TONE[kind]} />;
      },
    },
    { key: "createdAt", header: "التاريخ", render: (row) => row.createdAt.slice(0, 10).split("-").reverse().join("/") },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (row) => (
        <div className="flex justify-end gap-[6px]">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(row);
            }}
          >
            تعديل
          </Button>
          {!row.isSystem ? (
            <Button
              size="sm"
              variant="danger-outline"
              disabled={(usersByRoleId.get(row.id) ?? 0) > 0}
              title={(usersByRoleId.get(row.id) ?? 0) > 0 ? "الدور مستخدم من قبل مستخدمين" : undefined}
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(row);
              }}
            >
              حذف
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: roles.length },
    { key: "system", label: "نظام", count: roles.filter((r) => r.isSystem).length },
    { key: "custom", label: "مخصص", count: roles.filter((r) => !r.isSystem).length },
  ];

  return (
    <DocumentList<Role>
      eyebrow="Settings · Roles"
      title="الأدوار والصلاحيات"
      description="إدارة الأدوار المخصصة وصلاحياتها عبر جميع وحدات النظام المرخّصة."
      actions={<Button variant="primary" onClick={onCreate}>دور جديد</Button>}
      stats={[
        { label: "إجمالي الأدوار", value: <span className="mz-num">{roles.length}</span> },
        { label: "أدوار مخصصة", value: <span className="mz-num">{roles.filter((r) => !r.isSystem).length}</span> },
        { label: "أدوار النظام", value: <span className="mz-num">{roles.filter((r) => r.isSystem).length}</span> },
        {
          label: "إجمالي الصلاحيات الممنوحة",
          value: <span className="mz-num">{roles.reduce((n, r) => n + r.permissions.length, 0)}</span>,
        },
      ]}
      statusChips={statusChips}
      activeStatusKey={kindFilter}
      onStatusChange={(key) => setKindFilter(key as RoleKind | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="بحث باسم الدور أو الكود…"
      columns={columns}
      rows={filtered}
      rowKey={(row) => row.id}
      onRowClick={onEdit}
      page={1}
      pageCount={1}
      pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{roles.length}</span> دور</>}
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أدوار مطابقة</div>}
      filterBarExtra={
        deleteError ? (
          <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{deleteError}</div>
        ) : undefined
      }
    />
  );
}
