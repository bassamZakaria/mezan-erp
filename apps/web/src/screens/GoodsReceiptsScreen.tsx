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
import type { GoodsReceiptDTO, GoodsReceiptStatusDTO } from "@mezan/contracts";
import { useConfirmGoodsReceipt, useCreateGoodsReceipt, useGoodsReceipts, useItems, usePurchaseOrders, useSuppliers,
  useUsers,
  useBranches,
  useWarehouses,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";

const STATUS_KEY: Record<GoodsReceiptStatusDTO, AppTranslationKey> = {
  draft: "goodsReceipts.status.draft",
  confirmed: "goodsReceipts.status.confirmed",
  cancelled: "goodsReceipts.status.cancelled",
};
const STATUS_TONE: Record<GoodsReceiptStatusDTO, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

const num = (v: string) => Number(v);

interface PreviewLine {
  itemId: string;
  qty: number;
  unitCost: number;
}

function ReceiptDetail({
  receipt,
  order,
  supplierName,
  itemName,
  onBack,
  onConfirm,
}: {
  receipt: GoodsReceiptDTO;
  order: { number: string } | undefined;
  supplierName: (id: string) => string;
  itemName: (id: string) => string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <DocumentDetail
      title={t("goodsReceipts.detailTitle", { number: receipt.number })}
      statusLabel={t(STATUS_KEY[receipt.status])}
      statusTone={STATUS_TONE[receipt.status]}
      subtitle={t("goodsReceipts.subtitle", { supplier: supplierName(receipt.supplierId), order: order?.number ?? receipt.purchaseOrderId ?? "—" })}
      actions={
        <>
          {receipt.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              {t("goodsReceipts.confirm")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("goodsReceipts.backToList")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(receipt.supplierId) },
        { label: t("goodsReceipts.detail.order"), value: order?.number ?? receipt.purchaseOrderId },
        { label: t("common.date"), value: receipt.date.split("-").reverse().join("/") },
        { label: t("common.warehouse"), value: receipt.warehouseId },
        { label: t("goodsReceipts.detail.totalCost"), value: <MoneyValue value={num(receipt.totalCost)} /> },
        { label: t("goodsReceipts.detail.invoiceStatus"), value: receipt.invoiced ? t("goodsReceipts.invoiced") : t("goodsReceipts.notInvoiced"), valueTone: receipt.invoiced ? "success" : undefined },
      ]}
      effects={
        receipt.status === "confirmed"
          ? [
              t("goodsReceipts.effect.stockIn"),
              t("goodsReceipts.effect.noTaxYet"),
              t("goodsReceipts.effect.orderUpdated"),
            ]
          : [
              t("goodsReceipts.effect.draft"),
              t("goodsReceipts.effect.draftTax"),
            ]
      }
      tabs={[
        {
          key: "lines",
          label: t("goodsReceipts.tab.lines", { count: receipt.lines.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.receivedQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.unitCost")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.qty} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost) * Number(l.qty)} showUnit={false} /></td>
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

export function GoodsReceiptsScreen() {
  const { t } = useAppTranslation();
  const query = useGoodsReceipts();
  const ordersQuery = usePurchaseOrders();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createReceipt = useCreateGoodsReceipt();
  const confirmReceipt = useConfirmGoodsReceipt();

  const receipts = query.data ?? [];
  const orders = ordersQuery.data ?? [];
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
  const orderById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  /** Only sent / partially-received POs can be received against (docs/catalog/02). */
  const receivableOrders = orders.filter((o) => o.status === "sent" || o.status === "partially_received");
  const orderOptions: EntityPickerOption[] = receivableOrders.map((o) => ({
    id: o.id,
    label: `${o.number} · ${supplierName(o.supplierId)}`,
    sublabel: o.date,
  }));

  const users = useUsers().data ?? [];
  const filterBranches = useBranches().data ?? [];
  const filterWarehouses = useWarehouses().data ?? [];
  const [branchFilter, setBranchFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName ?? id;

  const [statusFilter, setStatusFilter] = useState<GoodsReceiptStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  useScreenIntent(() => openCreate());
  const [pickedOrder, setPickedOrder] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(todayIso());
  const [formError, setFormError] = useState<string | null>(null);

  const selected = selectedId === null ? null : (receipts.find((r) => r.id === selectedId || r.number === selectedId) ?? null);

  // create-from-PO preview only — the server auto-fills the real lines from the PO's outstanding qty on save.
  const previewLines: PreviewLine[] = useMemo(() => {
    const order = orders.find((o) => o.id === pickedOrder?.id);
    if (!order) return [];
    return order.lines
      .map((l) => ({ itemId: l.itemId, qty: Number(l.qty) - Number(l.receivedQty), unitCost: Number(l.unitPrice) }))
      .filter((l) => l.qty > 0);
  }, [pickedOrder, orders]);

  const filtered = useMemo(() => {
    let rows = receipts;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (branchFilter) {
      const inBranch = new Set(filterWarehouses.filter((w) => w.branchId === branchFilter).map((w) => w.id));
      rows = rows.filter((r) => inBranch.has(r.warehouseId));
    }
    if (warehouseFilter) rows = rows.filter((r) => r.warehouseId === warehouseFilter);
    if (supplierFilter) rows = rows.filter((r) => r.supplierId === supplierFilter);
    if (fromDate) rows = rows.filter((r) => r.date >= fromDate);
    if (toDate) rows = rows.filter((r) => r.date <= toDate);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q) || supplierName(r.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [receipts, statusFilter, search, supplierName, filterWarehouses, branchFilter, warehouseFilter, supplierFilter, fromDate, toDate]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: receipts.length },
    ...(Object.keys(STATUS_KEY) as GoodsReceiptStatusDTO[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: receipts.filter((r) => r.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<GoodsReceiptDTO>[] = [
    { key: "number", header: t("goodsReceipts.col.number"), render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "supplier", header: t("common.supplier"), render: (r) => supplierName(r.supplierId) },
    { key: "order", header: t("goodsReceipts.detail.order"), render: (r) => <span className="mz-num">{(r.purchaseOrderId ? orderById.get(r.purchaseOrderId)?.number : null) ?? "—"}</span> },
    { key: "total", header: t("goodsReceipts.detail.totalCost"), align: "end", render: (r) => <MoneyValue value={num(r.totalCost)} /> },
    { key: "invoiced", header: t("goodsReceipts.col.invoiceStatus"), render: (r) => <StatusPill label={r.invoiced ? t("goodsReceipts.invoiced") : t("goodsReceipts.notInvoiced")} tone={r.invoiced ? "success" : "neutral"} /> },
    { key: "status", header: t("common.status"), render: (r) => <StatusPill label={t(STATUS_KEY[r.status])} tone={STATUS_TONE[r.status]} /> },
    { key: "createdBy", header: t("common.createdBy"), render: (r) => <span className="text-ink-muted">{userName(r.createdBy)}</span> },
  ];

  function openCreate() {
    setPickedOrder(null);
    setDate(todayIso());
    setFormError(null);
    subPage.open("new");
  }

  async function confirmSelected(id: string) {
    try {
      await confirmReceipt.mutateAsync(id);
    } catch {
      // failure surfaces via the mutation's own error state on retry; nothing further to do here.
    }
  }

  async function save() {
    if (!pickedOrder || previewLines.length === 0) return;
    setFormError(null);
    try {
      await createReceipt.mutateAsync({ id: crypto.randomUUID(), purchaseOrderId: pickedOrder.id, date });
      subPage.close();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("goodsReceipts.error.createFailed"));
    }
  }

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.goodsReceipts")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("goodsReceipts.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("goodsReceipts.panel.description")}</p>
        </div>
        <Button variant="default" onClick={subPage.close}>
          {t("quotes.backToList")}
        </Button>
      </div>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <div role="note" className="rounded-md border border-info bg-info-soft px-[12px] py-[10px] text-[12px] text-info-ink">
          {t("goodsReceipts.panel.note")}
        </div>
        <EntityPicker label={t("goodsReceipts.field.order")} value={pickedOrder} onChange={setPickedOrder} options={orderOptions} placeholder={t("goodsReceipts.field.orderPlaceholder")} emptyMessage={t("goodsReceipts.field.orderEmpty")} />
        <TextField label={t("goodsReceipts.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        {previewLines.length > 0 ? (
          <div className="rounded-lg border border-border bg-surface p-[12px]">
            <div className="mb-[8px] text-[12.5px] font-semibold text-ink">{t("goodsReceipts.linesAuto")}</div>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {previewLines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="py-[7px]">{itemName(l.itemId)}</td>
                    <td className="py-[7px] text-end"><QtyDisplay value={l.qty} /></td>
                    <td className="py-[7px] text-end"><MoneyValue value={l.unitCost} showUnit={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!pickedOrder || previewLines.length === 0}>
            {t("goodsReceipts.saveDraft")}
          </Button>
        </div>
      </div>
    </div>
  );

  if (firstSegment === "new") return createPage;

  if (selected) {
    return (
      <>
        <ReceiptDetail
          receipt={selected}
          order={selected.purchaseOrderId ? orderById.get(selected.purchaseOrderId) : undefined}
          supplierName={supplierName}
          itemName={itemName}
          onBack={() => subPage.close()}
          onConfirm={() => confirmSelected(selected.id)}
        />
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("goodsReceipts.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<GoodsReceiptDTO>
        title={t("goodsReceipts.title")}
        description={t("goodsReceipts.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("goodsReceipts.new")}
          </Button>
        }
        stats={[
          { label: t("goodsReceipts.stat.total"), value: <span className="mz-num">{receipts.length}</span> },
          { label: t("goodsReceipts.stat.confirmed"), value: <span className="mz-num">{receipts.filter((r) => r.status === "confirmed").length}</span> },
          { label: t("goodsReceipts.stat.value"), value: <MoneyValue value={sumMajor(receipts.map((r) => r.totalCost))} showUnit={false} /> },
          { label: t("goodsReceipts.stat.uninvoiced"), value: <span className="mz-num">{receipts.filter((r) => !r.invoiced).length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as GoodsReceiptStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("goodsReceipts.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField
              label={t("common.branch")}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[{ value: "", label: t("common.allBranches") }, ...filterBranches.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <SelectField
              label={t("common.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[{ value: "", label: t("common.allWarehouses") }, ...filterWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
            />
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
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => subPage.open(r.number ?? r.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{receipts.length}</span> {t("goodsReceipts.showingSuffix")}</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("goodsReceipts.empty")}</div>}
      />
    </>
  );
}
