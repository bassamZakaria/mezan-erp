import { useMemo, useState } from "react";
import { FulcrumRule, Button, Card, PermissionMatrix, type PermissionMatrixItem, type PermissionMatrixModule } from "@mezan/ui";
import {
  getPermission,
  isPlatformAdminOnly,
  isSensitive,
  licensedModules,
  licensedPermissions,
  toggleAll,
  togglePermission,
  type Entitlements,
} from "@mezan/domain";
import type { RoleDTO as Role } from "@mezan/contracts";
import { entitySegment, permissionLabel, subgroupLabel } from "../permission-labels";
import { moduleLabel } from "../domain-labels";
import type { StoreResult } from "./UsersPage";
import { useAppTranslation } from "../i18n";

export interface RoleEditorPageProps {
  role: Role | null;
  entitlements: Entitlements;
  onSave: (cmd: { code: string; name: string; description: string; permissions: string[] }) => Promise<StoreResult<Role>>;
  onCancel: () => void;
}

export function RoleEditorPage({ role, entitlements, onSave, onCancel }: RoleEditorPageProps) {
  const { t } = useAppTranslation();
  const [name, setName] = useState(role?.name ?? "");
  const [code, setCode] = useState(role?.code ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(role?.permissions ?? []));
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const matrixModules: PermissionMatrixModule[] = useMemo(() => {
    const mods = licensedModules(entitlements);
    const perms = licensedPermissions(entitlements);

    return mods
      .map((mod) => {
        const modPerms = perms.filter((p) => p.module === mod.id);
        const subgroupOrder: string[] = [];
        const subgroupItems = new Map<string, PermissionMatrixItem[]>();
        const subgroupLabels = new Map<string, string>();

        for (const p of modPerms) {
          const key = entitySegment(p.code);
          const item: PermissionMatrixItem = {
            code: p.code,
            label: permissionLabel(p, t),
            sensitive: p.sensitive,
            platformAdminOnly: p.platformAdminOnly,
            dependsOn: p.deps.length > 0 ? [...p.deps] : undefined,
            selected: selected.has(p.code),
            disabled: p.platformAdminOnly,
            disabledReason: p.platformAdminOnly ? t("roles.editor.adminOnly") : undefined,
          };
          if (!subgroupItems.has(key)) {
            subgroupItems.set(key, []);
            subgroupLabels.set(key, subgroupLabel(p));
            subgroupOrder.push(key);
          }
          subgroupItems.get(key)?.push(item);
        }

        return {
          key: mod.id,
          label: moduleLabel(mod, t),
          subgroups: subgroupOrder.map((key) => ({
            key,
            label: subgroupLabels.get(key) ?? key,
            items: subgroupItems.get(key) ?? [],
          })),
        };
      })
      .filter((mod) => mod.subgroups.length > 0);
  }, [entitlements, selected, t]);

  const summary = useMemo(() => {
    const touchedModules = new Set<string>();
    let sensitiveCount = 0;
    const perModule = new Map<string, number>();
    for (const code of selected) {
      const def = getPermission(code);
      if (!def) continue;
      touchedModules.add(def.module);
      perModule.set(def.module, (perModule.get(def.module) ?? 0) + 1);
      if (isSensitive(code)) sensitiveCount += 1;
    }
    return { selectedCount: selected.size, moduleCount: touchedModules.size, sensitiveCount, perModule };
  }, [selected]);

  function handleToggle(permissionCode: string) {
    setSelected((prev) => togglePermission(prev, permissionCode));
  }

  function handleToggleModule(_moduleKey: string, codes: string[], select: boolean) {
    const selectableCodes = codes.filter((c) => !isPlatformAdminOnly(c));
    setSelected((prev) => toggleAll(prev, selectableCodes, select));
  }

  async function handleSave() {
    setFormError(null);
    if (!name.trim() || !code.trim()) {
      setFormError(t("roles.editor.nameAndCodeRequired"));
      return;
    }
    setSaving(true);
    const result = await onSave({ code: code.trim(), name: name.trim(), description, permissions: Array.from(selected) });
    setSaving(false);
    if (!result.ok) setFormError(result.error ?? t("roles.editor.saveFailed"));
  }

  const moduleLabelById = new Map(licensedModules(entitlements).map((m) => [m.id, moduleLabel(m, t)]));

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-start justify-between gap-[14px]">
        <div>
          <div className="mz-eyebrow">Settings · Roles</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{role ? t("roles.editor.title.edit") : t("roles.editor.title.new")}</h1>
        </div>
        <div className="flex gap-[9px]">
          <Button variant="ghost" onClick={onCancel}>{t("roles.editor.cancel")}</Button>
          <Button variant="primary" disabled={saving || role?.isSystem} onClick={() => void handleSave()}>
            {saving ? t("roles.editor.saving") : t("roles.editor.save")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {formError ? (
        <div className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[9px] text-[12.5px] text-danger-ink">
          {formError}
        </div>
      ) : null}

      <Card className="mb-[18px] p-[15px] flex flex-col gap-[12px] sm:flex-row sm:items-start">
        <label className="flex-1">
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("roles.editor.field.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={role?.isSystem}
            className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60"
          />
        </label>
        <label className="flex-1">
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("roles.editor.field.code")}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={role !== null}
            placeholder="VAN_SALES"
            className="mz-lat w-full rounded-md border border-border bg-surface px-[11px] py-[9px] font-mono text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60"
          />
        </label>
        <label className="flex-[2]">
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("roles.editor.field.description")}</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={role?.isSystem}
            className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand disabled:opacity-60"
          />
        </label>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <PermissionMatrix
          modules={matrixModules}
          onToggle={handleToggle}
          onToggleModule={handleToggleModule}
          searchValue={search}
          onSearchChange={setSearch}
        />

        <div className="flex flex-col gap-[14px]">
          <Card className="p-[15px]">
            <div className="grid grid-cols-3 gap-[10px] text-center">
              <SummaryStat label={t("roles.editor.stat.selected")} value={summary.selectedCount} />
              <SummaryStat label={t("roles.editor.stat.modules")} value={summary.moduleCount} />
              <SummaryStat label={t("roles.editor.stat.sensitive")} value={summary.sensitiveCount} tone={summary.sensitiveCount > 0 ? "warning" : undefined} />
            </div>
          </Card>
          {summary.perModule.size > 0 ? (
            <Card className="p-[15px]">
              <h3 className="mb-[10px] text-[11px] font-bold uppercase tracking-[0.4px] text-ink-faint">{t("roles.editor.moduleHeading")}</h3>
              <ul className="flex flex-col gap-[7px]">
                {Array.from(summary.perModule.entries()).map(([moduleId, count]) => (
                  <li key={moduleId} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-ink">{moduleLabelById.get(moduleId) ?? moduleId}</span>
                    <span className="mz-num font-semibold text-ink-muted">{count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return (
    <div>
      <div className={"mz-num text-[19px] font-bold " + (tone === "warning" ? "text-warning-ink" : "text-ink")}>{value}</div>
      <div className="mt-[2px] text-[10.5px] text-ink-faint">{label}</div>
    </div>
  );
}
