import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { AuditEventDTO, AuditSeverityDTO, AuditStreamDTO } from "@mezan/contracts";
import { useAuditLog } from "../data/platform-hooks";
import { useBranches } from "../data/hooks";
import { branchName } from "../settings/branch-name";
import { SelectField, TextField } from "../settings/form-controls";

/**
 * سجل المراجعة (Audit Log Viewer) — `/audit`. Read-only over the real,
 * append-only `audit_event` table (packages/persistence/src/audit-sink.ts —
 * BEFORE UPDATE/DELETE triggers RAISE(ABORT) at the storage layer). This
 * screen has no edit or delete affordance anywhere — an audit row is
 * evidence, not editable state.
 */

const PAGE_SIZE = 25;

const STREAM_LABEL: Record<AuditStreamDTO, string> = {
  security: "أحداث الأمان",
  sensitive: "العمليات الحساسة",
};
const STREAM_TONE: Record<AuditStreamDTO, PillTone> = {
  security: "warning",
  sensitive: "info",
};

const SEVERITY_LABEL: Record<AuditSeverityDTO, string> = {
  CRITICAL: "حرج",
  ERROR: "خطأ",
  WARNING: "تحذير",
  INFO: "معلومة",
};
const SEVERITY_TONE: Record<AuditSeverityDTO, PillTone> = {
  CRITICAL: "danger",
  ERROR: "danger",
  WARNING: "warning",
  INFO: "neutral",
};

const SEVERITY_OPTIONS = [
  { value: "", label: "كل درجات الخطورة" },
  { value: "CRITICAL", label: "حرج" },
  { value: "ERROR", label: "خطأ" },
  { value: "WARNING", label: "تحذير" },
  { value: "INFO", label: "معلومة" },
];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
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
        header: "التاريخ والوقت",
        render: (e) => <span className="mz-num text-ink-muted">{formatTimestamp(e.timestamp)}</span>,
      },
      {
        key: "stream",
        header: "النوع",
        render: (e) => <StatusPill label={STREAM_LABEL[e.stream]} tone={STREAM_TONE[e.stream]} />,
      },
      { key: "module", header: "الوحدة", render: (e) => <span className="text-ink">{e.module}</span> },
      { key: "entityType", header: "الكيان", render: (e) => <span className="mz-num text-ink-muted">{e.entityType}</span> },
      { key: "action", header: "الإجراء", render: (e) => <span className="font-semibold text-ink">{e.action}</span> },
      { key: "actor", header: "المستخدم", render: (e) => <span className="text-ink-muted">{e.actor}</span> },
      {
        key: "branchId",
        header: "الفرع",
        render: (e) => (
          <span className="text-ink-muted">{e.branchId === null ? "—" : branchName(e.branchId, branches)}</span>
        ),
      },
      {
        key: "severity",
        header: "الخطورة",
        render: (e) => <StatusPill label={SEVERITY_LABEL[e.severity]} tone={SEVERITY_TONE[e.severity]} />,
      },
    ],
    [branches],
  );

  return (
    <>
      {listQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل سجل المراجعة.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => listQuery.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<AuditEventDTO>
        eyebrow="Platform · Audit Log"
        title="سجل المراجعة"
        description="سجل الأحداث الأمنية والعمليات الحساسة — للقراءة فقط، ولا يمكن تعديله أو حذفه"
        stats={[
          { label: "إجمالي حسب الفلاتر الحالية", value: <span className="mz-num">{total}</span> },
          { label: "أحداث الأمان", value: <span className="mz-num">{securityTotal}</span> },
          { label: "العمليات الحساسة", value: <span className="mz-num">{sensitiveTotal}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: securityTotal + sensitiveTotal },
          { key: "security", label: "أحداث الأمان", count: securityTotal },
          { key: "sensitive", label: "العمليات الحساسة", count: sensitiveTotal },
        ]}
        activeStatusKey={filters.stream}
        onStatusChange={(k) => updateFilters({ stream: k as Filters["stream"] })}
        searchValue={filters.actor}
        onSearchChange={(v) => updateFilters({ actor: v })}
        searchPlaceholder="بحث باسم المستخدم..."
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[150px]">
              <TextField label="الوحدة" value={filters.module} onChange={(v) => updateFilters({ module: v })} />
            </div>
            <div className="w-[150px]">
              <TextField label="الإجراء" value={filters.action} onChange={(v) => updateFilters({ action: v })} />
            </div>
            <div className="w-[150px]">
              <TextField label="الكيان" value={filters.entityType} onChange={(v) => updateFilters({ entityType: v })} />
            </div>
            <div className="w-[170px]">
              <SelectField
                label="الخطورة"
                value={filters.severity}
                onChange={(v) => updateFilters({ severity: v as Filters["severity"] })}
                options={SEVERITY_OPTIONS}
              />
            </div>
            <div className="w-[170px]">
              <SelectField
                label="الفرع"
                value={filters.branchId}
                onChange={(v) => updateFilters({ branchId: v })}
                options={[
                  { value: "", label: "كل الفروع" },
                  ...branches.map((b) => ({ value: b.id, label: branchName(b.id, branches) })),
                ]}
              />
            </div>
            <div className="w-[140px]">
              <TextField label="من تاريخ" value={filters.from} onChange={(v) => updateFilters({ from: v })} placeholder="YYYY-MM-DD" />
            </div>
            <div className="w-[140px]">
              <TextField label="إلى تاريخ" value={filters.to} onChange={(v) => updateFilters({ to: v })} placeholder="YYYY-MM-DD" />
            </div>
            <Button size="sm" onClick={() => updateFilters(BLANK_FILTERS)}>
              مسح الفلاتر
            </Button>
          </div>
        }
        columns={columns}
        rows={events}
        rowKey={(e) => `${e.timestamp}-${e.actor}-${e.action}-${e.entityType}`}
        onRowClick={setSelected}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSummary={
          <>
            عرض <span className="mz-num">{events.length}</span> من <span className="mz-num">{total}</span> حدث
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أحداث مطابقة</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelected(null)} title="تفاصيل الحدث" description="سجل مراجعة — للقراءة فقط">
        {selected ? (
          <div className="flex flex-col gap-[14px]">
            <dl className="flex flex-col gap-[8px] text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">التاريخ والوقت</dt>
                <dd className="mz-num text-ink">{formatTimestamp(selected.timestamp)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">النوع</dt>
                <dd><StatusPill label={STREAM_LABEL[selected.stream]} tone={STREAM_TONE[selected.stream]} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">الوحدة</dt>
                <dd className="text-ink">{selected.module}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">الكيان</dt>
                <dd className="text-ink">{selected.entityType}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">الإجراء</dt>
                <dd className="font-semibold text-ink">{selected.action}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">المستخدم</dt>
                <dd className="text-ink">{selected.actor}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">الفرع</dt>
                <dd className="text-ink">
                  {selected.branchId === null ? (
                    <span className="text-ink-faint">لم يُسجَّل فرع لهذا الحدث</span>
                  ) : (
                    branchName(selected.branchId, branches)
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">الخطورة</dt>
                <dd><StatusPill label={SEVERITY_LABEL[selected.severity]} tone={SEVERITY_TONE[selected.severity]} /></dd>
              </div>
            </dl>
            <div>
              <h4 className="mb-[6px] text-[12.5px] font-semibold text-ink">تفاصيل إضافية</h4>
              {selected.details === null ? (
                <p className="text-[12.5px] text-ink-faint">لا توجد تفاصيل إضافية</p>
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
