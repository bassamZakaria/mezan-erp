import { useFormat } from "@mezan/ui";

/**
 * توزيع المصروفات — labelled donut with a readout centre (spec §6), drawn as
 * inline SVG arcs so it needs no charting dependency. Segments are the expense
 * accounts of the period's income statement; percentages are of their total.
 */

const RADIUS = 52;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const HUES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export interface ExpenseDonutProps {
  readonly slices: readonly DonutSlice[];
  readonly centreCaption: string;
  readonly emptyLabel: string;
}

export function ExpenseDonut({ slices, centreCaption, emptyLabel }: ExpenseDonutProps) {
  const format = useFormat();
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  if (total <= 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }

  let offset = 0;
  const arcs = slices.map((slice, index) => {
    const length = (slice.value / total) * CIRCUMFERENCE;
    const arc = { key: slice.key, color: HUES[index % HUES.length] ?? HUES[0], length, offset };
    offset += length;
    return arc;
  });

  return (
    <div className="flex flex-wrap items-center gap-[22px]">
      <div className="relative flex-none">
        <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label={centreCaption}>
          <g transform="rotate(-90 70 70)">
            <circle cx="70" cy="70" r={RADIUS} fill="none" stroke="var(--surface-3)" strokeWidth={STROKE} />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx="70"
                cy="70"
                r={RADIUS}
                fill="none"
                stroke={arc.color}
                strokeWidth={STROKE}
                strokeDasharray={`${arc.length.toFixed(2)} ${(CIRCUMFERENCE - arc.length).toFixed(2)}`}
                strokeDashoffset={(-arc.offset).toFixed(2)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="mz-num text-xs font-semibold text-ink">{format.money(total)}</div>
            <div className="mt-[1px] text-[10px] text-ink-faint">{centreCaption}</div>
          </div>
        </div>
      </div>
      <ul className="flex min-w-[190px] flex-1 flex-col gap-[9px]">
        {arcs.map((arc, index) => {
          const slice = slices[index];
          if (!slice) return null;
          return (
            <li key={arc.key} className="flex items-center gap-[9px] text-xs">
              <span aria-hidden className="h-[9px] w-[9px] flex-none rounded-sm" style={{ background: arc.color }} />
              <span className="min-w-0 flex-1 truncate text-ink-muted">{slice.label}</span>
              <span className="mz-num font-semibold text-ink">{format.money(slice.value)}</span>
              <span className="mz-num w-[42px] text-end text-ink-faint">
                {format.number(Math.round((slice.value / total) * 100))}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
