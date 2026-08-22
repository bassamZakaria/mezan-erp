import { useMemo, useState } from "react";
import { Button, Card, Chip, DonutChart, Money, StatCard, TrendChart } from "@mezan/ui";
import {
  agingBucketLabels,
  agingRows,
  companyKpiTiles,
  dashboardDateLabel,
  dashboardFooterDisclaimer,
  dashboardGreetingName,
  DEFAULT_TAX_RATE,
  expenseBreakdown,
  expenseBreakdownRangeOptions,
  followUpItems,
  kpiTiles,
  quickActions,
  rankListDateRangeOptions,
  recentActivity,
  revenueTrendForRange,
  revenueTrendRangeOptions,
  topCustomers,
  topItems,
} from "./dashboard-sample-data";

type TaxMode = "inc" | "exc";
type ItemSort = "value" | "qty";

function taxExclusive(valueIncTax: number): number {
  return valueIncTax / (1 + DEFAULT_TAX_RATE / 100);
}

/**
 * لوحة التحكم (Dashboard — Home), docs/catalog/09-settings-dashboard-ux.md
 * §Dashboard + the approved mockup's `data-view="dashboard"`. Sample-data
 * driven like every Phase-1 web screen (no `/api/dashboard/*` wiring yet —
 * the shapes in dashboard-sample-data.ts mirror the documented endpoints so
 * a later fetch swap is drop-in). Company-wide figures are intentionally NOT
 * branch-scoped, per the footer disclaimer below.
 */
