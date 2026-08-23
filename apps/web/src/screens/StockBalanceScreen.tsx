import { useMemo, useState } from "react";
import { DocumentList, Money as MoneyDisplay, type DocumentListColumn } from "@mezan/ui";
import type { StockBalanceRow } from "@mezan/domain";
import { useInventoryOpsStore } from "../store/useInventoryOpsStore";
import { sharedInventoryOpsStore } from "../store/shared-inventory-ops-store";
import { demoItems } from "../items-sample-data";

/**
 * أرصدة المخزون (Stock Balance) — docs/catalog/03. Read-only cross-warehouse
 * rollup, one row per item, over `rollupStockBalance` (domain pure function).
 */

function itemLabel(id: string): string {
  const item = demoItems.find((i) => i.id === id);
  return item ? `${item.nameAr} (${item.code})` : id;
}

export function StockBalanceScreen() {
  const store = useInventoryOpsStore(sharedInventoryOpsStore);
  const [search, setSearch] = useState("");

  const rows = store.stockBalance;

  const counts = useMemo(() => {
    const outOfStock = rows.filter((r) => r.onHand.isZero()).length;
    return { total: rows.length, outOfStock };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => itemLabel(r.itemId).toLowerCase().includes(q));
    }
    return list;
  }, [rows, search]);

  const columns: DocumentListColumn<StockBalanceRow>[] = [
    { key: "item", header: "الصنف", render: (r) => <span className="text-ink">{itemLabel(r.itemId)}</span> },
    {
      key: "onHand",
      header: "إجمالي المخزون",
      align: "end",
      sortable: true,
      render: (r) => <span className="mz-num font-semibold text-ink">{r.onHand.toString()}</span>,
    },
    {
      key: "averageCost",
      header: "متوسط التكلفة",
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.averageCost.toString())} />,
    },
    {
      key: "totalValue",
      header: "القيمة الإجمالية",
      align: "end",
      render: (r) => <MoneyDisplay value={Number(r.totalValue.toString())} />,
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
      <DocumentList<StockBalanceRow>
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
