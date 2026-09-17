import { Fragment, type ReactNode } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";

/**
 * A long document table that paginates the way a measured document has to.
 *
 * A مستخلص runs to dozens of BOQ lines and is signed page by page, so every
 * page has to carry the identity header, the page number, and — this is the
 * part a generic table never does — the running subtotal: «ما قبله» as the
 * first row of every page after the first, «يُرحل» as the last row of every
 * page before the last. Without those two rows a reader cannot check one page
 * against the next, which is exactly what the consultant does before signing.
 *
 * The signature block belongs to the document, not to a page, so it renders on
 * the FINAL page only.
 */

export interface PaginatedTableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly align?: "start" | "end" | "center";
  readonly render: (row: Row, index: number) => ReactNode;
  /**
   * The value that accumulates into «ما قبله» / «يُرحل», as an exact decimal
   * string. A column without one prints an empty carry cell — a page total
   * under a percentage column would be arithmetic nobody asked for.
   */
  readonly carry?: (row: Row) => string;
}

export interface PaginatedTableProps<Row> {
  readonly columns: readonly PaginatedTableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly rowKey: (row: Row, index: number) => string;
  /** Rows per printed page. */
  readonly rowsPerPage?: number;
  /** Repeated at the top of every page. */
  readonly identityHeader: ReactNode;
  /** Rendered after the last row of the LAST page — the totals block. */
  readonly footer?: ReactNode;
  /** Rendered at the very bottom of the last page only — the signatures. */
  readonly signatures?: ReactNode;
  readonly accentColor?: string;
  readonly className?: string;
}

const SCALE = 1_000_000n;

function parseDecimal(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return 0n;
  const frac = ((match[3] ?? "") + "000000").slice(0, 6);
  const scaled = BigInt(match[2] ?? "0") * SCALE + BigInt(frac);
  return match[1] === "-" ? -scaled : scaled;
}

function formatDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / SCALE;
  const cents = (abs % SCALE) / 10_000n;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${cents.toString().padStart(2, "0")}`;
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  if (rows.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export function PaginatedTable<Row>({
  columns,
  rows,
  rowKey,
  rowsPerPage = 22,
  identityHeader,
  footer,
  signatures,
  accentColor,
  className,
}: PaginatedTableProps<Row>) {
  const { t } = useTranslation();
  const pages = chunk(rows, Math.max(1, rowsPerPage));

  // The running carry is computed once over the whole list, so page n's
  // «ما قبله» is by construction page n−1's «يُرحل» — they can never disagree.
  let consumed = 0;
  const pageCarries = pages.map((pageRows) => {
    const before = rows.slice(0, consumed);
    consumed += pageRows.length;
    const through = rows.slice(0, consumed);
    return {
      brought: columns.map((col) => (col.carry ? before.reduce((acc, r) => acc + parseDecimal(col.carry!(r)), 0n) : null)),
      carried: columns.map((col) => (col.carry ? through.reduce((acc, r) => acc + parseDecimal(col.carry!(r)), 0n) : null)),
    };
  });

  return (
    <div className={cn("flex flex-col gap-[16px]", className)}>
      {pages.map((pageRows, pageIndex) => {
        const isFirst = pageIndex === 0;
        const isLast = pageIndex === pages.length - 1;
        const carry = pageCarries[pageIndex];
        return (
          <section
            key={`page-${pageIndex}`}
            className={cn("flex flex-col gap-[10px]", !isLast && "break-after-page")}
          >
            {identityHeader}
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y-2" style={{ borderColor: accentColor }}>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "p-[6px_8px] font-semibold",
                        col.align === "end" ? "text-end" : col.align === "center" ? "text-center" : "text-start",
                      )}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!isFirst ? (
                  <tr className="border-b border-border bg-surface-2 font-semibold">
                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={cn("p-[6px_8px]", col.align === "end" ? "mz-num text-end" : "text-start")}
                      >
                        {i === 0
                          ? t("print.page.carriedForward")
                          : carry?.brought[i] !== null && carry?.brought[i] !== undefined
                            ? formatDecimal(carry.brought[i] as bigint)
                            : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
                {pageRows.map((row, i) => (
                  <tr key={rowKey(row, pageIndex * rowsPerPage + i)} className="border-b border-border">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={cn(
                          "p-[6px_8px]",
                          col.align === "end" ? "text-end" : col.align === "center" ? "text-center" : "text-start",
                        )}
                      >
                        {col.render(row, pageIndex * rowsPerPage + i)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!isLast ? (
                  <tr className="border-y-2 bg-surface-2 font-semibold" style={{ borderColor: accentColor }}>
                    {columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={cn("p-[6px_8px]", col.align === "end" ? "mz-num text-end" : "text-start")}
                      >
                        {i === 0
                          ? t("print.page.carriedTo")
                          : carry?.carried[i] !== null && carry?.carried[i] !== undefined
                            ? formatDecimal(carry.carried[i] as bigint)
                            : ""}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>

            {isLast ? <Fragment>{footer}</Fragment> : null}

            <div className="mt-auto flex items-center justify-between pt-[6px] text-[10px] text-ink-faint">
              <span className="mz-num">
                {t("print.page.indicator", { page: String(pageIndex + 1), pages: String(pages.length) })}
              </span>
            </div>

            {isLast ? <Fragment>{signatures}</Fragment> : null}
          </section>
        );
      })}
    </div>
  );
}
