import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";
import {
  LIST_NAV_EVENT,
  isTopListNavSubscriber,
  popListNavSubscriber,
  pushListNavSubscriber,
  type ListNavDetail,
} from "../lib/keys";
import { useUiTranslation } from "../i18n";
import { Card, StatCard } from "./atoms";
import { SearchInput } from "./form";
import { Select } from "./Select";
import { ListViews, AppliedFilters, type ListView, type AppliedFilter } from "./ListViews";
import { SkeletonTable } from "./feedback";

/**
 * DocumentList — the reusable list-page pattern (KPI strip + status chips +
 * filter bar + sortable table + pager). This is the single shape reused
 * across ~40 "list of documents" screens (invoices, journals, customers…),
 * per docs/archive/mezan-ui-mockups.html's `pattern-list` section.
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

/** An actionable exception above a list (R1.9). */
export interface DocumentListAttentionBanner {
  key: string;
  label: string;
  /** Rows behind the exception; a banner with none is not rendered. */
  count: number;
  tone?: "danger" | "warning";
  /** Applies the filter that shows exactly those rows. */
  onApply: () => void;
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
  /**
   * Actionable exceptions shown above the list (R1.9) — "2 overdue invoices
   * need follow-up". Distinct from the KPI tiles: a tile states a figure, a
   * banner states a problem AND applies the filter that shows it. A banner
   * with no `onApply` would just be a tile in a louder colour.
   */
  attentionBanners?: DocumentListAttentionBanner[];
  statusChips?: DocumentListStatusChip[];
  activeStatusKey?: string;
  onStatusChange?: (key: string) => void;
  /**
   * The single-select view control shown above the filter bar. Takes
   * precedence over `statusChips` when supplied — both drive the same
   * `activeStatusKey`/`onStatusChange` pair, so a screen can upgrade to
   * `description`/`alwaysShow` per view without touching its handlers.
   */
  views?: ListView[];
  /** Removable tags summarising the filters currently narrowing this list. */
  appliedFilters?: AppliedFilter[];
  /** Wired to `AppliedFilters`' "مسح الكل" action. Renders only when more than one filter is applied. */
  onClearAllFilters?: () => void;
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
   * (docs/archive/reference-parity/REQUIREMENTS.md R1.12) instead of each screen
   * growing its own.
   */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  emptyState?: ReactNode;
  /**
   * First load only. An empty table and a still-loading one look identical,
   * and the empty state actively lies while the rows are on their way — it
   * offers "create the first one" for records that already exist. Pass the
   * query's loading flag and the rows are replaced by a skeleton until they
   * arrive; a refetch over rows already shown is NOT loading.
   */
  loading?: boolean;
  /**
   * The query that feeds `rows` failed. An empty list and a failed load both
   * arrive here as `rows: []`, and the empty state then tells the operator
   * the opposite of the truth — that the records are not there — under the
   * screen's own error banner (D123). Pass the query's error flag and the
   * empty state stays out of the way until there is an answer to show.
   */
  loadFailed?: boolean;
  /**
   * Renders `stats` behind a collapse toggle (R1.11) — a report with 30 rows
   * of KPI cards above it is a report you scroll past, not one you read.
   * Requires `listKey` to remember the reader's choice across a reload;
   * without one the toggle still works, it just resets each mount.
   */
  statsCollapsible?: boolean;
  /**
   * Renders `filterBarExtra` behind a "تصفية النتائج" toggle carrying
   * `activeFilterCount` as a badge (R1.13), instead of always-visible filter
   * fields. Existing callers that omit this keep the old always-visible
   * behaviour unchanged.
   */
  filterBarCollapsible?: boolean;
  /** How many of this list's filters currently narrow the result set — shown as the toggle's badge. Zero renders no badge. */
  activeFilterCount?: number;
  /** Persists `statsCollapsible`/`filterBarCollapsible` open state per screen. Omit to keep it session-only. */
  listKey?: string;
  className?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

/** Table-row height in px — the `h-[36px]` on every `<tr>` below. The two must move together. */
const VIRTUAL_ROW_HEIGHT = 36;
/** Rows rendered beyond the viewport on each side, so a fast scroll never shows a gap. */
const VIRTUAL_OVERSCAN = 8;
/** Below this a page renders whole: the scroll listener costs more than the rows do. */
const VIRTUALIZE_THRESHOLD = 60;

function getListStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Privacy mode / disabled storage can throw on access rather than just being absent.
    return null;
  }
}

