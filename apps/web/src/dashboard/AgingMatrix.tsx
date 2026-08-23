import { useFormat } from "@mezan/ui";

/**
 * أعمار الأرصدة — the aging heat matrix (spec §6). Older buckets tint warmer,
 * and the tint strength also tracks the amount, so the eye lands on the oldest
 * large balance first. A zero bucket is rendered plainly, never tinted.
 */

const BUCKET_HUE = ["var(--info)", "var(--accent)", "var(--warning)", "var(--danger)", "var(--danger)"] as const;
const BUCKET_INK = ["var(--info-ink)", "var(--accent-strong)", "var(--warning-ink)", "var(--danger-ink)", "var(--danger-ink)"] as const;
const BUCKET_MAX_MIX = [13, 19, 25, 32, 40] as const;

export interface AgingMatrixRow {
  readonly key: string;
  readonly label: string;
  readonly buckets: readonly number[];
}

export interface AgingMatrixProps {
  readonly partyHeader: string;
  readonly bucketLabels: readonly string[];
  readonly rows: readonly AgingMatrixRow[];
  readonly emptyLabel: string;
}

export function AgingMatrix({ partyHeader, bucketLabels, rows, emptyLabel }: AgingMatrixProps) {
  const format = useFormat();
  const peak = Math.max(0, ...rows.flatMap((row) => row.buckets.map((value) => Math.abs(value))));

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-2xs">
        <thead>
          <tr>
            <th scope="col" className="pb-[8px] text-start font-semibold text-ink-faint">
              {partyHeader}
            </th>
            {bucketLabels.map((label) => (
              <th key={label} scope="col" className="pb-[8px] text-center font-semibold text-ink-faint">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="whitespace-nowrap pe-[10px] py-[3px] text-start text-sm font-semibold text-ink">
                {row.label}
              </th>
              {row.buckets.map((value, index) => {
                const share = peak > 0 ? Math.abs(value) / peak : 0;
                const mix = (0.4 + 0.6 * share) * (BUCKET_MAX_MIX[index] ?? 40);
                const hot = value !== 0;
                return (
                  <td key={bucketLabels[index] ?? index} className="p-[3px]">
                    <span
                      className="mz-num block rounded-sm px-[8px] py-[6px] text-center font-semibold"
                      style={
                        hot
                          ? {
                              background: `color-mix(in oklab, ${BUCKET_HUE[index] ?? BUCKET_HUE[4]} ${mix.toFixed(1)}%, var(--surface))`,
                              color: BUCKET_INK[index] ?? BUCKET_INK[4],
                            }
                          : { background: "var(--surface-2)", color: "var(--text-faint)" }
                      }
                    >
                      {format.money(value)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
