import { useState } from "react";
import { buildReportExport, downloadReportExport, type ReportExportColumn, type ReportExportFormat } from "@mezan/ui";
import type { AuditEventDTO, AuditFieldChangeDTO, AuditQueryDTO, AuditQueryResponseDTO, BranchDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { readError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";
import { branchName } from "../../../settings/branch-name";
import { auditChangesOfEvent, useAuditLabels } from "./audit-changes";
import { todayIso } from "../../../lib/dates";

const PAGE = 200;
export const AUDIT_EXPORT_CAP = 10_000;

export function auditQueryString(filter: AuditQueryDTO): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

function safeCell(value: string): string {
  if (value === "" || NUMERIC.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

interface ExportRow {
  readonly event: AuditEventDTO;
  readonly change: AuditFieldChangeDTO | null;
}

export interface AuditExportOutcome {
  readonly exported: number;
  readonly total: number;
}

export function useAuditExport(branches: readonly BranchDTO[]) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const labels = useAuditLabels();
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AuditExportOutcome | null>(null);

  async function fetchAll(filter: AuditQueryDTO): Promise<AuditExportOutcome & { events: AuditEventDTO[] }> {
    const frozen: AuditQueryDTO = { ...filter, to: filter.to ?? new Date().toISOString() };
    const events: AuditEventDTO[] = [];
    let total = 0;
    for (let offset = 0; offset < AUDIT_EXPORT_CAP; offset += PAGE) {
      const qs = auditQueryString({ ...frozen, limit: PAGE, offset });
      const res = await request(`/audit?${qs}`);
      if (!res.ok) throw new Error(await readError(res, t("auditLedger.exportFailed"), t));
      const body = await res.json<AuditQueryResponseDTO>();
      total = body.total;
      events.push(...body.events);
      if (body.events.length < PAGE || events.length >= total) break;
    }
    return { events, exported: events.length, total };
  }

  const columns: ReportExportColumn<ExportRow>[] = [
    { key: "timestamp", header: t("auditLedger.col.timestamp"), value: (r) => r.event.timestamp },
    { key: "stream", header: t("auditLedger.col.stream"), value: (r) => safeCell(r.event.stream) },
    { key: "module", header: t("auditLedger.col.module"), value: (r) => safeCell(r.event.module) },
    { key: "entityType", header: t("auditLedger.col.entityType"), value: (r) => safeCell(r.event.entityType) },
    { key: "entityId", header: t("auditLedger.col.entityId"), value: (r) => safeCell(r.event.entityId ?? "") },
    { key: "action", header: t("auditLedger.col.action"), value: (r) => safeCell(labels.actionLabel(r.event.action)) },
    { key: "actor", header: t("auditLedger.col.actor"), value: (r) => safeCell(r.event.actor) },
    {
      key: "branch",
      header: t("auditLedger.col.branch"),
      value: (r) => (r.event.branchId === null ? "" : safeCell(branchName(r.event.branchId, branches))),
    },
    { key: "severity", header: t("auditLedger.col.severity"), value: (r) => safeCell(r.event.severity) },
    {
      key: "origin",
      header: t("auditLedger.col.origin"),
      value: (r) => {
        const origin = r.event.details?.["origin"];
        return typeof origin === "string" ? safeCell(origin) : "";
      },
    },
    { key: "field", header: t("auditLedger.field"), value: (r) => (r.change ? safeCell(labels.fieldLabel(r.change.field)) : "") },
    { key: "key", header: t("auditLedger.key"), value: (r) => safeCell(r.change?.key ?? "") },
    { key: "from", header: t("auditLedger.before"), value: (r) => (r.change ? safeCell(labels.fromLabel(r.change)) : "") },
    { key: "to", header: t("auditLedger.after"), value: (r) => (r.change ? safeCell(labels.toLabel(r.change)) : "") },
  ];

  async function run(format: ReportExportFormat, filter: AuditQueryDTO) {
    if (busy !== null) return;
    setBusy(format);
    setError(null);
    setOutcome(null);
    try {
      const { events, exported, total } = await fetchAll(filter);
      const rows: ExportRow[] = events.flatMap((event): ExportRow[] => {
        const changes = auditChangesOfEvent(event);
        return changes.length === 0 ? [{ event, change: null }] : changes.map((change) => ({ event, change }));
      });
      const file = await buildReportExport(columns, rows, {
        format,
        baseFilename: `audit-log-${todayIso()}`,
        sheetName: t("auditLedger.sheetName"),
      });
      downloadReportExport(file);
      setOutcome({ exported, total });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auditLedger.exportFailed"));
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, outcome };
}
