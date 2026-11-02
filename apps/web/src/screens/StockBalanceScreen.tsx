import { useEffect, useMemo, useState } from "react";
import { DocumentList, EmptyState, Money as MoneyDisplay, Qty, Card, Button, StatusPill, type DocumentListColumn } from "@mezan/ui";
import type { StockBalanceRowDTO } from "@mezan/contracts";
import { useStockBalance, useWarehouses } from "../data/hooks";
import { useMaySeeItemCost } from "../data/item-cost";
import { SelectField, NumberField } from "../settings/form-controls";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { majorOf } from "../lib/money";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { errorMessage } from "../lib/error-message";

/**
 * أرصدة المخزون (Stock Balance) — docs/archive/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, on the real `GET /inventory/stock-balance` route
 * (packages/api/src/inventory-routes.ts), which runs the SAME
 * `rollupStockBalance` domain function server-side.
 */
type StatusFilter = "all" | "in_stock" | "low" | "out";
const PAGE_SIZES = [10, 25, 50, 100] as const;

function itemLabel(row: StockBalanceRowDTO): string {
  return row.itemNameAr ? `${row.itemNameAr} (${row.itemCode})` : row.itemId;
}

/**
 * The reorder point is master data on the item, not on the position — the
 * balance rollup has no opinion about what "low" means for an item that
 * never set one, so an item without a reorder point is never low.
 */
function statusOf(row: StockBalanceRowDTO): StatusFilter {
  const onHand = majorOf(row.onHand);
  if (onHand <= 0) return "out";
  const reorderPoint = row.reorderPoint ?? null;
  return reorderPoint !== null && onHand <= reorderPoint ? "low" : "in_stock";
}

