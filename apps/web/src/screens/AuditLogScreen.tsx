import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Button, Card, SidePanel, formatDateTime, type DocumentListColumn, type Locale, type PillTone } from "@mezan/ui";
import type { AuditEventDTO, AuditSeverityDTO, AuditStreamDTO } from "@mezan/contracts";
import { useAuditLog } from "../data/platform-hooks";
import { useBranches } from "../data/hooks";
import { branchName } from "../settings/branch-name";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * سجل المراجعة (Audit Log Viewer) — `/audit`. Read-only over the real,
 * append-only `audit_event` table (packages/persistence/src/audit-sink.ts —
 * BEFORE UPDATE/DELETE triggers RAISE(ABORT) at the storage layer). This
 * screen has no edit or delete affordance anywhere — an audit row is
 * evidence, not editable state.
 */

const PAGE_SIZE = 25;

const STREAM_KEY: Record<AuditStreamDTO, AppTranslationKey> = {
  security: "audit.securityEvents",
  sensitive: "audit.sensitiveOperations",
};
const STREAM_TONE: Record<AuditStreamDTO, PillTone> = {
  security: "warning",
  sensitive: "info",
};

const SEVERITY_KEY: Record<AuditSeverityDTO, AppTranslationKey> = {
  CRITICAL: "audit.critical",
  ERROR: "audit.error",
  WARNING: "audit.warning",
  INFO: "audit.info",
};
const SEVERITY_TONE: Record<AuditSeverityDTO, PillTone> = {
  CRITICAL: "danger",
  ERROR: "danger",
  WARNING: "warning",
  INFO: "neutral",
};

const SEVERITY_OPTION_KEYS: { value: string; key: AppTranslationKey }[] = [
  { value: "", key: "audit.allSeverities" },
  { value: "CRITICAL", key: "audit.critical" },
  { value: "ERROR", key: "audit.error" },
  { value: "WARNING", key: "audit.warning" },
  { value: "INFO", key: "audit.info" },
];

function formatTimestamp(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateTime(d, { locale });
}

interface Filters {
  stream: "all" | AuditStreamDTO;
  module: string;
  action: string;
  actor: string;
  entityType: string;
  severity: "" | AuditSeverityDTO;
  branchId: string;
  from: string;
  to: string;
}

const BLANK_FILTERS: Filters = {
  stream: "all",
  module: "",
  action: "",
  actor: "",
  entityType: "",
  severity: "",
  branchId: "",
  from: "",
  to: "",
};

