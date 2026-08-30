import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { Card, StatusPill, type PillTone } from "./atoms";
import { DisclosureChevron } from "./DisclosureChevron";

/**
 * AccountTree — the دليل الحسابات (Chart of Accounts) tree table: an
 * indented, expand/collapse table matching the `.tree-row` / `.tree-toggle`
 * pattern in docs/archive/mezan-ui-mockups.html's Chart of Accounts screen. The
 * caller owns expand/collapse state and passes down the already-flattened,
 * already-filtered set of *visible* rows (depth-first order) — this
 * component only renders them.
 */

export interface AccountTreeRow {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  typeLabel: string;
  natureLabel: string;
  statusLabel: string;
  statusTone?: PillTone;
  level: number;
  hasChildren: boolean;
  expanded: boolean;
}

/**
 * Header labels. The tree is reused for the cost-centre hierarchy, which is not
 * a chart of accounts — leaving the defaults there labelled its columns
 * "اسم الحساب / الطبيعة" over cost-centre data (D44).
 */
export interface AccountTreeColumnLabels {
  readonly name?: string;
  readonly type?: string;
  readonly nature?: string;
  readonly status?: string;
}

export interface AccountTreeProps {
  rows: AccountTreeRow[];
  columnLabels?: AccountTreeColumnLabels;
  onToggle: (id: string) => void;
  onRowClick?: (id: string) => void;
  rowActions?: (row: AccountTreeRow) => ReactNode;
  emptyState?: ReactNode;
  /**
   * The query that feeds `rows` failed. A failed load and a genuinely empty
   * chart both arrive as `rows: []`, and the empty state then contradicts the
   * error banner above it (D123).
   */
  loadFailed?: boolean;
  className?: string;
}

function TreeToggle({ hasChildren, expanded, onClick }: { hasChildren: boolean; expanded: boolean; onClick: () => void }) {
  const { t } = useUiTranslation();
  if (!hasChildren) {
    return <span aria-hidden className="inline-block h-[18px] w-[18px] flex-none" />;
  }
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? t("ui.accountTree.collapse") : t("ui.accountTree.expand")}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
    >
      <DisclosureChevron collapsed={!expanded} className="h-[9px] w-[9px]" />
    </button>
  );
}

export function AccountTree({
  rows,
  columnLabels,
  onToggle,
  onRowClick,
  rowActions,
  emptyState,
  loadFailed = false,
  className,
}: AccountTreeProps) {
  const { t } = useUiTranslation();
  return (
    <Card className={cn("overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-start text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted">
                {columnLabels?.name ?? t("ui.accountTree.col.name")}
              </th>
              <th scope="col" className="whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-start text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted">
                {columnLabels?.type ?? t("ui.accountTree.col.type")}
              </th>
              <th scope="col" className="whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-start text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted">
                {columnLabels?.nature ?? t("ui.accountTree.col.nature")}
              </th>
              <th scope="col" className="whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-start text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted">
                {columnLabels?.status ?? t("ui.accountTree.col.status")}
              </th>
              {rowActions ? <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[11px]" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-b border-border last:border-b-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-surface-2",
                )}
                onClick={onRowClick ? () => onRowClick(row.id) : undefined}
              >
                <td className="px-[15px] py-[10px] align-middle">
                  <div className="flex items-center gap-[6px]" style={{ paddingInlineStart: row.level * 20 }}>
                    <TreeToggle hasChildren={row.hasChildren} expanded={row.expanded} onClick={() => onToggle(row.id)} />
                    <div>
                      <div className="font-semibold text-ink">{row.nameAr}</div>
                      <div className="mz-num text-[11px] text-ink-faint">{row.code}</div>
                    </div>
                  </div>
                </td>
                <td className="px-[15px] py-[10px] align-middle">
                  <span className="inline-flex rounded-sm bg-surface-3 px-[8px] py-[3px] text-[11.5px] font-semibold text-ink-muted">
                    {row.typeLabel}
                  </span>
                </td>
                <td className="px-[15px] py-[10px] align-middle text-ink-muted">{row.natureLabel}</td>
                <td className="px-[15px] py-[10px] align-middle">
                  <StatusPill label={row.statusLabel} tone={row.statusTone ?? "success"} />
                </td>
                {rowActions ? <td className="px-[15px] py-[10px] align-middle text-end">{rowActions(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!loadFailed && rows.length === 0 && emptyState ? <div className="p-[16px]">{emptyState}</div> : null}
      </div>
    </Card>
  );
}
