import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import { useItems } from "../../data/hooks";
import { useReport } from "../../data/reports-hooks";
import type { ScreenKey } from "../../router/screens";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * المخزون hub — item counts from `/items`, and stock value + at-risk items
 * from the REAL `/reports/inventory/stock-levels` engine (the same one
 * `InventoryStockLevelsReportScreen` runs) rather than re-deriving valuation
 * client-side. No qty/timestamp field exists on `ItemDTO` itself, so the
 * "needs attention" list below is sourced from that report's rows, not a
 * fabricated "recent items" ordering.
 */

/**
 * NO QUICK ACTIONS. Every destination this overview used to repeat is a chip
 * on the bar above it — أرصدة المخزون، تحويلات، تسويات، الجرد الفعلي — and a
 * button that opens the same screen as a chip two centimetres away is a second
 * name for one place. «صنف جديد» went too: creating an item belongs to
 * الأصناف, which owns the form and its validation, and it is a workspace of
 * its own now.
 */
const STOCK_LEVELS_PARAMS = { warehouseId: "", search: "" };

export function InventoryHubScreen() {
  const { t } = useAppTranslation();
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
    <WorkspaceHub
      title={t("inventoryHub.title")}
      description={t("inventoryHub.description")}
      loading={isLoading}
      error={isError ? t("inventoryHub.loadFailed") : null}
      stats={[
        { key: "items", label: t("inventoryHub.stat.items"), value: items.length, sub: t("inventoryHub.stat.itemsSub") },
        { key: "active", label: t("inventoryHub.stat.active"), value: activeItems, sub: t("inventoryHub.stat.activeSub") },
        { key: "value", label: t("inventoryHub.stat.value"), value: <Money value={inventoryValue} />, sub: t("inventoryHub.stat.valueSub") },
        {
          key: "attention",
          label: t("inventoryHub.stat.attention"),
          value: needsAttentionCount,
          sub: t("inventoryHub.stat.attentionSub"),
          subTone: needsAttentionCount > 0 ? "down" : "neutral",
        },
      ]}
      list={{
        title: t("inventoryHub.stat.attention"),
        sub: t("inventoryHub.attentionSub"),
        empty: t("inventoryHub.empty"),
        rows: needsAttention.map((row) => ({
          key: row.itemId,
          primary: row.itemNameAr,
          secondary: (
            <>
              <span className="mz-lat">{row.sku}</span> · {t("inventoryHub.remaining")} <span className="mz-num">{row.onHand}</span>
            </>
          ),
          trailing: (
            <span className="text-2xs font-semibold text-danger-ink">
              {row.status === "out" ? t("inventoryHub.out") : t("inventoryHub.low")}
            </span>
          ),
        })),
      }}
    />
  );
}
