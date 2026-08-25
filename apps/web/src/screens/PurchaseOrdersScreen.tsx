import { useMemo, useState } from "react";
import {
  Button,
  Card,
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
  Qty as QtyDisplay,
} from "@mezan/ui";
import type { PurchaseOrderDTO, PurchaseOrderLineDTO, PurchaseOrderStatusDTO } from "@mezan/contracts";
import { useConfirmPurchaseOrder, useCreatePurchaseOrder, useItems, usePurchaseOrders, useSuppliers } from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { useUnitLabel } from "../lib/item-labels";
import { TextField, NumberField } from "../settings/form-controls";
import { useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const STATUS_KEY: Record<PurchaseOrderStatusDTO, AppTranslationKey> = {
  draft: "purchaseOrders.status.draft",
  sent: "purchaseOrders.status.sent",
  partially_received: "purchaseOrders.status.partially_received",
  fully_received: "purchaseOrders.status.fully_received",
  cancelled: "purchaseOrders.status.cancelled",
};
const STATUS_TONE: Record<PurchaseOrderStatusDTO, PillTone> = {
  draft: "neutral",
  sent: "info",
  partially_received: "warning",
  fully_received: "success",
  cancelled: "danger",
};

const num = (v: string) => Number(v);
const lineTotal = (l: PurchaseOrderLineDTO) => Number(l.qty) * Number(l.unitPrice);
const outstandingQty = (l: PurchaseOrderLineDTO) => Number(l.qty) - Number(l.receivedQty);

interface DraftLine {
  itemId: string;
  qty: number;
  unitPrice: number;
}

function OrderDetail({
  order,
  supplierName,
  itemName,
  onBack,
  onConfirm,
}: {
  order: PurchaseOrderDTO;
  supplierName: (id: string) => string;
  itemName: (id: string) => string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <DocumentDetail
      title={t("purchaseOrders.detailTitle", { number: order.number })}
      statusLabel={t(STATUS_KEY[order.status])}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${supplierName(order.supplierId)} · ${order.date.split("-").reverse().join("/")}`}
      actions={
        <>
          {order.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              {t("purchaseOrders.confirmSend")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("purchaseOrders.backToList")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(order.supplierId) },
        { label: t("common.date"), value: order.date.split("-").reverse().join("/") },
        { label: t("purchaseOrders.detail.expectedDelivery"), value: order.expectedDeliveryDate?.split("-").reverse().join("/") ?? "—" },
        { label: t("common.warehouse"), value: order.warehouseId },
        { label: t("common.total"), value: <MoneyValue value={num(order.subtotal)} /> },
        { label: t("purchaseOrders.detail.createdBy"), value: order.createdBy },
      ]}
      effects={[
        t("purchaseOrders.effect.noStock"),
        t("purchaseOrders.effect.onReceipt"),
        t("purchaseOrders.effect.onInvoice"),
      ]}
      tabs={[
        {
          key: "lines",
          label: t("purchaseOrders.tab.lines", { count: order.lines.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseOrders.col.unitPrice")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseOrders.col.received")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseOrders.col.remaining")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseOrders.col.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.qty} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitPrice)} showUnit={false} /></td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.receivedQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{outstandingQty(l)}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={lineTotal(l)} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
      ]}
    />
  );
}

export function PurchaseOrdersScreen() {
  const { t } = useAppTranslation();
  const query = usePurchaseOrders();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createOrder = useCreatePurchaseOrder();
  const confirmOrder = useConfirmPurchaseOrder();

  const orders = query.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
  const unitLabel = useUnitLabel();
  const itemOptions: EntityPickerOption[] = items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: unitLabel(i.baseUnitCode) }));

  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  useScreenIntent(() => openCreate());
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, unitPrice: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = selectedId === null ? null : (orders.find((o) => o.id === selectedId || o.number === selectedId) ?? null);

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || supplierName(o.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [orders, statusFilter, search, supplierName]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: orders.length },
    ...(Object.keys(STATUS_KEY) as PurchaseOrderStatusDTO[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<PurchaseOrderDTO>[] = [
    { key: "number", header: t("purchaseOrders.col.number"), render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "supplier", header: t("common.supplier"), render: (o) => supplierName(o.supplierId) },
    { key: "date", header: t("common.date"), render: (o) => <span className="mz-num">{o.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: t("common.total"), align: "end", render: (o) => <MoneyValue value={num(o.subtotal)} /> },
    { key: "status", header: t("common.status"), render: (o) => <StatusPill label={t(STATUS_KEY[o.status])} tone={STATUS_TONE[o.status]} /> },
  ];

  function openCreate() {
    setSupplier(null);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setLines([{ itemId: "", qty: 1, unitPrice: 0 }]);
    setFormError(null);
    subPage.open("new");
  }

  async function confirmSelected(id: string) {
    try {
      await confirmOrder.mutateAsync(id);
    } catch {
      // The list/detail re-render from the failed mutation's settled cache; nothing further to do here.
    }
  }

  const workingLocation = useWorkingLocation();
  const draftSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const canSave = supplier !== null && lines.some((l) => l.itemId !== "" && l.qty > 0);

  async function save() {
    if (!supplier) return;
    setFormError(null);
    if (!workingLocation.branchId || !workingLocation.warehouseId) {
      setFormError(t("purchaseOrders.error.noScope"));
      return;
    }
    try {
      await createOrder.mutateAsync({
        id: crypto.randomUUID(),
        supplierId: supplier.id,
        date,
        branchId: workingLocation.branchId ?? "",
        warehouseId: workingLocation.warehouseId ?? "",
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: lines
          .filter((l) => l.itemId !== "" && l.qty > 0)
          .map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitPrice: String(l.unitPrice || 0) })),
      });
      subPage.close();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("purchaseOrders.error.saveFailed"));
    }
  }

  const form = (
    <div className="flex flex-col gap-[14px]">
      {formError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {formError}
        </div>
      ) : null}
      <EntityPicker label={t("purchaseOrders.field.supplier")} value={supplier} onChange={setSupplier} options={supplierOptions} placeholder={t("purchaseOrders.field.supplierPlaceholder")} />
      <TextField label={t("purchaseOrders.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
      <div className="flex flex-col gap-[10px]">
        <span className="text-[12.5px] font-semibold text-ink">{t("purchaseOrders.linesHeading")}</span>
        {lines.map((line, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
            <EntityPicker
              label={t("common.item")}
              value={itemOptions.find((o) => o.id === line.itemId) ?? null}
              onChange={(opt) => {
                const item = items.find((it) => it.id === opt?.id);
                setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "", unitPrice: item?.costPrice ? Number(item.costPrice) : l.unitPrice } : l)));
              }}
              options={itemOptions}
              placeholder={t("purchaseOrders.field.itemPlaceholder")}
            />
            <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
              <NumberField label={t("common.qty")} value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
              <NumberField label={t("purchaseOrders.col.unitPrice")} value={line.unitPrice} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: v } : l)))} />
            </div>
            {lines.length > 1 ? (
              <div className="mt-[8px] flex justify-end">
                <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>{t("purchaseOrders.deleteLine")}</Button>
              </div>
            ) : null}
          </div>
        ))}
        <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, unitPrice: 0 }])}>{t("purchaseOrders.addLine")}</Button>
      </div>
      <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
      <div className="flex items-center justify-between border-t border-border pt-[12px]">
        <span className="text-[12.5px] text-ink-muted">{t("common.total")}</span>
        <MoneyValue value={draftSubtotal} />
      </div>
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={save} disabled={!canSave}>
          {t("purchaseOrders.saveDraft")}
        </Button>
      </div>
    </div>
  );

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.orders")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("purchaseOrders.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("purchaseOrders.panel.description")}</p>
        </div>
        <Button variant="default" onClick={subPage.close}>
          {t("quotes.backToList")}
        </Button>
      </div>
      {form}
    </div>
  );

  if (firstSegment === "new") return createPage;

  if (selected) {
    return (
      <>
        <OrderDetail order={selected} supplierName={supplierName} itemName={itemName} onBack={() => subPage.close()} onConfirm={() => confirmSelected(selected.id)} />
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("purchaseOrders.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<PurchaseOrderDTO>
        eyebrow={t("eyebrow.purchases.orders")}
        title={t("purchaseOrders.title")}
        description={t("purchaseOrders.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("purchaseOrders.new")}
          </Button>
        }
        stats={[
          { label: t("purchaseOrders.stat.total"), value: <span className="mz-num">{orders.length}</span> },
          { label: t("purchaseOrders.stat.sent"), value: <span className="mz-num">{orders.filter((o) => o.status === "sent").length}</span> },
          { label: t("purchaseOrders.stat.value"), value: <MoneyValue value={orders.reduce((sum, o) => sum + num(o.subtotal), 0)} showUnit={false} /> },
          { label: t("purchaseOrders.stat.received"), value: <span className="mz-num">{orders.filter((o) => o.status === "fully_received").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseOrderStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("purchaseOrders.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        onRowClick={(o) => subPage.open(o.number ?? o.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{orders.length}</span> {t("purchaseOrders.showingSuffix")}</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("purchaseOrders.empty")}</div>}
      />
    </>
  );
}
