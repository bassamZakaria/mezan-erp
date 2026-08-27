import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import type { InventoryStockLevelsRow } from "@mezan/domain";
import { useItems } from "../../data/hooks";
import { useReport } from "../../data/reports-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { StockBalanceScreen } from "../StockBalanceScreen";

/**
 * المخزون hub — item counts from `/items`, and stock value from the REAL
 * `/reports/inventory/stock-levels` engine (the same one
 * `InventoryStockLevelsReportScreen` runs) rather than re-deriving valuation
 * client-side.
 *
 * THE BALANCES TABLE IS THIS PAGE. أرصدة المخزون used to be a sibling nav
 * entry answering the hub's own question — how much of what, and where — so
 * the hub carried a five-row «needs attention» teaser above a link to the real
 * list. The list is now rendered here, and its own stat strip counts total /
 * low / out across the same rows, which is what that teaser was approximating.
 */

const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "inventoryHub.action.newItem", screen: "items" },
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
  const needsAttentionCount = useMemo(() => rows.filter((r) => r.status !== "normal").length, [rows]);

  const isLoading = itemsQuery.isLoading || stockLevelsQuery.isLoading;
  const isError = itemsQuery.isError || stockLevelsQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
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

      <StockBalanceScreen />
    </div>
  );
}