function loadPersistedOpen(key: string, fallback: boolean): boolean {
  const storage = getListStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

function persistOpen(key: string, open: boolean): void {
  const storage = getListStorage();
  if (!storage) return;
  try {
    storage.setItem(key, open ? "1" : "0");
  } catch {
    // Ignore write failures — the toggle still works for this session.
  }
}

function FilterToggleIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="13" height="13" className={cn("flex-none opacity-70 transition-transform", open && "rotate-180")}>
      <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  title,
  description,
  actions,
  stats,
  attentionBanners,
  statusChips,
  activeStatusKey,
  onStatusChange,
  views,
  appliedFilters,
  onClearAllFilters,
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
  loading = false,
  loadFailed = false,
  statsCollapsible = false,
  filterBarCollapsible = false,
  activeFilterCount,
  listKey,
  className,
}: DocumentListProps<Row>) {
  const { t } = useUiTranslation();
  const searchLabel = searchPlaceholder ?? t("ui.search.placeholder");
  const showRowAction = Boolean(rowAction ?? onRowClick);
  const viewItems: ListView[] | undefined = views ?? statusChips;
  const footerColumns = columns.filter((col) => col.total);
  const totalLabelIndex = columns.findIndex((col) => !col.total);
  const statsStorageKey = listKey ? `mezan.list.stats.${listKey}` : null;
  const filtersStorageKey = listKey ? `mezan.list.filters.${listKey}` : null;
  // The filter bar defaults OPEN whenever the screen has filters to show —
  // hiding useful filters behind a closed toggle is worse than an open one a
  // reader can dismiss. `loadPersistedOpen` still wins once the reader has
  // made their own choice.
  const filtersDefaultOpen = Boolean(filterBarExtra);
  const [statsOpen, setStatsOpen] = useState(() => (statsStorageKey ? loadPersistedOpen(statsStorageKey, true) : true));

  // `j`/`k`/`Enter`. The keymap dispatches `mz:list-nav` on window and this is
  // the listener for it — without one the keys are swallowed by the app's
  // `preventDefault` and nothing moves.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  /**
   * Windowing (Q-9). Every table row is a fixed 36px, so the visible slice is
   * arithmetic rather than measurement — no library and no per-row observer.
   *
   * OFF when a row can expand: an expanded row is not 36px, so the spacers
   * below would compute the wrong offset and the table would jump. Also off
   * under the threshold, because rendering forty rows whole costs less than
   * the scroll listener does.
   */
  const canVirtualize = renderExpandedRow === undefined && rows.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (!canVirtualize) return;
    const el = scrollRef.current;
    if (!el) return;
    const read = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    read();
    el.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      el.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, [canVirtualize]);

  const visible = useMemo(() => {
    if (!canVirtualize) return { start: 0, end: rows.length };
    const height = viewport.height > 0 ? viewport.height : 760;
    const first = Math.max(0, Math.floor(viewport.top / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const span = Math.ceil(height / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    let start = first;
    let end = Math.min(rows.length, first + span);
    // The keyboard-selected row must stay in the DOM: `j`/`k` navigation finds
    // it by `data-mz-row-index` and scrolls it into view.
    if (selectedIndex !== null) {
      start = Math.min(start, selectedIndex);
      end = Math.max(end, selectedIndex + 1);
    }
    return { start, end };
  }, [canVirtualize, rows.length, viewport, selectedIndex]);
  const navId = useId();
  const latest = useRef({ rows, onRowClick, selectedIndex });
  latest.current = { rows, onRowClick, selectedIndex };

  useEffect(() => {
    const id = Symbol(navId);
    pushListNavSubscriber(id);
    function onListNav(event: Event) {
      if (!isTopListNavSubscriber(id)) return;
      const { rows: liveRows, onRowClick: open, selectedIndex: current } = latest.current;
      if (liveRows.length === 0) return;
      const { action } = (event as CustomEvent<ListNavDetail>).detail;
      if (action === "open") {
        if (current !== null && liveRows[current] !== undefined) open?.(liveRows[current]);
        return;
      }
      const next =
        current === null
          ? action === "next"
            ? 0
            : liveRows.length - 1
          : Math.min(liveRows.length - 1, Math.max(0, current + (action === "next" ? 1 : -1)));
      setSelectedIndex(next);
      // Not `children[next]`: an expanded row inserts a second <tr>, so the
      // index into the DOM is not the index into `rows`.
      tbodyRef.current?.querySelector(`[data-mz-row-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener(LIST_NAV_EVENT, onListNav);
    return () => {
      popListNavSubscriber(id);
      window.removeEventListener(LIST_NAV_EVENT, onListNav);
    };
  }, [navId]);

  // A selection that outlives the rows it pointed at would highlight a
  // different document after a filter or a page change.
  useEffect(() => {
    setSelectedIndex(null);
  }, [page, rows.length]);

  const [filtersOpen, setFiltersOpen] = useState(() =>
    filtersStorageKey ? loadPersistedOpen(filtersStorageKey, filtersDefaultOpen) : filtersDefaultOpen,
  );
  const toggleStatsOpen = () => {
    setStatsOpen((open) => {
      const next = !open;
      if (statsStorageKey) persistOpen(statsStorageKey, next);
      return next;
    });
  };
  const toggleFiltersOpen = () => {
    setFiltersOpen((open) => {
      const next = !open;
      if (filtersStorageKey) persistOpen(filtersStorageKey, next);
      return next;
    });
  };
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          {title ? <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{title}</h1> : null}
          {description ? <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-[9px]">{actions}</div> : null}
      </div>

      {attentionBanners && attentionBanners.length > 0 ? (
        <div className="mb-[12px] flex flex-col gap-[6px]">
          {attentionBanners
            // A zero-count exception is not an exception; showing it would
            // train people to ignore the row that matters.
            .filter((banner) => banner.count > 0)
            .map((banner) => (
              <button
                key={banner.key}
                type="button"
                onClick={banner.onApply}
                className={cn(
                  "flex w-full items-center justify-between gap-[10px] rounded-md border px-[14px] py-[9px] text-start text-[12.5px] transition-colors",
                  banner.tone === "danger"
                    ? "border-danger bg-danger-soft text-danger-ink"
                    : "border-warning bg-warning-soft text-warning-ink",
                )}
              >
                <span className="font-semibold">{banner.label}</span>
                <span className="text-[11.5px] underline underline-offset-2">{t("ui.list.applyFilter")}</span>
              </button>
            ))}
        </div>
      ) : null}

      {stats && stats.length > 0 ? (
        <div className="mb-[18px]">
          {statsCollapsible ? (
            <button
              type="button"
              onClick={toggleStatsOpen}
              aria-expanded={statsOpen}
              className="mb-[10px] inline-flex items-center gap-[6px] text-[12px] font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              {statsOpen ? t("ui.list.statsCollapse") : t("ui.list.statsExpand")}
            </button>
          ) : null}
          {!statsCollapsible || statsOpen ? (
            <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
              {stats.map((stat, i) => (
                <StatCard key={i} label={stat.label} value={stat.value} sub={stat.sub} subTone={stat.subTone} valueTone={stat.valueTone} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {viewItems && viewItems.length > 0 ? (
        <div className="mb-[16px]">
          <ListViews
            views={viewItems}
            activeKey={activeStatusKey ?? ""}
            onChange={(key) => onStatusChange?.(key)}
            aria-label={t("ui.list.statusFilter")}
          />
        </div>
      ) : null}

      {onSearchChange || filterBarExtra ? (
        <div className="mb-[14px] flex flex-col gap-[10px]">
          <div className="flex flex-wrap gap-[10px]">
            {onSearchChange ? (
              <SearchInput
                className="min-w-[240px] flex-1"
                value={searchValue ?? ""}
                onValueChange={onSearchChange}
                placeholder={searchLabel}
                aria-label={searchLabel}
              />
            ) : null}
            {filterBarExtra && filterBarCollapsible ? (
              <button
                type="button"
                onClick={toggleFiltersOpen}
                aria-expanded={filtersOpen}
                className={cn(
                  "flex items-center gap-[7px] rounded-md border px-[12px] py-[8px] text-[12.5px] font-semibold transition-colors",
                  filtersOpen || (activeFilterCount ?? 0) > 0
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-border-strong bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                {t("ui.list.filters")}
                {activeFilterCount ? (
                  <span className="mz-num rounded-pill bg-brand px-[7px] py-[1px] text-[11px] font-bold text-brand-ink">
                    {activeFilterCount}
                  </span>
                ) : null}
                <FilterToggleIcon open={filtersOpen} />
              </button>
            ) : null}
          </div>
          {filterBarExtra && (!filterBarCollapsible || filtersOpen) ? filterBarExtra : null}
        </div>
      ) : null}

      {appliedFilters && appliedFilters.length > 0 ? (
        <div className="mb-[14px]">
          <AppliedFilters filters={appliedFilters} onClearAll={onClearAllFilters} />
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-md">
        <div ref={scrollRef} className="max-h-[min(68vh,760px)] overflow-auto">
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
            <tbody ref={tbodyRef}>
              {visible.start > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={columns.length + (showRowAction ? 1 : 0)} style={{ height: visible.start * VIRTUAL_ROW_HEIGHT }} />
                </tr>
              ) : null}
              {rows.slice(visible.start, visible.end).map((row, offsetIndex) => {
                const rowIndex = visible.start + offsetIndex;
                const key = rowKey(row, rowIndex);
                const expansion = renderExpandedRow?.(row);
                const isExpanded = expansion !== undefined && expansion !== null && expandedKeys?.includes(key) === true;
                return (
                <Fragment key={key}>
                <tr
                  data-mz-row-index={rowIndex}
                  aria-selected={selectedIndex === rowIndex ? true : undefined}
                  className={cn(
                    "group/row h-[36px] transition-colors even:bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)]",
                    onRowClick && "cursor-pointer hover:bg-surface-2",
                    selectedIndex === rowIndex && "bg-brand-soft even:bg-brand-soft",
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
              {visible.end < rows.length ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={columns.length + (showRowAction ? 1 : 0)}
                    style={{ height: (rows.length - visible.end) * VIRTUAL_ROW_HEIGHT }}
                  />
                </tr>
              ) : null}
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

          {loading && rows.length === 0 ? (
            <div className="p-[16px]">
              <SkeletonTable rows={Math.min(pageSize ?? 5, 8)} columns={Math.min(columns.length, 6)} />
            </div>
          ) : null}

          {!loading && !loadFailed && rows.length === 0 && emptyState ? <div className="p-[16px]">{emptyState}</div> : null}
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
