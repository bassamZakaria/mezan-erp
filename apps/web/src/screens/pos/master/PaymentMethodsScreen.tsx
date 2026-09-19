import { useState } from "react";
import {
  Button,
  DocumentList,
  EmptyState,
  RowMenu,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { PosPaymentAccountTypeDTO, PosPaymentMethodDTO, PosPaymentMethodKindDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useTreasuryAccounts } from "../../../data/hooks";
import { FormError, SelectField, TextField, ToggleField } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useEntityName } from "../../../lib/entity-names";
import { EMPTY } from "../../../lib/empty";
import { useCreatePosPaymentMethod, useDeletePosPaymentMethod, usePosPaymentMethods, useUpdatePosPaymentMethod } from "./hooks";

type NewKind = Exclude<PosPaymentMethodKindDTO, "cash">;

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  kind: NewKind;
  accountType: PosPaymentAccountTypeDTO;
  defaultTreasuryAccountId: string;
  active: boolean;
}

const BLANK: Draft = { code: "", nameAr: "", nameEn: "", kind: "card", accountType: "bank", defaultTreasuryAccountId: "", active: true };

function holdsAccount(kind: PosPaymentMethodKindDTO): boolean {
  return kind !== "cash" && kind !== "on_account";
}

export function PaymentMethodsScreen() {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const { session } = useApi();
  const auth = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(auth, "pos.terminal.view");
  const mayEdit = can(auth, "pos.settings.edit");

  const query = usePosPaymentMethods();
  const accounts = useTreasuryAccounts().data ?? (EMPTY as TreasuryAccountDTO[]);
  const createMethod = useCreatePosPaymentMethod();
  const updateMethod = useUpdatePosPaymentMethod();
  const deleteMethod = useDeletePosPaymentMethod();
  const rows = query.data ?? (EMPTY as PosPaymentMethodDTO[]);

  const [panel, setPanel] = useState<{ mode: "new" } | { mode: "edit"; method: PosPaymentMethodDTO } | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const methodName = (m: PosPaymentMethodDTO) => nameOf({ name: m.nameAr, nameEn: m.nameEn });
  const accountLabel = (id: string | null) => {
    const account = accounts.find((a) => a.id === id);
    return account ? `${account.code} — ${nameOf(account)}` : (id ?? "");
  };

  function openNew() {
    setDraft(BLANK);
    setError(null);
    setPanel({ mode: "new" });
  }

  function openEdit(method: PosPaymentMethodDTO) {
    setDraft({
      code: method.code,
      nameAr: method.nameAr,
      nameEn: method.nameEn ?? "",
      kind: method.kind === "cash" ? "card" : method.kind,
      accountType: method.accountType ?? "bank",
      defaultTreasuryAccountId: method.defaultTreasuryAccountId ?? "",
      active: method.active,
    });
    setError(null);
    setPanel({ mode: "edit", method });
  }

  async function runRowAction(method: PosPaymentMethodDTO, run: () => Promise<unknown>) {
    if (pendingId !== null) return;
    setPendingId(method.id);
    setActionError(null);
    try {
      await run();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("pos.common.saveFailed"));
    } finally {
      setPendingId(null);
    }
  }

  async function submit() {
    if (!panel) return;
    setError(null);
    setSaving(true);
    const editingKind = panel.mode === "edit" ? panel.method.kind : draft.kind;
    const withAccount = holdsAccount(editingKind);
    try {
      if (panel.mode === "new") {
        await createMethod.mutateAsync({
          code: draft.code.trim().toUpperCase(),
          nameAr: draft.nameAr.trim(),
          nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
          kind: draft.kind,
          accountType: withAccount ? draft.accountType : null,
          defaultTreasuryAccountId: withAccount && draft.defaultTreasuryAccountId !== "" ? draft.defaultTreasuryAccountId : null,
          active: draft.active,
        });
      } else {
        await updateMethod.mutateAsync({
          id: panel.method.id,
          body: {
            nameAr: draft.nameAr.trim(),
            nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
            ...(withAccount
              ? { accountType: draft.accountType, defaultTreasuryAccountId: draft.defaultTreasuryAccountId === "" ? null : draft.defaultTreasuryAccountId }
              : {}),
            active: draft.active,
          },
        });
      }
      setPanel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pos.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!mayView) return <EmptyState title={t("pos.common.noAccessTitle")} description={t("pos.common.noAccessBody")} />;

  const columns: DocumentListColumn<PosPaymentMethodDTO>[] = [
    {
      key: "name",
      header: t("pos.methods.col.name"),
      render: (m) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[6px] font-semibold text-ink">
            {methodName(m)}
            {m.builtIn ? <StatusPill label={t("pos.common.builtIn")} tone="info" /> : null}
          </div>
          <div className="mz-num text-[11.5px] text-ink-muted">{m.code}</div>
        </div>
      ),
    },
    { key: "kind", header: t("pos.methods.col.kind"), render: (m) => t(`pos.common.kind.${m.kind}` as AppTranslationKey) },
    {
      key: "accountType",
      header: t("pos.methods.col.accountType"),
      render: (m) => (m.accountType ? t(`pos.common.accountType.${m.accountType}` as AppTranslationKey) : t("pos.common.none")),
    },
    {
      key: "defaultAccount",
      header: t("pos.methods.col.defaultAccount"),
      render: (m) =>
        m.kind === "cash"
          ? t("pos.methods.drawer")
          : m.kind === "on_account"
            ? t("pos.methods.customerAccount")
            : m.defaultTreasuryAccountId
              ? accountLabel(m.defaultTreasuryAccountId)
              : t("pos.methods.perTerminal"),
    },
    {
      key: "usedBy",
      header: t("pos.methods.col.usedBy"),
      render: (m) => (m.usedBy.length === 0 ? t("pos.common.none") : <span className="mz-num">{m.usedBy.join("، ")}</span>),
    },
    {
      key: "status",
      header: t("pos.methods.col.status"),
      render: (m) => <StatusPill label={m.active ? t("pos.common.active") : t("pos.common.inactive")} tone={m.active ? "success" : "neutral"} />,
    },
  ];

  const panelKind = panel?.mode === "edit" ? panel.method.kind : draft.kind;
  const eligibleAccounts = accounts.filter((a) => a.status === "active" && a.type === draft.accountType);

  return (
    <>
      <FormError message={actionError} />
      <DocumentList<PosPaymentMethodDTO>
        title={t("pos.methods.title")}
        description={t("pos.methods.description")}
        actions={
          mayEdit ? (
            <Button variant="primary" onClick={openNew}>
              {t("pos.methods.add")}
            </Button>
          ) : undefined
        }
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        onRowClick={mayEdit ? openEdit : undefined}
        rowAction={(m) => {
          const items: RowMenuItem[] = [];
          if (mayEdit) {
            items.push({ key: "edit", label: t("common.edit"), onSelect: () => openEdit(m) });
            if (m.kind !== "cash") {
              items.push({
                key: "toggle",
                label: m.active ? t("pos.common.disable") : t("pos.common.enable"),
                disabled: pendingId === m.id,
                onSelect: () => runRowAction(m, () => updateMethod.mutateAsync({ id: m.id, body: { active: !m.active } })),
              });
            }
            items.push({
              key: "delete",
              label: m.builtIn ? t("pos.methods.builtInNoDelete") : t("common.delete"),
              tone: "danger",
              disabled: m.builtIn || m.usedBy.length > 0 || pendingId === m.id,
              confirm: { consequence: t("pos.methods.deleteConsequence"), confirmLabel: t("common.delete") },
              onSelect: () => runRowAction(m, () => deleteMethod.mutateAsync({ id: m.id })),
            });
          }
          return items.length > 0 ? <RowMenu items={items} label={t("common.rowActionsFor", { name: m.code })} /> : null;
        }}
        loading={query.isLoading}
        loadFailed={query.isError}
        page={1}
        pageCount={1}
        emptyState={<EmptyState title={t("pos.methods.empty")} />}
      />

      <SidePanel
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel?.mode === "edit" ? t("pos.methods.panel.edit", { name: methodName(panel.method) }) : t("pos.methods.panel.new")}
        description={t("pos.methods.panel.description")}
      >
        <div className="flex flex-col gap-[14px]">
          <FormError message={error} />
          <TextField label={t("pos.methods.field.nameAr")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("pos.methods.field.nameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <TextField
            label={t("pos.methods.field.code")}
            value={draft.code}
            placeholder="NETWORK"
            disabled={panel?.mode === "edit"}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.toUpperCase() }))}
          />
          {panel?.mode === "edit" && panel.method.kind === "cash" ? (
            <p className="text-[12px] text-ink-muted">{t("pos.methods.cashLocked")}</p>
          ) : (
            <SelectField
              label={t("pos.methods.field.kind")}
              hint={t("pos.methods.field.kindHint")}
              value={panelKind}
              disabled={panel?.mode === "edit"}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v as NewKind, defaultTreasuryAccountId: "" }))}
              options={(["card", "wallet", "transfer", "on_account"] as const).map((k) => ({ value: k, label: t(`pos.common.kind.${k}` as AppTranslationKey) }))}
            />
          )}
          {holdsAccount(panelKind) ? (
            <>
              <SelectField
                label={t("pos.methods.field.accountType")}
                value={draft.accountType}
                onChange={(v) => setDraft((d) => ({ ...d, accountType: v as PosPaymentAccountTypeDTO, defaultTreasuryAccountId: "" }))}
                options={[
                  { value: "bank", label: t("pos.common.accountType.bank") },
                  { value: "cash", label: t("pos.common.accountType.cash") },
                ]}
              />
              <SelectField
                label={t("pos.methods.field.defaultAccount")}
                value={draft.defaultTreasuryAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, defaultTreasuryAccountId: v }))}
                options={[
                  { value: "", label: t("pos.methods.field.noDefault") },
                  ...eligibleAccounts.map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` })),
                ]}
              />
            </>
          ) : null}
          {panel?.mode === "edit" && panel.method.kind === "cash" ? null : (
            <ToggleField label={t("pos.methods.field.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          )}
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanel(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={saving}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}
