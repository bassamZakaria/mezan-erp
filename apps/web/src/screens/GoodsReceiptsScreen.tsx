import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EmptyState,
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
  Qty as QtyDisplay,
} from "@mezan/ui";
import type { GoodsReceiptDTO, GoodsReceiptStatusDTO } from "@mezan/contracts";
import { useConfirmGoodsReceipt, useCreateGoodsReceipt, useGoodsReceiptCounts, useGoodsReceipts, useGoodsReceiptStats, useItems, usePurchaseOrders, useSettings, useSuppliers,
  useUsers,
  useBranches,
  useWarehouses,
  type GoodsReceiptListFilter,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { SelectField, TextField, NumberField } from "../settings/form-controls";
import { itemTypeIsPurchasable } from "@mezan/domain";
import { useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { majorOf } from "../lib/money";
import { todayIso } from "../lib/dates";
import { AttachmentsTab } from "../attachments/AttachmentsTab";

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

/** One hand-entered line of an ad-hoc (PO-less) receipt — only reachable when the policy is off. */
interface AdHocLine {
  key: string;
  itemId: string;
  qty: number;
  unitCost: number;
  /** Shown only for a batch-tracked item — the contract has always accepted both. */
  batchNo: string;
  expiryDate: string;
}
let adHocSeq = 0;
function blankAdHocLine(): AdHocLine {
  adHocSeq += 1;
  return { key: `ah${adHocSeq}`, itemId: "", qty: 1, unitCost: 0, batchNo: "", expiryDate: "" };
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
        {
          key: "attachments",
          label: t("attachments.tab"),
          content: <AttachmentsTab entityType="goods-receipt" entityId={receipt.id} />,
        },
      ]}
    />
  );
}

