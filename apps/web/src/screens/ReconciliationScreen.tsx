import { useState } from "react";
import { FulcrumRule, DocumentList, StatusPill, Chip, Button, Card, type DocumentListColumn } from "@mezan/ui";
import type { ReconciliationRowDTO, UnlinkedEntryLineDTO } from "@mezan/contracts";
import { useReconciliation } from "../data/hooks";

function fmt(value: string): string {
  return Number(value).toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * مطابقة الأرصدة — Balance Reconciliation (docs/catalog/04). Cross-checks each
 * sub-ledger balance against its GL control account and flags journal lines
 * posted directly to a control account (القيود غير المرتبطة), on the real
 * `GET /reconciliation` route (packages/api/src/reconciliation-routes.ts),
 * which runs the SAME `computeBalanceReconciliation` / `findUnlinkedControlLines`
 * domain functions server-side.
 */
export function ReconciliationScreen() {
  const query = useReconciliation();
  const [tab, setTab] = useState<"summary" | "unlinked">("summary");
  const report = query.data ?? null;

  const summaryColumns: DocumentListColumn<ReconciliationRowDTO>[] = [
    { key: "label", header: "المطابقة", render: (r) => <span className="font-semibold text-ink">{r.label}</span> },
    { key: "sub", header: "رصيد المصدر", render: (r) => <span className="mz-num">{fmt(r.subLedgerBalance)}</span> },
    { key: "gl", header: "رصيد دفتر الأستاذ", render: (r) => <span className="mz-num">{fmt(r.glBalance)}</span> },
    { key: "diff", header: "الفارق", render: (r) => <span className={`mz-num ${r.matched ? "text-ink-muted" : "text-danger-ink font-bold"}`}>{fmt(r.difference)}</span> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={r.matched ? "متطابق" : "غير متطابق"} tone={r.matched ? "success" : "danger"} /> },
  ];

  const unlinkedColumns: DocumentListColumn<UnlinkedEntryLineDTO>[] = [
    { key: "no", header: "رقم القيد", render: (u) => <span className="mz-num text-ink">{u.entryNo ?? u.entryId}</span> },
    { key: "date", header: "التاريخ", render: (u) => <span className="mz-num text-ink-muted">{u.date}</span> },
    { key: "account", header: "الحساب", render: (u) => <span className="text-ink">{u.accountId}</span> },
    { key: "memo", header: "الوصف", render: (u) => <span className="text-ink-muted">{u.memo ?? "—"}</span> },
    { key: "debit", header: "مدين", render: (u) => <span className="mz-num">{fmt(u.debit)}</span> },
    { key: "credit", header: "دائن", render: (u) => <span className="mz-num">{fmt(u.credit)}</span> },
  ];

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">Accounting · Reconciliation</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">مطابقة الأرصدة</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">مطابقة أرصدة دفاتر المساعدة مع حسابات المراقبة في دفتر الأستاذ، ورصد البنود غير المرتبطة</p>
        </div>
        <Button onClick={() => query.refetch()}>تحديث</Button>
      </div>
      <FulcrumRule />

      {query.isError ? (
        <Card className="mb-[16px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل مطابقة الأرصدة.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      {report ? (
        <div className={`mb-[16px] rounded-md border px-[12px] py-[10px] text-[12.5px] ${report.allMatched ? "border-success bg-success-soft text-success-ink" : "border-warning bg-warning-soft text-warning-ink"}`}>
          {report.allMatched ? "جميع الأرصدة متطابقة" : "توجد فروقات تحتاج إلى مراجعة"}
        </div>
      ) : null}

      <div className="mb-[16px] flex flex-wrap gap-[8px]">
        <Chip active={tab === "summary"} onClick={() => setTab("summary")}>ملخص المطابقة</Chip>
        <Chip active={tab === "unlinked"} onClick={() => setTab("unlinked")}>القيود غير المرتبطة ({report?.unlinked.length ?? 0})</Chip>
      </div>

      {tab === "summary" ? (
        <DocumentList<ReconciliationRowDTO>
          eyebrow="Accounting · Reconciliation"
          title=""
          columns={summaryColumns}
          rows={report?.rows ?? []}
          rowKey={(r) => r.key}
          page={1}
          pageCount={1}
          pageSummary={<>عرض <span className="mz-num">{report?.rows.length ?? 0}</span> مطابقة</>}
          emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد حسابات مراقبة</div>}
        />
      ) : (
        <>
          {report && report.unlinked.length === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-muted">جميع بنود حسابات المراقبة مخصصة بشكل صحيح</Card>
          ) : (
            <DocumentList<UnlinkedEntryLineDTO>
              eyebrow="Accounting · Reconciliation"
              title=""
              columns={unlinkedColumns}
              rows={report?.unlinked ?? []}
              rowKey={(u) => `${u.entryId}-${u.accountId}`}
              page={1}
              pageCount={1}
              pageSummary={<>عرض <span className="mz-num">{report?.unlinked.length ?? 0}</span> بند غير مرتبط</>}
              emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بنود</div>}
            />
          )}
        </>
      )}
    </div>
  );
}
