import { useMemo, useState } from "react";
import { Button, DocumentList, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import type { RoleDTO as Role } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useUrlParam } from "../lib/url-state";

export interface RolesPageProps {
  roles: Role[];
  usersByRoleId: Map<string, number>;
  onCreate: () => void;
  onEdit: (role: Role) => void;
  /** Opens the editor on a NEW role carrying this one's permissions. */
  onDuplicate: (role: Role) => void;
  onDelete: (roleId: string) => Promise<{ ok: boolean; error?: string }>;
}

type RoleKind = "system" | "custom";

const KIND_KEY: Record<RoleKind, AppTranslationKey> = { system: "roles.system", custom: "roles.custom" };
const KIND_TONE: Record<RoleKind, PillTone> = { system: "info", custom: "neutral" };

export function RolesPage({ roles, usersByRoleId, onCreate, onEdit, onDuplicate, onDelete }: RolesPageProps) {
  const { t } = useAppTranslation();
  const [kindFilter, setKindFilter] = useUrlParam("kind", "all") as [
    RoleKind | "all",
    (next: string) => void,
  ];
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
    if (!result.ok) setDeleteError(result.error ?? t("roles.couldNotDeleteTheRole"));
  }

  const columns: DocumentListColumn<Role>[] = [
    { key: "name", header: t("roles.roleName"), sortable: true, render: (row) => <span className="font-semibold text-ink">{row.name}</span> },
    { key: "code", header: t("common.code"), render: (row) => <code dir="ltr" className="mz-lat font-mono text-[11.5px] text-ink-faint">{row.code}</code> },
    { key: "count", header: t("roles.permissions"), align: "end", render: (row) => <span className="mz-num">{row.permissions.length}</span> },
    {
      key: "kind",
      header: t("common.status"),
      render: (row) => {
        const kind: RoleKind = row.isSystem ? "system" : "custom";
        return <StatusPill label={t(KIND_KEY[kind])} tone={KIND_TONE[kind]} />;
      },
    },
    { key: "createdAt", header: t("common.date"), render: (row) => row.createdAt.slice(0, 10).split("-").reverse().join("/") },
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
            {t("common.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(row);
            }}
          >
            {t("roles.duplicate")}
          </Button>
          {!row.isSystem ? (
            <Button
              size="sm"
              variant="danger-outline"
              disabled={(usersByRoleId.get(row.id) ?? 0) > 0}
              title={(usersByRoleId.get(row.id) ?? 0) > 0 ? t("roles.theRoleIsInUse") : undefined}
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(row);
              }}
            >
              {t("common.delete")}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: roles.length },
    { key: "system", label: t("roles.system"), count: roles.filter((r) => r.isSystem).length },
    { key: "custom", label: t("roles.custom"), count: roles.filter((r) => !r.isSystem).length },
  ];

  return (
    <DocumentList<Role>
      title={t("roles.rolesAndPermissions")}
      description={t("roles.manageTheCustomRolesAnd")}
      actions={<Button variant="primary" onClick={onCreate}>{t("roles.newRole")}</Button>}
      stats={[
        { label: t("roles.totalRoles"), value: <span className="mz-num">{roles.length}</span> },
        { label: t("roles.customRoles"), value: <span className="mz-num">{roles.filter((r) => !r.isSystem).length}</span> },
        { label: t("roles.systemRoles"), value: <span className="mz-num">{roles.filter((r) => r.isSystem).length}</span> },
        {
          label: t("roles.permissionsGrantedInTotal"),
          value: <span className="mz-num">{roles.reduce((n, r) => n + r.permissions.length, 0)}</span>,
        },
      ]}
      statusChips={statusChips}
      activeStatusKey={kindFilter}
      onStatusChange={(key) => setKindFilter(key as RoleKind | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("roles.searchByRoleNameOr")}
      columns={columns}
      rows={filtered}
      rowKey={(row) => row.id}
      onRowClick={onEdit}
      page={1}
      pageCount={1}
      pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{roles.length}</span> {t("roles.role")}</>}
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("roles.noMatchingRoles")}</div>}
      filterBarExtra={
        deleteError ? (
          <div className="rounded-md border border-danger bg-danger-soft px-[12px] py-[7px] text-[12px] text-danger-ink">{deleteError}</div>
        ) : undefined
      }
    />
  );
}
