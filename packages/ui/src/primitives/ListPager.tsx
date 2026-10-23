import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Select } from "./Select";

export const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const;

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

export interface ListPagerProps {
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  pageSummary?: ReactNode;
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/** The pager footer DocumentList and ReportRunner share: summary, rows-per-page, page buttons. */
export function ListPager({
  page,
  pageCount,
  onPageChange,
  pageSummary,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  className,
}: ListPagerProps) {
  const { t } = useUiTranslation();
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-[10px] border-t border-border px-[16px] py-[13px] text-xs text-ink-muted", className)}>
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
  );
}
