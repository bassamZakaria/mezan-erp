import { useMemo, useState } from "react";
import { DocumentList, Money as MoneyDisplay, Card, Button, type DocumentListColumn } from "@mezan/ui";
import type { StockBalanceRowDTO } from "@mezan/contracts";
import { useItems, useStockBalance } from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * أرصدة المخزون (Stock Balance) — docs/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, on the real `GET /inventory/stock-balance` route
 * (packages/api/src/inventory-routes.ts), which runs the SAME
 * `rollupStockBalance` domain function server-side.
 */
export function StockBalanceScreen() {
  const { t } = useAppTranslation();
  const balanceQuery = useStockBalance();
  const itemsQuery = useItems();
  const [search, setSearch] = useState("");

  const rows = balanceQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  function itemLabel(id: string): string {
    const item = items.find((i) => i.id === id);
    return item ? `${item.nameAr} (${item.code})` : id;
  }

  const counts = useMemo(() => {
    const outOfStock = rows.filter((r) => Number(r.onHand) === 0).length;
    return { total: rows.length, outOfStock };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => itemLabel(r.itemId).toLowerCase().includes(q));
    }
    return list;
  }, [rows, search, items]);

  const columns: DocumentListColumn<StockBalanceRowDTO>[] = [
    { key: "item", header: t("common.item"), render: (r) => <span className="text-ink">{itemLabel(r.itemId)}</span> },
    {
      key: "onHand",
      header: t("stockBalance.col.totalOnHand"),
      align: "end",
      sortable: true,
      render: (r) => <span className="mz-num font-semibold text-ink">{r.onHand}</span>,
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
        eyebrow={t("eyebrow.inventory.stockBalance")}
        title={t("stockBalance.title")}
        description={t("stockBalance.description")}
        stats={[
          { label: t("stockBalance.stat.total"), value: <span className="mz-num">{counts.total}</span> },
          { label: t("stockBalance.stat.outOfStock"), value: <span className="mz-num">{counts.outOfStock}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("stockBalance.searchPlaceholder")}
        columns={columns}
        rows={[...filtered]}
        rowKey={(r) => r.itemId}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.total}</span> {t("stockBalance.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("stockBalance.empty")}</div>}
      />
    </div>
  );
}
