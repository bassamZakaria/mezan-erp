import { useMemo } from "react";
import { Button, Card, Money, StatCard } from "@mezan/ui";
import { useAssetCategories, useAssets, useDepreciationRuns } from "../../data/hooks";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../App";

/**
 * الأصول الثابتة hub — asset register + categories + depreciation runs over
 * the real `/assets`, `/asset-categories`, `/depreciation-runs` endpoints.
 */

function num(value: string | undefined | null): number {
  return value ? Number(value) : 0;
}

const quickActions: { label: string; screen: ScreenKey }[] = [
  { label: "أصل جديد", screen: "asset-register" },
  { label: "تشغيل إهلاك جديد", screen: "depreciation-runs" },
  { label: "تصنيفات الأصول", screen: "asset-categories" },
];

export function AssetsHubScreen() {
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
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Assets</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">الأصول الثابتة</h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">سجل الأصول والإهلاك — من {categories.length} تصنيف مسجّل</p>
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل بيانات الأصول الثابتة.</p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label="عدد الأصول" value={isLoading ? "—" : assets.length} sub="إجمالي الأصول المسجّلة" />
        <StatCard label="أصول نشطة" value={isLoading ? "—" : activeAssets} sub="قيد الاستخدام" />
        <StatCard label="إجمالي تكلفة الاقتناء" value={<Money value={totalCost} />} sub="جميع الأصول" />
        <StatCard label="إجمالي الإهلاك المتراكم" value={<Money value={totalAccumulatedDepreciation} />} sub="حتى الآن" />
      </div>

      <Card className="p-[18px_20px]">
        <h3 className="font-display text-[14.5px] font-bold text-ink">أحدث عمليات الإهلاك</h3>
        <div className="mb-[10px] mt-[2px] text-[11.5px] text-ink-faint">آخر 5 عمليات مسجّلة</div>
        {recentRuns.length > 0 ? (
          <ul className="flex flex-col gap-[10px]">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-[10px]">
                <div>
                  <div className="mz-lat text-[12.5px] text-ink">{r.period}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">{r.status === "posted" ? "مرحّل" : r.status === "draft" ? "مسودة" : "ملغى"}</div>
                </div>
                <Money value={num(r.totalAmount)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-muted">لا توجد عمليات إهلاك بعد — ستظهر هنا فور تشغيل أول عملية.</p>
        )}
      </Card>
    </div>
  );
}
