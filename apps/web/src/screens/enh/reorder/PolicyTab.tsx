import { useMemo, useState } from "react";
import { Button, Card, DecimalStringInput, EmptyState, EntityPicker, Select, TextInput, useFormat, type EntityPickerOption } from "@mezan/ui";
import type { ReorderPolicyDTO } from "@mezan/contracts";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useItems, useSuppliers, useWarehouses } from "../../../data/hooks";
import { useDeleteReorderPolicy, useReorderPolicies, useSaveReorderPolicy } from "./hooks";

const NO_SUPPLIER = "";
const DEFAULT_LEAD_DAYS = "7";

function trimQty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

interface Draft {
  readonly item: EntityPickerOption | null;
  readonly warehouseId: string;
  readonly min: string;
  readonly max: string;
  readonly leadDays: string;
  readonly pack: string;
  readonly supplierId: string;
}

const EMPTY_DRAFT: Draft = { item: null, warehouseId: "", min: "", max: "", leadDays: DEFAULT_LEAD_DAYS, pack: "", supplierId: NO_SUPPLIER };

function draftOf(policy: ReorderPolicyDTO): Draft {
  return {
    item: { id: policy.itemId, label: policy.itemNameAr, sublabel: policy.itemCode },
    warehouseId: policy.warehouseId,
    min: trimQty(policy.minQty),
    max: trimQty(policy.maxQty),
    leadDays: String(policy.leadDays),
    pack: Number(policy.packQty) > 1 ? trimQty(policy.packQty) : "",
    supplierId: policy.supplierId ?? NO_SUPPLIER,
  };
}

