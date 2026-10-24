import { SalesInvoiceDerivedFilter } from "@mezan/contracts";
import { SALES_INVOICE_ACTIVE_STATUSES } from "@mezan/domain";
import { AlreadySavedNotice, useAlreadySavedNotice, useDocumentId } from "../lib/document-id";
import { useEffect, useMemo, useRef, useState } from "react";
import { HeldDocumentReapproval } from "../shell/ReapprovalNotice";
import { errorMessage } from "../lib/error-message";
import {
  RowActionOutcome,
  Button,
  Card,
  Chip,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type RowMenuItem,
} from "@mezan/ui";
import type { DocumentStatusDTO, SalesReturnLineDTO, SalesReturnReasonDTO } from "@mezan/contracts";
import { SelectField, NumberField } from "../settings/form-controls";
import {
  useCancelSalesReturn,
  useConfirmSalesReturn,
  useCreateSalesReturnFromInvoice,
  useCustomers,
  useItemsByIds,
  useRefundSalesReturn,
  useSalesInvoice,
  useSalesInvoices,
  useReturnDocument,
  useSalesReturns,
  useReturnSourceLines,
  ReturnKind,
  useSalesReturnCounts,
  useSalesReturnStats,
  useTreasuryAccounts,
  useWarehouses,
  type SalesInvoiceDTO,
  type SalesReturnListFilter,
} from "../data/hooks";
import { SalesInvoicePicker } from "./InvoicePickers";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { SalesReturnPrintPage } from "../print/documents";
import { useNameSubPage, useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { nextReturnSourceLine, sourceLineOptions } from "./return-source-lines";
import { useEntityName } from "../lib/entity-names";
import { todayIso } from "../lib/dates";
import { majorOf } from "../lib/money";
import { returnLinesTotal } from "./exact-line-totals";
import { EMPTY } from "../lib/empty";
import { ReturnJournalCard } from "./ReturnJournalCard";
import { ReturnFamily, ReturnMirrorLinks, VoidReturnAction, VoidReturnDialog, VoidReturnReasonNotice, returnDocumentLabel, useMayVoidReturn, type VoidableReturn } from "./VoidReturnAction";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { ResubmitErrorNotice, ResubmitFamily, ResubmitForApprovalAction, resubmitRowMenuItems, useResubmitForApproval } from "./ResubmitForApprovalAction";

/** مرتجعات المبيعات (Sales Returns) — docs/archive/catalog/01. Document-framework-backed (draft → confirmed, restocks at cost, reduces AR). */

const REASON_KEY: Record<SalesReturnReasonDTO, AppTranslationKey> = {
  DEFECTIVE: "salesReturns.reason.DEFECTIVE",
  WRONG_ITEM: "salesReturns.reason.WRONG_ITEM",
  EXCESS_QTY: "salesReturns.reason.EXCESS_QTY",
  CHANGED_MIND: "salesReturns.reason.CHANGED_MIND",
  OTHER: "salesReturns.reason.OTHER",
};



interface LineDraft {
  key: string;
  sourceLineId: string;
  qty: number;
  /** سبب الإرجاع per line (R3.9) — one item can come back broken and another as the wrong pick. */
  reason: SalesReturnReasonDTO;
}
let lineSeq = 0;
function blankLine(sourceLineId: string, reason: SalesReturnReasonDTO): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, sourceLineId, qty: 1, reason };
}

const PAGE_SIZES = [10, 25, 50, 100] as const;
const RETURNABLE_INVOICES = { status: SalesInvoiceDerivedFilter.Active };

function returnable(invoice: SalesInvoiceDTO): boolean {
  return SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status);
}

