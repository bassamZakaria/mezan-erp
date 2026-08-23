import { useMemo, useState } from "react";
import { DocumentList, Money as MoneyDisplay, type DocumentListColumn } from "@mezan/ui";
import type { StockBalanceRowDTO } from "@mezan/contracts";
import { useStockBalance } from "../data/inventory-ops-hooks";
import { useItems } from "../data/hooks";

/**
 * أرصدة المخزون (Stock Balance) — docs/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, backed by `GET /inventory/stock-balance`.
 */

export function StockBalanceScreen() {
  const balanceQuery = useStockBalance();
  const itemsQuery = useItems();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => balanceQuery.data ?? [], [balanceQuery.data]);

  const itemLabel = useMemo(() => {
    const map = new Map((itemsQuery.data ?? []).map((i) => [i.id, `${i.nameAr} (${i.code})`]));
    return (id: string) => map.get(id) ?? id;
  }, [itemsQuery.data]);

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
  }, [rows, search, itemLabel]);

  const columns: DocumentListColumn<StockBalanceRowDTO>[] = [
    { key: "item", header: "الصنف", render: (r) => <span className="text-ink">{itemLabel(r.itemId)}</span> },
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
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {balanceQuery.isLoading ? "جارِ التحميل…" : balanceQuery.isError ? (balanceQuery.error?.message ?? "تعذّر تحميل أرصدة المخزون.") : "لا توجد أصناف مطابقة"}
          </div>
        }
      />
    </div>
  );
}
