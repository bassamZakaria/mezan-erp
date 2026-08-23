import { useMemo, useState } from "react";
import { Button, Card, DocumentList, Money as MoneyDisplay, type DocumentListColumn } from "@mezan/ui";
import type { ItemDTO, StockBalanceRowDTO } from "@mezan/contracts";
import { useItems, useStockBalance } from "../data/hooks";

/**
 * أرصدة المخزون (Stock Balance) — docs/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, served by `GET /inventory/stock-balance`.
 */

function itemLabel(id: string, items: readonly ItemDTO[]): string {
  const item = items.find((i) => i.id === id);
  return item ? `${item.nameAr} (${item.code})` : id;
}

export function StockBalanceScreen() {
  const query = useStockBalance();
  const itemsQuery = useItems();
  const [search, setSearch] = useState("");

  const rows = query.data ?? [];
  const items = itemsQuery.data ?? [];

  const counts = useMemo(() => {
    const outOfStock = rows.filter((r) => Number(r.onHand) === 0).length;
    return { total: rows.length, outOfStock };
  }, [rows]);

  const filtered = useMemo(() => {
    if (search.trim() === "") return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => itemLabel(r.itemId, items).toLowerCase().includes(q));
  }, [rows, items, search]);

  const columns: DocumentListColumn<StockBalanceRowDTO>[] = [
    { key: "item", header: "الصنف", render: (r) => <span className="text-ink">{itemLabel(r.itemId, items)}</span> },
    {
      key: "onHand",
      header: "إجمالي المخزون",
      align: "end",
      sortable: true,
      render: (r) => <span className="mz-num font-semibold text-ink">{r.onHand}</span>,
    },
    {
      key: "averageCost",
      header: "متوسط التكلفة",
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.averageCost)} />,
    },
    {
      key: "totalValue",
      header: "القيمة الإجمالية",
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.totalValue)} />,
    },
    {
      key: "warehouseCount",
      header: "عدد المستودعات",
      align: "end",
      render: (r) => <span className="mz-num text-ink-muted">{r.warehouseCount}</span>,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل أرصدة المخزون.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<StockBalanceRowDTO>
        eyebrow="Inventory · Stock Balance"
        title="أرصدة المخزون"
        description="نظرة عامة على أرصدة الأصناف عبر جميع المستودعات — قراءة فقط، مُشتقة من دفتر المخزون"
        stats={[
          { label: "إجمالي الأصناف", value: <span className="mz-num">{counts.total}</span> },
          { label: "نفد المخزون", value: <span className="mz-num">{counts.outOfStock}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الكود..."
        columns={columns}
        rows={[...filtered]}
        rowKey={(r) => r.itemId}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.total}</span> صنف
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أصناف مطابقة</div>}
      />
    </div>
  );
}
