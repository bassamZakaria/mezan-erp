import type { ReactNode } from "react";
import { Card, StatCard } from "./atoms";

/**
 * WorkspaceHub — the shape every «نظرة عامة» screen already had.
 *
 * Eleven hubs were the same ~100 lines copy-pasted: a title and description, a
 * row of actions, an error card, a four-tile stat grid, and one "recent" list.
 * They had already drifted from each other — the same card carried three
 * different paddings and two different empty-state treatments — which is what
 * copy-paste always costs. The differences that are real (which figures, which
 * rows, which verbs) are props; the frame is here once.
 */

export interface WorkspaceHubStat {
  readonly key: string;
  readonly label: string;
  /** Rendered as given, so a caller can pass `<Money>` rather than a formatted string. */
  readonly value: ReactNode;
  readonly sub?: ReactNode;
  readonly subTone?: "up" | "down" | "neutral";
  readonly valueTone?: "default" | "danger";
}

export interface WorkspaceHubRow {
  readonly key: string;
  /** The line a reader scans — a customer, an item, a document memo. */
  readonly primary: ReactNode;
  /** The quieter line beneath it — a date, a code, a warehouse. */
  readonly secondary?: ReactNode;
  /** The end-aligned figure or status. */
  readonly trailing?: ReactNode;
}

export interface WorkspaceHubList {
  readonly title: string;
  readonly sub?: string;
  readonly rows: readonly WorkspaceHubRow[];
  /** Shown when `rows` is empty. Never a blank card. */
  readonly empty: string;
  /** Optional control in the list header — "open the full dashboard". */
  readonly action?: ReactNode;
}

export interface WorkspaceHubProps {
  readonly title: string;
  readonly description: string;
  /** The workspace's verbs. The bar above already carries its destinations. */
  readonly actions?: ReactNode;
  /** Shown instead of stale figures when a query failed. */
  readonly error?: string | null;
  /**
   * True only while the FIRST load is in flight. Tiles render an em dash rather
   * than a zero: a zero that turns out to be a loading state is a lie about the
   * books.
   */
  readonly loading?: boolean;
  readonly stats?: readonly WorkspaceHubStat[];
  readonly list?: WorkspaceHubList;
  /** Anything a particular hub needs that the frame does not model. */
  readonly children?: ReactNode;
}

export function WorkspaceHub({ title, description, actions, error, loading = false, stats, list, children }: WorkspaceHubProps) {
  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div>
          <h1 className="mt-[4px] font-display text-lg font-bold text-ink">{title}</h1>
          <p className="mt-[4px] max-w-[62ch] text-xs text-ink-muted">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-[8px]">{actions}</div> : null}
      </div>

      {error ? (
        <Card className="p-[18px_20px]">
          <p role="alert" className="text-sm font-semibold text-danger-ink">
            {error}
          </p>
        </Card>
      ) : null}

      {stats && stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard
              key={stat.key}
              label={stat.label}
              value={loading ? "—" : stat.value}
              sub={stat.sub}
              subTone={stat.subTone}
              valueTone={stat.valueTone}
            />
          ))}
        </div>
      ) : null}

      {list ? (
        <Card className="p-[18px_20px]">
          <div className="flex items-start justify-between gap-[10px]">
            <div>
              <h3 className="font-display text-sm font-bold text-ink">{list.title}</h3>
              {list.sub ? <div className="mb-[10px] mt-[2px] text-2xs text-ink-faint">{list.sub}</div> : null}
            </div>
            {list.action}
          </div>
          {list.rows.length > 0 ? (
            <ul className="flex flex-col gap-[10px]">
              {list.rows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-[10px]">
                  <div>
                    <div className="text-xs text-ink">{row.primary}</div>
                    {row.secondary ? <div className="mt-[1px] text-2xs text-ink-faint">{row.secondary}</div> : null}
                  </div>
                  {row.trailing}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink-muted">{list.empty}</p>
          )}
        </Card>
      ) : null}

      {children}
    </div>
  );
}
