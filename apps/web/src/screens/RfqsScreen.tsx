import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
} from "@mezan/ui";
import { Money, Qty, compareRfqQuotes, type PurchaseRfq, type PurchaseRfqStatus, type RfqQuote } from "@mezan/domain";
import { demoSuppliers } from "../partners-sample-data";
import { demoPurchaseItems, itemName, supplierName } from "../purchasing-sample-data";
import { demoRfqs, demoRfqQuotes } from "../rfq-sample-data";
import { TextField, NumberField } from "../settings/form-controls";

/**
 * طلبات عروض الأسعار (RFQs — docs/catalog/02 §"طلبات عروض الأسعار"): مسودة →
 * مرسل → مغلق (ملغي as a cancel path). Pre-PO document — capture requested
 * items, collect supplier quotes once sent, compare them, then convert the
 * chosen quote into a Purchase Order. Mirrors PurchaseOrdersScreen.tsx's demo
 * pattern (local state seeded from rfq-sample-data.ts) — the real permission-
 * gated `/rfqs` routes already exist in @mezan/api, this screen just isn't
 * wired to a live client yet (same as every other purchases screen).
 *
 * `compareRfqQuotes` is the one piece of real domain logic this screen calls
 * directly (pure, no I/O) — the comparison grid is exactly what the domain
 * computes, not a UI re-derivation of it.
 */

const STATUS_LABEL: Record<PurchaseRfqStatus, string> = {
  draft: "مسودة",
  sent: "مرسل",
  closed: "مغلق",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<PurchaseRfqStatus, PillTone> = {
  draft: "neutral",
  sent: "info",
  closed: "success",
  cancelled: "danger",
};

const num = (m: Money) => Number(m.toString());
const itemOptions: EntityPickerOption[] = demoPurchaseItems.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.unit }));
const supplierOptions: EntityPickerOption[] = demoSuppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));

let nextRfqSeq = demoRfqs.length + 1;
let nextQuoteSeq = demoRfqQuotes.length + 1;

interface DraftLine {
  itemId: string;
  qty: number;
  notes: string;
}

interface QuoteDraftLine {
  itemId: string;
  unitPrice: number;
}

function fmtDate(iso: string | null): string {
  return iso ? iso.split("-").reverse().join("/") : "—";
}

