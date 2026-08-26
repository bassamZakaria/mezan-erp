import { useState } from "react";
import { Card } from "./atoms";
import { DonutChart } from "./charts";
import { cn } from "../lib/cn";
import { useFormat } from "../hooks/useFormat";
import { useUiTranslation } from "../i18n";

export interface ReportChartPoint {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export type ReportChartView = "bar" | "pie" | "table" | "hidden";

export interface ReportChartProps {
  title: string;
  points: readonly ReportChartPoint[];
  /** How to read it (R21.3). A chart nobody can read is decoration. */
  caption?: string;
  /** Which view opens first. Bar unless the report says otherwise. */
  defaultView?: ReportChartView;
  className?: string;
}

/**
 * A report's chart, with the view toggles on the card itself (R21.4): bar,
 * pie, the same numbers as a table, or hidden.
 *
 * The table view is not a fallback — it is the view someone reaches for when
 * they want to read the figures rather than compare them, and a chart that
 * cannot be turned back into numbers hides its own data.
 *
 * Bars are plain elements rather than SVG so they inherit the theme tokens and
 * survive the RTL flip without a transform.
 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

const VIEWS: readonly { view: ReportChartView; labelKey: "ui.chart.bar" | "ui.chart.pie" | "ui.chart.table" | "ui.chart.hide" }[] = [
  { view: "bar", labelKey: "ui.chart.bar" },
  { view: "pie", labelKey: "ui.chart.pie" },
  { view: "table", labelKey: "ui.chart.table" },
  { view: "hidden", labelKey: "ui.chart.hide" },
];

export function ReportChart({ title, points, caption, defaultView = "bar", className }: ReportChartProps) {
  const { t } = useUiTranslation();
  const fmt = useFormat();
  const [view, setView] = useState<ReportChartView>(defaultView);

  if (points.length === 0) return null;

  const total = points.reduce((sum, point) => sum + Math.abs(point.value), 0);
  // Scaled against the largest MAGNITUDE so a negative bar is still visible;
  // scaling against the largest value would collapse every bar on a report
  // whose top row happens to be a refund.
  const peak = points.reduce((max, point) => Math.max(max, Math.abs(point.value)), 0);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-border bg-surface-2 px-[16px] py-[9px]">
        <span className="text-[12.5px] font-bold text-ink">{title}</span>
        <div className="flex gap-[4px]">
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              aria-pressed={view === option.view}
              onClick={() => setView(option.view)}
              className={cn(
                "rounded-md border px-[9px] py-[3px] text-[11px] font-semibold transition-colors",
                view === option.view
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border bg-surface text-ink-muted hover:border-brand hover:text-brand",
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {view === "hidden" ? null : (
        <div className="p-[14px_16px]">
          {view === "bar" ? (
            <div className="flex flex-col gap-[7px]">
              {points.map((point, index) => (
                <div key={point.key} className="flex items-center gap-[10px]">
                  <span className="w-[26%] shrink-0 truncate text-[12px] text-ink-muted" title={point.label}>
                    {point.label}
                  </span>
                  <span className="h-[14px] flex-1 overflow-hidden rounded-sm bg-surface-2">
                    <span
                      className="block h-full rounded-sm"
                      style={{
                        inlineSize: peak > 0 ? `${(Math.abs(point.value) / peak) * 100}%` : "0%",
                        background: CHART_COLORS[index % CHART_COLORS.length],
                      }}
                    />
                  </span>
                  <span className="mz-num w-[22%] shrink-0 text-end text-[12px] font-semibold text-ink">
                    {fmt.money(point.value)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {view === "pie" ? (
            <DonutChart
              title=""
              segments={points.map((point, index) => ({
                key: point.key,
                label: point.label,
                value: Math.abs(point.value),
                color: CHART_COLORS[index % CHART_COLORS.length]!,
              }))}
              centerLabel={fmt.money(total)}
              centerSub={t("ui.chart.total")}
            />
          ) : null}

          {view === "table" ? (
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {points.map((point) => (
                  <tr key={point.key} className="border-b border-border last:border-b-0">
                    <td className="py-[6px] text-ink">{point.label}</td>
                    <td className="mz-num py-[6px] text-end font-semibold text-ink">{fmt.money(point.value)}</td>
                    <td className="mz-num w-[64px] py-[6px] text-end text-ink-muted">
                      {total > 0 ? `${fmt.number((Math.abs(point.value) / total) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {caption ? <p className="mt-[8px] text-[11.5px] text-ink-muted">{caption}</p> : null}
        </div>
      )}
    </Card>
  );
}
