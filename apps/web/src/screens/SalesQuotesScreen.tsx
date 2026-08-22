import { useMemo, useState } from "react";
import { Button, DocumentList, Money as MoneyDisplay, StatusPill, SidePanel, type DocumentListColumn, type DocumentListStatusChip, type PillTone } from "@mezan/ui";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import {
  useAcceptSalesQuote,
  useConvertSalesQuoteToInvoice,
  useCreateSalesQuote,
  useCustomers,
  useRejectSalesQuote,
  useSalesQuotes,
  useSendSalesQuote,
  type SalesQuoteRecord,
} from "../data/hooks";

type QuoteStatus = SalesQuoteRecord["status"];

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "مسودة",
  sent: "مرسل",
  accepted: "مقبول",
  rejected: "مرفوض",
  converted: "محول",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<QuoteStatus, PillTone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  converted: "success",
  cancelled: "neutral",
};

interface LineDraft {
  key: string;
  itemId: string;
  itemNameAr: string;
  qty: number;
  unitPrice: number;
}
let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: `ITEM-${lineSeq}`, itemNameAr: "", qty: 1, unitPrice: 0 };
}

/**
 * عروض الأسعار / Sales Quotations (docs/catalog/01 — مسودة → مرسل → مقبول →
 * محول). Real data only: list, create, and every status transition (send/
 * accept/reject/convert-to-invoice) go through `/sales-quotes` via TanStack
 * Query — the customer picker is real customers off `/customers` too.
 */
