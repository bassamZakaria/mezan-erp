import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Button, Card, useFormat } from "@mezan/ui";
import type { PendingStorageRequestDTO, StorageRequestDTO } from "@mezan/contracts";
import { StorageDecision, formatStorageMb } from "@mezan/domain";
import { useAppTranslation } from "../i18n";
import { PlatformApiError, readPlatformErrorMessage, usePlatformApi } from "./api";

const STORAGE_REQUESTS_KEY = ["platform", "storage-requests"] as const;

function usePendingStorageRequests(): UseQueryResult<PendingStorageRequestDTO[], PlatformApiError> {
  const { t } = useAppTranslation();
  const { request, session } = usePlatformApi();
  return useQuery<PendingStorageRequestDTO[], PlatformApiError>({
    queryKey: STORAGE_REQUESTS_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/storage-requests");
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.storageRequests.loadFailed"));
      return res.json<PendingStorageRequestDTO[]>();
    },
  });
}

function useDecideStorageRequest() {
  const { t } = useAppTranslation();
  const { request } = usePlatformApi();
  const queryClient = useQueryClient();
  return useMutation<StorageRequestDTO, PlatformApiError, { id: string; decision: StorageDecision }>({
    mutationFn: async ({ id, decision }) => {
      const res = await request(`/storage-requests/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
      if (!res.ok) throw new PlatformApiError(res.status, await readPlatformErrorMessage(res, t, "platform.storageRequests.decideFailed"));
      return res.json<StorageRequestDTO>();
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: STORAGE_REQUESTS_KEY }),
        queryClient.invalidateQueries({ queryKey: ["platform", "tenants"] }),
      ]),
  });
}

export function StorageRequestsCard({ isOwner }: { isOwner: boolean }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const pending = usePendingStorageRequests();
  const decide = useDecideStorageRequest();
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = pending.data ?? [];
  if (pending.isError) {
    return (
      <Card className="mb-[14px] p-[14px_16px]">
        <p role="alert" className="text-[12.5px] font-semibold text-danger-ink">
          {pending.error.message}
        </p>
        <Button size="sm" className="mt-[8px]" onClick={() => pending.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  const act = (id: string, decision: StorageDecision) => {
    if (busyId !== null) return;
    decide.reset();
    setBusyId(id);
    decide.mutate({ id, decision }, { onSettled: () => setBusyId(null) });
  };

  return (
    <Card className="mb-[14px] p-[14px_16px]">
      <h2 className="text-[13px] font-bold text-ink">{t("platform.storageRequests.title")}</h2>
      {decide.error ? (
        <p role="alert" className="mt-[6px] text-[12px] font-semibold text-danger-ink">
          {decide.error.message}
        </p>
      ) : null}
      <ul className="mt-[10px] flex flex-col gap-[10px]">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-[10px] border-t border-border pt-[10px] first:border-t-0 first:pt-0">
            <div className="min-w-0 text-[12.5px]">
              <div className="font-semibold text-ink">
                {r.tenantNameAr} <span className="mz-lat text-[11.5px] text-ink-faint">{r.tenantCode}</span>
              </div>
              <div className="text-ink-muted">
                {t("platform.storageRequests.asks")} <span className="mz-num font-semibold text-ink">{formatStorageMb(r.extraMb)}</span>
                {" · "}
                <span className="mz-num">{format.date(r.requestedAt)}</span>
              </div>
              {r.note ? <p className="mt-[4px] break-words text-ink-muted">{r.note}</p> : null}
            </div>
            {isOwner ? (
              <div className="flex gap-[8px]">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busyId === r.id}
                  aria-label={`${t("platform.storageRequests.approve")} ${formatStorageMb(r.extraMb)} ${r.tenantNameAr}`}
                  onClick={() => act(r.id, StorageDecision.Approve)}
                >
                  {t("platform.storageRequests.approve")}
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === r.id}
                  aria-label={`${t("platform.storageRequests.decline")} ${formatStorageMb(r.extraMb)} ${r.tenantNameAr}`}
                  onClick={() => act(r.id, StorageDecision.Decline)}
                >
                  {t("platform.storageRequests.decline")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
