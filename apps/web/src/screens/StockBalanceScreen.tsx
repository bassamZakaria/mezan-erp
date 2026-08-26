import { useMemo, useState } from "react";
import { DocumentList, Money as MoneyDisplay, Card, Button, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { StockBalanceRowDTO } from "@mezan/contracts";
import { useItems, useStockBalance, useWarehouses } from "../data/hooks";
import { SelectField, NumberField } from "../settings/form-controls";
import { useAppTranslation } from "../i18n";
import { majorOf } from "../lib/money";

/**
 * أرصدة المخزون (Stock Balance) — docs/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, on the real `GET /inventory/stock-balance` route
 * (packages/api/src/inventory-routes.ts), which runs the SAME
 * `rollupStockBalance` domain function server-side.
 */
type StatusFilter = "all" | "in_stock" | "low" | "out";

export function StockBalanceScreen() {
  const { t } = useAppTranslation();
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // NaN is this codebase's empty number, as NumberField already treats it.
  const [qtyFrom, setQtyFrom] = useState(Number.NaN);
  const [qtyTo, setQtyTo] = useState(Number.NaN);
  const [search, setSearch] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const balanceQuery = useStockBalance(warehouseFilter ? { warehouseId: warehouseFilter } : {});
  const itemsQuery = useItems();
  const warehouses = useWarehouses().data ?? [];

  const rows = balanceQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }
  function warehouseLabel(id: string): string {
    return warehouses.find((w) => w.id === id)?.name ?? id;
  }
  /**
   * The reorder point is master data on the item, not on the position — the
   * balance rollup has no opinion about what "low" means for an item that
   * never set one, so an item without a reorder point is never low.
   */
  function reorderPointOf(itemId: string): number | null {
    return items.find((i) => i.id === itemId)?.reorderPoint ?? null;
  }
  function statusOf(row: StockBalanceRowDTO): StatusFilter {
    const onHand = majorOf(row.onHand);
    if (onHand <= 0) return "out";
    const reorderPoint = reorderPointOf(row.itemId);
    return reorderPoint !== null && onHand <= reorderPoint ? "low" : "in_stock";
  }

  const counts = useMemo(
    () => ({
      total: rows.length,
      outOfStock: rows.filter((r) => statusOf(r) === "out").length,
      lowStock: rows.filter((r) => statusOf(r) === "low").length,
    }),
    [rows, items],
  );

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== "all") list = list.filter((r) => statusOf(r) === statusFilter);
    if (!Number.isNaN(qtyFrom)) list = list.filter((r) => majorOf(r.onHand) >= qtyFrom);
    if (!Number.isNaN(qtyTo)) list = list.filter((r) => majorOf(r.onHand) <= qtyTo);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => itemLabel(r.itemId).toLowerCase().includes(q));
    }
    return list;
  }, [rows, search, items, statusFilter, qtyFrom, qtyTo]);

  const columns: DocumentListColumn<StockBalanceRowDTO>[] = [
    {
      key: "item",
      header: t("common.item"),
      render: (r) => {
        const status = statusOf(r);
        return (
          <div className="flex items-center gap-[8px]">
            <span className="text-ink">{itemLabel(r.itemId)}</span>
            {status === "out" ? <StatusPill label={t("items.stockState.out")} tone="danger" /> : null}
            {status === "low" ? <StatusPill label={t("items.stockState.low")} tone="warning" /> : null}
          </div>
        );
      },
    },
    {
      key: "onHand",
      header: t("stockBalance.col.totalOnHand"),
      align: "end",
      sortable: true,
      render: (r) => <span className="mz-num font-semibold text-ink">{r.onHand}</span>,
    },
    {
      key: "reserved",
      header: t("stockBalance.col.reserved"),
      align: "end",
      render: (r) => <span className="mz-num text-ink-muted">{r.reserved}</span>,
    },
    {
      key: "available",
      header: t("stockBalance.col.available"),
      align: "end",
      render: (r) => <span className="mz-num font-semibold text-ink">{r.available}</span>,
    },
    {
      key: "reorderPoint",
      header: t("stockBalance.col.reorderPoint"),
      align: "end",
      render: (r) => {
        const point = reorderPointOf(r.itemId);
        return point === null ? <span className="text-ink-faint">—</span> : <span className="mz-num text-ink-muted">{point}</span>;
      },
    },
    {
      key: "averageCost",
      header: t("stockBalance.col.averageCost"),
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.averageCost)} />,
    },
    {
      key: "totalValue",
      header: t("stockBalance.col.totalValue"),
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.totalValue)} />,
    },
    {
      key: "warehouseCount",
      header: t("stockBalance.col.warehouses"),
      align: "end",
      render: (r) => <span className="mz-num text-ink-muted">{r.warehouseCount}</span>,
    },
  ];

  if (balanceQuery.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("stockBalance.loadFailed")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => balanceQuery.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <DocumentList<StockBalanceRowDTO>
        title={t("stockBalance.title")}
        description={t("stockBalance.description")}
        stats={[
          { label: t("stockBalance.stat.total"), value: <span className="mz-num">{counts.total}</span> },
          { label: t("stockBalance.stat.lowStock"), value: <span className="mz-num">{counts.lowStock}</span> },
          { label: t("stockBalance.stat.outOfStock"), value: <span className="mz-num">{counts.outOfStock}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("stockBalance.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={t("stockBalance.filter.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[
                { value: "", label: t("stockBalance.filter.allWarehouses") },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
            <SelectField
              label={t("stockBalance.filter.status")}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: "all", label: t("stockBalance.filter.allStatuses") },
                { value: "in_stock", label: t("stockBalance.filter.inStock") },
                { value: "low", label: t("items.stockState.low") },
                { value: "out", label: t("items.stockState.out") },
              ]}
            />
            <NumberField label={t("stockBalance.filter.qtyFrom")} value={qtyFrom} onChange={setQtyFrom} />
            <NumberField label={t("stockBalance.filter.qtyTo")} value={qtyTo} onChange={setQtyTo} />
          </div>
        }
        columns={columns}
        rows={[...filtered]}
        rowKey={(r) => r.itemId}
        expandedKeys={expandedKeys}
        renderExpandedRow={(r) =>
          // A single-warehouse row has no breakdown to show — expanding it
          // would just repeat the row above.
          r.warehouses.length <= 1 ? null : (
            <table className="w-full border-collapse text-[12px]">
              <thead className="text-[11px] font-semibold text-ink-faint">
                <tr>
                  <th className="px-[10px] py-[5px] text-start">{t("stockBalance.filter.warehouse")}</th>
                  <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.totalOnHand")}</th>
                  <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.reserved")}</th>
                  <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.available")}</th>
                  <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.averageCost")}</th>
                  <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.totalValue")}</th>
                </tr>
              </thead>
              <tbody>
                {r.warehouses.map((w) => (
                  <tr key={w.warehouseId} className="border-t border-border">
                    <td className="px-[10px] py-[6px] text-ink">{warehouseLabel(w.warehouseId)}</td>
                    <td className="mz-num px-[10px] py-[6px] text-end">{w.onHand}</td>
                    <td className="mz-num px-[10px] py-[6px] text-end text-ink-muted">{w.reserved}</td>
                    <td className="mz-num px-[10px] py-[6px] text-end font-semibold">{w.available}</td>
                    <td className="px-[10px] py-[6px] text-end">
                      <MoneyDisplay value={Number(w.averageCost)} />
                    </td>
                    <td className="px-[10px] py-[6px] text-end">
                      <MoneyDisplay value={Number(w.totalValue)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        rowAction={(r) =>
          r.warehouses.length <= 1 ? null : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setExpandedKeys((prev) =>
                  prev.includes(r.itemId) ? prev.filter((key) => key !== r.itemId) : [...prev, r.itemId],
                );
              }}
              className="inline-flex items-center rounded-sm border border-border-strong bg-surface px-[9px] py-[3px] text-2xs font-semibold text-ink-muted transition-colors hover:border-brand hover:text-brand"
            >
              {expandedKeys.includes(r.itemId) ? t("stockBalance.collapse") : t("stockBalance.expand")}
            </button>
          )
        }
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")}{" "}
            <span className="mz-num">{counts.total}</span> {t("stockBalance.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("stockBalance.empty")}</div>}
      />
    </div>
  );
}
