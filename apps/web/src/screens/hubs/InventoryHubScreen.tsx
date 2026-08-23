import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import { useItems } from "../../data/hooks";
import { useReport } from "../../data/reports-hooks";
import { useNavigate } from "../../navigation";

/**
 * المخزون hub — item counts from `/items`, and stock value + at-risk items
 * from the REAL `/reports/inventory/stock-levels` engine (the same one
 * `InventoryStockLevelsReportScreen` runs) rather than re-deriving valuation
 * client-side. No qty/timestamp field exists on `ItemDTO` itself, so the
 * "needs attention" list below is sourced from that report's rows, not a
 * fabricated "recent items" ordering.
 */

const quickActions: { label: string; screen: string }[] = [
  { label: "صنف جديد", screen: "items" },
  { label: "أرصدة المخزون", screen: "stock-balance" },
  { label: "تحويل مخزون", screen: "stock-transfers" },
  { label: "جرد فعلي", screen: "physical-counts" },
];

const STOCK_LEVELS_PARAMS = { warehouseId: "", search: "" };

export function InventoryHubScreen() {
  const navigate = useNavigate();
  const itemsQuery = useItems();
  const stockLevelsQuery = useReport<InventoryStockLevelsRow>(
    "inventory.stock-levels",
    "/inventory/stock-levels",
    STOCK_LEVELS_PARAMS,
  );

  const items = itemsQuery.data ?? [];
  const activeItems = useMemo(() => items.filter((i) => i.status === "active").length, [items]);
  const rows = stockLevelsQuery.data?.rows ?? [];
  const inventoryValue = stockLevelsQuery.data?.grandTotals.value ?? 0;
  const needsAttention = useMemo(() => rows.filter((r) => r.status !== "normal").slice(0, 5), [rows]);
  const needsAttentionCount = useMemo(() => rows.filter((r) => r.status !== "normal").length, [rows]);

  const isLoading = itemsQuery.isLoading || stockLevelsQuery.isLoading;
  const isError = itemsQuery.isError || stockLevelsQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Inventory</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">المخزون</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">الأصناف ومستويات المخزون — من محرك التقارير الفعلي</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات المخزون.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="عدد الأصناف" value={isLoading ? "—" : items.length} sub="إجمالي الأصناف المسجّلة" />
        <StatCard label="أصناف نشطة" value={isLoading ? "—" : activeItems} sub="حالة الصنف: نشط" />
        <StatCard label="قيمة المخزون" value={<Money value={inventoryValue} />} sub="أصناف مخزنية · كل المستودعات" />
        <StatCard
          label="أصناف تحتاج انتباه"
          value={isLoading ? "—" : needsAttentionCount}
          sub="نافدة أو تحت حد إعادة الطلب"
          subTone={needsAttentionCount > 0 ? "down" : "neutral"}
        />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أصناف تحتاج انتباه</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">من تقرير مستويات المخزون — نافدة أو تحت حد إعادة الطلب</div>
        {needsAttention.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {needsAttention.map((row) => (
              <li key={row.itemId} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{row.itemNameAr}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    <span className="mz-lat">{row.sku}</span> · متبقي <span className="mz-num">{row.onHand}</span>
                  </div>
                </div>
                <span className="text-[11.5px] font-semibold text-danger-ink">{row.status === "out" ? "نافد" : "منخفض"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">لا توجد أصناف تحتاج انتباهاً حالياً.</p>
        )}
      </Card>
    </div>
  );
}