export function DashboardScreen() {
  const [trendRange, setTrendRange] = useState<string>("6");
  const [expenseRange, setExpenseRange] = useState<string>("month");
  const [itemsRange, setItemsRange] = useState<string>("month");
  const [itemsSort, setItemsSort] = useState<ItemSort>("value");
  const [itemsTaxMode, setItemsTaxMode] = useState<TaxMode>("inc");
  const [customersRange, setCustomersRange] = useState<string>("month");
  const [customersTaxMode, setCustomersTaxMode] = useState<TaxMode>("inc");

  const trend = useMemo(() => revenueTrendForRange(Number(trendRange)), [trendRange]);

  const sortedItems = useMemo(() => {
    const rows = [...topItems];
    rows.sort((a, b) => (itemsSort === "value" ? b.revenueIncTax - a.revenueIncTax : b.qty - a.qty));
    return rows;
  }, [itemsSort]);

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <div className="mz-lat text-[11px] font-bold uppercase tracking-[1.2px] text-ink-faint">Overview</div>
          <h1 className="mt-[4px] font-display text-[23px] font-bold text-ink">
            مرحباً، {dashboardGreetingName} · طاب يومك
          </h1>
          <p className="mt-[4px] max-w-[62ch] text-[12.5px] text-ink-muted">
            {dashboardDateLabel} · جميع الأرقام على مستوى الشركة، بغض النظر عن نطاق الفرع المحدد أعلاه
          </p>
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {quickActions.map((label, index) => (
            <Button key={label} size="sm" variant={index === 2 ? "primary" : "default"}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        {kpiTiles.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={<Money value={tile.value} />}
            sub={tile.sub}
            subTone={tile.subTone}
            valueTone={tile.valueTone}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-[1.6fr_1fr]">
        <TrendChart
          title="أداء الفترة"
          hint="الخط المتقطع = الشهر الحالي (جزئي)"
          categories={[...trend.categories]}
          series={[
            { key: "revenue", label: "الإيرادات", color: "var(--chart-1)", values: trend.revenue },
            { key: "expenses", label: "المصروفات", color: "var(--chart-2)", values: trend.expenses },
            { key: "net-profit", label: "صافي الربح", color: "var(--chart-3)", values: trend.netProfit },
          ]}
          partialFromIndex={trend.categories.length - 1}
          rangeOptions={[...revenueTrendRangeOptions]}
          activeRange={trendRange}
          onRangeChange={setTrendRange}
        />

        <Card className="p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">يحتاج متابعة</h3>
          <div className="mt-[2px] text-[11.5px] text-ink-faint">أولويات اليوم</div>
          <div className="mt-[12px] flex flex-col gap-[10px]">
            {followUpItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between gap-[12px] rounded-md border border-border p-[10px_12px]"
              >
                <div>
                  <div className="text-[13px] font-semibold text-ink">{item.title}</div>
                  <div className="mt-[2px] text-[11.5px] text-ink-faint">
                    <span className="mz-num">{item.sub}</span>
                  </div>
                </div>
                <Button size="sm" variant={item.actionVariant === "primary" ? "primary" : "default"}>
                  {item.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <div className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.8px] text-ink-faint">على مستوى الشركة</div>
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
          {companyKpiTiles.map((tile) => (
            <StatCard key={tile.key} label={tile.label} value={<Money value={tile.value} />} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
        <Card className="p-[18px_20px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">المبالغ المتأخرة</h3>
          <div className="mt-[12px] overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-start text-[10.5px] font-bold uppercase tracking-[0.2px] text-ink-muted">
                    الجهة
                  </th>
                  {agingBucketLabels.map((label) => (
                    <th
                      key={label}
                      className="border-b border-border bg-surface-2 px-[10px] py-[8px] text-end text-[10.5px] font-bold uppercase tracking-[0.2px] text-ink-muted"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agingRows.map((row) => (
                  <tr key={row.key} className="border-b border-border last:border-b-0">
                    <td className="px-[10px] py-[9px] font-semibold text-ink">{row.entity}</td>
                    {row.buckets.map((amount, i) => (
                      <td key={agingBucketLabels[i]} className="px-[10px] py-[9px] text-end">
                        <Money value={amount} showUnit={false} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-[6px] mt-[20px] font-display text-[14.5px] font-bold text-ink">النشاط الأخير</h3>
          <div className="mb-[10px] text-[11.5px] text-ink-faint">ما يحدث في النظام</div>
          <ul className="flex flex-col gap-[10px]">
            {recentActivity.map((entry) => (
              <li key={entry.key} className="flex items-start gap-[10px]">
                <span aria-hidden className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-brand" />
                <div>
                  <div className="text-[12.5px] text-ink">{entry.text}</div>
                  <div className="mt-[1px] text-[11px] text-ink-faint">{entry.when}</div>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-[12px]">
            عرض الكل
          </Button>
        </Card>

        <div className="flex flex-col gap-[16px]">
          <DonutChart
            title="توزيع المصروفات"
            hint="نسبة كل فئة"
            segments={expenseBreakdown.segments}
            centerLabel={expenseBreakdown.centerLabel}
            centerSub={expenseBreakdown.centerSub}
            rangeOptions={[...expenseBreakdownRangeOptions]}
            activeRange={expenseRange}
            onRangeChange={setExpenseRange}
          />

          <Card className="p-[18px_20px]">
            <div className="flex flex-wrap items-center justify-between gap-[10px]">
              <h3 className="font-display text-[14.5px] font-bold text-ink">الأصناف الأعلى مبيعاً</h3>
              <Button size="sm" variant="ghost">
                الكل
              </Button>
            </div>

            <div className="mt-[10px] flex flex-wrap gap-[6px]" role="group" aria-label="نطاق التاريخ · الأصناف الأعلى مبيعاً">
              {rankListDateRangeOptions.map((opt) => (
                <Chip key={opt.value} type="button" active={itemsRange === opt.value} onClick={() => setItemsRange(opt.value)}>
                  {opt.label}
                </Chip>
              ))}
            </div>
            <div className="mt-[6px] flex flex-wrap gap-[6px]" role="group" aria-label="خيارات العرض · الأصناف الأعلى مبيعاً">
              <Chip type="button" active={itemsSort === "value"} onClick={() => setItemsSort("value")}>
                بالقيمة
              </Chip>
              <Chip type="button" active={itemsSort === "qty"} onClick={() => setItemsSort("qty")}>
                بالكمية
              </Chip>
              <Chip type="button" active={itemsTaxMode === "inc"} onClick={() => setItemsTaxMode("inc")}>
                شامل الضريبة
              </Chip>
              <Chip type="button" active={itemsTaxMode === "exc"} onClick={() => setItemsTaxMode("exc")}>
                غير شامل الضريبة
              </Chip>
            </div>

            <ol className="mt-[14px] flex flex-col gap-[9px]">
              {sortedItems.map((row, index) => (
                <li key={row.key} className="flex items-center gap-[10px] text-[12.5px]">
                  <span className="flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-muted">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate text-ink">{row.name}</span>
                  <span className="mz-num text-ink-faint">{row.qty} وحدة</span>
                  <Money value={itemsTaxMode === "inc" ? row.revenueIncTax : taxExclusive(row.revenueIncTax)} />
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Card className="p-[18px_20px]">
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <h3 className="font-display text-[14.5px] font-bold text-ink">أعلى العملاء مبيعاً</h3>
          <Button size="sm" variant="ghost">
            الكل
          </Button>
        </div>

        <div className="mt-[10px] flex flex-wrap gap-[6px]" role="group" aria-label="خيارات العرض · أعلى العملاء مبيعاً">
          {rankListDateRangeOptions.map((opt) => (
            <Chip key={opt.value} type="button" active={customersRange === opt.value} onClick={() => setCustomersRange(opt.value)}>
              {opt.label}
            </Chip>
          ))}
          <Chip type="button" active={customersTaxMode === "inc"} onClick={() => setCustomersTaxMode("inc")}>
            شامل الضريبة
          </Chip>
          <Chip type="button" active={customersTaxMode === "exc"} onClick={() => setCustomersTaxMode("exc")}>
            غير شامل الضريبة
          </Chip>
        </div>

        <ol className="mt-[14px] grid grid-cols-1 gap-[9px] sm:grid-cols-2">
          {topCustomers.map((row, index) => (
            <li key={row.key} className="flex items-center gap-[10px] text-[12.5px]">
              <span className="flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-muted">
                {index + 1}
              </span>
              <span className="flex-1 truncate text-ink">{row.name}</span>
              <span className="mz-num text-ink-faint">{row.invoiceCount} فاتورة</span>
              <Money value={customersTaxMode === "inc" ? row.revenueIncTax : taxExclusive(row.revenueIncTax)} />
            </li>
          ))}
        </ol>
      </Card>

      <p className="text-[11px] text-ink-faint">{dashboardFooterDisclaimer}</p>
    </div>
  );
}
