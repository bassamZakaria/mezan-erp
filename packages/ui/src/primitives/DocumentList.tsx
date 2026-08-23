import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Card, Chip, StatCard } from "./atoms";

/**
 * DocumentList — the reusable list-page pattern (KPI strip + status chips +
 * filter bar + sortable table + pager). This is the single shape reused
 * across ~40 "list of documents" screens (invoices, journals, customers…),
 * per design/mezan-ui-mockups.html's `pattern-list` section.
 */

export interface DocumentListColumn<Row> {
  key: string;
  header: ReactNode;
  align?: "start" | "end";
  sortable?: boolean;
  render: (row: Row) => ReactNode;
}

export interface DocumentListStat {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: "up" | "down" | "neutral";
  valueTone?: "default" | "danger";
}

export interface DocumentListStatusChip {
  key: string;
  label: string;
  count: number;
}

export interface DocumentListSort {
  key: string;
  direction: "asc" | "desc";
}

export interface DocumentListProps<Row> {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: DocumentListStat[];
  statusChips?: DocumentListStatusChip[];
  activeStatusKey?: string;
  onStatusChange?: (key: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filterBarExtra?: ReactNode;
  columns: DocumentListColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  sort?: DocumentListSort;
  onSortChange?: (key: string) => void;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  pageSummary?: ReactNode;
  emptyState?: ReactNode;
  className?: string;
}

function getPageItems(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items = new Set<number>([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = [...items].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push("ellipsis");
    out.push(n);
    prev = n;
  }
  return out;
}

export function DocumentList<Row>({
  eyebrow,
  title,
  description,
  actions,
  stats,
  statusChips,
  activeStatusKey,
  onStatusChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filterBarExtra,
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  onSortChange,
  page,
  pageCount,
  onPageChange,
  pageSummary,
  emptyState,
  className,
}: DocumentListProps<Row>) {
  const { t } = useUiTranslation();
  const searchLabel = searchPlaceholder ?? t("ui.search.placeholder");
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          {eyebrow ? (
            <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{title}</h1>
          {description ? <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-[9px]">{actions}</div> : null}
      </div>

      {stats && stats.length > 0 ? (
        <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
          {stats.map((stat, i) => (
            <StatCard key={i} label={stat.label} value={stat.value} sub={stat.sub} subTone={stat.subTone} valueTone={stat.valueTone} />
          ))}
        </div>
      ) : null}

      {statusChips && statusChips.length > 0 ? (
        <div className="mb-[16px] flex flex-wrap gap-[8px]" role="tablist" aria-label={t("ui.list.statusFilter")}>
          {statusChips.map((chip) => (
            <Chip
              key={chip.key}
              role="tab"
              aria-selected={activeStatusKey === chip.key}
              active={activeStatusKey === chip.key}
              count={chip.count}
              onClick={() => onStatusChange?.(chip.key)}
            >
              {chip.label}
            </Chip>
          ))}
        </div>
      ) : null}

      {onSearchChange || filterBarExtra ? (
        <div className="mb-[14px] flex flex-wrap gap-[10px]">
          {onSearchChange ? (
            <div className="flex min-w-[240px] flex-1 items-center gap-[9px] rounded-md border border-border bg-surface px-[13px] py-[9px] focus-within:border-brand">
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none text-ink-faint">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
                <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchLabel}
                aria-label={searchLabel}
                className="w-full border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          ) : null}
          {filterBarExtra}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr>
                {columns.map((col) => {
                  const isSorted = sort?.key === col.key;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={isSorted ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted",
                        col.align === "end" ? "text-end" : "text-start",
                        col.sortable && "cursor-pointer select-none",
                      )}
                      onClick={col.sortable ? () => onSortChange?.(col.key) : undefined}
                    >
                      {col.header}
                      {col.sortable ? (
                        <span aria-hidden className="ms-[5px] text-[10px] text-ink-faint">
                          {isSorted ? (sort?.direction === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-b border-border last:border-b-0 transition-colors",
                    onRowClick && "cursor-pointer hover:bg-surface-2",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-[15px] py-[12px] align-middle", col.align === "end" ? "text-end" : "text-start")}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && emptyState ? <div className="p-[16px]">{emptyState}</div> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[10px] border-t border-border px-[16px] py-[13px] text-xs text-ink-muted">
          <span>{pageSummary}</span>
          {pageCount > 1 ? (
            <nav aria-label={t("ui.list.pagination")} className="flex gap-[4px]">
              {getPageItems(page, pageCount).map((item, i) =>
                item === "ellipsis" ? (
                  <span key={`ellipsis-${i}`} className="flex h-[30px] min-w-[30px] items-center justify-center text-ink-faint">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    aria-current={item === page ? "page" : undefined}
                    onClick={() => onPageChange?.(item)}
                    className={cn(
                      "h-[30px] min-w-[30px] rounded-sm border px-[6px] text-xs",
                      item === page
                        ? "border-brand bg-brand font-semibold text-brand-ink"
                        : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
                    )}
                  >
                    {item}
                  </button>
                ),
              )}
            </nav>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
