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
import type { ItemDTO, PurchaseRfqDTO, PurchaseRfqStatusDTO, RfqQuoteDTO, SupplierDTO } from "@mezan/contracts";
import {
  useCancelRfq,
  useCloseRfq,
  useConvertRfq,
  useCreateRfq,
  useCreateRfqQuote,
  useItems,
  useRfqComparison,
  useRfqQuotes,
  useRfqs,
  useSendRfq,
  useSuppliers,
  type RfqComparisonRecord,
} from "../data/hooks";
import { TextField, NumberField } from "../settings/form-controls";

/**
 * طلبات عروض الأسعار (RFQs — docs/catalog/02 §"طلبات عروض الأسعار"): مسودة →
 * مرسل → مغلق (ملغي as a cancel path). Pre-PO document — capture requested
 * items, collect supplier quotes once sent, compare them, then convert the
 * chosen quote into a Purchase Order via the real `/rfqs` routes.
 *
 * The comparison grid is fetched from `GET /rfqs/:id/comparison` — the
 * server-computed equivalent of `@mezan/domain`'s `compareRfqQuotes` — rather
 * than re-run client-side, since the wire quotes/RFQ are decimal-string DTOs,
 * not `Money`/`Qty` domain instances.
 */

const STATUS_LABEL: Record<PurchaseRfqStatusDTO, string> = {
  draft: "مسودة",
  sent: "مرسل",
  closed: "مغلق",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<PurchaseRfqStatusDTO, PillTone> = {
  draft: "neutral",
  sent: "info",
  closed: "success",
  cancelled: "danger",
};

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function RfqDetail({
  rfq,
  quotes,
  comparisonQuery,
  items,
  suppliers,
  onBack,
  sendRfq,
  closeRfq,
  cancelRfq,
  createRfqQuote,
  convertRfq,
}: {
  rfq: PurchaseRfqDTO;
  quotes: RfqQuoteDTO[];
  comparisonQuery: ReturnType<typeof useRfqComparison>;
  items: ItemDTO[];
  suppliers: SupplierDTO[];
  onBack: () => void;
  sendRfq: ReturnType<typeof useSendRfq>;
  closeRfq: ReturnType<typeof useCloseRfq>;
  cancelRfq: ReturnType<typeof useCancelRfq>;
  createRfqQuote: ReturnType<typeof useCreateRfqQuote>;
  convertRfq: ReturnType<typeof useConvertRfq>;
}) {
  const [quoteSupplier, setQuoteSupplier] = useState<EntityPickerOption | null>(null);
  const [quoteLines, setQuoteLines] = useState<QuoteDraftLine[]>(rfq.lines.map((l) => ({ itemId: l.itemId, unitPrice: 0 })));
  const [quoteNotes, setQuoteNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingConvertSupplierId, setPendingConvertSupplierId] = useState<string | null>(null);

  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
  const alreadyQuotedSupplierIds = new Set(quotes.map((q) => q.supplierId));
  const availableQuoteSuppliers = supplierOptions.filter((s) => !alreadyQuotedSupplierIds.has(s.id));

  function itemLabel(itemId: string): string {
    return items.find((i) => i.id === itemId)?.nameAr ?? itemId;
  }
  function supplierLabel(supplierId: string): string {
    return suppliers.find((s) => s.id === supplierId)?.nameAr ?? supplierId;
  }

  async function submitQuote() {
    if (!quoteSupplier) return;
    const priced = quoteLines.filter((l) => l.unitPrice > 0);
    if (priced.length === 0) return;
    setActionError(null);
    try {
      await createRfqQuote.mutateAsync({
        rfqId: rfq.id,
        body: {
          id: crypto.randomUUID(),
          supplierId: quoteSupplier.id,
          lines: priced.map((l) => ({ itemId: l.itemId, unitPrice: String(l.unitPrice), notes: null })),
          notes: quoteNotes.trim() === "" ? null : quoteNotes.trim(),
        },
      });
      setQuoteSupplier(null);
      setQuoteLines(rfq.lines.map((l) => ({ itemId: l.itemId, unitPrice: 0 })));
      setQuoteNotes("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleConvert(supplierId: string) {
    if (pendingConvertSupplierId !== null) return;
    setActionError(null);
    setPendingConvertSupplierId(supplierId);
    try {
      await convertRfq.mutateAsync({
        rfqId: rfq.id,
        body: { purchaseOrderId: crypto.randomUUID(), supplierId, expectedDeliveryDate: null },
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingConvertSupplierId(null);
    }
  }

  const comparison = comparisonQuery.data;

  return (
    <DocumentDetail
      title={`طلب عرض سعر ${rfq.number}`}
      statusLabel={STATUS_LABEL[rfq.status]}
      statusTone={STATUS_TONE[rfq.status]}
      subtitle={`${fmtDate(rfq.date)} · ${rfq.lines.length} بند`}
      actions={
        <>
          {rfq.status === "draft" ? (
            <Button variant="primary" onClick={() => sendRfq.mutate(rfq.id)} disabled={sendRfq.isPending}>
              إرسال
            </Button>
          ) : null}
          {rfq.status === "sent" ? (
            <Button onClick={() => closeRfq.mutate(rfq.id)} disabled={closeRfq.isPending}>
              إغلاق بدون تحويل
            </Button>
          ) : null}
          {rfq.status === "draft" || rfq.status === "sent" ? (
            <Button onClick={() => cancelRfq.mutate(rfq.id)} disabled={cancelRfq.isPending}>
              إلغاء الطلب
            </Button>
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
                      <td className="px-[12px] py-[10px]">{itemLabel(l.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty}</td>
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
                        <span className="text-[13px] font-semibold text-ink">{supplierLabel(q.supplierId)}</span>
                        <span className="text-[11.5px] text-ink-muted mz-num">{fmtDate(q.submittedAt.slice(0, 10))}</span>
                      </div>
                      <table className="w-full border-collapse text-[12.5px]">
                        <tbody>
                          {q.lines.map((l, i) => (
                            <tr key={i} className="border-b border-border last:border-b-0">
                              <td className="py-[6px]">{itemLabel(l.itemId)}</td>
                              <td className="py-[6px] text-end"><MoneyValue value={Number(l.unitPrice)} showUnit={false} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {q.notes ? <p className="mt-[6px] text-[11.5px] text-ink-muted">{q.notes}</p> : null}
                    </div>
                  ))}
                </div>
              )}

              {actionError ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{actionError}</div> : null}

              {rfq.status === "sent" && availableQuoteSuppliers.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-[14px]">
                  <div className="mb-[10px] text-[13px] font-semibold text-ink">تسجيل عرض سعر جديد</div>
                  <div className="flex flex-col gap-[10px]">
                    <EntityPicker label="المورد" value={quoteSupplier} onChange={setQuoteSupplier} options={availableQuoteSuppliers} placeholder="اختر المورد…" />
                    {rfq.lines.map((line, i) => (
                      <NumberField
                        key={line.itemId}
                        label={`سعر ${itemLabel(line.itemId)}`}
                        value={quoteLines[i]?.unitPrice ?? 0}
                        min={0}
                        onChange={(v) =>
                          setQuoteLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: v } : l)))
                        }
                      />
                    ))}
                    <TextField label="ملاحظات" value={quoteNotes} onChange={setQuoteNotes} />
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={submitQuote} disabled={!quoteSupplier || createRfqQuote.isPending}>
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
            ) : comparisonQuery.isLoading || !comparison ? (
              <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                جارِ تحميل المقارنة…
              </div>
            ) : (
              <div className="flex flex-col gap-[10px]">
                {actionError ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{actionError}</div> : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                        <th className="px-[12px] py-[9px] text-start">الصنف</th>
                        {comparison.supplierIds.map((sid) => (
                          <th key={sid} className="px-[12px] py-[9px] text-end">{supplierLabel(sid)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((row) => (
                        <tr key={row.itemId} className="border-b border-border last:border-b-0">
                          <td className="px-[12px] py-[10px]">{itemLabel(row.itemId)}</td>
                          {comparison.supplierIds.map((sid) => {
                            const price = row.quotesBySupplier[sid];
                            const isCheapest = row.cheapestSupplierId === sid;
                            return (
                              <td key={sid} className={`px-[12px] py-[10px] text-end ${isCheapest ? "font-semibold text-success-ink" : ""}`}>
                                {price ? <MoneyValue value={Number(price)} showUnit={false} /> : "—"}
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
                          const total = comparison.totalsBySupplier[sid];
                          return (
                            <td key={sid} className="px-[12px] py-[10px] text-end">
                              {total ? <MoneyValue value={Number(total)} showUnit={false} /> : "غير مكتمل"}
                            </td>
                          );
                        })}
                      </tr>
                      {rfq.status === "sent" ? (
                        <tr>
                          <td className="px-[12px] py-[10px]" />
                          {comparison.supplierIds.map((sid) => (
                            <td key={sid} className="px-[12px] py-[10px] text-end">
                              {comparison.totalsBySupplier[sid] ? (
                                <Button
                                  variant="primary"
                                  onClick={() => handleConvert(sid)}
                                  disabled={pendingConvertSupplierId !== null}
                                >
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
              </div>
            ),
        },
      ]}
    />
  );
}

export function RfqsScreen() {
  const rfqsQuery = useRfqs();
  const rfqs = rfqsQuery.data ?? [];
  const suppliersQuery = useSuppliers();
  const suppliers = suppliersQuery.data ?? [];
  const itemsQuery = useItems();
  const items = itemsQuery.data ?? [];

  const createRfq = useCreateRfq();
  const sendRfq = useSendRfq();
  const closeRfq = useCloseRfq();
  const cancelRfq = useCancelRfq();
  const createRfqQuote = useCreateRfqQuote();
  const convertRfq = useConvertRfq();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseRfqStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [requiredByDate, setRequiredByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, notes: "" }]);
  const [createError, setCreateError] = useState<string | null>(null);

  const itemOptions: EntityPickerOption[] = useMemo(
    () => items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.baseUnitCode })),
    [items],
  );

  const selected = rfqs.find((r) => r.id === selectedId) ?? null;
  const quotesQuery = useRfqQuotes(selectedId);
  const selectedQuotes = quotesQuery.data ?? [];
  const comparisonQuery = useRfqComparison(selectedId);

  const filtered = useMemo(() => {
    let rows = rfqs;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [rfqs, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<"all" | PurchaseRfqStatusDTO, number> = { all: rfqs.length, draft: 0, sent: 0, closed: 0, cancelled: 0 };
    for (const r of rfqs) c[r.status] += 1;
    return c;
  }, [rfqs]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all },
    { key: "draft", label: STATUS_LABEL.draft, count: counts.draft },
    { key: "sent", label: STATUS_LABEL.sent, count: counts.sent },
    { key: "closed", label: STATUS_LABEL.closed, count: counts.closed },
    { key: "cancelled", label: STATUS_LABEL.cancelled, count: counts.cancelled },
  ];

  const columns: DocumentListColumn<PurchaseRfqDTO>[] = [
    { key: "number", header: "رقم الطلب", render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "date", header: "التاريخ", render: (r) => <span className="mz-num">{fmtDate(r.date)}</span> },
    { key: "lines", header: "البنود", align: "end", render: (r) => <span className="mz-num">{r.lines.length}</span> },
    { key: "po", header: "أمر الشراء", render: (r) => r.purchaseOrderId ?? "—" },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  function openCreate() {
    setDate(todayIso());
    setRequiredByDate("");
    setNotes("");
    setLines([{ itemId: "", qty: 1, notes: "" }]);
    setCreateError(null);
    setPanelOpen(true);
  }

  const canSave = lines.some((l) => l.itemId !== "" && l.qty > 0);

  async function save() {
    const usable = lines.filter((l) => l.itemId !== "" && l.qty > 0);
    if (usable.length === 0) return;
    setCreateError(null);
    try {
      await createRfq.mutateAsync({
        id: crypto.randomUUID(),
        date,
        requiredByDate: requiredByDate.trim() === "" ? null : requiredByDate.trim(),
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: usable.map((l) => ({
          itemId: l.itemId,
          description: null,
          qty: String(l.qty),
          notes: l.notes.trim() === "" ? null : l.notes.trim(),
        })),
      });
      setPanelOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
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
        {createError ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{createError}</div> : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createRfq.isPending}>
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
          comparisonQuery={comparisonQuery}
          items={items}
          suppliers={suppliers}
          onBack={() => setSelectedId(null)}
          sendRfq={sendRfq}
          closeRfq={closeRfq}
          cancelRfq={cancelRfq}
          createRfqQuote={createRfqQuote}
          convertRfq={convertRfq}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      <DocumentList<PurchaseRfqDTO>
        eyebrow="Purchases · RFQs"
        title="طلبات عروض الأسعار"
        description="اجمع عروض أسعار الموردين وقارنها قبل إصدار أمر الشراء"
        actions={
          <Button variant="primary" onClick={openCreate}>
            طلب عرض سعر جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الطلبات", value: <span className="mz-num">{counts.all}</span> },
          { label: "مرسلة", value: <span className="mz-num">{counts.sent}</span> },
          { label: "مغلقة (محوّلة)", value: <span className="mz-num">{counts.closed}</span> },
          { label: "مسودة", value: <span className="mz-num">{counts.draft}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseRfqStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم الطلب…"
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> طلب</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {rfqsQuery.isLoading ? "جارِ التحميل…" : "لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء"}
          </div>
        }
      />
      {panel}
    </>
  );
}
