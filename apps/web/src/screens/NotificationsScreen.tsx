import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  RowMenu,
  Select,
  StatusPill,
  formatDateTime,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { NOTIFICATION_PRIORITIES, type NotificationPriority } from "@mezan/domain";
import type { NotificationDTO } from "@mezan/contracts";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadNotificationCount } from "../data/hooks";
import { eventLabelByCode } from "../domain-labels";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useNavigation } from "../navigation";
import { EMPTY } from "../lib/empty";

/**
 * مركز الإشعارات — the bell's "عرض جميع الإشعارات" destination (R1.6). The
 * dropdown panel (`NotificationsBell`) stays the quick glance; this is the
 * full, filterable feed over the SAME `/notifications` data — nothing here is
 * a second, invented source.
 */

const PRIORITY_KEY: Record<NotificationPriority, AppTranslationKey> = {
  low: "notifRules.priority.low",
  normal: "notifRules.priority.normal",
  high: "notifRules.priority.high",
  urgent: "notifRules.priority.urgent",
};
const PRIORITY_TONE: Record<NotificationPriority, PillTone> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function NotificationsScreen() {
  const { t, locale } = useAppTranslation();
  const { navigate } = useNavigation();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [priorityFilter, setPriorityFilter] = useState<"" | NotificationPriority>("");
  const [eventFilter, setEventFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const listQuery = useNotifications();
  const unreadCountQuery = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const fullList = listQuery.data ?? EMPTY;
  const unreadCount = unreadCountQuery.data ?? 0;
  const urgentCount = fullList.filter((n) => n.priority === "urgent" && n.status === "unread").length;

  const eventOptions = useMemo(() => [...new Set(fullList.map((n) => n.eventCode))].sort(), [fullList]);

  function updateFilters(patch: { priority?: "" | NotificationPriority; event?: string; search?: string }) {
    if (patch.priority !== undefined) setPriorityFilter(patch.priority);
    if (patch.event !== undefined) setEventFilter(patch.event);
    if (patch.search !== undefined) setSearch(patch.search);
    setPage(1);
  }

  const tabRows = tab === "unread" ? fullList.filter((n) => n.status === "unread") : fullList;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tabRows.filter((n) => {
      if (priorityFilter && n.priority !== priorityFilter) return false;
      if (eventFilter && n.eventCode !== eventFilter) return false;
      if (term && !`${n.title} ${n.body}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [tabRows, priorityFilter, eventFilter, search]);

  const activeFilterCount = (priorityFilter ? 1 : 0) + (eventFilter ? 1 : 0);
  // Zero rows means something different depending on WHY: nothing has ever
  // arrived (the CTA sets up a rule) versus the current tab/filter/search
  // narrowed a real feed to nothing (the CTA just clears them).
  const isFilteredEmpty = filtered.length === 0 && fullList.length > 0;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function markOneRead(n: NotificationDTO) {
    if (n.status !== "unread" || pendingId) return;
    setPendingId(n.id);
    try {
      await markRead.mutateAsync(n.id);
    } finally {
      setPendingId(null);
    }
  }

  function clearFilters() {
    setPriorityFilter("");
    setEventFilter("");
    setSearch("");
    setPage(1);
  }

  const columns: DocumentListColumn<NotificationDTO>[] = useMemo(
    () => [
      {
        key: "priority",
        header: t("notifRules.col.priority"),
        render: (n) => <StatusPill label={t(PRIORITY_KEY[n.priority])} tone={PRIORITY_TONE[n.priority]} />,
      },
      {
        key: "title",
        header: t("notifications.screen.col.title"),
        render: (n) => (
          <div className="flex items-center gap-[8px]">
            {n.status === "unread" ? <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-brand" /> : null}
            <span className={n.status === "unread" ? "font-bold text-ink" : "text-ink-muted"}>{n.title}</span>
          </div>
        ),
      },
      {
        key: "body",
        header: t("notifications.screen.col.body"),
        render: (n) => <span className="line-clamp-1 text-ink-muted">{n.body}</span>,
      },
      {
        key: "eventCode",
        header: t("notifications.screen.col.type"),
        render: (n) => <span className="text-[11.5px] text-ink-faint">{eventLabelByCode(n.eventCode, t) ?? n.eventCode}</span>,
      },
      {
        key: "createdAt",
        header: t("notifications.screen.col.time"),
        align: "end",
        numeric: false,
        render: (n) => <span className="mz-num text-ink-muted">{formatDateTime(new Date(n.createdAt), { locale })}</span>,
      },
    ],
    [locale, t],
  );

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("notifications.tabAll"), count: fullList.length },
    { key: "unread", label: t("notifications.tabUnread"), count: unreadCount },
  ];

  return (
    <>
      {listQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("notifications.screen.couldNotLoad")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => listQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<NotificationDTO>
        title={t("notifications.title")}
        description={t("notifications.screen.description")}
        listKey="notifications"
        actions={
          <Button
            size="sm"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {t("notifications.markAllRead")}
          </Button>
        }
        stats={[
          { label: t("notifications.screen.stat.total"), value: <span className="mz-num">{fullList.length}</span> },
          { label: t("notifications.tabUnread"), value: <span className="mz-num">{unreadCount}</span>, valueTone: unreadCount > 0 ? "danger" : "default" },
          { label: t("notifRules.priority.urgent"), value: <span className="mz-num">{urgentCount}</span> },
        ]}
        statsCollapsible
        statusChips={statusChips}
        activeStatusKey={tab}
        onStatusChange={(k) => {
          setTab(k as "all" | "unread");
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(v) => updateFilters({ search: v })}
        searchPlaceholder={t("notifications.screen.search")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <Select
              className="w-[170px]"
              size="sm"
              aria-label={t("notifications.screen.filter.priority")}
              value={priorityFilter}
              onChange={(v) => updateFilters({ priority: v as "" | NotificationPriority })}
              options={[
                { value: "", label: t("notifications.screen.filter.allPriorities") },
                ...NOTIFICATION_PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_KEY[p]) })),
              ]}
            />
            <Select
              className="w-[220px]"
              size="sm"
              aria-label={t("notifications.screen.filter.type")}
              value={eventFilter}
              onChange={(v) => updateFilters({ event: v })}
              options={[
                { value: "", label: t("notifications.screen.filter.allTypes") },
                ...eventOptions.map((code) => ({ value: code, label: eventLabelByCode(code, t) ?? code })),
              ]}
            />
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={listQuery.isLoading}
        rowKey={(n) => n.id}
        rowAction={(n) => {
          const menuItems: RowMenuItem[] =
            n.status === "unread"
              ? [{ key: "markRead", label: t("common.markRead"), disabled: pendingId === n.id, onSelect: () => void markOneRead(n) }]
              : [];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: n.title })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeOptions={PAGE_SIZES}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")}{" "}
            <span className="mz-num">{filtered.length}</span> {t("notifications.screen.unit")}
          </>
        }
        emptyState={
          isFilteredEmpty ? (
            <EmptyState
              title={t("notifications.screen.emptyFiltered.title")}
              description={t("notifications.screen.emptyFiltered.description")}
              action={{ label: t("notifications.screen.emptyFiltered.action"), onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              title={t("notifications.screen.emptyAll.title")}
              description={t("notifications.screen.emptyAll.description")}
              action={{ label: t("notifications.screen.emptyAll.action"), onClick: () => navigate("notification-rules") }}
            />
          )
        }
      />
    </>
  );
}
