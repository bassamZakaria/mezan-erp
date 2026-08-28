import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useAssetCategories, useAssets, useDepreciationRuns } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";

/**
 * الأصول الثابتة hub — asset register + categories + depreciation runs over
 * the real `/assets`, `/asset-categories`, `/depreciation-runs` endpoints.
 */

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

/**
 * Verbs only. A row of buttons that navigate to the same screens the bar one
 * pixel above already lists is a second copy of the navigation, not an action —
 * and each of these now opens the create flow rather than landing on the list.
 */
const quickActions: { label: AppTranslationKey; screen: ScreenKey }[] = [
  { label: "assetsHub.newAsset", screen: "asset-register" },
  { label: "assetsHub.runDepreciation", screen: "depreciation-runs" },
];

export function AssetsHubScreen() {
  const { t } = useAppTranslation();
  const { navigate } = useNavigation();
  const assetsQuery = useAssets();
  const categoriesQuery = useAssetCategories();
  const runsQuery = useDepreciationRuns();

  const assets = assetsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const runs = runsQuery.data ?? [];

  const activeAssets = useMemo(() => assets.filter((a) => a.status === "active").length, [assets]);
  const totalCost = useMemo(() => assets.reduce((sum, a) => sum + num(a.acquisitionCost), 0), [assets]);
  const totalAccumulatedDepreciation = useMemo(
    () => assets.reduce((sum, a) => sum + num(a.accumulatedDepreciation), 0),
    [assets],
  );
  const recentRuns = useMemo(() => [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5), [runs]);

  const isLoading = assetsQuery.isLoading || categoriesQuery.isLoading || runsQuery.isLoading;
  const isError = assetsQuery.isError || categoriesQuery.isError || runsQuery.isError;

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">{t("assetsHub.fixedAssets")}</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("assetsHub.theAssetAndDepreciationRegister")} {categories.length} {t("assetsHub.categoriesOnRecord")}</p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((action, index) => (
            <Button key={action.screen} size="sm" variant={index === 0 ? "primary" : "default"} onClick={() => navigate(action.screen, "create")}>
              {t(action.label)}
            </Button>
          ))}
        </div>
      </div>

      {isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("assetsHub.fixedAssetDataCouldNot")}</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("assetsHub.assets")} value={isLoading ? "—" : assets.length} sub={t("assetsHub.allAssetsOnRecord")} />
        <StatCard label={t("assetsHub.activeAssets")} value={isLoading ? "—" : activeAssets} sub={t("assetsHub.inUse")} />
        <StatCard label={t("assetsHub.totalAcquisitionCost")} value={<Money value={totalCost} />} sub={t("assetsHub.allAssets")} />
        <StatCard label={t("assetsHub.totalAccumulatedDepreciation")} value={<Money value={totalAccumulatedDepreciation} />} sub={t("assetsHub.toDate")} />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">{t("assetsHub.latestDepreciationRuns")}</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">{t("assetsHub.theLast5RunsRecorded")}</div>
        {recentRuns.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="mz-lat text-[12.5px] text-ink">{r.period}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">{r.status === "posted" ? t("assetsHub.posted") : r.status === "draft" ? t("docStatus.draft") : t("assetsHub.cancelled")}</div>
                </div>
                <Money value={num(r.totalAmount)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("assetsHub.noDepreciationRunsYetThe")}</p>
        )}
      </Card>
    </div>
  );
}
