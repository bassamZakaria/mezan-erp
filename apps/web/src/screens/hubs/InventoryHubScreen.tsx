import { Money, Qty, WorkspaceHub } from "@mezan/ui";
import { StockLevelStatusDTO } from "@mezan/contracts";
import { useItemCounts } from "../../data/hooks";
import { useApi } from "../../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../../data/document-read-permissions";
import { useStockLevelsSummary } from "../../data/reports-hooks";
import type { ScreenKey } from "../../router/screens";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { EMPTY } from "../../lib/empty";

/**
 * NO QUICK ACTIONS. Every destination this overview used to repeat is a chip
 * on the bar above it — أرصدة المخزون، تحويلات، تسويات، الجرد الفعلي — and a
 * button that opens the same screen as a chip two centimetres away is a second
 * name for one place. «صنف جديد» went too: creating an item belongs to
 * الأصناف, which owns the form and its validation, and it is a workspace of
 * its own now.
 */
export function InventoryHubScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const readsItems = sessionMayRead(session, DocumentReadPermission.Items);
  const itemCountsQuery = useItemCounts({}, { enabled: readsItems });
  const stockLevelsQuery = useStockLevelsSummary();

  const itemCounts = itemCountsQuery.data ?? {};
  const inventoryValue = stockLevelsQuery.data?.totalValue ?? "0";
  const needsAttention = stockLevelsQuery.data?.attention ?? EMPTY;
  const needsAttentionCount = stockLevelsQuery.data?.needsAttentionCount ?? 0;

  const isLoading = (readsItems && itemCountsQuery.isLoading) || stockLevelsQuery.isLoading;
  const isError = (readsItems && itemCountsQuery.isError) || stockLevelsQuery.isError;

  return (
    <WorkspaceHub
      title={t("inventoryHub.title")}
      description={t("inventoryHub.description")}
      loading={isLoading}
      error={isError ? t("inventoryHub.loadFailed") : null}
      stats={[
        ...(readsItems
          ? [
              { key: "items", label: t("inventoryHub.stat.items"), value: itemCounts.all ?? 0, sub: t("inventoryHub.stat.itemsSub") },
              { key: "active", label: t("inventoryHub.stat.active"), value: itemCounts.active ?? 0, sub: t("inventoryHub.stat.activeSub") },
            ]
          : []),
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
              <span className="mz-lat">{row.sku}</span> · {t("inventoryHub.remaining")} <Qty value={row.onHand} />
            </>
          ),
          trailing: (
            <span className="text-2xs font-semibold text-danger-ink">
              {row.status === StockLevelStatusDTO.Out ? t("inventoryHub.out") : t("inventoryHub.low")}
            </span>
          ),
        })),
      }}
    />
  );
}
