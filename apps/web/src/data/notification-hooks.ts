import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateNotificationRuleDTO,
  NotificationDTO,
  NotificationInboxDTO,
  NotificationRuleDTO,
  NotificationTriggerCatalogDTO,
  UpdateNotificationRuleDTO,
} from "@mezan/contracts";
import type { ShellNotification } from "@mezan/ui";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";

/**
 * قواعد الإشعارات + the shell bell's inbox (docs/catalog/09), against the real
 * `/notifications` API. Zero rules and zero notifications are real states — the
 * screens render their empty state rather than any placeholder row.
 */

const RULES_KEY = ["notification-rules"] as const;
const TRIGGERS_KEY = ["notification-triggers"] as const;
const INBOX_KEY = ["notifications", "me"] as const;

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string; reasons?: string[] }>().catch(() => ({}))) as {
    message?: string;
    reasons?: string[];
  };
  if (body.reasons && body.reasons.length > 0) return body.reasons.join("، ");
  return body.message ?? fallback;
}

export function useNotificationRules(): UseQueryResult<NotificationRuleDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<NotificationRuleDTO[], ApiError>({
    queryKey: RULES_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/notifications/rules");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قواعد الإشعارات.");
      return res.json<NotificationRuleDTO[]>();
    },
  });
}

/** The trigger catalog + the channels this build actually delivers on. */
export function useNotificationTriggers(): UseQueryResult<NotificationTriggerCatalogDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<NotificationTriggerCatalogDTO, ApiError>({
    queryKey: TRIGGERS_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/notifications/triggers");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قائمة الأحداث.");
      return res.json<NotificationTriggerCatalogDTO>();
    },
  });
}

export function useCreateNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, CreateNotificationRuleDTO>({
    mutationFn: async (body) => {
      const res = await request("/notifications/rules", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء القاعدة."));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

export function useUpdateNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, { id: string; body: UpdateNotificationRuleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/notifications/rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحديث القاعدة."));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

export function useDeleteNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notifications/rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حذف القاعدة."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RULES_KEY }),
  });
}

/** The signed-in user's own inbox — the bell's data source. */
export function useMyNotifications(): UseQueryResult<NotificationInboxDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<NotificationInboxDTO, ApiError>({
    queryKey: INBOX_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/notifications/me");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الإشعارات.");
      return res.json<NotificationInboxDTO>();
    },
  });
}

export function useMarkNotificationRead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notifications/me/${id}/read`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحديث حالة الإشعار.");
      return res.json<NotificationDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ updated: number; unreadCount: number }, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/notifications/me/read-all", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحديد الإشعارات كمقروءة.");
      return res.json<{ updated: number; unreadCount: number }>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "منذ ١٠ د" / "منذ ٣ س" / "منذ يومين" — the reference bell's relative stamp. */
export function relativeTimeAr(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "الآن";
  if (elapsed < HOUR) return `منذ ${Math.floor(elapsed / MINUTE)} د`;
  if (elapsed < DAY) return `منذ ${Math.floor(elapsed / HOUR)} س`;
  return `منذ ${Math.floor(elapsed / DAY)} ي`;
}

export interface ShellNotificationFeed {
  readonly notifications: ShellNotification[];
  readonly unreadCount: number;
  markRead(id: string): void;
  markAllRead(): void;
}

/**
 * The one hook `App.tsx` needs: the bell's rows, its unread badge count, and
 * the two actions. An empty feed is a real state — the bell renders its empty
 * state and no badge.
 */
export function useShellNotifications(): ShellNotificationFeed {
  const inbox = useMyNotifications();
  const markReadMutation = useMarkNotificationRead();
  const markAllMutation = useMarkAllNotificationsRead();
  const data = inbox.data;

  return {
    notifications: (data?.notifications ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body === "" ? undefined : n.body,
      at: relativeTimeAr(n.createdAt),
      read: n.readAt !== null,
    })),
    unreadCount: data?.unreadCount ?? 0,
    markRead: (id) => {
      if (markReadMutation.isPending) return;
      markReadMutation.mutate(id);
    },
    markAllRead: () => {
      if (markAllMutation.isPending) return;
      markAllMutation.mutate();
    },
  };
}
