import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../lib/error-message";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { CreatePurchaseReturnDTO, DocumentStatusDTO, PurchaseInvoiceDTO, PurchaseReturnLineDTO, PurchaseReturnReasonDTO } from "@mezan/contracts";
import { SelectField, NumberField, TextField } from "../settings/form-controls";
import {
  useCancelPurchaseReturn,
  useConfirmPurchaseReturn,
  useCreatePurchaseReturn,
  useItems,
  usePurchaseInvoices,
  usePurchaseReturns,
  useReturnSourceLines,
  ReturnKind,
  usePurchaseReturnCounts,
  usePurchaseReturnStats,
  useSuppliers,
  useWarehouses,
  type PurchaseReturnListFilter,
} from "../data/hooks";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { PurchaseReturnPrintPage } from "../print/documents";
import { useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { nextReturnSourceLine, sourceLineOptions } from "./return-source-lines";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** مرتجعات المشتريات (Purchase Returns) — docs/archive/catalog/02. Document-framework-backed (draft → confirmed, de-stocks, reduces AP). */

const REASON_KEY: Record<PurchaseReturnReasonDTO, AppTranslationKey> = {
  DEFECTIVE: "purchaseReturns.reason.DEFECTIVE",
  WRONG_ITEM: "purchaseReturns.reason.WRONG_ITEM",
  EXCESS_QTY: "purchaseReturns.reason.EXCESS_QTY",
  QUALITY_ISSUE: "purchaseReturns.reason.QUALITY_ISSUE",
  OTHER: "purchaseReturns.reason.OTHER",
};


const num = (v: string) => Number(v);
const lineTotal = (l: PurchaseReturnLineDTO) => num(l.unitCost) * num(l.qty) + num(l.taxAmount);

interface LineDraft {
  key: string;
  sourceLineId: string;
  qty: number;
}
let lineSeq = 0;
function blankLine(sourceLineId: string): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, sourceLineId, qty: 1 };
}

// EXTERNAL CONTRACT: a purchase invoice line has no id of its own; the server
// names it by its position in the invoice, and a return must send the same.
function returnableLinesOf(invoice: PurchaseInvoiceDTO | null | undefined) {
  return (invoice?.lines ?? [])
    .map((l, index) => ({ ...l, sourceLineId: String(index) }))
    .flatMap((l) => (l.kind === "inventory" && l.itemId !== null ? [{ ...l, itemId: l.itemId }] : []));
}