export function SalesQuotesScreen() {
  const query = useSalesQuotes();
  const quotes = query.data ?? [];
  const customersQuery = useCustomers();
  const customers = customersQuery.data ?? [];

  const create = useCreateSalesQuote();
  const send = useSendSalesQuote();
  const accept = useAcceptSalesQuote();
  const reject = useRejectSalesQuote();
  const convert = useConvertSalesQuoteToInvoice();

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteStatus>("all");
  const [customerId, setCustomerId] = useState("");
  const [expiryDate, setExpiryDate] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [convertDueDate, setConvertDueDate] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [convertWarehouseId, setConvertWarehouseId] = useState("");

  const counts = useMemo(() => {
    const c: Record<"all" | QuoteStatus, number> = { all: quotes.length, draft: 0, sent: 0, accepted: 0, rejected: 0, converted: 0, cancelled: 0 };
    for (const q of quotes) c[q.status] += 1;
    return c;
  }, [quotes]);

  const filtered = statusFilter === "all" ? quotes : quotes.filter((q) => q.status === statusFilter);
  const selected = typeof panel === "object" ? (quotes.find((q) => q.id === panel.id) ?? null) : null;

  function resetForm() {
    setLines([blankLine()]);
    setCustomerId(customers[0]?.id ?? "");
    setError(null);
  }

  async function submit() {
    setError(null);
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) {
      setError("اختر عميلاً.");
      return;
    }
    const quoteLines = lines.filter((l) => l.qty > 0 && l.itemNameAr.trim() !== "");
    if (quoteLines.length === 0) {
      setError("أضف بنداً واحداً على الأقل باسم صنف وكمية أكبر من صفر.");
      return;
    }
    try {
      await create.mutateAsync({
        date: new Date().toISOString().slice(0, 10),
        expiryDate,
        customerId: customer.id,
        customerNameAr: customer.nameAr,
        branchId: "BR1",
        lines: quoteLines.map((l) => ({
          lineId: l.key,
          itemId: l.itemId,
          itemNameAr: l.itemNameAr,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
        })),
      });
      setPanel("none");
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function doConvert(quote: SalesQuoteRecord) {
    setError(null);
    if (!convertWarehouseId.trim()) {
      setError("أدخل المستودع.");
      return;
    }
    try {
      await convert.mutateAsync({
        id: quote.id,
        body: {
          dueDate: convertDueDate,
          warehouseId: convertWarehouseId.trim(),
          arAccountId: "1105",
          taxAccountId: "2200",
          lines: quote.lines.map((l) => ({ lineId: l.lineId, isStock: false, revenueAccountId: "4100" })),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "draft", label: "مسودة", count: counts.draft },
    { key: "sent", label: "مرسل", count: counts.sent },
    { key: "accepted", label: "مقبول", count: counts.accepted },
    { key: "rejected", label: "مرفوض", count: counts.rejected },
    { key: "converted", label: "محول", count: counts.converted },
  ];

  const columns: DocumentListColumn<SalesQuoteRecord>[] = [
    {
      key: "docNo",
      header: "رقم العرض",
      render: (q) => (
        <div>
          <div className="mz-num font-semibold text-ink">{q.docNo ?? "مسودة"}</div>
          <div className="text-[11px] text-ink-muted">{q.customerNameAr}</div>
        </div>
      ),
    },
    { key: "expiry", header: "تاريخ الانتهاء", render: (q) => <span className="mz-num">{q.expiryDate}</span> },
    {
      key: "total",
      header: "الإجمالي",
      align: "end",
      render: (q) => <MoneyDisplay value={Number(q.totals.grandTotal)} />,
    },
    { key: "status", header: "الحالة", render: (q) => <StatusPill label={STATUS_LABEL[q.status]} tone={STATUS_TONE[q.status]} /> },
  ];

  return (
    <div className="w-full">
      <DocumentList<SalesQuoteRecord>
        eyebrow="Sales · Quotations"
        title="عروض الأسعار"
        description="عروض أسعار للعملاء قابلة للتحويل إلى فاتورة مبيعات مؤكدة بعد قبولها."
        actions={
          <Button variant="primary" onClick={() => { resetForm(); setPanel("create"); }}>
            عرض سعر جديد
          </Button>
        }
        stats={[
          { label: "إجمالي العروض", value: <span className="mz-num">{counts.all}</span> },
          { label: "مقبولة", value: <span className="mz-num">{counts.accepted}</span> },
          { label: "محولة", value: <span className="mz-num">{counts.converted}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | QuoteStatus)}
        columns={columns}
        rows={filtered}
        rowKey={(q) => q.id}
        onRowClick={(q) => setPanel({ id: q.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> عرض
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">{query.isLoading ? "جارِ التحميل…" : "لا توجد عروض أسعار — أنشئ عرضاً جديداً"}</div>
        }
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title="عرض سعر جديد">
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label="العميل *"
            value={customerId}
            onChange={setCustomerId}
            options={[{ value: "", label: "اختر عميلاً" }, ...customers.map((c) => ({ value: c.id, label: c.nameAr }))]}
          />
          <TextField label="تاريخ الانتهاء" value={expiryDate} onChange={setExpiryDate} placeholder="YYYY-MM-DD" />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">البنود</span>
            {lines.map((line) => (
              <div key={line.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <TextField
                    label="اسم الصنف"
                    value={line.itemNameAr}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemNameAr: v } : l)))}
                  />
                </div>
                <div className="w-[80px]">
                  <NumberField
                    label="الكمية"
                    value={line.qty}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))}
                    min={0}
                  />
                </div>
                <div className="w-[100px]">
                  <NumberField
                    label="سعر الوحدة"
                    value={line.unitPrice}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, unitPrice: v } : l)))}
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
            <Button variant="default" onClick={() => setPanel("none")}>
              إلغاء
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending}>
              حفظ كمسودة
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? "عرض سعر"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <div className="text-[12.5px] text-ink-muted">العميل: {selected.customerNameAr}</div>
            <div className="text-[12.5px] text-ink-muted">تاريخ الانتهاء: <span className="mz-num">{selected.expiryDate}</span></div>
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l) => (
                <div key={l.lineId} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{l.itemNameAr}</span>
                  <span className="mz-num text-ink-muted">
                    {l.qty} × <MoneyDisplay value={Number(l.unitPrice)} />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-[13px] font-semibold">
              <span>الإجمالي الكلي</span>
              <MoneyDisplay value={Number(selected.totals.grandTotal)} />
            </div>

            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

            {selected.status === "draft" ? (
              <Button variant="primary" onClick={() => send.mutate(selected.id)} disabled={send.isPending}>
                إرسال للعميل
              </Button>
            ) : null}
            {selected.status === "sent" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => accept.mutate(selected.id)} disabled={accept.isPending}>
                  قبول العميل
                </Button>
                <Button variant="default" onClick={() => reject.mutate(selected.id)} disabled={reject.isPending}>
                  رفض
                </Button>
              </div>
            ) : null}
            {selected.status === "accepted" ? (
              <div className="flex flex-col gap-3 rounded-[10px] border border-border p-3">
                <span className="text-[12.5px] font-semibold text-ink">تحويل إلى فاتورة مبيعات</span>
                <TextField label="تاريخ الاستحقاق" value={convertDueDate} onChange={setConvertDueDate} placeholder="YYYY-MM-DD" />
                <TextField label="المستودع *" value={convertWarehouseId} onChange={setConvertWarehouseId} placeholder="WH1" />
                <Button variant="primary" onClick={() => doConvert(selected)} disabled={convert.isPending}>
                  إنشاء الفاتورة
                </Button>
              </div>
            ) : null}
            {selected.status === "converted" ? (
              <div className="rounded-[8px] bg-success-soft px-3 py-2 text-[12.5px] text-success-ink">
                تم تحويل هذا العرض إلى فاتورة مبيعات.
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
