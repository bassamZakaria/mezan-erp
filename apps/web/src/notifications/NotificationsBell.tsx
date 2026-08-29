import { useState } from "react";
import { useAppTranslation, type AppI18n } from "../i18n";
import { NotificationsPanel, type NotificationPanelItem } from "@mezan/ui";
import type { NotificationDTO, NotificationPriorityDTO } from "@mezan/contracts";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "../data/hooks";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "قبل N دقيقة/ساعة/يوم" — matches the reference panel's relative timestamps (docs/archive/catalog/09 §الإشعارات). */
function relativeTime(iso: string, now: number, t: AppI18n["t"]): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < MINUTE) return t("notifications.justNow");
  if (diff < HOUR) return t("notifications.minutesAgo", { n: String(Math.floor(diff / MINUTE)) });
  if (diff < DAY) return t("notifications.hoursAgo", { n: String(Math.floor(diff / HOUR)) });
  return t("notifications.daysAgo", { n: String(Math.floor(diff / DAY)) });
}

function toPanelItem(n: NotificationDTO, now: number, t: AppI18n["t"]): NotificationPanelItem {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    timeLabel: relativeTime(n.createdAt, now, t),
    read: n.status === "read",
    priority: n.priority as NotificationPriorityDTO,
  };
}

/**
 * The top-bar bell's real data container (docs/archive/catalog/09 §الإشعارات):
 * fetches the current user's own notifications + unread count off
 * `/notifications`, renders them through the presentational
 * `NotificationsPanel`, and marks read on click / "تحديد الكل كمقروء".
 */
export function useNotificationsBell(onViewAll?: () => void) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");

  const { t } = useAppTranslation();
  const listQuery = useNotifications(tab === "unread" ? "unread" : undefined);
  const unreadCountQuery = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const now = Date.now();
  const items = (listQuery.data ?? []).map((n) => toPanelItem(n, now, t));
  const unreadCount = unreadCountQuery.data ?? 0;

  const panel = (
    <NotificationsPanel
      open={open}
      onClose={() => setOpen(false)}
      items={items}
      unreadCount={unreadCount}
      tab={tab}
      onTabChange={setTab}
      onMarkAllRead={() => markAllRead.mutate()}
      onItemClick={(id) => {
        const item = (listQuery.data ?? []).find((n) => n.id === id);
        if (item && item.status === "unread") markRead.mutate(id);
      }}
      loading={listQuery.isLoading}
      onViewAll={
        onViewAll
          ? () => {
              setOpen(false);
              onViewAll();
            }
          : undefined
      }
    />
  );

  return { open, onToggle: () => setOpen((v) => !v), unreadCount, panel };
}
