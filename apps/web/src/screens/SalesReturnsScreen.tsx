import { useMemo, useRef, useState } from "react";
import {
  Button,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { Money, Qty, isAwaitingRefund, type DocumentStatus, type FrameworkDocument, type SalesReturnLine, type SalesReturnReason } from "@mezan/domain";
import { SelectField, NumberField } from "../settings/form-controls";
import { demoInvoices, demoWarehouses } from "../sample-data";
import { demoItems } from "../items-sample-data";
import { createReturnsLandedInstallmentsStore } from "../store/returns-landed-installments-store";
import { demoAccounts, demoOpenPeriod } from "../store/document-demo-shared";

/** مرتجعات المبيعات (Sales Returns) — docs/catalog/01. Document-framework-backed (draft → confirmed, restocks at cost, reduces AR). */

type Doc = FrameworkDocument<SalesReturnLine>;

const REASON_LABEL: Record<SalesReturnReason, string> = {
  DEFECTIVE: "معيب",
  WRONG_ITEM: "صنف خاطئ",
  EXCESS_QTY: "كمية زائدة",
  CHANGED_MIND: "تغيير رأي العميل",
  OTHER: "أخرى",
};

const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  confirmed: "مؤكد",
  posted: "مرحل",
  cancelled: "ملغي",
  reversed: "معكوس",
};
const STATUS_TONE: Record<DocumentStatus, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

interface LineDraft {
  key: string;
  itemId: string;
  qty: number;
}
let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: demoItems[0]?.id ?? "", qty: 1 };
}