function PolicyForm({ initial, locked, onDone }: { initial: Draft; locked: boolean; onDone: () => void }) {
  const { t } = useAppTranslation();
  const save = useSaveReorderPolicy();
  const items = useItems();
  const warehouses = useWarehouses();
  const suppliers = useSuppliers();
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);

  const itemOptions = useMemo<EntityPickerOption[]>(
    () => (items.data ?? []).map((item) => ({ id: item.id, label: item.nameAr, sublabel: item.code })),
    [items.data],
  );
  const warehouseOptions = (warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }));
  const supplierOptions = [{ value: NO_SUPPLIER, label: t("reorder.policies.supplierDefault") }, ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.nameAr }))];

  function patch(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
  }

  function submit() {
    if (save.isPending) return;
    if (!draft.item || draft.warehouseId === "" || draft.min === "" || draft.max === "") {
      setError(t("reorder.policies.required"));
      return;
    }
    setError(null);
    save.mutate(
      {
        itemId: draft.item.id,
        warehouseId: draft.warehouseId,
        minQty: draft.min,
        maxQty: draft.max,
        leadDays: Number.parseInt(draft.leadDays, 10) || 0,
        packQty: draft.pack === "" ? null : draft.pack,
        supplierId: draft.supplierId === NO_SUPPLIER ? null : draft.supplierId,
      },
      { onSuccess: onDone, onError: (err) => setError(errorMessage(err, t("reorder.policies.saveFailed"))) },
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-[16px_18px]">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label={t("reorder.policies.item")}>
          <EntityPicker value={draft.item} onChange={(item) => patch({ item })} options={itemOptions} placeholder={t("reorder.policies.itemPlaceholder")} disabled={locked} ariaLabel={t("reorder.policies.item")} />
        </Field>
        <Field label={t("reorder.policies.warehouse")}>
          <Select value={draft.warehouseId} onChange={(warehouseId) => patch({ warehouseId })} options={warehouseOptions} disabled={locked} aria-label={t("reorder.policies.warehouse")} />
        </Field>
        <Field label={t("reorder.policies.min")}>
          <DecimalStringInput value={draft.min} onChange={(min) => patch({ min })} aria-label={t("reorder.policies.min")} />
        </Field>
        <Field label={t("reorder.policies.max")}>
          <DecimalStringInput value={draft.max} onChange={(max) => patch({ max })} aria-label={t("reorder.policies.max")} />
        </Field>
        <Field label={t("reorder.policies.leadDays")}>
          <TextInput inputMode="numeric" value={draft.leadDays} onChange={(event) => patch({ leadDays: event.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label={t("reorder.policies.pack")}>
          <DecimalStringInput value={draft.pack} onChange={(pack) => patch({ pack })} aria-label={t("reorder.policies.pack")} />
        </Field>
        <Field label={t("reorder.policies.supplier")}>
          <Select value={draft.supplierId} onChange={(supplierId) => patch({ supplierId })} options={supplierOptions} aria-label={t("reorder.policies.supplier")} />
        </Field>
      </div>
      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? t("reorder.policies.saving") : t("reorder.policies.save")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("reorder.policies.cancel")}
        </Button>
      </div>
    </Card>
  );
}

export function PolicyTab({ mayManage }: { mayManage: boolean }) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const query = useReorderPolicies();
  const remove = useDeleteReorderPolicy();
  const [editing, setEditing] = useState<{ draft: Draft; locked: boolean } | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function removePolicy(policy: ReorderPolicyDTO) {
    if (removingKey !== null) return;
    const key = `${policy.itemId}:${policy.warehouseId}`;
    setRemovingKey(key);
    setError(null);
    remove.mutate(
      { itemId: policy.itemId, warehouseId: policy.warehouseId },
      {
        onError: (err) => setError(errorMessage(err, t("reorder.policies.deleteFailed"))),
        onSettled: () => setRemovingKey(null),
      },
    );
  }

  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError || !query.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error?.message ?? t("reorder.policies.loadFailed")}
      </Card>
    );
  }
  const policies = query.data;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-ink-muted">{t("reorder.policies.hint")}</p>
      {mayManage && !editing ? (
        <div>
          <Button variant="primary" onClick={() => setEditing({ draft: EMPTY_DRAFT, locked: false })}>
            {t("reorder.policies.add")}
          </Button>
        </div>
      ) : null}
      {editing ? <PolicyForm initial={editing.draft} locked={editing.locked} onDone={() => setEditing(null)} /> : null}
      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {policies.length === 0 ? (
        <EmptyState title={t("reorder.policies.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">{t("reorder.policies.item")}</th>
                <th className="p-3 text-start">{t("reorder.policies.warehouse")}</th>
                <th className="p-3 text-start">{t("reorder.policies.min")}</th>
                <th className="p-3 text-start">{t("reorder.policies.max")}</th>
                <th className="p-3 text-start">{t("reorder.policies.leadDays")}</th>
                <th className="p-3 text-start">{t("reorder.policies.pack")}</th>
                <th className="p-3 text-start">{t("reorder.policies.supplier")}</th>
                <th className="p-3 text-start" />
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => {
                const key = `${policy.itemId}:${policy.warehouseId}`;
                return (
                  <tr key={key} className="border-b border-border">
                    <td className="p-3">
                      <div className="font-semibold text-ink">{policy.itemNameAr}</div>
                      <div className="text-[11.5px] text-ink-faint mz-num">{policy.itemCode}</div>
                    </td>
                    <td className="p-3">{policy.warehouseName}</td>
                    <td className="p-3 mz-num">{fmt.qty(Number(policy.minQty))}</td>
                    <td className="p-3 mz-num">{fmt.qty(Number(policy.maxQty))}</td>
                    <td className="p-3 mz-num">{policy.leadDays}</td>
                    <td className="p-3 mz-num">{fmt.qty(Number(policy.packQty))}</td>
                    <td className="p-3">{policy.supplierName ?? t("reorder.policies.supplierDefault")}</td>
                    <td className="p-3">
                      {mayManage ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ draft: draftOf(policy), locked: true })}>
                            {t("reorder.policies.edit")}
                          </Button>
                          <Button size="sm" variant="ghost" disabled={removingKey !== null} onClick={() => removePolicy(policy)}>
                            {t("reorder.policies.delete")}
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