export function AuditLogScreen() {
  const { t, locale } = useAppTranslation();
  const branchesQuery = useBranches();
  const branches = useMemo(() => branchesQuery.data ?? [], [branchesQuery.data]);
  const [filters, setFilters] = useState<Filters>(BLANK_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEventDTO | null>(null);

  function updateFilters(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  const listQuery = useAuditLog({
    stream: filters.stream === "all" ? undefined : filters.stream,
    module: filters.module.trim() || undefined,
    action: filters.action.trim() || undefined,
    actor: filters.actor.trim() || undefined,
    entityType: filters.entityType.trim() || undefined,
    severity: filters.severity || undefined,
    branchId: filters.branchId || undefined,
    from: filters.from.trim() || undefined,
    to: filters.to.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // Cheap independent lookups purely to feed the stream chip/stat counts —
  // deliberately ignore the other filters so the chips reflect the whole log.
  const securityCountQuery = useAuditLog({ stream: "security", limit: 1 });
  const sensitiveCountQuery = useAuditLog({ stream: "sensitive", limit: 1 });
  const securityTotal = securityCountQuery.data?.total ?? 0;
  const sensitiveTotal = sensitiveCountQuery.data?.total ?? 0;

  const events = listQuery.data?.events ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: DocumentListColumn<AuditEventDTO>[] = useMemo(
    () => [
      {
        key: "timestamp",
        header: t("audit.dateAndTime"),
        render: (e) => <span className="mz-num text-ink-muted">{formatTimestamp(e.timestamp, locale)}</span>,
      },
      {
        key: "stream",
        header: t("common.type"),
        render: (e) => <StatusPill label={t(STREAM_KEY[e.stream])} tone={STREAM_TONE[e.stream]} />,
      },
      { key: "module", header: t("audit.module"), render: (e) => <span className="text-ink">{e.module}</span> },
      { key: "entityType", header: t("audit.entity"), render: (e) => <span className="mz-num text-ink-muted">{e.entityType}</span> },
      { key: "action", header: t("audit.action"), render: (e) => <span className="font-semibold text-ink">{e.action}</span> },
      { key: "actor", header: t("audit.user"), render: (e) => <span className="text-ink-muted">{e.actor}</span> },
      {
        key: "branchId",
        header: t("common.branch"),
        render: (e) => (
          <span className="text-ink-muted">{e.branchId === null ? "—" : branchName(e.branchId, branches)}</span>
        ),
      },
      {
        key: "severity",
        header: t("audit.severity"),
        render: (e) => <StatusPill label={t(SEVERITY_KEY[e.severity])} tone={SEVERITY_TONE[e.severity]} />,
      },
    ],
    [branches],
  );

  return (
    <>
      {listQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("audit.couldNotLoadTheAudit")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => listQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<AuditEventDTO>
        title={t("audit.auditLog")}
        description={t("audit.aRecordOfSecurityEvents")}
        listKey="audit-log"
        statsCollapsible
        stats={[
          { label: t("audit.totalUnderTheCurrentFilters"), value: <span className="mz-num">{total}</span> },
          { label: t("audit.securityEvents"), value: <span className="mz-num">{securityTotal}</span> },
          { label: t("audit.sensitiveOperations"), value: <span className="mz-num">{sensitiveTotal}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: securityTotal + sensitiveTotal },
          { key: "security", label: t("audit.securityEvents"), count: securityTotal },
          { key: "sensitive", label: t("audit.sensitiveOperations"), count: sensitiveTotal },
        ]}
        activeStatusKey={filters.stream}
        onStatusChange={(k) => updateFilters({ stream: k as Filters["stream"] })}
        searchValue={filters.actor}
        onSearchChange={(v) => updateFilters({ actor: v })}
        searchPlaceholder={t("audit.searchByUser")}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[150px]">
              <TextField label={t("audit.module")} value={filters.module} onChange={(v) => updateFilters({ module: v })} />
            </div>
            <div className="w-[150px]">
              <TextField label={t("audit.action")} value={filters.action} onChange={(v) => updateFilters({ action: v })} />
            </div>
            <div className="w-[150px]">
              <TextField label={t("audit.entity")} value={filters.entityType} onChange={(v) => updateFilters({ entityType: v })} />
            </div>
            <div className="w-[170px]">
              <SelectField
                label={t("audit.severity")}
                value={filters.severity}
                onChange={(v) => updateFilters({ severity: v as Filters["severity"] })}
                options={SEVERITY_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
              />
            </div>
            <div className="w-[170px]">
              <SelectField
                label={t("common.branch")}
                value={filters.branchId}
                onChange={(v) => updateFilters({ branchId: v })}
                options={[
                  { value: "", label: t("audit.allBranches") },
                  ...branches.map((b) => ({ value: b.id, label: branchName(b.id, branches) })),
                ]}
              />
            </div>
            <div className="w-[140px]">
              <TextField label={t("audit.from")} value={filters.from} onChange={(v) => updateFilters({ from: v })} placeholder="YYYY-MM-DD" />
            </div>
            <div className="w-[140px]">
              <TextField label={t("audit.to")} value={filters.to} onChange={(v) => updateFilters({ to: v })} placeholder="YYYY-MM-DD" />
            </div>
            <Button size="sm" onClick={() => updateFilters(BLANK_FILTERS)}>
              {t("audit.clearFilters")}
            </Button>
          </div>
        }
        columns={columns}
        rows={events}
        // Bulk writes share a millisecond, an actor and an action — only the position separates them.
        rowKey={(e, i) => `${e.timestamp}-${e.actor}-${e.action}-${e.entityType}-${i}`}
        onRowClick={setSelected}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{events.length}</span> {t("common.of")} <span className="mz-num">{total}</span> {t("audit.event")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("audit.noMatchingEvents")}</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelected(null)} title={t("audit.eventDetails")} description={t("audit.auditLogReadOnly")}>
        {selected ? (
          <div className="flex flex-col gap-[14px]">
            <dl className="flex flex-col gap-[8px] text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.dateAndTime")}</dt>
                <dd className="mz-num text-ink">{formatTimestamp(selected.timestamp, locale)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("common.type")}</dt>
                <dd><StatusPill label={t(STREAM_KEY[selected.stream])} tone={STREAM_TONE[selected.stream]} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.module")}</dt>
                <dd className="text-ink">{selected.module}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.entity")}</dt>
                <dd className="text-ink">{selected.entityType}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.action")}</dt>
                <dd className="font-semibold text-ink">{selected.action}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.user")}</dt>
                <dd className="text-ink">{selected.actor}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("common.branch")}</dt>
                <dd className="text-ink">
                  {selected.branchId === null ? (
                    <span className="text-ink-faint">{t("audit.noBranchWasRecordedFor")}</span>
                  ) : (
                    branchName(selected.branchId, branches)
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("audit.severity")}</dt>
                <dd><StatusPill label={t(SEVERITY_KEY[selected.severity])} tone={SEVERITY_TONE[selected.severity]} /></dd>
              </div>
            </dl>
            <div>
              <h4 className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("audit.furtherDetails")}</h4>
              {selected.details === null ? (
                <p className="text-[12.5px] text-ink-faint">{t("audit.noFurtherDetails")}</p>
              ) : (
                <pre className="mz-num overflow-x-auto rounded-md border border-border bg-surface-2 p-[12px] text-[11.5px] text-ink-muted">
                  {JSON.stringify(selected.details, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ) : null}
      </SidePanel>
    </>
  );
}