export function PurchaseReturnsScreen() {
  const { t } = useAppTranslation();
  const invoicesQuery = usePurchaseInvoices();
  const warehousesQuery = useWarehouses();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createReturn = useCreatePurchaseReturn();
  const confirmReturn = useConfirmPurchaseReturn();
  const cancelReturn = useCancelPurchaseReturn();

  const invoices = (invoicesQuery.data ?? []).filter((i) => i.status === "confirmed");
  const warehouses = warehousesQuery.data ?? EMPTY;
  const suppliers = suppliersQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | DocumentStatusDTO,
    (next: string) => void,
  ];
  const [invoiceId, setInvoiceId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState<PurchaseReturnReasonDTO>("DEFECTIVE");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Defaults the create form's invoice/warehouse pickers once their queries resolve —
  // `openCreate` alone can't do this if the page is opened before `invoices`/`warehouses` load.
  useEffect(() => {
    if (firstSegment !== "new" || invoiceId !== "") return;
    const firstInvoice = invoices[0];
    if (!firstInvoice) return;
    setInvoiceId(firstInvoice.id);
    setWarehouseId(firstInvoice.warehouseId);
    const firstLine = returnableLinesOf(firstInvoice)[0];
    setLines(firstLine ? [blankLine(firstLine.sourceLineId)] : []);
  }, [firstSegment, invoices, invoiceId]);

  useEffect(() => {
    if (firstSegment !== "new" || warehouseId !== "" || invoiceId !== "") return;
    const firstWarehouse = warehouses[0];
    if (firstWarehouse) setWarehouseId(firstWarehouse.id);
  }, [firstSegment, warehouses, warehouseId, invoiceId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const returnableLines = useMemo(() => returnableLinesOf(selectedInvoice), [selectedInvoice]);
  const sourceLines = useReturnSourceLines(ReturnKind.Purchase, firstSegment === "new" ? invoiceId : "").data?.lines ?? EMPTY;

  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [supplierFilter, setSupplierFilter] = useUrlParam("supplier");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");

  /**
   * One filter for the rows, the chip counts and the KPI strip (R1.1) — the
   * three used to disagree: the chips and the KPI strip counted every
   * unfiltered return the server had ever sent, so applying a filter moved
   * the table and left the header alone.
   */
  const filter = useMemo<PurchaseReturnListFilter>(
    () => ({
      status: statusFilter,
      supplierId: supplierFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, supplierFilter, fromDate, toDate, search],
  );
  const query = usePurchaseReturns(filter);
  const documents = query.data ?? [];
  const counts = usePurchaseReturnCounts(filter).data ?? {};
  const stats = usePurchaseReturnStats(filter).data ?? {};

  const activeFilterCount = [supplierFilter, fromDate, toDate].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = documents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected =
    firstSegment !== undefined && firstSegment !== "new"
      ? (documents.find((d) => d.id === firstSegment || d.docNo === firstSegment) ?? null)
      : null;

  useScreenIntent((intent) => {
    openCreate(intent.prefill?.invoiceId);
  });

  function openCreate(sourceInvoiceId?: string) {
    setError(null);
    const firstInvoice = invoices.find((i) => i.id === sourceInvoiceId) ?? invoices[0] ?? null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(firstInvoice?.warehouseId ?? warehouses[0]?.id ?? "");
    setReason("DEFECTIVE");
    const firstLine = returnableLinesOf(firstInvoice)[0];
    setLines(firstLine ? [blankLine(firstLine.sourceLineId)] : []);
    subPage.open("new");
  }

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id) ?? null;
    if (invoice) setWarehouseId(invoice.warehouseId);
    const firstLine = returnableLinesOf(invoice)[0];
    setLines(firstLine ? [blankLine(firstLine.sourceLineId)] : []);
  }

  function nextSourceLineId(rows: readonly LineDraft[]): string {
    const returnable = new Set(returnableLines.map((l) => l.sourceLineId));
    const known = sourceLines.filter((line) => returnable.has(line.sourceLineId));
    const sold = known.length > 0 ? known : returnableLines.map((l) => ({ sourceLineId: l.sourceLineId, soldQty: l.qty, returnedQty: "0" }));
    return nextReturnSourceLine(sold, rows, returnableLines[0]?.sourceLineId ?? "");
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice || !warehouseId) {
      setError(t("purchaseReturns.error.needInvoice"));
      return;
    }
    const returnLines: CreatePurchaseReturnDTO["lines"] = lines.flatMap((l) => {
      const source = returnableLines.find((sl) => sl.sourceLineId === l.sourceLineId);
      if (!source || l.qty <= 0) return [];
      return [
        {
          itemId: source.itemId,
          warehouseId,
          supplierId: invoice.supplierId,
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.number,
          sourceLineId: source.sourceLineId,
          reason,
          qty: String(l.qty),
        },
      ];
    });
    if (returnLines.length === 0) {
      setError(t("purchaseReturns.error.needLine"));
      return;
    }
    try {
      const id = crypto.randomUUID();
      const created = await createReturn.mutateAsync({ id, date: todayIso(), memo: "", lines: returnLines });
      if (confirmAfter) await confirmReturn.mutateAsync(created.id);
      subPage.close();
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
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelReturn.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
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
      header: t("purchaseReturns.col.docNo"),
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</div>
          <div className="text-[11px] text-ink-muted">{d.lines[0]?.sourceInvoiceNumber ?? "—"}</div>
        </div>
      ),
    },
    { key: "supplier", header: t("common.supplier"), render: (d) => (d.lines[0] ? supplierName(d.lines[0].supplierId) : "—") },
    { key: "total", header: t("purchaseReturns.col.total"), align: "end", render: (d) => <MoneyDisplay value={d.grandTotal !== undefined ? num(d.grandTotal) : d.lines.reduce((s, l) => s + lineTotal(l), 0)} /> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} /> },
  ];

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.returns")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("purchaseReturns.panel.title")}</h1>
        </div>
      </div>
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label={t("purchaseReturns.field.sourceInvoice")}
            value={invoiceId}
            onChange={changeInvoice}
            options={invoices.map((i) => ({ value: i.id, label: `${i.number} — ${supplierName(i.supplierId)}` }))}
          />
          <SelectField label={t("purchaseReturns.field.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label={t("purchaseReturns.field.reason")}
            value={reason}
            onChange={(v) => setReason(v as PurchaseReturnReasonDTO)}
            options={Object.entries(REASON_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("purchaseReturns.linesHeading")}</span>
            {returnableLines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">{t("purchaseReturns.noReturnable")}</div>
            ) : null}
            {lines.map((line) => (
              <div key={line.key} className="flex items-end gap-2 rounded-[10px] border border-border p-2.5">
                <div className="flex-1">
                  <SelectField
                    label={t("common.item")}
                    value={line.sourceLineId}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, sourceLineId: v } : l)))}
                    options={sourceLineOptions(returnableLines.map((sl) => ({ sourceLineId: sl.sourceLineId, itemId: sl.itemId, label: itemName(sl.itemId) })))}
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
                <Button variant="ghost" onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))} disabled={lines.length === 1}>
                  {t("common.delete")}
                </Button>
              </div>
            ))}
            <Button
              variant="default"
              disabled={returnableLines.length === 0}
              onClick={() => setLines((prev) => [...prev, blankLine(nextSourceLineId(prev))])}
            >
              {t("purchaseReturns.addLine")}
            </Button>
          </div>

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              {t("purchaseReturns.saveDraft")}
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              {t("purchaseReturns.saveConfirm")}
            </Button>
          </div>
        </div>
    </div>
  );

  const detailPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.returns")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{selected?.docNo ?? t("purchaseReturns.detailTitle")}</h1>
          {selected ? (
            <Button className="mt-2" onClick={() => subPage.open(selected.docNo ?? selected.id, "print")}>
              {t("print.action.print")}
            </Button>
          ) : null}
        </div>
      </div>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={documentStatusLabel(selected.status, t)} tone={DOC_STATUS_TONE[selected.status]} />
            <div className="text-[12.5px] text-ink-muted">{t("purchaseReturns.sourceInvoice", { number: selected.lines[0]?.sourceInvoiceNumber ?? "—" })}</div>
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{itemName(l.itemId)}</span>
                  <span className="mz-num text-ink-muted">
                    {l.qty} × <MoneyDisplay value={num(l.unitCost)} />
                  </span>
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "draft" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                  {t("purchaseReturns.confirm")}
                </Button>
                <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}
            {selected.status === "confirmed" ? (
              <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                {t("purchaseReturns.void")}
              </Button>
            ) : null}
          </div>
        ) : null}
    </div>
  );

  if (firstSegment === "new") return createPage;
  // إشعار خصم — the debit note sent to the supplier (P-6).
  if (selected && subPage.segments[1] === "print") return <PurchaseReturnPrintPage document={selected} />;
  if (selected) return detailPage;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("purchaseReturns.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<(typeof documents)[number]>
        title={t("purchaseReturns.title")}
        description={t("purchaseReturns.description")}
        actions={
          <Button variant="primary" onClick={() => openCreate()}>
            {t("purchaseReturns.new")}
          </Button>
        }
        stats={[
          { label: t("purchaseReturns.stat.total"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("purchaseReturns.stat.confirmed"), value: <span className="mz-num">{stats.confirmed ?? 0}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        columns={columns}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("purchaseReturns.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-3">
            <SelectField
              label={t("common.supplier")}
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={[{ value: "", label: t("common.allSuppliers") }, ...suppliers.map((sup) => ({ value: sup.id, label: sup.nameAr }))]}
            />
            <TextField label={t("common.fromDate")} value={fromDate} onChange={setFromDate} type="date" />
            <TextField label={t("common.toDate")} value={toDate} onChange={setToDate} type="date" />
          </div>
        }
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => subPage.open(d.docNo ?? d.id)}
        rowAction={(d) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(d.docNo ?? d.id) },
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(d.docNo ?? d.id, "print") },
            ...(d.status === "draft"
              ? [
                  { key: "confirm", label: t("purchaseReturns.confirm"), onSelect: () => void confirmExisting(d.id) },
                  { key: "cancel", label: t("common.cancel"), onSelect: () => void cancelExisting(d.id) },
                ]
              : []),
            ...(d.status === "confirmed" ? [{ key: "void", label: t("purchaseReturns.void"), onSelect: () => void cancelExisting(d.id) }] : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems} label={t("purchaseReturns.row.actionsFor", { doc: d.docNo ?? d.id })} />
            </div>
          );
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{documents.length}</span> {t("purchaseReturns.showingSuffix")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("purchaseReturns.empty")}
            description={t("purchaseReturns.emptyHint")}
            action={{ label: t("purchaseReturns.new"), onClick: () => openCreate() }}
          />
        }
      />


    </div>
  );
}