export function SalesReturnsScreen() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const newestInvoiceQuery = useSalesInvoices({ status: SalesInvoiceDerivedFilter.Active, page: 1, pageSize: 1 });
  const warehousesQuery = useWarehouses();
  const customersQuery = useCustomers();
  const createReturn = useCreateSalesReturnFromInvoice();
  const savedNotice = useAlreadySavedNotice();
  const returnId = useDocumentId((savedId) => {
    savedNotice.show(savedId);
    subPage.open(savedId);
  });
  const refundReturn = useRefundSalesReturn();
  const confirmReturn = useConfirmSalesReturn();
  const resubmit = useResubmitForApproval(ResubmitFamily.SalesReturns);
  const cancelReturn = useCancelSalesReturn();
  const mayVoid = useMayVoidReturn(ReturnFamily.Sales);
  const [voidTarget, setVoidTarget] = useState<VoidableReturn | null>(null);

  const newestInvoice = newestInvoiceQuery.data?.[0] ?? null;
  const warehouses = warehousesQuery.data ?? EMPTY;
  const customers = customersQuery.data ?? EMPTY;

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [customers]);

  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const { openScreenAt } = useNavigation();
  const [firstSegment] = subPage.segments;
  useScreenIntent((intent) => {
    const invoiceId = intent.prefill?.invoiceId;
    subPage.open(...(invoiceId ? ["new", invoiceId] : ["new"]));
  });
  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | DocumentStatusDTO,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [customerFilter, setCustomerFilter] = useState<EntityPickerOption | null>(null);
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  // The source invoice rides in the URL (`…/new/<invoiceId>`) when the user
  // arrived from «إنشاء مرتجع مبيعات» on that invoice's row.
  const [invoiceId, setInvoiceId] = useState(() => subPage.segments[1] ?? "");
  const invoiceQueryById = useSalesInvoice(invoiceId || null);
  const [pickedInvoice, setPickedInvoice] = useState<SalesInvoiceDTO | null>(null);
  const chosenInvoice = invoiceQueryById.data ?? (pickedInvoice?.id === invoiceId ? pickedInvoice : newestInvoice?.id === invoiceId ? newestInvoice : undefined);
  const selectedInvoice = chosenInvoice && returnable(chosenInvoice) ? chosenInvoice : null;
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState<SalesReturnReasonDTO>("DEFECTIVE");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [refundTreasuryId, setRefundTreasuryId] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "bank" | "cheque" | "card" | "wallet">("cash");
  const [refundNotice, setRefundNotice] = useState<string | null>(null);

  /**
   * One filter for the rows, the chip counts and the KPI strip (R1.1) — the
   * three used to disagree: the chips and the KPI strip counted every
   * unfiltered return the server had ever sent, so applying a filter moved
   * the table and left the header alone.
   */
  const filter = useMemo<SalesReturnListFilter>(
    () => ({
      status: statusFilter,
      customerId: customerFilter?.id,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      awaitingRefund: awaitingOnly || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, customerFilter, fromDate, toDate, awaitingOnly, search],
  );
  const query = useSalesReturns(filter);
  const documents = query.data ?? [];
  const counts = useSalesReturnCounts(filter).data ?? {};
  const stats = useSalesReturnStats(filter).data ?? {};

  const treasuryAccounts = useTreasuryAccounts().data ?? EMPTY;
  useEffect(() => {
    if (refundTreasuryId !== "") return;
    const firstOpen = treasuryAccounts.find((a) => a.status === "active") ?? treasuryAccounts[0];
    if (firstOpen) setRefundTreasuryId(firstOpen.id);
  }, [treasuryAccounts, refundTreasuryId]);

  useEffect(() => {
    if (firstSegment !== "new" || warehouseId !== "") return;
    if (invoiceId !== "" && invoiceQueryById.isLoading) return;
    const next = selectedInvoice?.warehouseId ?? warehouses[0]?.id;
    if (next) setWarehouseId(next);
  }, [firstSegment, warehouses, warehouseId, selectedInvoice, invoiceId, invoiceQueryById.isLoading]);

  const sourceLinesQuery = useReturnSourceLines(ReturnKind.Sales, firstSegment === "new" ? invoiceId : "");
  const sourceLines = sourceLinesQuery.data?.lines ?? EMPTY;
  const sourceLinesReady = invoiceId === "" || sourceLinesQuery.isSuccess;
  const returnableLines = useMemo(
    () => (selectedInvoice?.lines ?? []).filter((l) => l.isStock && l.unitCost !== null),
    [selectedInvoice],
  );

  // INVARIANT: the first row is offered only once the SERVER has said what is
  // left to return, and it names a line that still has room. Seeded from the
  // invoice alone it could name a line already returned in full.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (firstSegment !== "new" || invoiceId === "" || !sourceLinesQuery.isSuccess || seededFor.current === invoiceId) return;
    seededFor.current = invoiceId;
    if (lines.length > 0) return;
    const returnable = new Set(returnableLines.map((line) => line.lineId));
    const first = nextReturnSourceLine(sourceLines.filter((line) => returnable.has(line.sourceLineId)), [], "");
    if (first !== "") setLines([blankLine(first, reason)]);
  }, [firstSegment, invoiceId, sourceLinesQuery.isSuccess, sourceLines, returnableLines, lines.length, reason]);

  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const pageRows = documents.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) + (awaitingOnly ? 1 : 0) + (customerFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const addressed = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : "";
  const listed = addressed === "" ? null : (documents.find((d) => d.id === addressed || d.docNo === addressed) ?? null);
  const unlisted = useReturnDocument<(typeof documents)[number]>(ReturnFamily.Sales, addressed !== "" && !listed && query.isSuccess ? addressed : "");
  const selected = listed ?? unlisted.data ?? null;
  const reversedReturnNo = selected?.reversesDocId ? (documents.find((d) => d.id === selected.reversesDocId)?.docNo ?? null) : null;
  const selectedLabel = selected ? returnDocumentLabel(selected, reversedReturnNo, t("salesReturns.detailTitle"), t) : null;
  useNameSubPage(selected ? addressed : null, selectedLabel);

  const selectedItems = useItemsByIds(selected?.lines.map((l) => l.itemId) ?? []).byId;
  const itemName = (id: string) => selectedItems.get(id)?.nameAr ?? id;
  const selectedSourceLine = selected?.lines[0];
  const unnumberedSource = useSalesInvoice(selectedSourceLine && !selectedSourceLine.sourceInvoiceNumber ? selectedSourceLine.sourceInvoiceId : null).data;
  /**
   * The source invoice's number. The denormalised `sourceInvoiceNumber` on the
   * line is null on some rows (a return raised before the invoice was
   * numbered); the open document resolves those from the invoice itself, a
   * list row falls back to the id.
   */
  const sourceInvoiceNo = (line: { sourceInvoiceId: string; sourceInvoiceNumber: string | null } | undefined) =>
    line ? (line.sourceInvoiceNumber ?? (unnumberedSource?.id === line.sourceInvoiceId ? unnumberedSource.docNo : null) ?? line.sourceInvoiceId) : null;

  function openCreate() {
    setError(null);
    const firstInvoice = newestInvoice && returnable(newestInvoice) ? newestInvoice : null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(firstInvoice?.warehouseId ?? warehouses[0]?.id ?? "");
    setReason("DEFECTIVE");
    const firstLine = firstInvoice?.lines.find((l) => l.isStock && l.unitCost !== null);
    setLines(firstLine ? [blankLine(firstLine.lineId, "DEFECTIVE")] : []);
    subPage.open("new");
  }

  function changeInvoice(invoice: SalesInvoiceDTO | null) {
    setPickedInvoice(invoice);
    setInvoiceId(invoice?.id ?? "");
    if (invoice) setWarehouseId(invoice.warehouseId);
    const firstLine = invoice?.lines.find((l) => l.isStock && l.unitCost !== null);
    setLines(firstLine ? [blankLine(firstLine.lineId, reason)] : []);
  }

  function nextSourceLineId(rows: readonly LineDraft[]): string {
    const returnable = new Set(returnableLines.map((l) => l.lineId));
    const known = sourceLines.filter((line) => returnable.has(line.sourceLineId));
    return nextReturnSourceLine(known, rows, returnableLines[0]?.lineId ?? "");
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    const invoice = selectedInvoice;
    if (!invoice || !warehouseId) {
      setError(t("salesReturns.error.needInvoice"));
      return;
    }
    // Only the invoice and a quantity per item leave the browser. Price, cost,
    // tax share and what is still returnable are all read off the source
    // invoice server-side — a screen that computed them would be a second
    // opinion the books never asked for.
    const requested = lines.flatMap((l) => {
      const source = returnableLines.find((sl) => sl.lineId === l.sourceLineId);
      return source && l.qty > 0 ? [{ itemId: source.itemId, sourceLineId: source.lineId, qty: String(l.qty), reason: l.reason }] : [];
    });
    if (requested.length === 0) {
      setError(t("salesReturns.error.needLine"));
      return;
    }
    try {
      const created = await createReturn.mutateAsync({
        id: returnId.current(),
        date: todayIso(),
        memo: "",
        sourceInvoiceId: invoice.id,
        warehouseId,
        reason,
        requested,
      });
      if (confirmAfter) await confirmReturn.mutateAsync(created.id);
      returnId.renew();
      subPage.close();
    } catch (err) {
      if (returnId.recover(err)) return;
      setError(errorMessage(err, t("common.failed")));
    }
  }

  async function refundExisting(id: string) {
    setError(null);
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;
    if (refundTreasuryId === "") {
      setError(t("salesReturns.refund.needTreasury"));
      return;
    }
    try {
      const settled = await refundReturn.mutateAsync({
        id,
        amount: doc.refundDue,
        treasuryAccountId: refundTreasuryId,
        paymentMethod: refundMethod,
        date: doc.date,
      });
      setRefundNotice(t("salesReturns.refund.done", { voucher: settled.voucherNo ?? settled.voucherId }));
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  async function confirmExisting(id: string) {
    setError(null);
    try {
      await confirmReturn.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelReturn.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "draft", label: t("docStatus.draft"), count: counts.draft ?? 0 },
    { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed ?? 0 },
    { key: "cancelled", label: t("docStatus.cancelled"), count: counts.cancelled ?? 0 },
  ];

  const columns: DocumentListColumn<(typeof documents)[number]>[] = [
    {
      key: "docNo",
      header: t("salesReturns.col.docNo"),
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</div>
          <div className="text-[11px] text-ink-muted">{sourceInvoiceNo(d.lines[0]) ?? "—"}</div>
        </div>
      ),
    },
    { key: "customer", header: t("common.customer"), render: (d) => (d.lines[0] ? customerName(d.lines[0].customerId) : "—") },
    {
      key: "reasons",
      header: t("salesReturns.col.reasons"),
      render: (d) => (
        <div className="flex flex-wrap gap-1">
          {[...new Set(d.lines.map((l) => l.reason))].map((r) => (
            <StatusPill key={r} label={t(REASON_KEY[r])} tone="neutral" />
          ))}
        </div>
      ),
    },
    { key: "total", header: t("salesReturns.col.total"), align: "end", render: (d) => <MoneyDisplay value={d.grandTotal !== undefined ? majorOf(d.grandTotal) : returnLinesTotal(d.lines)} /> },
    {
      key: "refundDue",
      header: t("salesReturns.col.refundDue"),
      align: "end",
      render: (d) => (majorOf(d.refundDue) > 0 ? <MoneyDisplay value={majorOf(d.refundDue)} /> : "—"),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} />
          {d.awaitingRefund ? <StatusPill label={t("salesReturns.awaitingRefund")} tone="warning" /> : null}
        </div>
      ),
    },
  ];

  const invoiceOption = (i: SalesInvoiceDTO): EntityPickerOption => ({ id: i.id, label: `${i.docNo ?? i.id} — ${i.customerNameAr}` });

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.sales.returns")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("salesReturns.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("salesReturns.panel.description")}</p>
        </div>
      </div>
        <div className="flex flex-col gap-4 p-5">
          <SalesInvoicePicker
            label={t("salesReturns.field.sourceInvoice")}
            value={selectedInvoice}
            onChange={changeInvoice}
            optionOf={invoiceOption}
            accept={returnable}
            filter={RETURNABLE_INVOICES}
          />
          <SelectField label={t("salesReturns.field.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label={t("salesReturns.field.reason")}
            value={reason}
            onChange={(v) => {
              const next = v as SalesReturnReasonDTO;
              setReason(next);
              // The header reason is the DEFAULT for the lines, not a
              // replacement: a line already given its own reason keeps it.
              setLines((prev) => prev.map((l) => (l.reason === reason ? { ...l, reason: next } : l)));
            }}
            options={Object.entries(REASON_KEY).map(([value, key]) => ({ value, label: t(key) }))}
            hint={t("salesReturns.field.reasonHint")}
          />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("salesReturns.linesHeading")}</span>
            {returnableLines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">{t("salesReturns.noReturnable")}</div>
            ) : null}
            {lines.map((line) => (
              <div key={line.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label={t("common.item")}
                    value={line.sourceLineId}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, sourceLineId: v } : l)))}
                    options={sourceLineOptions(returnableLines.map((sl) => ({ sourceLineId: sl.lineId, itemId: sl.itemId, label: sl.itemNameAr })))}
                  />
                </div>
                <div className="w-[90px]">
                  <NumberField
                    label={t("common.qty")}
                    value={line.qty}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))}
                    min={0}
                  />
                </div>
                <div className="w-[160px]">
                  <SelectField
                    label={t("salesReturns.field.lineReason")}
                    value={line.reason}
                    onChange={(v) =>
                      setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, reason: v as SalesReturnReasonDTO } : l)))
                    }
                    options={Object.entries(REASON_KEY).map(([value, key]) => ({ value, label: t(key) }))}
                  />
                </div>
                <Button variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} disabled={lines.length === 1}>
                  {t("common.delete")}
                </Button>
              </div>
            ))}
            <Button variant="default" disabled={returnableLines.length === 0 || !sourceLinesReady} onClick={() => setLines((prev) => [...prev, blankLine(nextSourceLineId(prev), reason)])}>
              {t("salesReturns.addLine")}
            </Button>
          </div>

          {sourceLinesQuery.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
              <span>{t("returns.sourceLinesFailed")}</span>
              <Button size="sm" onClick={() => void sourceLinesQuery.refetch()}>
                {t("common.retry")}
              </Button>
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" disabled={!sourceLinesReady} onClick={() => submit(false)}>
              {t("salesReturns.saveDraft")}
            </Button>
            <Button variant="primary" disabled={!sourceLinesReady} onClick={() => submit(true)}>
              {t("salesReturns.saveConfirm")}
            </Button>
          </div>
        </div>
    </div>
  );

  const detailPage = (
    <div className="w-full">
      <AlreadySavedNotice notice={savedNotice} openId={firstSegment ?? null} message={t("documents.alreadySaved")} dismissLabel={t("documents.alreadySaved.dismiss")} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.sales.returns")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{selectedLabel ?? t("salesReturns.detailTitle")}</h1>
        </div>
        {selected && !selected.reversesDocId ? (
          <Button onClick={() => subPage.open(selected.docNo ?? selected.id, "print")}>{t("print.action.print")}</Button>
        ) : null}
      </div>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-1.5">
              <StatusPill label={documentStatusLabel(selected.status, t)} tone={DOC_STATUS_TONE[selected.status]} />
              {selected.awaitingRefund ? <StatusPill label={t("salesReturns.awaitingRefund")} tone="warning" /> : null}
            </div>
            <HeldDocumentReapproval document={selected} pending={confirmReturn.isPending} confirm={(id) => confirmReturn.mutateAsync(id)} />
            <ReturnMirrorLinks document={selected} originalNo={reversedReturnNo} onOpen={(id) => subPage.open(id)} />
            <div className="flex flex-wrap items-center gap-[10px] text-[12.5px] text-ink-muted">
              <span>{t("salesReturns.sourceInvoice", { number: sourceInvoiceNo(selected.lines[0]) ?? "—" })}</span>
              {selected.lines[0] ? (
                <Button
                  size="sm"
                  onClick={() => openScreenAt("sales-invoices", [selected.lines[0]?.sourceInvoiceId ?? ""])}
                >
                  {t("salesReturns.row.viewSourceInvoice")}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-[10px] rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span className="flex items-center gap-[8px]">
                    {itemName(l.itemId)}
                    <StatusPill label={t(REASON_KEY[l.reason])} tone="neutral" />
                  </span>
                  <span className="mz-num text-ink-muted">
                    {l.qty} × <MoneyDisplay value={majorOf(l.unitPrice)} />
                  </span>
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {refundNotice ? <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-success-ink">{refundNotice}</div> : null}
            <ResubmitForApprovalAction family={ResubmitFamily.SalesReturns} document={selected} />
            {selected.status === "draft" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                  {t("salesReturns.confirm")}
                </Button>
                <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}

            {selected.status === "confirmed" && selected.awaitingRefund ? (
              <Card className="p-[16px_18px]">
                <h3 className="font-display text-[13.5px] font-bold text-ink">{t("salesReturns.refund.heading")}</h3>
                <p className="mt-[4px] max-w-[62ch] text-[12px] text-ink-muted">{t("salesReturns.refund.hint")}</p>
                <div className="mt-[10px] flex flex-wrap items-end gap-[10px]">
                  <div className="min-w-[220px] flex-1">
                    <SelectField
                      label={t("salesReturns.refund.treasury")}
                      value={refundTreasuryId}
                      onChange={setRefundTreasuryId}
                      options={treasuryAccounts.map((a) => ({ value: a.id, label: `${nameOf(a)} (${a.code})` }))}
                    />
                  </div>
                  <div className="w-[160px]">
                    <SelectField
                      label={t("salesReturns.refund.method")}
                      value={refundMethod}
                      onChange={(v) => setRefundMethod(v as typeof refundMethod)}
                      options={[
                        { value: "cash", label: t("salesReturns.refund.method.cash") },
                        { value: "bank", label: t("salesReturns.refund.method.bank") },
                        { value: "cheque", label: t("salesReturns.refund.method.cheque") },
                      ]}
                    />
                  </div>
                  <div className="text-[12.5px] text-ink">
                    <div className="text-[11px] font-semibold text-ink-faint">{t("salesReturns.refund.due")}</div>
                    <MoneyDisplay value={majorOf(selected.refundDue)} className="text-[14px] font-bold" />
                  </div>
                  <Button variant="primary" disabled={refundReturn.isPending} onClick={() => refundExisting(selected.id)}>
                    {t("salesReturns.refund.submit")}
                  </Button>
                </div>
              </Card>
            ) : null}

            {selected.refunds.length > 0 ? (
              <Card className="p-[16px_18px]">
                <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-ink">{t("salesReturns.refund.postedHeading")}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-ink-faint">
                        <th className="p-[6px] text-start font-semibold">{t("salesReturns.refund.voucher")}</th>
                        <th className="p-[6px] text-start font-semibold">{t("common.date")}</th>
                        <th className="p-[6px] text-end font-semibold">{t("common.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.refunds.map((r) => (
                        <tr key={r.voucherId} className="border-t border-border">
                          <td className="mz-num p-[6px] text-ink">{r.voucherNo ?? r.voucherId}</td>
                          <td className="mz-num p-[6px] text-ink-muted">{r.date}</td>
                          <td className="p-[6px] text-end">
                            <MoneyDisplay value={majorOf(r.amount)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}

            <Card className="p-[16px_18px]">
              <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("attachments.tab")}</h3>
              <AttachmentsTab entityType="sales-return" entityId={selected.id} />
            </Card>

            <ReturnJournalCard family={ReturnFamily.Sales} document={selected} lineLabel={itemName} />
            <VoidReturnReasonNotice document={selected} />
            <VoidReturnAction family={ReturnFamily.Sales} document={selected} />
          </div>
        ) : null}
    </div>
  );

  if (firstSegment === "new") return createPage;
  // إشعار خصم — the credit note the customer keeps (P-6). A destination, not
  // an overlay, so it survives a reload.
  if (selected && !selected.reversesDocId && subPage.segments[1] === "print") return <SalesReturnPrintPage document={selected} />;
  if (selected) return detailPage;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("salesReturns.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <ResubmitErrorNotice controller={resubmit} />
      <DocumentList<(typeof documents)[number]>
        title={t("salesReturns.title")}
        description={t("salesReturns.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("salesReturns.new")}
          </Button>
        }
        listKey="sales-returns"
        statsCollapsible
        stats={[
          { label: t("salesReturns.stat.total"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("salesReturns.stat.confirmed"), value: <span className="mz-num">{stats.confirmed ?? 0}</span> },
          { label: t("salesReturns.awaitingRefund"), value: <span className="mz-num">{stats.awaitingRefund ?? 0}</span> },
          {
            label: t("salesReturns.stat.refundDue"),
            value: <MoneyDisplay value={majorOf(String(stats.refundDue ?? "0"))} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("salesReturns.searchPlaceholder")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-center gap-[10px]">
            <div className="min-w-[210px]">
              <EntityPicker
                value={customerFilter}
                onChange={setCustomerFilter}
                options={customerOptions}
                placeholder={t("salesReturns.filterByCustomer")}
                aria-label={t("salesReturns.filterByCustomer")}
              />
            </div>
            <TextInput numeric type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label={t("common.fromDate")} />
            <TextInput numeric type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label={t("common.toDate")} />
            <Chip
              toggle
              active={awaitingOnly}
              onClick={() => {
                setAwaitingOnly((on) => !on);
                setPage(1);
              }}
            >
              {t("salesReturns.awaitingRefund")}
            </Chip>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => subPage.open(d.docNo ?? d.id)}
        rowAction={(d) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("salesReturns.row.view"), onSelect: () => subPage.open(d.docNo ?? d.id) },
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(d.docNo ?? d.id, "print") },
            ...(d.lines[0]
              ? [
                  {
                    key: "source",
                    label: t("salesReturns.row.viewSourceInvoice"),
                    onSelect: () => openScreenAt("sales-invoices", [d.lines[0]?.sourceInvoiceId ?? ""]),
                  },
                ]
              : []),
            ...(d.status === "draft"
              ? [
                  { key: "confirm", label: t("salesReturns.confirm"), onSelect: () => confirmExisting(d.id) },
                  { key: "cancel", label: t("common.cancel"), tone: "danger" as const, onSelect: () => cancelExisting(d.id) },
                ]
              : []),
              ...resubmitRowMenuItems(resubmit, d),
            ...(d.awaitingRefund
              ? [{ key: "refund", label: t("salesReturns.refund.submit"), onSelect: () => subPage.open(d.docNo ?? d.id) }]
              : []),
            ...(mayVoid(d) ? [{ key: "void", label: t("salesReturns.void"), tone: "danger" as const, onSelect: () => setVoidTarget(d) }] : []),
          ];
          return <RowMenu items={menuItems} label={t("salesReturns.row.actionsFor", { doc: d.docNo ?? d.id })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{documents.length}</span> {t("salesReturns.showingSuffix")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("salesReturns.empty")}
            description={t("salesReturns.emptyBody")}
            action={{ label: t("salesReturns.new"), onClick: openCreate }}
          />
        }
      />
      <VoidReturnDialog family={ReturnFamily.Sales} document={voidTarget} onClose={() => setVoidTarget(null)} />
    </div>
  );
}
