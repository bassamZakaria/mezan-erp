import { useEffect, useMemo, useState } from "react";
import {
  RowActionOutcome,
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
import { GoodsReceiptInvoicingStatusDTO, type CostCategoryDTO, type GoodsReceiptDTO, type GoodsReceiptStatusDTO, type PurchaseOrderDTO } from "@mezan/contracts";
import { useConfirmGoodsReceipt, useCreateGoodsReceipt, useGoodsReceiptCounts, useGoodsReceipts, useGoodsReceiptStats, useItems, useProjects, usePurchaseOrders, useTenantSettings, useSuppliers,
  useUsers,
  useBranches,
  useWarehouses,
  type GoodsReceiptListFilter,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { SelectField, TextField, NumberField } from "../settings/form-controls";
import { itemTypeIsPurchasable } from "@mezan/domain";
import { GoodsReceiptPrintPage } from "../print/documents";
import { useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { majorOf } from "../lib/money";
import { todayIso } from "../lib/dates";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { EMPTY } from "../lib/empty";
import { EMPTY_LOT, LotFields, lotIsComplete, lotPayload, tracksLots, type LotValue } from "./enh/expiry/LotFields";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

const INVOICING_KEY: Record<GoodsReceiptInvoicingStatusDTO, AppTranslationKey> = {
  [GoodsReceiptInvoicingStatusDTO.NotInvoiced]: "goodsReceipts.notInvoiced",
  [GoodsReceiptInvoicingStatusDTO.PartiallyInvoiced]: "goodsReceipts.partiallyInvoiced",
  [GoodsReceiptInvoicingStatusDTO.Invoiced]: "goodsReceipts.invoiced",
};
const INVOICING_TONE: Record<GoodsReceiptInvoicingStatusDTO, "neutral" | "warning" | "success"> = {
  [GoodsReceiptInvoicingStatusDTO.NotInvoiced]: "neutral",
  [GoodsReceiptInvoicingStatusDTO.PartiallyInvoiced]: "warning",
  [GoodsReceiptInvoicingStatusDTO.Invoiced]: "success",
};

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

const COST_CATEGORY_VALUES = ["materials", "labour", "equipment", "subcontract", "indirect"] as const satisfies readonly CostCategoryDTO[];
const COST_CATEGORY_KEY: Record<CostCategoryDTO, AppTranslationKey> = {
  materials: "costCategory.materials",
  labour: "costCategory.labour",
  equipment: "costCategory.equipment",
  subcontract: "costCategory.subcontract",
  indirect: "costCategory.indirect",
};

/**
 * One line of a receipt taken against a purchase order. `qty` is what the
 * storekeeper says arrived and defaults to `outstandingQty`; a partial delivery
 * is the normal case, so the two are not the same number (D73).
 */
interface FromOrderLine {
  key: string;
  itemId: string;
  qty: number;
  outstandingQty: number;
  unitCost: number;
  costCategory: CostCategoryDTO | null;
  lot: LotValue;
}

function buildFromOrderLines(order: PurchaseOrderDTO): FromOrderLine[] {
  return order.lines
    .map((line, index) => {
      const outstandingQty = Number(line.qty) - Number(line.receivedQty);
      return {
        key: `${order.id}:${index}`,
        itemId: line.itemId,
        qty: outstandingQty,
        outstandingQty,
        unitCost: Number(line.unitPrice),
        costCategory: null,
        lot: EMPTY_LOT,
      };
    })
    .filter((line) => line.outstandingQty > 0);
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
  costCategory: CostCategoryDTO | null;
}
let adHocSeq = 0;
function blankAdHocLine(): AdHocLine {
  adHocSeq += 1;
  return { key: `ah${adHocSeq}`, itemId: "", qty: 1, unitCost: 0, batchNo: "", expiryDate: "", costCategory: null };
}

function ReceiptDetail({
  receipt,
  order,
  supplierName,
  warehouseName,
  itemName,
  projectName,
  onBack,
  onConfirm,
  onPrint,
}: {
  receipt: GoodsReceiptDTO;
  order: { number: string } | undefined;
  supplierName: (id: string) => string;
  warehouseName: (id: string) => string;
  itemName: (id: string) => string;
  projectName: (id: string | null) => string;
  onBack: () => void;
  onConfirm: () => void;
  onPrint: () => void;
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
          <Button onClick={onPrint}>{t("print.action.print")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(receipt.supplierId) },
        { label: t("goodsReceipts.detail.order"), value: order?.number ?? receipt.purchaseOrderId },
        { label: t("common.date"), value: receipt.date.split("-").reverse().join("/") },
        { label: t("common.warehouse"), value: warehouseName(receipt.warehouseId) },
        { label: t("common.project"), value: projectName(receipt.projectId) },
        { label: t("goodsReceipts.detail.totalCost"), value: <MoneyValue value={num(receipt.totalCost)} /> },
        { label: t("goodsReceipts.detail.invoiceStatus"), value: t(INVOICING_KEY[receipt.invoicingStatus]), valueTone: receipt.invoiced ? "success" : undefined },
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
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("common.costCategory")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.receivedQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.invoicedQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.remainingQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.unitCost")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("goodsReceipts.col.lineTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="px-[12px] py-[10px]">{l.costCategory ? t(COST_CATEGORY_KEY[l.costCategory]) : "—"}</td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.qty} /></td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.invoicedQty} /></td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.remainingQty} /></td>
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
  const projectsQuery = useProjects();
  const createReceipt = useCreateGoodsReceipt();
  const confirmReceipt = useConfirmGoodsReceipt();

  const orders = ordersQuery.data ?? EMPTY;
  const suppliers = suppliersQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.nameAr]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : t("common.noProject"));
  }, [projects, t]);
  /** Only a live project can absorb new cost — a project already closed or cancelled stays out of the picker (D-01). */
  const projectOptions: EntityPickerOption[] = useMemo(
    () =>
      projects
        .filter((p) => p.status === "planned" || p.status === "active" || p.status === "on_hold")
        .map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code })),
    [projects],
  );
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
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [supplierFilter, setSupplierFilter] = useUrlParam("supplier");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const userName = (id: string) => users.find((u) => u.id === id)?.nameAr ?? id;

  /** A receipt has no branch of its own — the branch picker only narrows which warehouses are offered below it. */
  const branchWarehouses = branchFilter ? filterWarehouses.filter((w) => w.branchId === branchFilter) : filterWarehouses;

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    GoodsReceiptStatusDTO | "all",
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const { navigate } = useNavigation();
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  useScreenIntent((intent) => openCreate(intent.prefill?.purchaseOrderId));
  const [pickedOrder, setPickedOrder] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(todayIso());
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

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
  const settingsQuery = useTenantSettings();
  const requirePoForGrn = settingsQuery.data?.requirePoForGrn ?? true;
  const policyKnown = settingsQuery.data !== undefined;

  const [method, setMethod] = useState<"from-order" | "ad-hoc">("from-order");
  const [methodChosen, setMethodChosen] = useState(false);
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [project, setProject] = useState<EntityPickerOption | null>(null);
  const [adHocWarehouseId, setAdHocWarehouseId] = useState("");
  const [adHocLines, setAdHocLines] = useState<AdHocLine[]>([blankAdHocLine()]);
  const workingLocation = useWorkingLocation();

  const supplierOptions: EntityPickerOption[] = suppliers.map((sup) => ({ id: sup.id, label: sup.nameAr, sublabel: sup.code }));
  const itemOptions: EntityPickerOption[] = items.filter((i) => itemTypeIsPurchasable(i.type)).map((i) => ({ id: i.id, label: i.nameAr }));

  const receipts = query.data ?? EMPTY;
  const selected = selectedId === null ? null : (receipts.find((r) => r.id === selectedId || r.number === selectedId) ?? null);

  /**
   * The from-PO lines are seeded from the order's outstanding quantities and
   * then edited per row, so they are state rather than a memo — re-seeding on
   * every `orders` refetch would throw away what the storekeeper typed.
   */
  const [fromOrderLines, setFromOrderLines] = useState<FromOrderLine[]>([]);
  const [linesOrderId, setLinesOrderId] = useState<string | null>(null);
  useEffect(() => {
    const orderId = pickedOrder?.id ?? null;
    if (orderId === null) {
      if (linesOrderId !== null) {
        setLinesOrderId(null);
        setFromOrderLines([]);
      }
      return;
    }
    if (orderId === linesOrderId) return;
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    setLinesOrderId(orderId);
    setFromOrderLines(buildFromOrderLines(order));
  }, [pickedOrder, orders, linesOrderId]);

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
    { key: "invoiced", header: t("goodsReceipts.col.invoiceStatus"), render: (r) => <StatusPill label={t(INVOICING_KEY[r.invoicingStatus])} tone={INVOICING_TONE[r.invoicingStatus]} /> },
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
    setProject(null);
    setAdHocWarehouseId(workingLocation.warehouseId ?? warehousesForForm[0]?.id ?? "");
    setAdHocLines([blankAdHocLine()]);
    setFromOrderLines([]);
    setLinesOrderId(null);
    subPage.open("new");
  }

  /** Clearing the header project also clears every line's category — a category without a project is meaningless (D-01). */
  function changeProject(opt: EntityPickerOption | null) {
    setProject(opt);
    if (!opt) {
      setFromOrderLines((prev) => prev.map((l) => ({ ...l, costCategory: null })));
      setAdHocLines((prev) => prev.map((l) => ({ ...l, costCategory: null })));
    }
  }

  async function confirmSelected(id: string) {
    try {
      await confirmReceipt.mutateAsync(id);
    } catch {
      // failure surfaces via the mutation's own error state on retry; nothing further to do here.
      return RowActionOutcome.Refused;
    }
  }

  const usableAdHocLines = adHocLines.filter((l) => l.itemId !== "" && l.qty > 0);
  // A line received at zero is simply not on the receipt; one above the PO's
  // outstanding quantity is an over-receipt the server would refuse anyway.
  const usableFromOrderLines = fromOrderLines.filter((l) => l.qty > 0);
  const overReceiptLine = fromOrderLines.some((l) => l.qty > l.outstandingQty);
  const lotRuleOf = (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    return item ? { trackExpiry: item.trackExpiry } : undefined;
  };
  const lotsComplete =
    method === "from-order"
      ? usableFromOrderLines.every((l) => lotIsComplete(lotRuleOf(l.itemId), l.lot))
      : usableAdHocLines.every((l) => lotIsComplete(lotRuleOf(l.itemId), { batchNo: l.batchNo, expiryDate: l.expiryDate }));
  const canSave =
    lotsComplete &&
    (method === "from-order"
      ? pickedOrder !== null && usableFromOrderLines.length > 0 && !overReceiptLine
      : !requirePoForGrn && supplier !== null && adHocWarehouseId !== "" && usableAdHocLines.length > 0);

  async function save() {
    setFormError(null);
    try {
      if (method === "from-order") {
        if (!pickedOrder || usableFromOrderLines.length === 0 || overReceiptLine) return;
        await createReceipt.mutateAsync({
          id: crypto.randomUUID(),
          purchaseOrderId: pickedOrder.id,
          date,
          projectId: project?.id ?? null,
          lines: usableFromOrderLines.map((l) => ({
            itemId: l.itemId,
            qty: String(l.qty),
            unitCost: String(l.unitCost),
            ...(tracksLots(items.find((it) => it.id === l.itemId)) ? lotPayload(l.lot) : {}),
            costCategory: l.costCategory,
          })),
        });
      } else {
        if (!supplier || adHocWarehouseId === "" || usableAdHocLines.length === 0) return;
        await createReceipt.mutateAsync({
          id: crypto.randomUUID(),
          date,
          supplierId: supplier.id,
          warehouseId: adHocWarehouseId,
          projectId: project?.id ?? null,
          lines: usableAdHocLines.map((l) => ({
            itemId: l.itemId,
            qty: String(l.qty),
            unitCost: String(l.unitCost || 0),
            batchNo: l.batchNo.trim() === "" ? null : l.batchNo.trim(),
            expiryDate: l.expiryDate === "" ? null : l.expiryDate,
            costCategory: l.costCategory,
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
            {fromOrderLines.length > 0 ? (
              <div className="flex flex-col gap-[10px]">
                <span className="text-[12.5px] font-semibold text-ink">{t("goodsReceipts.linesAuto")}</span>
                {fromOrderLines.map((line) => (
                  <div key={line.key} className="rounded-lg border border-border bg-surface p-[12px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
                      <span className="text-[12.5px] font-semibold text-ink">{itemName(line.itemId)}</span>
                      <span className="text-[12px] text-ink-muted">
                        {t("goodsReceipts.col.unitCost")} <MoneyValue value={line.unitCost} showUnit={false} />
                      </span>
                    </div>
                    <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
                      <NumberField
                        label={t("goodsReceipts.col.receivedQty")}
                        value={line.qty}
                        min={0}
                        max={line.outstandingQty}
                        hint={`${t("goodsReceipts.line.outstanding")}: ${line.outstandingQty}`}
                        onChange={(v) =>
                          setFromOrderLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, qty: v } : l)))
                        }
                      />
                    </div>
                    <LotFields
                      item={items.find((it) => it.id === line.itemId)}
                      value={line.lot}
                      onChange={(lot) => setFromOrderLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, lot } : l)))}
                    />
                    {line.qty > line.outstandingQty ? (
                      <p role="alert" className="mt-[8px] text-[12px] text-danger-ink">
                        {t("goodsReceipts.error.overReceipt", { outstanding: String(line.outstandingQty) })}
                      </p>
                    ) : null}
                    <div className="mt-[10px]">
                      <SelectField
                        label={t("common.costCategory")}
                        value={line.costCategory ?? ""}
                        onChange={(v) =>
                          setFromOrderLines((prev) =>
                            prev.map((l) => (l.key === line.key ? { ...l, costCategory: v === "" ? null : (v as CostCategoryDTO) } : l)),
                          )
                        }
                        options={[{ value: "", label: t("common.none") }, ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(COST_CATEGORY_KEY[c]) }))]}
                        disabled={project === null}
                      />
                    </div>
                  </div>
                ))}
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
                <LotFields
                  item={items.find((it) => it.id === line.itemId)}
                  value={{ batchNo: line.batchNo, expiryDate: line.expiryDate }}
                  onChange={(lot) => setAdHocLines((prev) => prev.map((l) => (l.key === line.key ? { ...l, ...lot } : l)))}
                />
                <div className="mt-[10px]">
                  <SelectField
                    label={t("common.costCategory")}
                    value={line.costCategory ?? ""}
                    onChange={(v) =>
                      setAdHocLines((prev) =>
                        prev.map((l) => (l.key === line.key ? { ...l, costCategory: v === "" ? null : (v as CostCategoryDTO) } : l)),
                      )
                    }
                    options={[{ value: "", label: t("common.none") }, ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(COST_CATEGORY_KEY[c]) }))]}
                    disabled={project === null}
                  />
                </div>
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
            <EntityPicker
              label={t("common.project")}
              value={project}
              onChange={changeProject}
              options={projectOptions}
              placeholder={t("common.noProject")}
              emptyMessage={t("common.noProject")}
            />
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

  // إذن استلام — the paper the storekeeper signs at the gate (P-6).
  if (selected && subPage.segments[1] === "print") return <GoodsReceiptPrintPage receipt={selected} />;

  if (selected) {
    return (
      <>
        <ReceiptDetail
          receipt={selected}
          order={selected.purchaseOrderId ? orderById.get(selected.purchaseOrderId) : undefined}
          supplierName={supplierName}
          warehouseName={(id) => filterWarehouses.find((warehouse) => warehouse.id === id)?.name ?? id}
          itemName={itemName}
          projectName={projectName}
          onBack={() => subPage.close()}
          onConfirm={() => confirmSelected(selected.id)}
          onPrint={() => subPage.open(selected.number ?? selected.id, "print")}
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
        searchValue={searchText}
        onSearchChange={setSearchText}
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
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(r.number ?? r.id, "print") },
            ...(r.status === "draft"
              ? [{ key: "confirm", label: t("goodsReceipts.confirm"), onSelect: () => confirmSelected(r.id) }]
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
