import { useState } from "react";
import { Button, formatDateTime } from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { useApi } from "../../../data/ApiContext";
import { useAuditLog } from "../../../data/platform-hooks";
import { useAppTranslation } from "../../../i18n";
import { ChangesTable, auditChangesOfEvent, useAuditLabels } from "./audit-changes";

const PAGE_SIZE = 20;

export interface EntityHistoryPanelProps {
  readonly entityType: string;
  readonly entityId: string;
}

export function EntityHistoryPanel({ entityType, entityId }: EntityHistoryPanelProps) {
  const { session } = useApi();
  const { t } = useAppTranslation();
  const allowed = can(
    createAuthContext({
      userId: session?.userId ?? "anonymous",
      permissions: session?.permissions ?? [],
      branchScope: "*",
      warehouseScope: "*",
    }),
    "audit.logs.view",
  );
  if (!allowed) {
    return (
      <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
        {t("auditLedger.history.noPermission")}
      </div>
    );
  }
  return <EntityHistoryList entityType={entityType} entityId={entityId} />;
}

function EntityHistoryList({ entityType, entityId }: EntityHistoryPanelProps) {
  const { t, locale } = useAppTranslation();
  const labels = useAuditLabels();
  const [page, setPage] = useState(0);
  const query = useAuditLog({ entityType, entityId, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const events = query.data?.events ?? [];
  const total = query.data?.total ?? 0;

  if (query.isLoading) {
    return <div className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("common.loading")}</div>;
  }
  if (query.isError) {
    return (
      <div className="rounded-md border border-border p-[18px] text-center">
        <p className="text-[12.5px] font-semibold text-danger-ink">{query.error?.message ?? t("auditLedger.history.loadFailed")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">
        {t("auditLedger.history.empty")}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-[12px]" aria-label={t("auditLedger.history.title")}>
      <p className="text-[12px] text-ink-muted">{t("auditLedger.history.description")}</p>
      <ol className="flex flex-col gap-[12px]">
        {events.map((event, i) => {
          const changes = auditChangesOfEvent(event);
          const stamp = new Date(event.timestamp);
          return (
            <li key={`${event.timestamp}-${i}`} className="rounded-lg border border-border bg-surface p-[12px_14px]">
              <div className="mb-[8px] flex flex-wrap items-center justify-between gap-[8px] text-[12.5px]">
                <span className="font-semibold text-ink">{labels.actionLabel(event.action)}</span>
                <span className="text-ink-muted">{event.actor}</span>
                <span className="mz-num text-ink-faint">
                  {Number.isNaN(stamp.getTime()) ? event.timestamp : formatDateTime(stamp, { locale })}
                </span>
              </div>
              <ChangesTable changes={changes} />
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-[8px] text-[12px] text-ink-muted">
        <span className="mz-num">{t("auditLedger.history.showing", { shown: events.length, total })}</span>
        <div className="flex gap-[6px]">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            {t("auditLedger.history.newer")}
          </Button>
          <Button size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
            {t("auditLedger.history.older")}
          </Button>
        </div>
      </div>
    </section>
  );
}
