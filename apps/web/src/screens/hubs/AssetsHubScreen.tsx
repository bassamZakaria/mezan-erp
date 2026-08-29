import { useMemo } from "react";
import { Money, WorkspaceHub } from "@mezan/ui";
import { useAssetCategories, useAssets, useDepreciationRuns } from "../../data/hooks";
import { useAppTranslation } from "../../i18n";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";
import { EMPTY } from "../../lib/empty";

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
const quickActions: HubAction[] = [
  { label: "assetsHub.newAsset", screen: "asset-register" },
  { label: "assetsHub.runDepreciation", screen: "depreciation-runs" },
];

export function AssetsHubScreen() {
  const { t } = useAppTranslation();
  const assetsQuery = useAssets();
  const categoriesQuery = useAssetCategories();
  const runsQuery = useDepreciationRuns();

  const assets = assetsQuery.data ?? EMPTY;
  const categories = categoriesQuery.data ?? [];
  const runs = runsQuery.data ?? EMPTY;

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
    <WorkspaceHub
      title={t("assetsHub.fixedAssets")}
      description={`${t("assetsHub.theAssetAndDepreciationRegister")} ${categories.length} ${t("assetsHub.categoriesOnRecord")}`}
      loading={isLoading}
      error={isError ? t("assetsHub.fixedAssetDataCouldNot") : null}
      actions={<HubActions actions={quickActions} />}
      stats={[
        { key: "assets", label: t("assetsHub.assets"), value: assets.length, sub: t("assetsHub.allAssetsOnRecord") },
        { key: "active", label: t("assetsHub.activeAssets"), value: activeAssets, sub: t("assetsHub.inUse") },
        { key: "cost", label: t("assetsHub.totalAcquisitionCost"), value: <Money value={totalCost} />, sub: t("assetsHub.allAssets") },
        { key: "depreciation", label: t("assetsHub.totalAccumulatedDepreciation"), value: <Money value={totalAccumulatedDepreciation} />, sub: t("assetsHub.toDate") },
      ]}
      list={{
        title: t("assetsHub.latestDepreciationRuns"),
        sub: t("assetsHub.theLast5RunsRecorded"),
        empty: t("assetsHub.noDepreciationRunsYetThe"),
        rows: recentRuns.map((r) => ({
          key: r.id,
          primary: <span className="mz-lat">{r.period}</span>,
          secondary: r.status === "posted" ? t("assetsHub.posted") : r.status === "draft" ? t("docStatus.draft") : t("assetsHub.cancelled"),
          trailing: <Money value={num(r.totalAmount)} />,
        })),
      }}
    />
  );
}
