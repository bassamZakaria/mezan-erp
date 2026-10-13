import { Card, WorkspaceHub } from "@mezan/ui";
import { ScreenRequest } from "@mezan/domain";
import { useBoms, useConfigurableProducts, useItemCounts, useItems, useMayAskScreen, useProductTemplates } from "../../data/hooks";
import { useItemSpecifications } from "../../data/item-catalog-hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../router/screens";
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

  const readsTemplates = useMayAskScreen(ScreenRequest.ProductTemplates);
  const readsConfigurable = useMayAskScreen(ScreenRequest.ConfigurableProducts);
  const readsBoms = useMayAskScreen(ScreenRequest.Boms);
  const reads: Partial<Record<ScreenKey, boolean>> = { "product-templates": readsTemplates, "configurable-products": readsConfigurable, boms: readsBoms };

  const everyCard: CatalogueCard[] = [
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
  const cards = everyCard.filter((card) => reads[card.screen] !== false);

  return (
    <WorkspaceHub
      title={t("itemsHub.title")}
      description={t("itemsHub.description")}
      loading={isLoading}
      error={isError ? t("itemsHub.loadFailed") : null}
      stats={[
        { key: "items", label: t("itemsHub.stat.items"), value: counts.all ?? items.length, sub: t("itemsHub.stat.itemsSub") },
        { key: "active", label: t("itemsHub.stat.active"), value: counts.active ?? 0, sub: t("itemsHub.stat.activeSub") },
        { key: "stock", label: t("itemsHub.stat.stock"), value: counts["type:stock"] ?? 0, sub: t("itemsHub.stat.stockSub") },
        { key: "service", label: t("itemsHub.stat.service"), value: counts["type:service"] ?? 0, sub: t("itemsHub.stat.serviceSub") },
      ]}
    >
      <Card className="p-[18px_20px]">
        <h3 className="font-display text-sm font-bold text-ink">{t("itemsHub.catalogueHeading")}</h3>
        <div className="mb-[12px] mt-[2px] text-2xs text-ink-faint">{t("itemsHub.catalogueSub")}</div>
        <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <button
              key={card.screen}
              type="button"
              onClick={() => navigate(card.screen)}
              className="flex flex-col items-start gap-[2px] rounded-lg border border-border bg-surface-2 p-[14px_16px] text-start transition-colors hover:border-brand"
            >
              <span className="mz-num font-display text-xl font-bold text-ink">{card.count === null ? "—" : card.count}</span>
              <span className="text-xs font-semibold text-ink">{t(card.labelKey)}</span>
              <span className="text-2xs text-ink-faint">{t(card.hintKey)}</span>
            </button>
          ))}
        </div>
      </Card>
    </WorkspaceHub>
  );
}
