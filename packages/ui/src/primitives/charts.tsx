import { cn } from "../lib/cn";
import { useTranslation } from "../i18n";
import { formatNumber } from "../lib/format";
import { Card } from "./atoms";

/**
 * Dashboard chart primitives — inline SVG line/area chart + a CSS
 * conic-gradient donut, matching the approach docs/archive/mezan-ui-mockups.html
 * uses for the لوحة التحكم dashboard (no charting library dependency).
 */

export interface ChartRangeOption {
  value: string;
  label: string;
}

function RangeToggle({
  ariaLabel,
  options,
  activeValue,
  onChange,
}: {
  ariaLabel: string;
  options: ChartRangeOption[];
  activeValue?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-[2px] rounded-md border border-border p-[2px]" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={activeValue === opt.value}
          onClick={() => onChange?.(opt.value)}
          className={cn(
            "rounded-[5px] px-[10px] py-[5px] text-[11.5px] font-semibold transition-colors",
            activeValue === opt.value ? "bg-brand text-brand-ink" : "text-ink-muted hover:bg-surface-2",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TrendChart — line/area chart (أداء الفترة)                          */
/* ------------------------------------------------------------------ */

export interface TrendChartSeries {
  key: string;
  label: string;
  /** CSS color, typically a `var(--chart-N)` token. */
  color: string;
  values: number[];
}

export interface TrendChartProps {
  title: string;
  hint?: string;
  /** X-axis category labels (e.g. month names), same length as each series' values. */
  categories: string[];
  series: TrendChartSeries[];
  /** Index from which the line renders dashed — the mockup's "current, partial period" convention. */
  partialFromIndex?: number;
  rangeOptions?: ChartRangeOption[];
  activeRange?: string;
  onRangeChange?: (value: string) => void;
  height?: number;
  className?: string;
}

const VIEW_WIDTH = 560;

interface Point {
  x: number;
  y: number;
}

function buildScale(series: TrendChartSeries[], height: number): (value: number) => number {
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const paddingY = 16;
  const usable = height - paddingY * 2;
  return (value: number) => paddingY + usable - ((value - min) / span) * usable;
}

function buildPoints(values: number[], scaleY: (v: number) => number): Point[] {
  const stepX = values.length > 1 ? VIEW_WIDTH / (values.length - 1) : 0;
  return values.map((v, i) => ({ x: i * stepX, y: scaleY(v) }));
}

function pathFrom(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** أداء الفترة — revenue/expenses/net-profit trend line chart, `GET /api/dashboard/revenue-trend`. */
export function TrendChart({
  title,
  hint,
  categories,
  series,
  partialFromIndex,
  rangeOptions,
  activeRange,
  onRangeChange,
  height = 210,
  className,
}: TrendChartProps) {
  const { t } = useTranslation();
  const scaleY = buildScale(series, height);
  const gridLines = [0.19, 0.43, 0.67, 0.9].map((f) => f * height);

  return (
    <Card className={cn("p-[18px_20px]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
          {hint ? <div className="mt-[2px] text-[11.5px] text-ink-faint">{hint}</div> : null}
        </div>
        {rangeOptions && rangeOptions.length > 0 ? (
          <RangeToggle ariaLabel={title} options={rangeOptions} activeValue={activeRange} onChange={onRangeChange} />
        ) : null}
      </div>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        width="100%"
        height={height}
        className="mt-[14px] overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        {gridLines.map((y) => (
          <line key={y} x1={0} y1={y} x2={VIEW_WIDTH} y2={y} stroke="var(--border)" strokeWidth={1} />
        ))}
        {series.map((s) => {
          const points = buildPoints(s.values, scaleY);
          const splitIndex =
            partialFromIndex !== undefined && partialFromIndex > 0 && partialFromIndex < points.length ? partialFromIndex : null;
          const solidPoints = splitIndex ? points.slice(0, splitIndex + 1) : points;
          const dashedPoints = splitIndex ? points.slice(splitIndex) : [];
          return (
            <g key={s.key}>
              <path d={pathFrom(solidPoints)} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              {dashedPoints.length > 1 ? (
                <path
                  d={pathFrom(dashedPoints)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeDasharray="5 5"
                />
              ) : null}
              {points.map((p, i) => {
                const isLast = i === points.length - 1;
                return (
                  <circle
                    key={categories[i] ?? i}
                    cx={p.x}
                    cy={p.y}
                    r={isLast ? 4.5 : 3.5}
                    fill={s.color}
                    stroke={isLast ? "var(--surface)" : undefined}
                    strokeWidth={isLast ? 2 : 0}
                  >
                    <title>{`${s.label} · ${categories[i] ?? ""} · ${formatNumber(s.values[i] ?? 0)}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>

      <div className="mt-[12px] flex flex-wrap gap-[16px]">
        {series.map((s) => (
          <div key={s.key} className="flex items-center gap-[7px] text-[12px] font-medium text-ink-muted">
            <span aria-hidden className="h-[9px] w-[9px] rounded-full" style={{ background: s.color }} />
            {s.label}
          </div>
        ))}
      </div>

      {/* Screen-reader / test-queryable data table mirroring the chart. */}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t("charts.period")}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat, i) => (
            <tr key={cat}>
              <td>{cat}</td>
              {series.map((s) => (
                <td key={s.key}>{formatNumber(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* DonutChart — توزيع المصروفات                                        */
/* ------------------------------------------------------------------ */

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  title: string;
  hint?: string;
  segments: DonutSegment[];
  centerLabel: string;
  centerSub?: string;
  rangeOptions?: ChartRangeOption[];
  activeRange?: string;
  onRangeChange?: (value: string) => void;
  size?: number;
  className?: string;
}

function buildConicGradient(segments: DonutSegment[], total: number): string {
  if (total <= 0) return "conic-gradient(var(--surface-3) 0 100%)";
  let cursor = 0;
  const stops = segments.map((s) => {
    const start = cursor;
    const pct = (s.value / total) * 100;
    cursor += pct;
    return `${s.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

/** توزيع المصروفات — expense-breakdown donut, `GET /api/dashboard/expense-breakdown`. */
export function DonutChart({
  title,
  hint,
  segments,
  centerLabel,
  centerSub,
  rangeOptions,
  activeRange,
  onRangeChange,
  size = 132,
  className,
}: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className={cn("p-[18px_20px]", className)}>
      <div className="flex flex-wrap items-start justify-between gap-[12px]">
        <div>
          <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
          {hint ? <div className="mt-[2px] text-[11.5px] text-ink-faint">{hint}</div> : null}
        </div>
        {rangeOptions && rangeOptions.length > 0 ? (
          <RangeToggle ariaLabel={title} options={rangeOptions} activeValue={activeRange} onChange={onRangeChange} />
        ) : null}
      </div>

      <div className="mt-[16px] flex items-center gap-[22px]">
        <div
          role="img"
          aria-label={`${title} — ${centerLabel}${centerSub ? ` ${centerSub}` : ""}`}
          style={{ width: size, height: size, background: buildConicGradient(segments, total) }}
          className="relative grid flex-none place-items-center rounded-full"
        >
          <div className="grid h-[68%] w-[68%] place-items-center rounded-full bg-surface text-center">
            <div>
              <div className="mz-num font-display text-[15px] font-bold text-ink">{centerLabel}</div>
              {centerSub ? <div className="mt-[1px] text-[10px] text-ink-faint">{centerSub}</div> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-[9px]">
          {segments.map((s) => {
            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
            return (
              <div key={s.key} className="flex items-center gap-[8px] text-[12px]">
                <span aria-hidden className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: s.color }} />
                <span className="flex-1 truncate text-ink-muted">{s.label}</span>
                <span className="mz-num font-semibold text-ink">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
