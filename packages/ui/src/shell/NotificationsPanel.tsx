import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";

/** One row in the notifications panel. */
export interface ShellNotification {
  id: string;
  title: string;
  body?: string;
  at?: string;
  /** Undefined when the caller has no read-state to report. */
  read?: boolean;
}


/**
 * Presentational shape for one row — @mezan/ui has no dependency on
 * @mezan/contracts/@mezan/domain (see Topbar/CommandPalette), so this is a
 * local, minimal projection of the real `NotificationDTO` the web app's data
 * hooks fetch; the consumer maps its DTOs onto this shape.
 */
export interface NotificationPanelItem {
  id: string;
  title: string;
  body: string;
  /** Pre-formatted relative time, e.g. "قبل 17 دقيقة" — formatting is the consumer's job. */
  timeLabel: string;
  read: boolean;
  priority?: "low" | "normal" | "high" | "urgent";
}

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
  items: NotificationPanelItem[];
  unreadCount: number;
  tab: "all" | "unread";
  onTabChange: (tab: "all" | "unread") => void;
  onMarkAllRead: () => void;
  onItemClick: (id: string) => void;
  onViewAll?: () => void;
  loading?: boolean;
}

const PRIORITY_DOT_CLASS: Record<NonNullable<NotificationPanelItem["priority"]>, string> = {
  low: "bg-ink-faint",
  normal: "bg-brand",
  high: "bg-warning",
  urgent: "bg-danger",
};

/**
 * NotificationsPanel — a MODAL (docs/catalog/09 §الإشعارات): الكل/غير مقروء
 * tabs, mark-all-read, a scrollable list.
 *
 * It was a dropdown anchored to the bell. The bell now lives at the BOTTOM of
 * the workspace column, where an anchored panel either opens past the fold or
 * has to be flipped and squeezed into 200px of column; and a notification list
 * is something you read and act on, not a menu you flick through. So it opens
 * in the middle of the screen, the same shape as «كل الشاشات» and ⌘K — three
 * surfaces, one behaviour, one Escape.
 */
export function NotificationsPanel({
  open,
  onClose,
  items,
  unreadCount,
  tab,
  onTabChange,
  onMarkAllRead,
  onItemClick,
  onViewAll,
  loading,
}: NotificationsPanelProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  /*
   * PORTALED TO <body>. The bell lives inside the workspace column, whose
   * scroll container is `position: sticky` — and a sticky element creates a
   * stacking context, so a `position: fixed` dialog rendered inside it is
   * trapped in that context and the page's own cards paint straight over it.
   * z-index cannot win that fight; leaving the subtree does.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-scrim p-[16px] pt-[10vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("notifications.title")}
        className="flex max-h-[min(620px,76vh)] w-full max-w-[460px] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-2"
      >
        <div className="flex items-center justify-between border-b border-border px-[16px] py-[13px]">
          <div className="flex items-center gap-[8px]">
            <h3 className="font-display text-[14px] font-bold text-ink">{t("notifications.title")}</h3>
            {unreadCount > 0 ? (
              <span className="mz-num rounded-pill bg-brand-soft px-[8px] py-[1px] text-[11px] font-bold text-brand">{unreadCount}</span>
            ) : null}
          </div>
          <button type="button" onClick={onMarkAllRead} className="text-[11.5px] font-semibold text-brand hover:underline">
            {t("notifications.markAllRead")}
          </button>
        </div>

        <div className="flex gap-[6px] border-b border-border px-[16px] py-[9px]">
          {(["all", "unread"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              className={cn(
                "rounded-pill px-[11px] py-[5px] text-[12px] font-semibold transition-colors",
                // The selected tab is a "current" state, so it is gold like every
                // other one in the shell. The unread badge and the action links
                // below stay teal — they are actions, not selection.
                tab === key ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              {key === "all" ? t("notifications.tabAll") : unreadCount > 0 ? t("notifications.tabUnreadWithCount", { count: String(unreadCount) }) : t("notifications.tabUnread")}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-[16px] py-[24px] text-center text-[12.5px] text-ink-faint">{t("notifications.loading")}</p>
          ) : items.length === 0 ? (
            <p className="px-[16px] py-[24px] text-center text-[12.5px] text-ink-faint">{t("notifications.empty")}</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick(item.id)}
                className={cn(
                  "flex w-full items-start gap-[10px] border-b border-border px-[16px] py-[12px] text-start transition-colors hover:bg-surface-2",
                  !item.read && "bg-brand-soft/30",
                )}
              >
                <span
                  aria-hidden
                  className={cn("mt-[6px] h-[7px] w-[7px] flex-none rounded-full", item.priority ? PRIORITY_DOT_CLASS[item.priority] : "bg-ink-faint", item.read && "opacity-0")}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-[8px]">
                    <span className={cn("truncate text-[13px]", item.read ? "font-medium text-ink-muted" : "font-bold text-ink")}>{item.title}</span>
                    <span className="mz-lat flex-none text-[10.5px] text-ink-faint">{item.timeLabel}</span>
                  </span>
                  <span className="mt-[2px] block text-[11.5px] text-ink-muted">{item.body}</span>
                </span>
              </button>
            ))
          )}
        </div>

        {onViewAll ? (
          <div className="border-t border-border p-[10px]">
            <button
              type="button"
              onClick={onViewAll}
              className="w-full rounded-md py-[8px] text-center text-[12.5px] font-semibold text-brand hover:bg-brand-soft"
            >
              {t("notifications.viewAll")}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
