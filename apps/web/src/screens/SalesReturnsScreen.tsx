import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import type { DocumentStatusDTO, SalesReturnLineDTO, SalesReturnReasonDTO } from "@mezan/contracts";
import { SelectField, NumberField } from "../settings/form-controls";
import {
  useCancelSalesReturn,
  useConfirmSalesReturn,
  useCreateSalesReturn,
  useCustomers,
  useItems,
  useSalesInvoices,
  useSalesReturns,
  useWarehouses,
} from "../data/hooks";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** مرتجعات المبيعات (Sales Returns) — docs/catalog/01. Document-framework-backed (draft → confirmed, restocks at cost, reduces AR). */

const REASON_KEY: Record<SalesReturnReasonDTO, AppTranslationKey> = {
  DEFECTIVE: "salesReturns.reason.DEFECTIVE",
  WRONG_ITEM: "salesReturns.reason.WRONG_ITEM",
  EXCESS_QTY: "salesReturns.reason.EXCESS_QTY",
  CHANGED_MIND: "salesReturns.reason.CHANGED_MIND",
  OTHER: "salesReturns.reason.OTHER",
};


const num = (v: string) => Number(v);
const lineTotal = (l: SalesReturnLineDTO) => num(l.unitPrice) * num(l.qty) + num(l.taxAmount);

interface LineDraft {
  key: string;
  itemId: string;
  qty: number;
}
let lineSeq = 0;
function blankLine(defaultItemId: string): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: defaultItemId, qty: 1 };
}

