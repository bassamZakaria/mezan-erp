import { Button, Card } from "@mezan/ui";
import { useItems } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { StockBalanceScreen } from "../StockBalanceScreen";

/**
 * المخزون — THE LANDING PAGE IS THE STOCK, not a page about the stock.
 *
 * Every voice in the review said the same thing independently: a storekeeper
 * opening المخزون wants to see what is on hand, and the owner judges the
 * product on whether قيمة المخزون is one number he can trust. A hub of tiles
 * above a link to the real list made «كم عندنا من الصنف ده» a two-click
 * question with two candidate answers — أرصدة المخزون and مستويات المخزون —
 * and that pair is the "different numbers for the same thing" ticket.
 *
 * So the balances table IS this page; the tiles sit on top of it as its
 * summary. There is one place to look, and its total is the same rows.
 *
 * The stat strip belongs to the table and counts the very rows in it, so the
 * page's headline figure and its list can never disagree.
 */

/**
 * The doors to the screens the nav no longer lists. الجرد الفعلي is a
 * once-a-cycle action and طباعة الملصقات hangs off الأصناف, so neither earns a
 * permanent row — but both have to be reachable from the page whose work they
 * belong to, or they read as missing rather than as tidied away.
 */
const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "inventoryHub.action.newItem", screen: "items" },
  { label: "inventoryHub.action.transfer", screen: "stock-transfers" },
  { label: "inventoryHub.action.adjust", screen: "stock-adjustments" },
  { label: "inventoryHub.action.count", screen: "physical-counts" },
];

export function InventoryHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const itemsQuery = useItems();

  const isError = itemsQuery.isError;

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

      <StockBalanceScreen embedded />
    </div>
  );
}
