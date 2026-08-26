import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  RowMenu,
  StatusPill,
  SidePanel,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
  type RowMenuItem,
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
  useUsers,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { useSubPage } from "../navigation";
import { TextField, NumberField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { itemTypeIsPurchasable } from "@mezan/domain";
import { todayIso } from "../lib/dates";

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

const STATUS_KEY: Record<PurchaseRfqStatusDTO, AppTranslationKey> = {
  draft: "rfqs.status.draft",
  sent: "rfqs.status.sent",
  closed: "rfqs.status.closed",
  cancelled: "rfqs.status.cancelled",
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
  const { t } = useAppTranslation();
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
      title={t("rfqs.detailTitle", { number: rfq.number })}
      statusLabel={t(STATUS_KEY[rfq.status])}
      statusTone={STATUS_TONE[rfq.status]}
      subtitle={t("rfqs.subtitle", { date: fmtDate(rfq.date), count: rfq.lines.length })}
      actions={
        <>
          {rfq.status === "draft" ? (
            <Button variant="primary" onClick={() => sendRfq.mutate(rfq.id)} disabled={sendRfq.isPending}>
              {t("rfqs.send")}
            </Button>
          ) : null}
          {rfq.status === "sent" ? (
            <Button onClick={() => closeRfq.mutate(rfq.id)} disabled={closeRfq.isPending}>
              {t("rfqs.closeWithout")}
            </Button>
          ) : null}
          {rfq.status === "draft" || rfq.status === "sent" ? (
            <Button onClick={() => cancelRfq.mutate(rfq.id)} disabled={cancelRfq.isPending}>
              {t("rfqs.cancel")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("rfqs.backToList")}</Button>
        </>
      }
      summary={[
        { label: t("common.date"), value: fmtDate(rfq.date) },
        { label: t("rfqs.detail.requiredBy"), value: fmtDate(rfq.requiredByDate) },
        { label: t("common.warehouse"), value: rfq.warehouseId },
        { label: t("rfqs.detail.quotesReceived"), value: <span className="mz-num">{quotes.length}</span> },
        {
          label: t("rfqs.detail.linkedOrder"),
          value: rfq.purchaseOrderId ?? "—",
        },
        { label: t("rfqs.detail.createdBy"), value: rfq.createdBy },
      ]}
      effects={[
        t("rfqs.effect.noImpact"),
        t("rfqs.effect.afterSend"),
        t("rfqs.effect.onConvert"),
      ]}
      tabs={[
        {
          key: "lines",
          label: t("rfqs.tab.lines", { count: rfq.lines.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("common.notes")}</th>
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
          label: t("rfqs.tab.quotes", { count: quotes.length }),
          content: (
            <div className="flex flex-col gap-[16px]">
              {quotes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                  {t("rfqs.noQuotes")}
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
                  <div className="mb-[10px] text-[13px] font-semibold text-ink">{t("rfqs.newQuoteHeading")}</div>
                  <div className="flex flex-col gap-[10px]">
                    <EntityPicker label={t("rfqs.field.supplier")} value={quoteSupplier} onChange={setQuoteSupplier} options={availableQuoteSuppliers} placeholder={t("rfqs.field.supplierPlaceholder")} />
                    {rfq.lines.map((line, i) => (
                      <NumberField
                        key={line.itemId}
                        label={t("rfqs.field.priceFor", { item: itemLabel(line.itemId) })}
                        value={quoteLines[i]?.unitPrice ?? 0}
                        min={0}
                        onChange={(v) =>
                          setQuoteLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: v } : l)))
                        }
                      />
                    ))}
                    <TextField label={t("common.notes")} value={quoteNotes} onChange={setQuoteNotes} />
                    <div className="flex justify-end">
                      <Button variant="primary" onClick={submitQuote} disabled={!quoteSupplier || createRfqQuote.isPending}>
                        {t("rfqs.saveQuote")}
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
          label: t("rfqs.tab.compare"),
          content:
            quotes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                {t("rfqs.compareEmpty")}
              </div>
            ) : comparisonQuery.isLoading || !comparison ? (
              <div className="rounded-lg border border-dashed border-border p-[16px] text-center text-[13px] text-ink-muted">
                {t("rfqs.compareLoading")}
              </div>
            ) : (
              <div className="flex flex-col gap-[10px]">
                {actionError ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{actionError}</div> : null}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                        <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
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
                        <td className="px-[12px] py-[10px]">{t("rfqs.basketTotal")}</td>
                        {comparison.supplierIds.map((sid) => {
                          const total = comparison.totalsBySupplier[sid];
                          return (
                            <td key={sid} className="px-[12px] py-[10px] text-end">
                              {total ? <MoneyValue value={Number(total)} showUnit={false} /> : t("rfqs.incomplete")}
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
                                  {t("rfqs.convertToOrder")}
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
  const { t } = useAppTranslation();
  const workingLocation = useWorkingLocation();
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

  const [statusFilter, setStatusFilter] = useState<PurchaseRfqStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runRowAction(id: string, transition: { mutateAsync: (id: string) => Promise<unknown> }): Promise<void> {
    if (rowPendingId) return;
    setRowError(null);
    setRowPendingId(id);
    try {
      await transition.mutateAsync(id);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowPendingId(null);
    }
  }

  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const [date, setDate] = useState(todayIso());
  const [requiredByDate, setRequiredByDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, notes: "" }]);
  const [createError, setCreateError] = useState<string | null>(null);

  const itemOptions: EntityPickerOption[] = useMemo(
    () => items.filter((i) => itemTypeIsPurchasable(i.type)).map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.baseUnitCode })),
    [items],
  );

  const selected = selectedId === null ? null : (rfqs.find((r) => r.id === selectedId || r.number === selectedId) ?? null);
  const quotesQuery = useRfqQuotes(selectedId);
  const selectedQuotes = quotesQuery.data ?? [];
  const comparisonQuery = useRfqComparison(selectedId);

  const users = useUsers().data ?? [];
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName ?? id;
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    let rows = rfqs;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (fromDate) rows = rows.filter((r) => r.date >= fromDate);
    if (toDate) rows = rows.filter((r) => r.date <= toDate);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [rfqs, statusFilter, search, fromDate, toDate]);

  const counts = useMemo(() => {
    const c: Record<"all" | PurchaseRfqStatusDTO, number> = { all: rfqs.length, draft: 0, sent: 0, closed: 0, cancelled: 0 };
    for (const r of rfqs) c[r.status] += 1;
    return c;
  }, [rfqs]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "draft", label: t(STATUS_KEY.draft), count: counts.draft },
    { key: "sent", label: t(STATUS_KEY.sent), count: counts.sent },
    { key: "closed", label: t(STATUS_KEY.closed), count: counts.closed },
    { key: "cancelled", label: t(STATUS_KEY.cancelled), count: counts.cancelled },
  ];

  const columns: DocumentListColumn<PurchaseRfqDTO>[] = [
    { key: "number", header: t("rfqs.col.number"), render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "date", header: t("common.date"), render: (r) => <span className="mz-num">{fmtDate(r.date)}</span> },
    { key: "lines", header: t("rfqs.col.lines"), align: "end", render: (r) => <span className="mz-num">{r.lines.length}</span> },
    { key: "po", header: t("rfqs.col.po"), render: (r) => r.purchaseOrderId ?? "—" },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
    { key: "createdBy", header: t("common.createdBy"), render: (r) => <span className="text-ink-muted">{userName(r.createdBy)}</span> },
  ];

  function openCreate() {
    setDate(todayIso());
    setRequiredByDate("");
    setNotes("");
    setLines([{ itemId: "", qty: 1, notes: "" }]);
    setCreateError(null);
    subPage.open("new");
  }

  const canSave = lines.some((l) => l.itemId !== "" && l.qty > 0);

  async function save() {
    const usable = lines.filter((l) => l.itemId !== "" && l.qty > 0);
    if (usable.length === 0) return;
    setCreateError(null);
    if (!workingLocation.branchId || !workingLocation.warehouseId) {
      setCreateError(t("rfqs.error.noScope"));
      return;
    }
    try {
      await createRfq.mutateAsync({
        id: crypto.randomUUID(),
        date,
        requiredByDate: requiredByDate.trim() === "" ? null : requiredByDate.trim(),
        branchId: workingLocation.branchId ?? "",
        warehouseId: workingLocation.warehouseId ?? "",
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: usable.map((l) => ({
          itemId: l.itemId,
          description: null,
          qty: String(l.qty),
          notes: l.notes.trim() === "" ? null : l.notes.trim(),
        })),
      });
      subPage.close();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  }

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.rfqs")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("rfqs.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("rfqs.panel.description")}</p>
        </div>
        <Button variant="default" onClick={subPage.close}>
          {t("quotes.backToList")}
        </Button>
      </div>
      <div className="flex flex-col gap-[14px]">
        <TextField label={t("rfqs.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("rfqs.detail.requiredBy")} value={requiredByDate} onChange={setRequiredByDate} placeholder="YYYY-MM-DD" />
        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("rfqs.itemsHeading")}</span>
          {lines.map((line, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label={t("common.item")}
                value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                onChange={(opt) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "" } : l)))}
                options={itemOptions}
                placeholder={t("rfqs.field.itemPlaceholder")}
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField label={t("common.qty")} value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                <TextField label={t("common.notes")} value={line.notes} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, notes: v } : l)))} />
              </div>
              {lines.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>{t("rfqs.deleteLine")}</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, notes: "" }])}>{t("rfqs.addLine")}</Button>
        </div>
        <TextField label={t("rfqs.field.generalNotes")} value={notes} onChange={setNotes} />
        {createError ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{createError}</div> : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createRfq.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );

  if (firstSegment === "new") return createPage;

  if (selected) {
    return (
      <>
        <RfqDetail
          rfq={selected}
          quotes={selectedQuotes}
          comparisonQuery={comparisonQuery}
          items={items}
          suppliers={suppliers}
          onBack={() => subPage.close()}
          sendRfq={sendRfq}
          closeRfq={closeRfq}
          cancelRfq={cancelRfq}
          createRfqQuote={createRfqQuote}
          convertRfq={convertRfq}
        />
      </>
    );
  }

  return (
    <>
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<PurchaseRfqDTO>
        title={t("rfqs.title")}
        description={t("rfqs.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("rfqs.new")}
          </Button>
        }
        listKey="rfqs"
        statsCollapsible
        stats={[
          { label: t("rfqs.stat.total"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("rfqs.stat.sent"), value: <span className="mz-num">{counts.sent}</span> },
          { label: t("rfqs.stat.closed"), value: <span className="mz-num">{counts.closed}</span> },
          { label: t("rfqs.stat.draft"), value: <span className="mz-num">{counts.draft}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseRfqStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("rfqs.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <TextField label={t("common.fromDate")} value={fromDate} onChange={setFromDate} type="date" />
            <TextField label={t("common.toDate")} value={toDate} onChange={setToDate} type="date" />
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => subPage.open(r.number ?? r.id)}
        rowAction={(r) => {
          // Converting picks a winning supplier quote, so it opens the comparison rather than firing from the row.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(r.number ?? r.id) },
            ...(r.status === "draft"
              ? [{ key: "send", label: t("rfqs.send"), disabled: rowPendingId === r.id, onSelect: () => void runRowAction(r.id, sendRfq) }]
              : []),
            ...(r.status === "sent"
              ? [
                  { key: "convert", label: t("rfqs.convertToOrder"), onSelect: () => subPage.open(r.number ?? r.id) },
                  { key: "close", label: t("rfqs.closeWithout"), disabled: rowPendingId === r.id, onSelect: () => void runRowAction(r.id, closeRfq) },
                ]
              : []),
            ...(r.status === "draft" || r.status === "sent"
              ? [
                  {
                    key: "cancel",
                    label: t("rfqs.cancel"),
                    tone: "danger" as const,
                    disabled: rowPendingId === r.id,
                    onSelect: () => void runRowAction(r.id, cancelRfq),
                  },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: r.number ?? r.id })} />;
        }}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("rfqs.showingSuffix")}</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {rfqsQuery.isLoading ? t("common.loading") : t("rfqs.empty")}
          </div>
        }
      />
    </>
  );
}
