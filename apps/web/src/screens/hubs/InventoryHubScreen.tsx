import { useMemo } from "react";
import { FulcrumRule, Button, Card, Money, StatCard } from "@mezan/ui";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import { useItems } from "../../data/hooks";
import { useReport } from "../../data/reports-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * المخزون hub — item counts from `/items`, and stock value + at-risk items
 * from the REAL `/reports/inventory/stock-levels` engine (the same one
 * `InventoryStockLevelsReportScreen` runs) rather than re-deriving valuation
 * client-side. No qty/timestamp field exists on `ItemDTO` itself, so the
 * "needs attention" list below is sourced from that report's rows, not a
 * fabricated "recent items" ordering.
 */

const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "inventoryHub.action.newItem", screen: "items" },
  { label: "inventoryHub.action.balances", screen: "stock-balance" },
  { label: "inventoryHub.action.transfer", screen: "stock-transfers" },
  { label: "inventoryHub.action.count", screen: "physical-counts" },
];

const STOCK_LEVELS_PARAMS = { warehouseId: "", search: "" };

export function InventoryHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
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
          <div className="mz-eyebrow">{t("eyebrow.inventory")}</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("inventoryHub.title")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("inventoryHub.description")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen)}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>
      <div className="-mt-[18px] -mb-[22px]">
        <FulcrumRule />
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("inventoryHub.loadFailed")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("inventoryHub.stat.items")} value={isLoading ? "—" : items.length} sub={t("inventoryHub.stat.itemsSub")} />
        <StatCard label={t("inventoryHub.stat.active")} value={isLoading ? "—" : activeItems} sub={t("inventoryHub.stat.activeSub")} />
        <StatCard label={t("inventoryHub.stat.value")} value={<Money value={inventoryValue} />} sub={t("inventoryHub.stat.valueSub")} />
        <StatCard
          label={t("inventoryHub.stat.attention")}
          value={isLoading ? "—" : needsAttentionCount}
          sub={t("inventoryHub.stat.attentionSub")}
          subTone={needsAttentionCount > 0 ? "down" : "neutral"}
        />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("inventoryHub.stat.attention")}</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">{t("inventoryHub.attentionSub")}</div>
        {needsAttention.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {needsAttention.map((row) => (
              <li key={row.itemId} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="text-[12.5px] text-ink">{row.itemNameAr}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">
                    <span className="mz-lat">{row.sku}</span> · {t("inventoryHub.remaining")} <span className="mz-num">{row.onHand}</span>
                  </div>
                </div>
                <span className="text-[11.5px] font-semibold text-danger-ink">{row.status === "out" ? t("inventoryHub.out") : t("inventoryHub.low")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("inventoryHub.empty")}</p>
        )}
      </Card>
    </div>
  );
}