export function StockBalanceScreen() {
  const nameOf = useEntityName();
  const showCost = useMaySeeItemCost();
  const { t } = useAppTranslation();
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    StatusFilter,
    (next: string) => void,
  ];
  // NaN is this codebase's empty number, as NumberField already treats it.
  const [qtyFrom, setQtyFrom] = useState(Number.NaN);
  const [qtyTo, setQtyTo] = useState(Number.NaN);
  const [searchText, setSearchText, search] = useUrlSearch();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const balanceQuery = useStockBalance(warehouseFilter ? { warehouseId: warehouseFilter } : {});
  const warehouses = useWarehouses().data ?? [];

  const rows = balanceQuery.data ?? EMPTY;

  function warehouseLabel(id: string): string {
    return nameOf(warehouses.find((w) => w.id === id), id);
  }
  /**
   * Everything the user narrowed by except the status filter, which the stat
   * strip counts across. A stat that ignored the quantity range and the search
   * box would report the whole warehouse while the list showed six rows.
   */
  const baseRows = useMemo(() => {
    let list = rows;
    if (!Number.isNaN(qtyFrom)) list = list.filter((r) => majorOf(r.onHand) >= qtyFrom);
    if (!Number.isNaN(qtyTo)) list = list.filter((r) => majorOf(r.onHand) <= qtyTo);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => itemLabel(r).toLowerCase().includes(q));
    }
    return list;
  }, [rows, search, qtyFrom, qtyTo]);

  const counts = useMemo(
    () => ({
      total: baseRows.length,
      outOfStock: baseRows.filter((r) => statusOf(r) === "out").length,
      lowStock: baseRows.filter((r) => statusOf(r) === "low").length,
    }),
    [baseRows],
  );

  const filtered = useMemo(
    () => (statusFilter === "all" ? baseRows : baseRows.filter((r) => statusOf(r) === statusFilter)),
    [baseRows, statusFilter],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount =
    (warehouseFilter ? 1 : 0) +
    (statusFilter === "all" ? 0 : 1) +
    (Number.isNaN(qtyFrom) ? 0 : 1) +
    (Number.isNaN(qtyTo) ? 0 : 1);

  const columns: DocumentListColumn<StockBalanceRowDTO>[] = [
    {
      key: "item",
      header: t("common.item"),
      render: (r) => {
        const status = statusOf(r);
        return (
          <div className="flex items-center gap-[8px]">
            <span className="text-ink">{itemLabel(r)}</span>
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
      render: (r) => <Qty value={r.onHand} className="font-semibold text-ink" />,
    },
    {
      key: "reserved",
      header: t("stockBalance.col.reserved"),
      align: "end",
      render: (r) => <Qty value={r.reserved} className="text-ink-muted" />,
    },
    {
      key: "available",
      header: t("stockBalance.col.available"),
      align: "end",
      render: (r) => <Qty value={r.available} className="font-semibold text-ink" />,
    },
    {
      key: "reorderPoint",
      header: t("stockBalance.col.reorderPoint"),
      align: "end",
      render: (r) => {
        const point = r.reorderPoint ?? null;
        return point === null ? <span className="text-ink-faint">—</span> : <span className="mz-num text-ink-muted">{point}</span>;
      },
    },
    ...(showCost
      ? [
          {
            key: "averageCost",
            header: t("stockBalance.col.averageCost"),
            align: "end" as const,
            render: (r: StockBalanceRowDTO) => <MoneyDisplay value={Number(r.averageCost)} />,
          },
          {
            key: "totalValue",
            header: t("stockBalance.col.totalValue"),
            align: "end" as const,
            render: (r: StockBalanceRowDTO) => <MoneyDisplay value={Number(r.totalValue)} />,
          },
        ]
      : []),
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
        <p className="text-[13px] font-semibold text-danger-ink">{errorMessage(balanceQuery.error, t("stockBalance.loadFailed"))}</p>
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
        listKey="stock-balance"
        statsCollapsible
        stats={[
          { label: t("stockBalance.stat.total"), value: <span className="mz-num">{counts.total}</span> },
          { label: t("stockBalance.stat.lowStock"), value: <span className="mz-num">{counts.lowStock}</span> },
          { label: t("stockBalance.stat.outOfStock"), value: <span className="mz-num">{counts.outOfStock}</span> },
        ]}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("stockBalance.searchPlaceholder")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={t("stockBalance.filter.warehouse")}
              value={warehouseFilter}
              onChange={(v) => {
                setWarehouseFilter(v);
                setPage(1);
              }}
              options={[
                { value: "", label: t("stockBalance.filter.allWarehouses") },
                ...warehouses.map((w) => ({ value: w.id, label: w.name })),
              ]}
            />
            <SelectField
              label={t("stockBalance.filter.status")}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v as StatusFilter);
                setPage(1);
              }}
              options={[
                { value: "all", label: t("stockBalance.filter.allStatuses") },
                { value: "in_stock", label: t("stockBalance.filter.inStock") },
                { value: "low", label: t("items.stockState.low") },
                { value: "out", label: t("items.stockState.out") },
              ]}
            />
            <NumberField
              label={t("stockBalance.filter.qtyFrom")}
              value={qtyFrom}
              onChange={(v) => {
                setQtyFrom(v);
                setPage(1);
              }}
            />
            <NumberField
              label={t("stockBalance.filter.qtyTo")}
              value={qtyTo}
              onChange={(v) => {
                setQtyTo(v);
                setPage(1);
              }}
            />
          </div>
        }
        columns={columns}
        rows={[...pageRows]}
        loading={balanceQuery.isLoading}
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
                  {showCost ? <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.averageCost")}</th> : null}
                  {showCost ? <th className="px-[10px] py-[5px] text-end">{t("stockBalance.col.totalValue")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {r.warehouses.map((w) => (
                  <tr key={w.warehouseId} className="border-t border-border">
                    <td className="px-[10px] py-[6px] text-ink">{warehouseLabel(w.warehouseId)}</td>
                    <td className="px-[10px] py-[6px] text-end">
                      <Qty value={w.onHand} />
                    </td>
                    <td className="px-[10px] py-[6px] text-end">
                      <Qty value={w.reserved} className="text-ink-muted" />
                    </td>
                    <td className="px-[10px] py-[6px] text-end">
                      <Qty value={w.available} className="font-semibold" />
                    </td>
                    {showCost ? (
                      <td className="px-[10px] py-[6px] text-end">
                        <MoneyDisplay value={Number(w.averageCost)} />
                      </td>
                    ) : null}
                    {showCost ? (
                      <td className="px-[10px] py-[6px] text-end">
                        <MoneyDisplay value={Number(w.totalValue)} />
                      </td>
                    ) : null}
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
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")}{" "}
            <span className="mz-num">{filtered.length}</span> {t("stockBalance.showingSuffix")}
          </>
        }
        emptyState={<EmptyState title={t("stockBalance.empty")} description={t("stockBalance.emptyBody")} />}
      />
    </div>
  );
}