function RfqDetail({
  rfq,
  quotes,
  onBack,
  onSend,
  onClose,
  onCancel,
  onAddQuote,
  onConvert,
}: {
  rfq: PurchaseRfq;
  quotes: RfqQuote[];
  onBack: () => void;
  onSend: () => void;
  onClose: () => void;
  onCancel: () => void;
  onAddQuote: (supplierId: string, lines: QuoteDraftLine[], notes: string) => void;
  onConvert: (supplierId: string) => void;
}) {
  const [quoteSupplier, setQuoteSupplier] = useState<EntityPickerOption | null>(null);
  const [quoteLines, setQuoteLines] = useState<QuoteDraftLine[]>(rfq.lines.map((l) => ({ itemId: l.itemId, unitPrice: 0 })));
  const [quoteNotes, setQuoteNotes] = useState("");

  const comparison = useMemo(() => compareRfqQuotes(rfq, quotes), [rfq, quotes]);
  const alreadyQuotedSupplierIds = new Set(quotes.map((q) => q.supplierId));
  const availableQuoteSuppliers = supplierOptions.filter((s) => !alreadyQuotedSupplierIds.has(s.id));

  function submitQuote() {
    if (!quoteSupplier) return;
    const priced = quoteLines.filter((l) => l.unitPrice > 0);
    if (priced.length === 0) return;
    onAddQuote(quoteSupplier.id, priced, quoteNotes);
    setQuoteSupplier(null);
    setQuoteLines(rfq.lines.map((l) => ({ itemId: l.itemId, unitPrice: 0 })));
    setQuoteNotes("");
  }

  return (
    <DocumentDetail
      title={`طلب عرض سعر ${rfq.number}`}
      statusLabel={STATUS_LABEL[rfq.status]}
      statusTone={STATUS_TONE[rfq.status]}
      subtitle={`${rfq.date.split("-").reverse().join("/")} · ${rfq.lines.length} بند`}
      actions={
        <>
          {rfq.status === "draft" ? (
            <Button variant="primary" onClick={onSend}>
              إرسال
            </Button>
          ) : null}
          {rfq.status === "sent" ? <Button onClick={onClose}>إغلاق بدون تحويل</Button> : null}
          {rfq.status === "draft" || rfq.status === "sent" ? (
            <Button onClick={onCancel}>إلغاء الطلب</Button>
          ) : null}
          <Button onClick={onBack}>رجوع لطلبات عروض الأسعار</Button>
        </>
      }
      summary={[
        { label: "التاريخ", value: fmtDate(rfq.date) },
        { label: "مطلوب بحلول", value: fmtDate(rfq.requiredByDate) },
        { label: "المستودع", value: rfq.warehouseId },
        { label: "عدد العروض المستلمة", value: <span className="mz-num">{quotes.length}</span> },
        {
          label: "أمر الشراء المرتبط",
          value: rfq.purchaseOrderId ?? "—",
        },
        { label: "أنشئ بواسطة", value: rfq.createdBy },
      ]}
      effects={[
        "لا يؤثر طلب عرض السعر على المخزون أو الحسابات — مستند تحضيري فقط.",
        "بعد الإرسال يمكن تسجيل عروض أسعار الموردين ومقارنتها في التبويبات أدناه.",
        "تحويل عرض مختار إلى أمر شراء يُغلق طلب عرض السعر ويربطه بالأمر الجديد.",
      ]}
      tabs={[
        {
          key: "lines",
          label: `البنود (${rfq.lines.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية</th>
                    <th className="px-[12px] py-[9px] text-start">ملاحظات</th>
                  </tr>
                </thead>
                <tbody>
                  {rfq.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty.toString()}</td>
                      <td className="px-[12px] py-[10px]">{l.notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "quotes",
          label: `العروض (${quotes.length})`,
          content: (
            <div className="flex flex-col gap-[16px]">
              {quotes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                  لا توجد عروض أسعار مسجلة بعد
                </div>
              ) : (
                <div className="flex flex-col gap-[10px]">
                  {quotes.map((q) => (
                    <div key={q.id} className="rounded-lg border border-border bg-surface p-[12px]">
                      <div className="mb-[8px] flex items-center justify-between">
                        <span className="text-[13px] font-semibold text-ink">{supplierName(q.supplierId)}</span>
                        <span className="text-[11.5px] text-ink-muted mz-num">{fmtDate(q.submittedAt.slice(0, 10))}</span>
                      </div>
                      <table className="w-full border-collapse text-[12.5px]">
                        <tbody>
                          {q.lines.map((l, i) => (
                            <tr key={i} className="border-b border-border last:border-b-0">
                              <td className="py-[6px]">{itemName(l.itemId)}</td>
                              <td className="py-[6px] text-end"><MoneyValue value={num(l.unitPrice)} showUnit={false} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {q.notes ? <p className="mt-[6px] text-[11.5px] text-ink-muted">{q.notes}</p> : null}
                    </div>
                  ))}
                </div>
              )}

              {rfq.status === "sent" && availableQuoteSuppliers.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-[14px]">
                  <div className="mb-[10px] text-[13px] font-semibold text-ink">تسجيل عرض سعر جديد</div>
                  <div className="flex flex-col gap-[10px]">
                    <EntityPicker label="المورد" value={quoteSupplier} onChange={setQuoteSupplier} options={availableQuoteSuppliers} placeholder="اختر المورد…" />
                    {rfq.lines.map((line, i) => (
                      <NumberField
                        key={line.itemId}
                        label={`سعر ${itemName(line.itemId)}`}
                        value={quoteLines[i]?.unitPrice ?? 0}
                        min={0}
                        onChange={(v) =>
                          setQuoteLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: v } : l)))
                        }
                      />
                    ))}
                    <TextField label="ملاحظات" value={quoteNotes} onChange={setQuoteNotes} />
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={submitQuote} disabled={!quoteSupplier}>
                        حفظ العرض
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ),
        },
        {
          key: "comparison",
          label: "مقارنة العروض",
          content:
            quotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                سجّل عرضاً واحداً على الأقل لعرض المقارنة
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                      <th className="px-[12px] py-[9px] text-start">الصنف</th>
                      {comparison.supplierIds.map((sid) => (
                        <th key={sid} className="px-[12px] py-[9px] text-end">{supplierName(sid)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((row) => (
                      <tr key={row.itemId} className="border-b border-border last:border-b-0">
                        <td className="px-[12px] py-[10px]">{itemName(row.itemId)}</td>
                        {comparison.supplierIds.map((sid) => {
                          const price = row.quotesBySupplier.get(sid);
                          const isCheapest = row.cheapestSupplierId === sid;
                          return (
                            <td key={sid} className={`px-[12px] py-[10px] text-end ${isCheapest ? "font-semibold text-success-ink" : ""}`}>
                              {price ? <MoneyValue value={num(price)} showUnit={false} /> : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="px-[12px] py-[10px]">الإجمالي (سلة كاملة)</td>
                      {comparison.supplierIds.map((sid) => {
                        const total = comparison.totalsBySupplier.get(sid);
                        return (
                          <td key={sid} className="px-[12px] py-[10px] text-end">
                            {total ? <MoneyValue value={num(total)} showUnit={false} /> : "غير مكتمل"}
                          </td>
                        );
                      })}
                    </tr>
                    {rfq.status === "sent" ? (
                      <tr>
                        <td className="px-[12px] py-[10px]" />
                        {comparison.supplierIds.map((sid) => (
                          <td key={sid} className="px-[12px] py-[10px] text-end">
                            {comparison.totalsBySupplier.has(sid) ? (
                              <Button variant="primary" onClick={() => onConvert(sid)}>
                                تحويل إلى أمر شراء
                              </Button>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tfoot>
                </table>
              </div>
            ),
        },
      ]}
    />
  );
}

export function RfqsScreen() {
  const [rfqs, setRfqs] = useState<PurchaseRfq[]>(demoRfqs);
  const [quotes, setQuotes] = useState<RfqQuote[]>(demoRfqQuotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseRfqStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [date, setDate] = useState("2026-08-23");
  const [requiredByDate, setRequiredByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, notes: "" }]);

  const selected = rfqs.find((r) => r.id === selectedId) ?? null;
  const selectedQuotes = quotes.filter((q) => q.rfqId === selectedId);

  const filtered = useMemo(() => {
    let rows = rfqs;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [rfqs, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: rfqs.length },
    ...(Object.keys(STATUS_LABEL) as PurchaseRfqStatus[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: rfqs.filter((r) => r.status === s).length,
    })),
  ];

  const quoteCountByRfq = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of quotes) map.set(q.rfqId, (map.get(q.rfqId) ?? 0) + 1);
    return map;
  }, [quotes]);

  const columns: DocumentListColumn<PurchaseRfq>[] = [
    { key: "number", header: "رقم الطلب", render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "date", header: "التاريخ", render: (r) => <span className="mz-num">{fmtDate(r.date)}</span> },
    { key: "lines", header: "البنود", align: "end", render: (r) => <span className="mz-num">{r.lines.length}</span> },
    { key: "quotes", header: "العروض", align: "end", render: (r) => <span className="mz-num">{quoteCountByRfq.get(r.id) ?? 0}</span> },
    { key: "po", header: "أمر الشراء", render: (r) => r.purchaseOrderId ?? "—" },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  function openCreate() {
    setDate("2026-08-23");
    setRequiredByDate("");
    setNotes("");
    setLines([{ itemId: "", qty: 1, notes: "" }]);
    setPanelOpen(true);
  }

  const canSave = lines.some((l) => l.itemId !== "" && l.qty > 0);

  function save() {
    const usable = lines.filter((l) => l.itemId !== "" && l.qty > 0);
    if (usable.length === 0) return;
    const rfq: PurchaseRfq = {
      id: `rfq-${nextRfqSeq}`,
      number: `RFQ-${String(nextRfqSeq).padStart(6, "0")}`,
      date,
      requiredByDate: requiredByDate.trim() === "" ? null : requiredByDate.trim(),
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      notes: notes.trim() === "" ? null : notes.trim(),
      lines: usable.map((l) => ({
        itemId: l.itemId,
        description: null,
        qty: Qty.fromMajor(String(l.qty)),
        notes: l.notes.trim() === "" ? null : l.notes.trim(),
      })),
      status: "draft",
      purchaseOrderId: null,
      createdBy: "محمد الشهابي",
      createdAt: new Date().toISOString(),
    };
    nextRfqSeq += 1;
    setRfqs((prev) => [rfq, ...prev]);
    setPanelOpen(false);
  }

  // --- status transitions (mirror the domain's guard conditions in rfq.ts) ---

  function send(id: string) {
    setRfqs((prev) => prev.map((r) => (r.id === id && r.status === "draft" ? { ...r, status: "sent" } : r)));
  }
  function close(id: string) {
    setRfqs((prev) => prev.map((r) => (r.id === id && r.status === "sent" ? { ...r, status: "closed" } : r)));
  }
  function cancel(id: string) {
    setRfqs((prev) =>
      prev.map((r) => (r.id === id && (r.status === "draft" || r.status === "sent") ? { ...r, status: "cancelled" } : r)),
    );
  }
  function addQuote(rfqId: string, supplierId: string, draftLines: QuoteDraftLine[], notesValue: string) {
    const quote: RfqQuote = {
      id: `rfq-quote-${nextQuoteSeq}`,
      rfqId,
      supplierId,
      lines: draftLines.map((l) => ({ itemId: l.itemId, unitPrice: Money.fromMajor(String(l.unitPrice)), notes: null })),
      notes: notesValue.trim() === "" ? null : notesValue.trim(),
      submittedAt: new Date().toISOString(),
    };
    nextQuoteSeq += 1;
    setQuotes((prev) => [...prev, quote]);
  }
  function convert(rfqId: string, supplierId: string) {
    const poId = `po-from-${rfqId}`;
    setRfqs((prev) =>
      prev.map((r) => (r.id === rfqId && r.status === "sent" ? { ...r, status: "closed", purchaseOrderId: poId } : r)),
    );
    void supplierId; // the chosen supplier already drove the comparison total shown before converting
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="طلب عرض سعر جديد" description="اختر الأصناف والكميات المطلوبة لمقارنة عروض الموردين">
      <div className="flex flex-col gap-[14px]">
        <TextField label="التاريخ" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label="مطلوب بحلول" value={requiredByDate} onChange={setRequiredByDate} placeholder="YYYY-MM-DD" />
        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">الأصناف المطلوبة</span>
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label="الصنف"
                value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                onChange={(opt) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "" } : l)))}
                options={itemOptions}
                placeholder="اختر صنفاً…"
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField label="الكمية" value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                <TextField label="ملاحظات" value={line.notes} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, notes: v } : l)))} />
              </div>
              {lines.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>حذف البند</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, notes: "" }])}>إضافة بند</Button>
        </div>
        <TextField label="ملاحظات عامة" value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>
            حفظ
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <RfqDetail
          rfq={selected}
          quotes={selectedQuotes}
          onBack={() => setSelectedId(null)}
          onSend={() => send(selected.id)}
          onClose={() => close(selected.id)}
          onCancel={() => cancel(selected.id)}
          onAddQuote={(supplierId, draftLines, notesValue) => addQuote(selected.id, supplierId, draftLines, notesValue)}
          onConvert={(supplierId) => convert(selected.id, supplierId)}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      <DocumentList<PurchaseRfq>
        eyebrow="Purchases · RFQs"
        title="طلبات عروض الأسعار"
        description="اجمع عروض أسعار الموردين وقارنها قبل إصدار أمر الشراء"
        actions={
          <Button variant="primary" onClick={openCreate}>
            طلب عرض سعر جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الطلبات", value: <span className="mz-num">{rfqs.length}</span> },
          { label: "مرسلة", value: <span className="mz-num">{rfqs.filter((r) => r.status === "sent").length}</span> },
          { label: "مغلقة (محوّلة)", value: <span className="mz-num">{rfqs.filter((r) => r.status === "closed").length}</span> },
          { label: "مسودة", value: <span className="mz-num">{rfqs.filter((r) => r.status === "draft").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseRfqStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم الطلب…"
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{rfqs.length}</span> طلب</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء
          </div>
        }
      />
      {panel}
    </>
  );
}
