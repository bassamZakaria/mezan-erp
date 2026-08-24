import { useMemo, useState } from "react";
import {
  DocumentList,
  Button,
  Card,
  StatusPill,
  SidePanel,
  PermissionMatrix,
  formatDate,
  type DocumentListColumn,
  type PillTone,
  type PermissionMatrixModule,
  type PermissionMatrixItem,
} from "@mezan/ui";
import { MODULES, PERMISSIONS, isPlatformAdminOnly, togglePermission, toggleAll } from "@mezan/domain";
import type { ApiKeyDTO, CreateApiKeyResultDTO } from "@mezan/contracts";
import { entitySegment, permissionLabel, subgroupLabel } from "../permission-labels";
import { moduleLabel } from "../domain-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from "../data/account-hooks";
import { TextField } from "./form-controls";

/**
 * مفاتيح API (`/settings/api-keys`). Security invariants enforced by the
 * server (`api-keys-routes.ts` / `api-keys/create-api-key.ts`) — only a hash
 * of the key is ever stored, and the plaintext key is returned exactly once
 * (the create response); this screen is what shows it that one time and
 * never again, and shows the `prefix` everywhere else so a key stays
 * identifiable without exposing it.
 */

type Translate = (key: AppTranslationKey, params?: Record<string, string | number>) => string;

function keyStatus(key: ApiKeyDTO, t: Translate): { label: string; tone: PillTone } {
  if (key.revokedAt) return { label: t("apiKeys.status.revoked"), tone: "neutral" as PillTone };
  return { label: t("apiKeys.status.active"), tone: "success" as PillTone };
}

function buildScopeModules(selected: ReadonlySet<string>, t: Translate): PermissionMatrixModule[] {
  return MODULES.map((mod) => {
    const modPerms = PERMISSIONS.filter((p) => p.module === mod.id);
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
      subgroups: subgroupOrder.map((key) => ({ key, label: subgroupLabels.get(key) ?? key, items: subgroupItems.get(key) ?? [] })),
    };
  }).filter((mod) => mod.subgroups.length > 0);
}

function CreatedKeyBanner({ result, onDismiss }: { result: CreateApiKeyResultDTO; onDismiss: () => void }) {
  const { t } = useAppTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="mb-[18px] border-warning bg-warning-soft p-[18px_20px]">
      <p className="text-[13px] font-bold text-warning-ink">{t("apiKeys.created.notice", { name: result.name })}</p>
      <div className="mt-[10px] flex flex-wrap items-center gap-[10px]">
        <code className="mz-lat rounded-md border border-border bg-surface px-[12px] py-[8px] text-[13px] text-ink">{result.key}</code>
        <Button size="sm" onClick={() => void copy()}>{copied ? t("apiKeys.copied") : t("apiKeys.copy")}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>{t("apiKeys.dismiss")}</Button>
      </div>
    </Card>
  );
}

export function ApiKeysPage() {
  const { t } = useAppTranslation();
  const query = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const keys = query.data ?? [];

  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<CreateApiKeyResultDTO | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const matrixModules = useMemo(() => buildScopeModules(selected, t), [selected, t]);

  function handleToggle(code: string) {
    setSelected((prev) => togglePermission(prev, code));
  }

  function handleToggleModule(_moduleKey: string, codes: string[], select: boolean) {
    const selectableCodes = codes.filter((c) => !isPlatformAdminOnly(c));
    setSelected((prev) => toggleAll(prev, selectableCodes, select));
  }

  async function submitNewKey() {
    setFormError(null);
    if (name.trim() === "") {
      setFormError(t("apiKeys.error.nameRequired"));
      return;
    }
    if (selected.size === 0) {
      setFormError(t("apiKeys.error.scopeRequired"));
      return;
    }
    try {
      const result = await createKey.mutateAsync({ name: name.trim(), scopes: Array.from(selected) });
      setPanelOpen(false);
      setName("");
      setSelected(new Set());
      setCreatedKey(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("apiKeys.error.createFailed"));
    }
  }

  async function handleRevoke(id: string) {
    if (revokingId !== null) return;
    setRevokingId(id);
    try {
      await revokeKey.mutateAsync(id);
    } finally {
      setRevokingId(null);
    }
  }

  const columns: DocumentListColumn<ApiKeyDTO>[] = [
    { key: "name", header: t("apiKeys.col.name"), render: (k) => <span className="font-semibold text-ink">{k.name}</span> },
    { key: "prefix", header: t("apiKeys.col.prefix"), render: (k) => <code className="mz-lat text-[12px] text-ink-muted">{k.prefix}…</code> },
    { key: "scopes", header: t("apiKeys.col.scopes"), render: (k) => <span className="mz-num">{k.scopes.length}</span> },
    { key: "createdAt", header: t("apiKeys.col.createdAt"), render: (k) => formatDate(k.createdAt, { style: "long" }) },
    { key: "lastUsedAt", header: t("apiKeys.col.lastUsedAt"), render: (k) => (k.lastUsedAt ? formatDate(k.lastUsedAt, { style: "long" }) : t("apiKeys.neverUsed")) },
    {
      key: "status",
      header: t("apiKeys.col.status"),
      render: (k) => {
        const s = keyStatus(k, t);
        return <StatusPill label={s.label} tone={s.tone} />;
      },
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (k) =>
        k.revokedAt ? null : (
          <Button size="sm" variant="ghost" onClick={() => void handleRevoke(k.id)} disabled={revokingId === k.id}>
            {revokingId === k.id ? t("apiKeys.revoking") : t("apiKeys.revoke")}
          </Button>
        ),
    },
  ];

  const filtered = search.trim() === "" ? keys : keys.filter((k) => k.name.includes(search) || k.prefix.includes(search));

  return (
    <>
      {createdKey ? <CreatedKeyBanner result={createdKey} onDismiss={() => setCreatedKey(null)} /> : null}

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("apiKeys.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>{t("apiKeys.retry")}</Button>
        </Card>
      ) : null}

      <DocumentList<ApiKeyDTO>
        eyebrow="Settings · API keys"
        title={t("apiKeys.title")}
        description={t("apiKeys.description")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("apiKeys.new")}
          </Button>
        }
        stats={[
          { label: t("apiKeys.stat.total"), value: <span className="mz-num">{keys.length}</span> },
          { label: t("apiKeys.stat.active"), value: <span className="mz-num">{keys.filter((k) => !k.revokedAt).length}</span> },
          { label: t("apiKeys.stat.revoked"), value: <span className="mz-num">{keys.filter((k) => k.revokedAt).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("apiKeys.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(k) => k.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("apiKeys.showingPrefix")} <span className="mz-num">{filtered.length}</span> {t("apiKeys.showingOf")} <span className="mz-num">{keys.length}</span> {t("apiKeys.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("apiKeys.empty")}</div>}
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={t("apiKeys.panel.title")}
        description={t("apiKeys.panel.description")}
        className="w-[720px]"
      >
        <div className="flex flex-col gap-[14px]">
          {formError ? <StatusPill label={formError} tone="danger" /> : null}
          <TextField label={t("apiKeys.field.name")} value={name} onChange={setName} placeholder={t("apiKeys.field.namePlaceholder")} />
          <PermissionMatrix modules={matrixModules} onToggle={handleToggle} onToggleModule={handleToggleModule} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>{t("apiKeys.cancel")}</Button>
            <Button variant="primary" disabled={createKey.isPending} onClick={() => void submitNewKey()}>
              {createKey.isPending ? t("apiKeys.creating") : t("apiKeys.create")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