export function SalesReturnsScreen() {
  const { t } = useAppTranslation();
  const query = useSalesReturns();
  const invoicesQuery = useSalesInvoices();
  const warehousesQuery = useWarehouses();
  const customersQuery = useCustomers();
  const itemsQuery = useItems();
  const createReturn = useCreateSalesReturn();
  const confirmReturn = useConfirmSalesReturn();
  const cancelReturn = useCancelSalesReturn();

  const documents = query.data ?? [];
  const invoices = (invoicesQuery.data ?? []).filter((i) => i.status !== "draft" && i.status !== "cancelled");
  const warehouses = warehousesQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [customers]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");
  const [invoiceId, setInvoiceId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [reason, setReason] = useState<SalesReturnReasonDTO>("DEFECTIVE");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Defaults the create form's invoice/warehouse pickers once their queries resolve —
  // `openCreate` alone can't do this if the panel is opened before `invoices`/`warehouses` load.
  useEffect(() => {
    if (panel !== "create" || invoiceId !== "") return;
    const firstInvoice = invoices[0];
    if (!firstInvoice) return;
    setInvoiceId(firstInvoice.id);
    const firstLine = firstInvoice.lines.find((l) => l.isStock && l.unitCost !== null);
    setLines(firstLine ? [blankLine(firstLine.itemId)] : []);
  }, [panel, invoices, invoiceId]);

  useEffect(() => {
    if (panel !== "create" || warehouseId !== "") return;
    const firstWarehouse = warehouses[0];
    if (firstWarehouse) setWarehouseId(firstWarehouse.id);
  }, [panel, warehouses, warehouseId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const returnableLines = useMemo(
    () => (selectedInvoice?.lines ?? []).filter((l) => l.isStock && l.unitCost !== null),
    [selectedInvoice],
  );

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0, awaitingRefund: 0, cancelled: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
      if (d.awaitingRefund) c.awaitingRefund += 1;
      if (d.status === "cancelled") c.cancelled += 1;
    }
    return c;
  }, [documents]);

  const filtered = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
  const selected = typeof panel === "object" ? (documents.find((d) => d.id === panel.id) ?? null) : null;

  function openCreate() {
    setError(null);
    const firstInvoice = invoices[0] ?? null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(warehouses[0]?.id ?? "");
    setReason("DEFECTIVE");
    const firstLine = firstInvoice?.lines.find((l) => l.isStock && l.unitCost !== null);
    setLines(firstLine ? [blankLine(firstLine.itemId)] : []);
    setPanel("create");
  }

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id) ?? null;
    const firstLine = invoice?.lines.find((l) => l.isStock && l.unitCost !== null);
    setLines(firstLine ? [blankLine(firstLine.itemId)] : []);
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice || !warehouseId) {
      setError(t("salesReturns.error.needInvoice"));
      return;
    }
    const returnLines: SalesReturnLineDTO[] = lines
      .filter((l) => l.qty > 0 && l.itemId !== "")
      .map((l) => {
        const source = returnableLines.find((sl) => sl.itemId === l.itemId);
        const unitPrice = source?.unitPrice ?? "0";
        const unitCost = source?.unitCost ?? "0";
        const taxRate = source?.taxRatePercent ?? 0;
        const taxAmount = ((Number(unitPrice) * l.qty * taxRate) / 100).toFixed(6);
        return {
          itemId: l.itemId,
          warehouseId,
          customerId: invoice.customerId,
          sourceInvoiceId: invoice.id,
          sourceInvoiceNumber: invoice.docNo,
          reason,
          availableQty: source?.qty ?? String(l.qty),
          qty: String(l.qty),
          unitPrice,
          unitCost,
          taxAmount,
        };
      });
    if (returnLines.length === 0) {
      setError(t("salesReturns.error.needLine"));
      return;
    }
    try {
      const id = crypto.randomUUID();
      const created = await createReturn.mutateAsync({ id, date: new Date().toISOString().slice(0, 10), memo: "", lines: returnLines });
      if (confirmAfter) await confirmReturn.mutateAsync(created.id);
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmExisting(id: string) {
    setError(null);
    try {
      await confirmReturn.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelReturn.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "draft", label: t("docStatus.draft"), count: counts.draft },
    { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed },
    { key: "cancelled", label: t("docStatus.cancelled"), count: counts.cancelled },
  ];

  const columns: DocumentListColumn<(typeof documents)[number]>[] = [
    {
      key: "docNo",
      header: t("salesReturns.col.docNo"),
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</div>
          <div className="text-[11px] text-ink-muted">{d.lines[0]?.sourceInvoiceNumber ?? "—"}</div>
        </div>
      ),
    },
    { key: "customer", header: t("common.customer"), render: (d) => (d.lines[0] ? customerName(d.lines[0].customerId) : "—") },
    { key: "total", header: t("salesReturns.col.total"), align: "end", render: (d) => <MoneyDisplay value={d.lines.reduce((s, l) => s + lineTotal(l), 0)} /> },
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

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("salesReturns.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<(typeof documents)[number]>
        eyebrow={t("eyebrow.sales.returns")}
        title={t("salesReturns.title")}
        description={t("salesReturns.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("salesReturns.new")}
          </Button>
        }
        stats={[
          { label: t("salesReturns.stat.total"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("salesReturns.stat.confirmed"), value: <span className="mz-num">{counts.confirmed}</span> },
          { label: t("salesReturns.awaitingRefund"), value: <span className="mz-num">{counts.awaitingRefund}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("salesReturns.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("salesReturns.empty")}</div>}
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title={t("salesReturns.panel.title")} description={t("salesReturns.panel.description")}>
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label={t("salesReturns.field.sourceInvoice")}
            value={invoiceId}
            onChange={changeInvoice}
            options={invoices.map((i) => ({ value: i.id, label: `${i.docNo ?? i.id} — ${customerName(i.customerId)}` }))}
          />
          <SelectField label={t("salesReturns.field.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label={t("salesReturns.field.reason")}
            value={reason}
            onChange={(v) => setReason(v as SalesReturnReasonDTO)}
            options={Object.entries(REASON_KEY).map(([value, key]) => ({ value, label: t(key) }))}
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
                    value={line.itemId}
                    onChange={(v) => setLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, itemId: v } : l)))}
                    options={returnableLines.map((sl) => ({ value: sl.itemId, label: sl.itemNameAr }))}
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
            <Button variant="default" disabled={returnableLines.length === 0} onClick={() => setLines((prev) => [...prev, blankLine(returnableLines[0]?.itemId ?? "")])}>
              {t("salesReturns.addLine")}
            </Button>
          </div>

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              {t("salesReturns.saveDraft")}
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              {t("salesReturns.saveConfirm")}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? t("salesReturns.detailTitle")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-1.5">
              <StatusPill label={documentStatusLabel(selected.status, t)} tone={DOC_STATUS_TONE[selected.status]} />
              {selected.awaitingRefund ? <StatusPill label={t("salesReturns.awaitingRefund")} tone="warning" /> : null}
            </div>
            <div className="text-[12.5px] text-ink-muted">{t("salesReturns.sourceInvoice", { number: selected.lines[0]?.sourceInvoiceNumber ?? "—" })}</div>
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>{itemName(l.itemId)}</span>
                  <span className="mz-num text-ink-muted">
                    {l.qty} × <MoneyDisplay value={num(l.unitPrice)} />
                  </span>
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
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
            {selected.status === "confirmed" ? (
              <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                {t("salesReturns.void")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}
