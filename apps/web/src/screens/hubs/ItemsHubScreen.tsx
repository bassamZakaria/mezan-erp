import { Card, StatCard } from "@mezan/ui";
import { useBoms, useConfigurableProducts, useItemCounts, useItems, useProductTemplates } from "../../data/hooks";
import { useItemSpecifications } from "../../data/item-catalog-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * الأصناف overview — the workspace at a glance, so this workspace opens the
 * same way المخزون and التصنيع do.
 *
 * It deliberately does NOT repeat الأصناف's own stat strip (total / active /
 * stock / non-stock), which the list carries two clicks away and computes on
 * the server over the same filter. What it says instead is the one thing no
 * single screen on this bar can: how the catalogue is MADE UP — how many
 * plain items, how many generated from a template, how many priced by a
 * formula, and how many carry a recipe. Each figure is a live count from the
 * screen it names, and each card opens that screen.
 */

interface CatalogueCard {
  readonly labelKey: AppTranslationKey;
  readonly hintKey: AppTranslationKey;
  readonly screen: ScreenKey;
  readonly count: number | null;
}

export function ItemsHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();

  const itemsQuery = useItems();
  const countsQuery = useItemCounts();
  const templatesQuery = useProductTemplates();
  const configurableQuery = useConfigurableProducts();
  const specificationsQuery = useItemSpecifications();
  const bomsQuery = useBoms();

  const counts = countsQuery.data ?? {};
  const items = itemsQuery.data ?? [];
  const isLoading = itemsQuery.isLoading || countsQuery.isLoading;
  const isError = itemsQuery.isError || countsQuery.isError;

  /** `undefined` while a count is still loading, so a tile shows «—» not a 0. */
  const lengthOf = (rows: readonly unknown[] | undefined): number | null => (rows ? rows.length : null);

  const cards: CatalogueCard[] = [
    {
      labelKey: "itemsHub.card.templates",
      hintKey: "itemsHub.card.templatesHint",
      screen: "product-templates",
      count: lengthOf(templatesQuery.data),
    },
    {
      labelKey: "itemsHub.card.configurable",
      hintKey: "itemsHub.card.configurableHint",
      screen: "configurable-products",
      count: lengthOf(configurableQuery.data),
    },
    {
      labelKey: "itemsHub.card.specifications",
      hintKey: "itemsHub.card.specificationsHint",
      screen: "item-specifications",
      count: lengthOf(specificationsQuery.data),
    },
    {
      labelKey: "itemsHub.card.boms",
      hintKey: "itemsHub.card.bomsHint",
      screen: "boms",
      count: lengthOf(bomsQuery.data),
    },
  ];

  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("itemsHub.title")}</h1>
        <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("itemsHub.description")}</p>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("itemsHub.loadFailed")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("itemsHub.stat.items")} value={isLoading ? "—" : (counts.all ?? items.length)} sub={t("itemsHub.stat.itemsSub")} />
        <StatCard label={t("itemsHub.stat.active")} value={isLoading ? "—" : (counts.active ?? 0)} sub={t("itemsHub.stat.activeSub")} />
        <StatCard label={t("itemsHub.stat.stock")} value={isLoading ? "—" : (counts["type:stock"] ?? 0)} sub={t("itemsHub.stat.stockSub")} />
        <StatCard label={t("itemsHub.stat.service")} value={isLoading ? "—" : (counts["type:service"] ?? 0)} sub={t("itemsHub.stat.serviceSub")} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("itemsHub.catalogueHeading")}</h3>
        <div className="mb-[12px] mt-[2px] text-[11.5px] text-ink-faint">{t("itemsHub.catalogueSub")}</div>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <button
              key={card.screen}
              type="button"
              onClick={() => navigate(card.screen)}
              className="flex flex-col items-start gap-[2px] rounded-lg border border-border bg-surface-2 p-[14px_16px] text-start transition-colors hover:border-brand"
            >
              <span className="mz-num font-display text-[22px] font-bold text-ink">{card.count === null ? "—" : card.count}</span>
              <span className="text-[12.5px] font-semibold text-ink">{t(card.labelKey)}</span>
              <span className="text-[11px] text-ink-faint">{t(card.hintKey)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
