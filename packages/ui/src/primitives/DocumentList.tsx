import { Fragment } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Card, Chip, StatCard } from "./atoms";
import { SearchInput } from "./form";
import { Select } from "./Select";
import { FulcrumRule } from "../shell/FulcrumRule";

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
  /**
   * Figure column — mono + `tabular-nums` so digits line up. Defaults to true
   * for `align: "end"`; pass `false` for an end-aligned column of prose.
   */
  numeric?: boolean;
  /** Renders this column's cell in the faint total footer. Omit for no footer cell. */
  total?: (rows: readonly Row[]) => ReactNode;
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
  rowKey: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  /**
   * Detail panel shown beneath an expanded row — a per-warehouse breakdown, a
   * document's lines. Return null for a row with nothing to expand, and it
   * stays un-expandable rather than opening onto an empty panel.
   */
  renderExpandedRow?: (row: Row) => ReactNode | null;
  /** Row keys currently expanded. The caller owns the state. */
  expandedKeys?: readonly string[];
  /**
   * Trailing action revealed on the hovered (or keyboard-focused) row.
   * Defaults to a "عرض" button wired to `onRowClick` when that is present.
   */
  rowAction?: (row: Row) => ReactNode;
  sort?: DocumentListSort;
  onSortChange?: (key: string) => void;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  pageSummary?: ReactNode;
  /**
   * Rows per page. Supplying it renders the shared page-size selector in the
   * footer, so every list offers the same 10/25/50/100 the reference does
   * (docs/reference-parity/audit/REQUIREMENTS.md R1.12) instead of each screen
   * growing its own.
   */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  emptyState?: ReactNode;
  className?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

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
  renderExpandedRow,
  expandedKeys,
  rowAction,
  sort,
  onSortChange,
  page,
  pageCount,
  onPageChange,
  pageSummary,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  emptyState,
  className,
}: DocumentListProps<Row>) {
  const { t } = useUiTranslation();
  const searchLabel = searchPlaceholder ?? t("ui.search.placeholder");
  const showRowAction = Boolean(rowAction ?? onRowClick);
  const footerColumns = columns.filter((col) => col.total);
  const totalLabelIndex = columns.findIndex((col) => !col.total);
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          {title ? <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{title}</h1> : null}
          {description ? <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-[9px]">{actions}</div> : null}
      </div>
      <FulcrumRule />

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
            <SearchInput
              className="min-w-[240px] flex-1"
              value={searchValue ?? ""}
              onValueChange={onSearchChange}
              placeholder={searchLabel}
              aria-label={searchLabel}
            />
          ) : null}
          {filterBarExtra}
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-md">
        <div className="max-h-[min(68vh,760px)] overflow-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {columns.map((col) => {
                  const isSorted = sort?.key === col.key;
                  const sortColumn = col.sortable ? () => onSortChange?.(col.key) : undefined;
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={isSorted ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined}
                      tabIndex={col.sortable ? 0 : undefined}
                      title={col.sortable ? t("ui.list.sortColumn") : undefined}
                      className={cn(
                        "sticky top-0 z-20 whitespace-nowrap border-b border-border bg-surface-2 px-[14px] py-[9px] text-[11.5px] font-bold uppercase tracking-[0.3px] text-ink-muted",
                        col.align === "end" ? "text-end" : "text-start",
                        col.sortable && "cursor-pointer select-none hover:text-ink",
                      )}
                      onClick={sortColumn}
                      onKeyDown={
                        sortColumn
                          ? (e: KeyboardEvent<HTMLTableCellElement>) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                sortColumn();
                              }
                            }
                          : undefined
                      }
                    >
                      {col.header}
                      {col.sortable ? (
                        <span
                          aria-hidden
                          className={cn("ms-[5px] text-[10px]", isSorted ? "text-accent-strong" : "text-ink-faint")}
                        >
                          {isSorted ? (sort?.direction === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      ) : null}
                    </th>
                  );
                })}
                {showRowAction ? (
                  <th scope="col" className="sticky top-0 z-20 w-px border-b border-border bg-surface-2 px-[14px] py-[9px]">
                    <span className="sr-only">{t("ui.list.rowAction")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const key = rowKey(row, rowIndex);
                const expansion = renderExpandedRow?.(row);
                const isExpanded = expansion !== undefined && expansion !== null && expandedKeys?.includes(key) === true;
                return (
                <Fragment key={key}>
                <tr
                  className={cn(
                    "group/row h-[36px] transition-colors even:bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)]",
                    onRowClick && "cursor-pointer hover:bg-surface-2",
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-[14px] py-[6px] align-middle",
                        col.align === "end" ? "text-end" : "text-start",
                        (col.numeric ?? col.align === "end") && "font-mono tabular-nums",
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                  {showRowAction ? (
                    <td className="w-px px-[14px] py-[6px] text-end align-middle">
                      <span className="inline-flex opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none">
                        {rowAction ? (
                          rowAction(row)
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRowClick?.(row);
                            }}
                            className="inline-flex items-center rounded-sm border border-border-strong bg-surface px-[9px] py-[3px] text-2xs font-semibold text-ink-muted transition-colors hover:border-brand hover:text-brand"
                          >
                            {t("ui.list.rowAction")}
                          </button>
                        )}
                      </span>
                    </td>
                  ) : null}
                </tr>
                {isExpanded ? (
                  <tr className="bg-surface-2">
                    <td colSpan={columns.length + (showRowAction ? 1 : 0)} className="px-[14px] py-[10px]">
                      {expansion}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
            </tbody>
            {rows.length > 0 && footerColumns.length > 0 ? (
              <tfoot>
                <tr>
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      className={cn(
                        "sticky bottom-0 z-10 whitespace-nowrap border-t border-border-strong bg-surface-2 px-[14px] py-[8px] text-xs font-bold text-ink-muted",
                        col.align === "end" ? "text-end" : "text-start",
                        (col.numeric ?? col.align === "end") && "font-mono tabular-nums",
                      )}
                    >
                      {col.total ? col.total(rows) : i === totalLabelIndex ? t("ui.list.pageTotal") : null}
                    </td>
                  ))}
                  {showRowAction ? (
                    <td className="sticky bottom-0 z-10 border-t border-border-strong bg-surface-2 px-[14px] py-[8px]" />
                  ) : null}
                </tr>
              </tfoot>
            ) : null}
          </table>

          {rows.length === 0 && emptyState ? <div className="p-[16px]">{emptyState}</div> : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-[10px] border-t border-border px-[16px] py-[13px] text-xs text-ink-muted">
          <span className="flex flex-wrap items-center gap-[12px]">
            {pageSummary}
            {pageSize !== undefined && onPageSizeChange ? (
              <span className="flex items-center gap-[6px]">
                <Select
                  size="sm"
                  aria-label={t("ui.list.rowsPerPage")}
                  value={String(pageSize)}
                  onChange={(value) => onPageSizeChange(Number(value))}
                  options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
                  className="w-[78px]"
                />
                <span>{t("ui.list.rowsPerPage")}</span>
              </span>
            ) : null}
          </span>
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
