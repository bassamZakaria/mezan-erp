import { useFormat } from "@mezan/ui";

/** الأصناف الأعلى مبيعاً — ranked list with mono figures (spec §6). */

export interface TopItemRow {
  readonly key: string;
  readonly rank: number;
  readonly name: string;
  readonly qty: number;
  readonly revenue: number;
  readonly sharePercent: number;
}

export interface TopItemsProps {
  readonly rows: readonly TopItemRow[];
  readonly qtyUnitLabel: string;
  readonly emptyLabel: string;
}

export function TopItems({ rows, qtyUnitLabel, emptyLabel }: TopItemsProps) {
  const format = useFormat();

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <ol className="flex flex-col gap-[10px]">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-center gap-[10px]">
            <span className="mz-num grid h-[22px] w-[22px] flex-none place-items-center rounded-sm bg-brand-soft text-[11px] font-bold text-brand">
              {format.number(row.rank)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
            <span className="flex-none text-2xs text-ink-faint">
              <span className="mz-num">{format.number(row.qty)}</span> {qtyUnitLabel}
            </span>
            <span className="mz-num w-[86px] flex-none text-end text-sm font-semibold text-ink">{format.money(row.revenue)}</span>
          </div>
          <div className="ms-[32px] mt-[5px] h-[3px] overflow-hidden rounded-pill bg-surface-3">
            <div
              className="h-full rounded-pill bg-chart-1"
              style={{ width: `${Math.max(2, Math.min(100, row.sharePercent)).toFixed(2)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
