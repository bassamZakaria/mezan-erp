import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";

export interface ListView {
  key: string;
  label: string;
  count?: number;
  description?: string;
  /** Renders even when `count` is exactly 0 — for a view that is meaningful empty (e.g. "مسودات"). */
  alwaysShow?: boolean;
}

export interface ListViewsProps {
  views: ListView[];
  activeKey: string;
  onChange: (key: string) => void;
  "aria-label"?: string;
  className?: string;
}

/**
 * Single-select tabs over a list's views (status, saved filters, …).
 * A view with `count === 0` is not rendered — a zero-count option teaches
 * people to ignore the row that matters — except the currently active view
 * (so a selection never vanishes underneath the person who chose it) and any
 * view explicitly marked `alwaysShow`.
 */
export function ListViews({ views, activeKey, onChange, className, ...props }: ListViewsProps) {
  const { t } = useUiTranslation();
  const visible = views.filter((view) => view.count !== 0 || view.key === activeKey || view.alwaysShow);
  if (visible.length === 0) return null;
  const ariaLabel = props["aria-label"] ?? t("ui.views.label");
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("flex flex-wrap gap-[8px]", className)}>
      {visible.map((view) => {
        const active = view.key === activeKey;
        return (
          <button
            key={view.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view.key)}
            className={cn(
              "inline-flex min-h-[44px] items-center gap-[8px] rounded-pill border px-[16px] py-[8px] text-start text-[12.5px] font-semibold transition-colors",
              active
                ? "border-brand bg-brand text-brand-ink"
                : "border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            <span className="flex flex-col items-start justify-center gap-[1px]">
              <span>{view.label}</span>
              {view.description ? (
                <span className={cn("text-[11px] font-normal", active ? "text-brand-ink" : "text-ink-faint")}>
                  {view.description}
                </span>
              ) : null}
            </span>
            {view.count !== undefined ? (
              <span className="mz-num font-mono text-[11px] tabular-nums opacity-90">{view.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface AppliedFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface AppliedFiltersProps {
  filters: AppliedFilter[];
  onClearAll?: () => void;
  className?: string;
}

/** Removable tags summarising the filters currently narrowing a list (R1.13's companion). */
export function AppliedFilters({ filters, onClearAll, className }: AppliedFiltersProps) {
  const { t } = useUiTranslation();
  if (filters.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-[8px]", className)}>
      <span className="text-[12px] font-semibold text-ink-muted">{t("ui.filters.applied")}</span>
      {filters.map((filter) => (
        <span
          key={filter.key}
          className="inline-flex min-h-[44px] items-center gap-[4px] rounded-pill border border-border bg-surface-2 ps-[14px] pe-[4px] text-[12.5px] font-semibold text-ink"
        >
          {filter.label}
          <button
            type="button"
            onClick={filter.onRemove}
            aria-label={t("ui.filters.remove", { filter: filter.label })}
            className="inline-flex h-[44px] w-[44px] flex-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            <svg aria-hidden viewBox="0 0 16 16" width="11" height="11">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ))}
      {filters.length > 1 && onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-[44px] items-center px-[12px] text-[12px] font-semibold text-brand hover:underline"
        >
          {t("ui.filters.clearAll")}
        </button>
      ) : null}
    </div>
  );
}
