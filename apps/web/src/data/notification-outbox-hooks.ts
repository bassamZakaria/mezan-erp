import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { DrainResult } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError } from "./hooks";
import { sessionHolds } from "./session";
import { useAppTranslation } from "../i18n";

const OUTBOX_KEY = "notification-outbox";

// INVARIANT: the permission `/notifications/outbox` and `/notifications/drain` are gated on in packages/api/src/notifications-routes.ts.
export const NOTIFICATION_OUTBOX_PERMISSION = "admin.settings.edit";

export interface NotificationOutboxDTO {
  readonly queued: number;
  readonly queuedIsCapped: boolean;
  readonly oldestQueuedAt: string | null;
  readonly mailConfigured: boolean;
  readonly transportAvailable: boolean;
}

export function useMayManageNotificationOutbox(): boolean {
  const { session } = useApi();
  return sessionHolds(session, NOTIFICATION_OUTBOX_PERMISSION);
}

export function useNotificationOutbox(): UseQueryResult<NotificationOutboxDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayManage = useMayManageNotificationOutbox();
  return useQuery<NotificationOutboxDTO, ApiError>({
    queryKey: [OUTBOX_KEY],
    enabled: mayManage,
    queryFn: async () => {
      const res = await request("/notifications/outbox");
      if (!res.ok) throw await loaderError(res, t("notifOutbox.loadFailed"), t);
      return res.json<NotificationOutboxDTO>();
    },
  });
}

export function useDrainNotificationOutbox() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DrainResult, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/notifications/drain", { method: "POST", body: "{}" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("notifOutbox.sendFailed"), t));
      return res.json<DrainResult>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [OUTBOX_KEY] }),
  });
}