export function SalesReturnsScreen() {
  const storeRef = useRef(createReturnsLandedInstallmentsStore({ accounts: demoAccounts, period: demoOpenPeriod }));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const documents = useMemo(() => storeRef.current.snapshot().salesReturns, [version]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatus>("all");
  const [invoiceId, setInvoiceId] = useState(demoInvoices[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(demoWarehouses[0]?.id ?? "");
  const [reason, setReason] = useState<SalesReturnReason>("DEFECTIVE");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0, awaitingRefund: 0, cancelled: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
      if (isAwaitingRefund(d)) c.awaitingRefund += 1;
      if (d.status === "cancelled") c.cancelled += 1;
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? documents.find((d) => d.id === panel.id) ?? null : null;

  function resetForm() {
    setLines([blankLine()]);
    setReason("DEFECTIVE");
    setError(null);
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    const invoice = demoInvoices.find((i) => i.id === invoiceId);
    const id = crypto.randomUUID();
    const returnLines: SalesReturnLine[] = lines
      .filter((l) => l.qty > 0)
      .map((l) => {
        const item = demoItems.find((it) => it.id === l.itemId);
        const unitPrice = Money.fromMajor(item?.salePrice ?? "0");
        const unitCost = Money.fromMajor(item?.costPrice ?? "0");
        const taxRate = item?.taxRatePercent ?? 0;
        const taxAmount = Money.fromMajor(((Number(unitPrice.toString()) * l.qty * taxRate) / 100).toFixed(6));
        return {
          itemId: l.itemId,
          warehouseId,
          customerId: invoice?.customer ?? "عميل",
          sourceInvoiceId: invoiceId,
          sourceInvoiceNumber: invoice?.number ?? null,
          reason,
          // No live invoice-lines source in this pass (docs/catalog/01's
          // "المتاح للإرجاع" needs the real sales-invoices module, landing in
          // a parallel PR) — generous headroom so the demo never blocks on it.
          availableQty: Qty.fromMajor(String(Math.max(l.qty * 5, 100))),
          qty: Qty.fromMajor(String(l.qty)),
          unitPrice,
          unitCost,
          taxAmount,
        };
      });
    if (returnLines.length === 0) {
      setError("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.");
      return;
    }
    try {
      await storeRef.current.salesReturns.createDraft({ id, date: new Date().toISOString().slice(0, 10), memo: "", lines: returnLines });
      if (confirmAfter) await storeRef.current.salesReturns.confirm(id, { actor: "demo", actorRoles: ["*"] });
      bump();
      setPanel("none");
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmExisting(id: string) {
    try {
      await storeRef.current.salesReturns.confirm(id, { actor: "demo", actorRoles: ["*"] });
      bump();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "draft", label: "مسودة", count: counts.draft },
    { key: "confirmed", label: "مؤكد", count: counts.confirmed },
    { key: "cancelled", label: "ملغي", count: counts.cancelled },
  ];

  const columns: DocumentListColumn<Doc>[] = [
    {
      key: "docNo",
      header: "رقم المرتجع",
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? "مسودة"}</div>
          <div className="text-[11px] text-ink-muted">{d.lines[0]?.sourceInvoiceNumber ?? "—"}</div>
        </div>
      ),
    },
    { key: "customer", header: "العميل", render: (d) => d.lines[0]?.customerId ?? "—" },
    {
      key: "total",
      header: "قيمة المرتجع",
      align: "end",
      render: (d) => <MoneyDisplay value={Number(Money.sum(d.lines.map((l) => l.unitPrice.add(l.taxAmount))).toString())} />,
    },
    {
      key: "status",
      header: "الحالة",
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} />
          {isAwaitingRefund(d) ? <StatusPill label="بانتظار دفع المبلغ" tone="warning" /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<Doc>
        eyebrow="Sales · Returns"
        title="مرتجعات المبيعات"
        description="مرتجع ضد فاتورة مبيعات مؤكدة — يعيد البضاعة للمخزون ويخفض مديونية العميل؛ لا يسترد المبلغ تلقائياً."
        actions={
          <Button variant="primary" onClick={() => setPanel("create")}>
            مرتجع جديد
          </Button>
        }
        stats={[
          { label: "إجمالي المرتجعات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مؤكدة", value: <span className="mz-num">{counts.confirmed}</span> },
          { label: "بانتظار دفع المبلغ", value: <span className="mz-num">{counts.awaitingRefund}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatus)}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> مرتجع
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد مرتجعات — أنشئ مرتجعاً جديداً</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title="مرتجع مبيعات جديد" description="مرتجع لا يعني استرداد المبلغ تلقائياً">
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label="فاتورة المصدر *"
            value={invoiceId}
            onChange={setInvoiceId}
            options={demoInvoices.filter((i) => i.status !== "draft" && i.status !== "cancelled").map((i) => ({ value: i.id, label: `${i.number} — ${i.customer}` }))}
          />
          <SelectField label="المستودع *" value={warehouseId} onChange={setWarehouseId} options={demoWarehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label="سبب الإرجاع *"
            value={reason}
            onChange={(v) => setReason(v as SalesReturnReason)}
            options={Object.entries(REASON_LABEL).map(([value, label]) => ({ value, label }))}
          />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">بنود المرتجع</span>
            {lines.map((line, idx) => (
              <div key={line.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label="الصنف"
                    value={line.itemId}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemId: v } : l)))}
                    options={demoItems.map((it) => ({ value: it.id, label: it.nameAr }))}
                  />
                </div>
                <div className="w-[90px]">
                  <NumberField
                    label="الكمية"
                    value={line.qty}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))}
                    min={0}
                  />
                </div>
                <Button variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} disabled={lines.length === 1}>
                  حذف
                </Button>
              </div>
            ))}
            <Button variant="default" onClick={() => setLines((prev) => [...prev, blankLine()])}>
              إضافة بند
            </Button>
          </div>

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              حفظ كمسودة
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              حفظ وتأكيد
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? "مرتجع مبيعات"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-1.5">
              <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
              {isAwaitingRefund(selected) ? <StatusPill label="بانتظار دفع المبلغ" tone="warning" /> : null}
            </div>
            <div className="text-[12.5px] text-ink-muted">فاتورة المصدر: {selected.lines[0]?.sourceInvoiceNumber ?? "—"}</div>
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{demoItems.find((it) => it.id === l.itemId)?.nameAr ?? l.itemId}</span>
                  <span className="mz-num text-ink-muted">
                    {l.qty.toString()} × <MoneyDisplay value={Number(l.unitPrice.toString())} />
                  </span>
                </div>
              ))}
            </div>
            {selected.status === "draft" ? (
              <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                تأكيد المرتجع
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
