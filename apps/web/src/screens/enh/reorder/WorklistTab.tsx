import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../../lib/count-phrase";
import { useMemo, useState } from "react";
import { Button, Card, Checkbox, DecimalStringInput, EmptyState, Money, Select, StatCard, StatusPill, useFormat } from "@mezan/ui";
import {
  ReorderTriggerDTO,
  type ReorderProblemDTO,
  type CreateReorderOrdersResultDTO,
  type ReorderRowDTO,
  type SupplierDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { errorMessage } from "../../../lib/error-message";
import { useSuppliers, useWarehouses } from "../../../data/hooks";
import { OrdersResult } from "./OrdersResult";
import { useCreateReorderOrders, useReorderWorklist } from "./hooks";

const WINDOW_OPTIONS: readonly number[] = [7, 30, 90, 180];
const DEFAULT_WINDOW = 30;
const ALL_WAREHOUSES = "";

export interface WorklistTabProps {
  readonly mayCreate: boolean;
}

function trimQty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function reasonTone(row: ReorderRowDTO): "danger" | "warning" {
  return row.trigger === ReorderTriggerDTO.BelowMinimum ? "danger" : "warning";
}

export function WorklistTab({ mayCreate }: WorklistTabProps) {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const fmt = useFormat();
  const { openScreenAt } = useNavigation();
  const [warehouseId, setWarehouseId] = useState(ALL_WAREHOUSES);
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW);
  const query = useReorderWorklist(warehouseId, windowDays);
  const warehouses = useWarehouses();
  const suppliers = useSuppliers();
  const create = useCreateReorderOrders();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [qtyDraft, setQtyDraft] = useState<Readonly<Record<string, string>>>({});
  const [supplierDraft, setSupplierDraft] = useState<Readonly<Record<string, string>>>({});
  const [result, setResult] = useState<CreateReorderOrdersResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = query.data?.rows ?? [];
  const supplierOptions = useMemo(
    () => (suppliers.data ?? []).map((supplier: SupplierDTO) => ({ value: supplier.id, label: supplier.nameAr })),
    [suppliers.data],
  );
  const warehouseOptions = useMemo(
    () => [{ value: ALL_WAREHOUSES, label: t("reorder.worklist.allWarehouses") }, ...(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))],
    [warehouses.data, t],
  );
  const windowOptions = WINDOW_OPTIONS.map((days) => ({ value: String(days), label: t("reorder.worklist.windowDays", { days: countPhrase(days, CountedNoun.Day, ArabicCase.Oblique) }) }));

  const qtyOf = (row: ReorderRowDTO) => qtyDraft[row.key] ?? trimQty(row.suggestedQty);
  const supplierOf = (row: ReorderRowDTO) => supplierDraft[row.key] ?? row.supplierId ?? "";
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.key));

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.key)));
  }

  function submit() {
    if (create.isPending) return;
    const chosen = rows.filter((row) => selected.has(row.key));
    if (chosen.length === 0) return;
    setError(null);
    setResult(null);
    create.mutate(
      {
        windowDays,
        lines: chosen.map((row) => ({
          itemId: row.itemId,
          warehouseId: row.warehouseId,
          qty: qtyOf(row) === "" ? "0" : qtyOf(row),
          supplierId: supplierOf(row) === "" ? null : supplierOf(row),
        })),
      },
      {
        onSuccess: (outcome) => {
          setResult(outcome);
          setSelected(new Set());
          setQtyDraft({});
        },
        onError: (err) => setError(errorMessage(err, t("reorder.worklist.createFailed"))),
      },
    );
  }

  if (query.isLoading) return <Card className="p-[18px_20px] text-[13px] text-ink-muted">{t("common.loading")}</Card>;
  if (query.isError || !query.data) {
    return (
      <Card className="p-[18px_20px] text-[13px] text-danger-ink" role="alert">
        {query.error?.message ?? t("reorder.worklist.loadFailed")}
      </Card>
    );
  }
  const worklist = query.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label={t("reorder.worklist.count")}
          value={<span className="mz-num">{rows.length}</span>}
          sub={t("reorder.worklist.asOf", { date: fmt.date(worklist.asOfDate) })}
          valueTone={rows.length > 0 ? "danger" : "default"}
        />
        <StatCard label={t("reorder.worklist.needsSupplier")} value={<span className="mz-num">{worklist.needsSupplierCount}</span>} valueTone={worklist.needsSupplierCount > 0 ? "danger" : "default"} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[220px]">
          <Select value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} aria-label={t("reorder.worklist.warehouse")} />
        </div>
        <div className="w-[180px]">
          <Select value={String(windowDays)} onChange={(value) => setWindowDays(Number(value))} options={windowOptions} aria-label={t("reorder.worklist.window")} />
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <span className="text-[12.5px] text-ink-muted">{t("reorder.worklist.selected", { count: selected.size })}</span>
          <Button variant="primary" disabled={!mayCreate || selected.size === 0 || create.isPending} onClick={submit}>
            {create.isPending ? t("reorder.worklist.creating") : t("reorder.worklist.createOrders")}
          </Button>
        </div>
      </div>
      {!mayCreate ? <div className="text-[12px] text-ink-faint">{t("reorder.worklist.createDenied")}</div> : null}
      {error ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-3 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {result ? <OrdersResult result={result} onOpenOrders={() => openScreenAt("purchase-orders", [])} onDismiss={() => setResult(null)} /> : null}

      {rows.length === 0 ? (
        <EmptyState title={t("reorder.worklist.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
                <th className="p-3 text-start">
                  <Checkbox checked={allSelected} onChange={toggleAll} aria-label={t("reorder.worklist.selectAll")} />
                </th>
                <th className="p-3 text-start">{t("reorder.worklist.col.item")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.warehouse")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.onHand")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.reserved")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.onOrder")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.position")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.min")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.cover")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.reason")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.qty")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.supplier")}</th>
                <th className="p-3 text-start">{t("reorder.worklist.col.price")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.itemNameAr;
                return (
                  <tr key={row.key} className="border-b border-border align-top">
                    <td className="p-3">
                      <Checkbox checked={selected.has(row.key)} onChange={() => toggle(row.key)} aria-label={t("reorder.worklist.selectRow", { name, warehouse: row.warehouseName })} />
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-ink">{name}</div>
                      <div className="text-[11.5px] text-ink-faint mz-num">{row.itemCode}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <StatusPill tone="neutral" label={t(`reorder.worklist.rule.${row.source}` as AppTranslationKey)} />
                        {row.problems.map((problem: ReorderProblemDTO) => (
                          <StatusPill key={problem} tone="warning" label={t(`reorder.worklist.problem.${problem}` as AppTranslationKey)} />
                        ))}
                      </div>
                    </td>
                    <td className="p-3">{row.warehouseName}</td>
                    <td className="p-3 mz-num">{fmt.qty(Number(row.onHand))}</td>
                    <td className="p-3 mz-num">{fmt.qty(Number(row.reserved))}</td>
                    <td className="p-3">
                      <span className="mz-num">{fmt.qty(Number(row.onOrder) + Number(row.onOrderDraft))}</span>
                      {Number(row.onOrderDraft) > 0 ? <div className="text-[11px] text-ink-faint">{t("reorder.worklist.draftOfOrder", { qty: fmt.qty(Number(row.onOrderDraft)) })}</div> : null}
                    </td>
                    <td className="p-3 mz-num">{fmt.qty(Number(row.position))}</td>
                    <td className="p-3">
                      <span className="mz-num">{fmt.qty(Number(row.minQty))}</span>
                      {row.maxQty ? <div className="text-[11px] text-ink-faint mz-num">{t("reorder.worklist.col.max")} {fmt.qty(Number(row.maxQty))}</div> : null}
                      {row.leadDays > 0 ? <div className="text-[11px] text-ink-faint">{t("reorder.worklist.leadDays", { days: countPhrase(row.leadDays, CountedNoun.Day) })}</div> : null}
                    </td>
                    <td className="p-3">
                      <span className="mz-num">{row.daysOfCover === null ? t("reorder.worklist.coverNone") : t("reorder.worklist.coverDays", { days: countPhrase(row.daysOfCover, CountedNoun.Day) })}</span>
                      {Number(row.dailyVelocity) > 0 ? <div className="text-[11px] text-ink-faint">{t("reorder.worklist.perDay", { qty: fmt.qty(Number(row.dailyVelocity)) })}</div> : null}
                    </td>
                    <td className="p-3">
                      <StatusPill tone={reasonTone(row)} label={t(`reorder.worklist.trigger.${row.trigger}` as AppTranslationKey)} />
                    </td>
                    <td className="p-3">
                      <div className="w-[120px]">
                        <DecimalStringInput value={qtyOf(row)} onChange={(value) => setQtyDraft((current) => ({ ...current, [row.key]: value }))} aria-label={t("reorder.worklist.qtyLabel", { name })} />
                      </div>
                      {Number(row.packQty) > 1 ? <div className="mt-1 text-[11px] text-ink-faint">{t("reorder.worklist.pack", { qty: fmt.qty(Number(row.packQty)) })}</div> : null}
                    </td>
                    <td className="p-3">
                      <div className="w-[170px]">
                        <Select
                          value={supplierOf(row)}
                          onChange={(value) => setSupplierDraft((current) => ({ ...current, [row.key]: value }))}
                          options={supplierOptions}
                          placeholder={t("reorder.worklist.pickSupplier")}
                          aria-label={t("reorder.worklist.supplierLabel", { name })}
                        />
                      </div>
                    </td>
                    <td className="p-3">{row.unitPrice === null ? <span className="text-ink-faint">{t("reorder.worklist.noPrice")}</span> : <Money value={row.unitPrice} />}</td>
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