export function GoodsReceiptsScreen() {
  const { t } = useAppTranslation();
  const ordersQuery = usePurchaseOrders();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createReceipt = useCreateGoodsReceipt();
  const confirmReceipt = useConfirmGoodsReceipt();

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

  /** Only sent / partially-received POs can be received against (docs/archive/catalog/02). */
  const receivableOrders = orders.filter((o) => o.status === "sent" || o.status === "partially_received");
  const orderOptions: EntityPickerOption[] = receivableOrders.map((o) => ({
    id: o.id,
    label: `${o.number} · ${supplierName(o.supplierId)}`,
    sublabel: o.date,
  }));

  const users = useUsers().data ?? [];
  const filterBranches = useBranches().data ?? [];
  const filterWarehouses = useWarehouses().data ?? [];
  const warehousesForForm = filterWarehouses;
  const [branchFilter, setBranchFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const userName = (id: string) => users.find((u) => u.id === id)?.nameAr ?? id;

  /** A receipt has no branch of its own — the branch picker only narrows which warehouses are offered below it. */
  const branchWarehouses = branchFilter ? filterWarehouses.filter((w) => w.branchId === branchFilter) : filterWarehouses;

  const [statusFilter, setStatusFilter] = useState<GoodsReceiptStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const { navigate } = useNavigation();
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  useScreenIntent((intent) => openCreate(intent.prefill?.purchaseOrderId));
  const [pickedOrder, setPickedOrder] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(todayIso());
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1) — the receipt
   * has no branchId of its own, so only `warehouseId` reaches the server; the
   * status/supplier/date narrowing used to happen in the browser while the
   * header stats summed every receipt the server had sent.
   */
  const filter = useMemo<GoodsReceiptListFilter>(
    () => ({
      status: statusFilter,
      warehouseId: warehouseFilter || undefined,
      supplierId: supplierFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, warehouseFilter, supplierFilter, fromDate, toDate, search],
  );
  const query = useGoodsReceipts(filter);
  const counts = useGoodsReceiptCounts(filter).data ?? {};
  const stats = useGoodsReceiptStats(filter).data ?? {};

  /**
   * إلزام أمر الشراء قبل الاستلام (R4.6). The gate is the server's — the domain
   * refuses a PO-less receipt — and this reads the SAME tenant setting so the
   * form offers only what the tenant allows instead of letting the user fill a
   * whole receipt the server will then reject.
   */
  const settingsQuery = useSettings();
  const requirePoForGrn = settingsQuery.data?.requirePoForGrn ?? true;
  const policyKnown = settingsQuery.data !== undefined;

  const [method, setMethod] = useState<"from-order" | "ad-hoc">("from-order");
  const [methodChosen, setMethodChosen] = useState(false);
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [adHocWarehouseId, setAdHocWarehouseId] = useState("");
  const [adHocLines, setAdHocLines] = useState<AdHocLine[]>([blankAdHocLine()]);
  const workingLocation = useWorkingLocation();

  const supplierOptions: EntityPickerOption[] = suppliers.map((sup) => ({ id: sup.id, label: sup.nameAr, sublabel: sup.code }));
  const itemOptions: EntityPickerOption[] = items.filter((i) => itemTypeIsPurchasable(i.type)).map((i) => ({ id: i.id, label: i.nameAr }));

  const receipts = query.data ?? [];
  const selected = selectedId === null ? null : (receipts.find((r) => r.id === selectedId || r.number === selectedId) ?? null);

  // create-from-PO preview only — the server auto-fills the real lines from the PO's outstanding qty on save.
  const previewLines: PreviewLine[] = useMemo(() => {
    const order = orders.find((o) => o.id === pickedOrder?.id);
    if (!order) return [];
    return order.lines
      .map((l) => ({ itemId: l.itemId, qty: Number(l.qty) - Number(l.receivedQty), unitCost: Number(l.unitPrice) }))
      .filter((l) => l.qty > 0);
  }, [pickedOrder, orders]);

  const filtered = useMemo(() => [...receipts].sort((a, b) => b.number.localeCompare(a.number)), [receipts]);

  const activeFilterCount = [branchFilter, warehouseFilter, supplierFilter, fromDate, toDate].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    ...(Object.keys(STATUS_KEY) as GoodsReceiptStatusDTO[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: counts[s] ?? 0,
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

  function openCreate(purchaseOrderId?: string) {
    setPickedOrder(orderOptions.find((option) => option.id === purchaseOrderId) ?? null);
    setDate(todayIso());
    setFormError(null);
    setMethod("from-order");
    setMethodChosen(false);
    setSupplier(null);
    setAdHocWarehouseId(workingLocation.warehouseId ?? warehousesForForm[0]?.id ?? "");
    setAdHocLines([blankAdHocLine()]);
    subPage.open("new");
  }

  async function confirmSelected(id: string) {
    try {
      await confirmReceipt.mutateAsync(id);
    } catch {
      // failure surfaces via the mutation's own error state on retry; nothing further to do here.
    }
  }

  const usableAdHocLines = adHocLines.filter((l) => l.itemId !== "" && l.qty > 0);
  const canSave =
    method === "from-order"
      ? pickedOrder !== null && previewLines.length > 0
      : !requirePoForGrn && supplier !== null && adHocWarehouseId !== "" && usableAdHocLines.length > 0;

  async function save() {
    setFormError(null);
    try {
      if (method === "from-order") {
        if (!pickedOrder || previewLines.length === 0) return;
        await createReceipt.mutateAsync({ id: crypto.randomUUID(), purchaseOrderId: pickedOrder.id, date });
      } else {
        if (!supplier || adHocWarehouseId === "" || usableAdHocLines.length === 0) return;
        await createReceipt.mutateAsync({
          id: crypto.randomUUID(),
          date,
          supplierId: supplier.id,
          warehouseId: adHocWarehouseId,
          lines: usableAdHocLines.map((l) => ({
            itemId: l.itemId,
            qty: String(l.qty),
            unitCost: String(l.unitCost || 0),
            batchNo: l.batchNo.trim() === "" ? null : l.batchNo.trim(),
            expiryDate: l.expiryDate === "" ? null : l.expiryDate,
          })),
        });
      }
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

        {!methodChosen ? (
          <div className="rounded-lg border border-border p-[14px_16px]">
            <h3 className="mb-[4px] font-display text-[13.5px] font-bold text-ink">{t("goodsReceipts.method.title")}</h3>
            <p className="mb-[10px] text-[12.5px] text-ink-muted">{t("goodsReceipts.method.stepHint")}</p>
            <div className="grid gap-[10px] sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMethod("from-order")}
                aria-pressed={method === "from-order"}
                className={
                  method === "from-order"
                    ? "rounded-lg border border-brand bg-brand-soft p-[12px] text-start"
                    : "rounded-lg border border-border p-[12px] text-start hover:border-brand"
                }
              >
                <span className="block font-display text-[13px] font-bold text-ink">{t("goodsReceipts.method.fromOrder")}</span>
                <span className="block text-[12px] text-ink-muted">{t("goodsReceipts.method.fromOrderHint")}</span>
              </button>
              <button
                type="button"
                disabled={requirePoForGrn}
                onClick={() => setMethod("ad-hoc")}
                aria-pressed={method === "ad-hoc"}
                className={
                  requirePoForGrn
                    ? "cursor-not-allowed rounded-lg border border-border p-[12px] text-start opacity-60"
                    : method === "ad-hoc"
                      ? "rounded-lg border border-brand bg-brand-soft p-[12px] text-start"
                      : "rounded-lg border border-border p-[12px] text-start hover:border-brand"
                }
              >
                <span className="block font-display text-[13px] font-bold text-ink">{t("goodsReceipts.method.adHoc")}</span>
                <span className="block text-[12px] text-ink-muted">
                  {requirePoForGrn ? t("goodsReceipts.method.adHocBlocked") : t("goodsReceipts.method.adHocHint")}
                </span>
              </button>
            </div>
            <p className="mt-[10px] text-[11.5px] leading-[1.9] text-ink-muted">
              {policyKnown ? (requirePoForGrn ? t("goodsReceipts.policy.on") : t("goodsReceipts.policy.off")) : t("goodsReceipts.policy.loading")}
            </p>
            <div className="mt-[12px] flex justify-end">
              <Button variant="primary" onClick={() => setMethodChosen(true)}>
                {t("goodsReceipts.method.continue")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-lg border border-border p-[10px_16px]">
            <span className="text-[12.5px] text-ink-muted">
              {t("goodsReceipts.method.chosen")}:{" "}
              <span className="font-semibold text-ink">
                {method === "from-order" ? t("goodsReceipts.method.fromOrder") : t("goodsReceipts.method.adHoc")}
              </span>
            </span>
            <Button size="sm" onClick={() => setMethodChosen(false)}>
              {t("goodsReceipts.method.change")}
            </Button>
          </div>
        )}

        {methodChosen && method === "from-order" ? (
          <>
            <EntityPicker label={t("goodsReceipts.field.order")} value={pickedOrder} onChange={setPickedOrder} options={orderOptions} placeholder={t("goodsReceipts.field.orderPlaceholder")} emptyMessage={t("goodsReceipts.field.orderEmpty")} />
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
          </>
        ) : null}

        {methodChosen && method === "ad-hoc" ? (
          <>
            <EntityPicker label={t("goodsReceipts.field.supplier")} value={supplier} onChange={setSupplier} options={supplierOptions} placeholder={t("goodsReceipts.field.supplierPlaceholder")} />
            <SelectField
              label={t("goodsReceipts.field.warehouse")}
              value={adHocWarehouseId}
              onChange={setAdHocWarehouseId}
              options={warehousesForForm.map((w) => ({ value: w.id, label: w.name }))}
            />
            {adHocLines.map((line) => (
              <div key={line.key} className="rounded-lg border border-border bg-surface p-[12px]">
                <EntityPicker
                  label={t("common.item")}
                  value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                  onChange={(opt) => {
                    const item = items.find((it) => it.id === opt?.id);
                    setAdHocLines((prev) =>
                      prev.map((l) =>
                        l.key === line.key
                          ? { ...l, itemId: opt?.id ?? "", unitCost: item?.costPrice ? Number(item.costPrice) : l.unitCost }
                          : l,
                      ),
                    );
                  }}
                  options={itemOptions}
                  placeholder={t("goodsReceipts.field.itemPlaceholder")}
                />
                <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
                  <NumberField label={t("common.qty")} value={line.qty} min={0} onChange={(v) => setAdHocLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))} />
                  <NumberField label={t("goodsReceipts.col.unitCost")} value={line.unitCost} min={0} onChange={(v) => setAdHocLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, unitCost: v } : l)))} />
                </div>
                {/* Receiving is the ONLY moment a batch and its expiry can be
                    captured. Without these the FEFO engine, the cost layers and
                    the expiring-soon report have nothing to order by. */}
                {items.find((it) => it.id === line.itemId)?.trackBatches ? (
                  <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
                    <TextField
                      label={t("goodsReceipts.field.batchNo")}
                      value={line.batchNo}
                      onChange={(v) => setAdHocLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, batchNo: v } : l)))}
                    />
                    <TextField
                      label={t("goodsReceipts.field.expiryDate")}
                      value={line.expiryDate}
                      onChange={(v) => setAdHocLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, expiryDate: v } : l)))}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                ) : null}
                {adHocLines.length > 1 ? (
                  <div className="mt-[8px] flex justify-end">
                    <Button onClick={() => setAdHocLines((prev) => prev.filter((l) => l.key !== line.key))}>{t("goodsReceipts.deleteLine")}</Button>
                  </div>
                ) : null}
              </div>
            ))}
            <Button onClick={() => setAdHocLines((prev) => [...prev, blankAdHocLine()])}>{t("goodsReceipts.addLine")}</Button>
          </>
        ) : null}

        {methodChosen ? (
          <>
            <TextField label={t("goodsReceipts.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <div className="flex justify-end gap-[9px]">
              <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={save} disabled={!canSave}>
                {t("goodsReceipts.saveDraft")}
              </Button>
            </div>
          </>
        ) : null}
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
          <Button variant="primary" onClick={() => openCreate()}>
            {t("goodsReceipts.new")}
          </Button>
        }
        stats={[
          { label: t("goodsReceipts.stat.total"), value: <span className="mz-num">{Number(stats.count ?? 0)}</span> },
          { label: t("goodsReceipts.stat.confirmed"), value: <span className="mz-num">{Number(stats.confirmed ?? 0)}</span> },
          { label: t("goodsReceipts.stat.value"), value: <MoneyValue value={majorOf(String(stats.value ?? "0"))} showUnit={false} /> },
          { label: t("goodsReceipts.stat.uninvoiced"), value: <span className="mz-num">{Number(stats.uninvoiced ?? 0)}</span> },
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
              onChange={(v) => {
                setBranchFilter(v);
                setWarehouseFilter("");
              }}
              options={[{ value: "", label: t("common.allBranches") }, ...filterBranches.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <SelectField
              label={t("common.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[{ value: "", label: t("common.allWarehouses") }, ...branchWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
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
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        columns={columns}
        rows={pageRows}
        loading={settingsQuery.isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => subPage.open(r.number ?? r.id)}
        rowAction={(r) => {
          // A confirmed but un-invoiced receipt is the only one an invoice can be raised from (R1.3).
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(r.number ?? r.id) },
            ...(r.status === "draft"
              ? [{ key: "confirm", label: t("goodsReceipts.confirm"), onSelect: () => void confirmSelected(r.id) }]
              : []),
            ...(r.status === "confirmed" && !r.invoiced
              ? [
                  {
                    key: "invoice",
                    label: t("goodsReceipts.row.newInvoice"),
                    onSelect: () => navigate("purchase-invoices", { kind: "create" }),
                  },
                ]
              : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems} label={t("goodsReceipts.row.actionsFor", { doc: r.number ?? r.id })} />
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
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("goodsReceipts.showingSuffix")}</>}
        emptyState={
          <EmptyState
            title={t("goodsReceipts.empty")}
            description={t("goodsReceipts.emptyHint")}
            action={{ label: t("goodsReceipts.new"), onClick: () => openCreate() }}
          />
        }
      />
    </>
  );
}
