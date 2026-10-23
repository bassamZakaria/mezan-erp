import { useMemo, useState } from "react";
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
import type { ItemDTO, PurchaseOrderDTO, PurchaseOrderLineDTO, PurchaseOrderStatusDTO } from "@mezan/contracts";
import {
  useBranches,
  useConfirmPurchaseOrder,
  useCreatePurchaseOrder,
  useItemsByIds,
  usePurchaseOrderCounts,
  usePurchaseOrders,
  usePurchaseOrderStats,
  useSuppliers,
  useUsers,
  useWarehouses,
  type PurchaseOrderListFilter,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { useUnitLabel } from "../lib/item-labels";
import { SelectField, TextField, NumberField } from "../settings/form-controls";
import { PurchaseOrderPrintPage } from "../print/documents";
import { useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { majorOf } from "../lib/money";
import { ITEM_TYPES, itemTypeIsPurchasable } from "@mezan/domain";
import { ItemPicker, itemOption } from "./ItemPicker";
import { todayIso } from "../lib/dates";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

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

const PURCHASABLE_TYPES = ITEM_TYPES.filter(itemTypeIsPurchasable);

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
  onPrint,
}: {
  order: PurchaseOrderDTO;
  supplierName: (id: string) => string;
  itemName: (id: string) => string;
  onBack: () => void;
  onConfirm: () => void;
  onPrint: () => void;
}) {
  const { t } = useAppTranslation();
  const warehouses = useWarehouses().data ?? [];
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
          <Button onClick={onPrint}>{t("print.action.print")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(order.supplierId) },
        { label: t("common.date"), value: order.date.split("-").reverse().join("/") },
        { label: t("purchaseOrders.detail.expectedDelivery"), value: order.expectedDeliveryDate?.split("-").reverse().join("/") ?? "—" },
        { label: t("common.warehouse"), value: warehouses.find((warehouse) => warehouse.id === order.warehouseId)?.name ?? order.warehouseId },
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
        {
          key: "attachments",
          label: t("attachments.tab"),
          content: <AttachmentsTab entityType="purchase-order" entityId={order.id} />,
        },
      ]}
    />
  );
}

export function PurchaseOrdersScreen() {
  const { t } = useAppTranslation();
  const suppliersQuery = useSuppliers();
  const createOrder = useCreatePurchaseOrder();
  const confirmOrder = useConfirmPurchaseOrder();

  const suppliers = suppliersQuery.data ?? EMPTY;

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);

  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
  const unitLabel = useUnitLabel();

  const users = useUsers().data ?? [];
  const filterBranches = useBranches().data ?? [];
  const filterWarehouses = useWarehouses().data ?? [];
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [supplierFilter, setSupplierFilter] = useUrlParam("supplier");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const userName = (id: string) => users.find((u) => u.id === id)?.nameAr ?? id;

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    PurchaseOrderStatusDTO | "all",
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1) — the branch,
   * warehouse, supplier and date narrowing used to happen in the browser while
   * the header stats summed every order the server had sent, so applying a
   * filter moved the table and left the stats strip alone.
   */
  const filter = useMemo<PurchaseOrderListFilter>(
    () => ({
      status: statusFilter,
      branchId: branchFilter || undefined,
      warehouseId: warehouseFilter || undefined,
      supplierId: supplierFilter || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, branchFilter, warehouseFilter, supplierFilter, fromDate, toDate, search],
  );
  const query = usePurchaseOrders(filter);
  const counts = usePurchaseOrderCounts(filter).data ?? {};
  const stats = usePurchaseOrderStats(filter).data ?? {};
  const { navigate } = useNavigation();
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  useScreenIntent((intent) => {
    const supplierId = intent.prefill?.supplierId;
    openCreate(...(supplierId ? [supplierId] : []));
  });
  // Carried in from «أمر شراء جديد» on a supplier's page; derived from the URL.
  const [supplierChoice, setSupplierChoice] = useState<EntityPickerOption | null | undefined>(undefined);
  // `#/…/purchase-orders/new/<supplierId|any>/<itemId?>`. "any" fills the
  // supplier slot when the caller knows the item but not the supplier — which
  // is «طلب شراء» on an item, where the buyer is exactly what has not been
  // decided yet.
  const routedSupplier = subPage.segments[0] === "new" ? (subPage.segments[1] ?? null) : null;
  const prefilledSupplierId = routedSupplier === "any" ? null : routedSupplier;
  const prefilledItemId = subPage.segments[0] === "new" ? (subPage.segments[2] ?? null) : null;
  const supplier =
    supplierChoice !== undefined ? supplierChoice : (supplierOptions.find((option) => option.id === prefilledSupplierId) ?? null);
  const setSupplier = setSupplierChoice;
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  // Seeded once from the route, not synchronised: the buyer must be able to
  // change the line the item detail put here.
  const [lines, setLines] = useState<DraftLine[]>(() => [{ itemId: prefilledItemId ?? "", qty: 1, unitPrice: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickedItems, setPickedItems] = useState<ReadonlyMap<string, ItemDTO>>(new Map());

  const orders = query.data ?? EMPTY;
  const selected = selectedId === null ? null : (orders.find((o) => o.id === selectedId || o.number === selectedId) ?? null);
  const { byId: itemsById } = useItemsByIds([...(selected?.lines ?? []), ...lines].map((l) => l.itemId));
  const itemOf = (id: string) => pickedItems.get(id) ?? itemsById.get(id);
  const itemName = (id: string) => itemOf(id)?.nameAr ?? id;
  const itemValue = (id: string): EntityPickerOption | null => {
    if (id === "") return null;
    const item = itemOf(id);
    return item ? itemOption(item) : { id, label: id };
  };

  const filtered = useMemo(() => [...orders].sort((a, b) => b.number.localeCompare(a.number)), [orders]);

  const activeFilterCount = [branchFilter, warehouseFilter, supplierFilter, fromDate, toDate].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    ...(Object.keys(STATUS_KEY) as PurchaseOrderStatusDTO[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: counts[s] ?? 0,
    })),
  ];

  const columns: DocumentListColumn<PurchaseOrderDTO>[] = [
    { key: "number", header: t("purchaseOrders.col.number"), render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "supplier", header: t("common.supplier"), render: (o) => supplierName(o.supplierId) },
    { key: "date", header: t("common.date"), render: (o) => <span className="mz-num">{o.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: t("common.total"), align: "end", render: (o) => <MoneyValue value={num(o.subtotal)} /> },
    {
      key: "expected",
      header: t("purchaseOrders.col.expected"),
      render: (o) => <span className="mz-num">{o.expectedDeliveryDate ? o.expectedDeliveryDate.split("-").reverse().join("/") : "—"}</span>,
    },
    { key: "status", header: t("common.status"), render: (o) => <StatusPill label={t(STATUS_KEY[o.status])} tone={STATUS_TONE[o.status]} /> },
    { key: "createdBy", header: t("common.createdBy"), render: (o) => <span className="text-ink-muted">{userName(o.createdBy)}</span> },
  ];

  function openCreate(supplierId?: string) {
    setSupplierChoice(undefined);
    setDate(todayIso());
    setNotes("");
    setLines([{ itemId: "", qty: 1, unitPrice: 0 }]);
    setFormError(null);
    subPage.open(...(supplierId ? ["new", supplierId] : ["new"]));
  }

  async function confirmSelected(id: string, expectedVersion?: number) {
    setFormError(null);
    try {
      await confirmOrder.mutateAsync({ id, expectedVersion });
    } catch (err) {
      // N-9: a refusal because another till already moved this order names that
      // till's operator. Swallowing it left the button doing nothing at all.
      setFormError(err instanceof Error ? err.message : t("purchaseOrders.error.saveFailed"));
      return RowActionOutcome.Refused;
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
            <ItemPicker
              label={t("common.item")}
              value={itemValue(line.itemId)}
              filter={{ types: PURCHASABLE_TYPES }}
              sublabel={(item) => unitLabel(item.baseUnitCode)}
              onChange={(item) => {
                if (item) setPickedItems((prev) => new Map(prev).set(item.id, item));
                setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: item?.id ?? "", unitPrice: item?.costPrice ? Number(item.costPrice) : l.unitPrice } : l)));
              }}
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
      </div>
      {form}
    </div>
  );

  if (firstSegment === "new") return createPage;

  // `#/buy/purchase-orders/<number>/print` — a destination, not an overlay (P-6).
  if (selected && subPage.segments[1] === "print") return <PurchaseOrderPrintPage order={selected} />;

  if (selected) {
    return (
      <>
        <OrderDetail
          order={selected}
          supplierName={supplierName}
          itemName={itemName}
          onBack={() => subPage.close()}
          onConfirm={() => confirmSelected(selected.id, selected.version)}
          onPrint={() => subPage.open(selected.number ?? selected.id, "print")}
        />
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("purchaseOrders.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<PurchaseOrderDTO>
        title={t("purchaseOrders.title")}
        description={t("purchaseOrders.description")}
        actions={
          <Button variant="primary" onClick={() => openCreate()}>
            {t("purchaseOrders.new")}
          </Button>
        }
        stats={[
          { label: t("purchaseOrders.stat.total"), value: <span className="mz-num">{Number(stats.count ?? 0)}</span> },
          { label: t("purchaseOrders.stat.sent"), value: <span className="mz-num">{Number(stats.sent ?? 0)}</span> },
          { label: t("purchaseOrders.stat.value"), value: <MoneyValue value={majorOf(String(stats.value ?? "0"))} showUnit={false} /> },
          { label: t("purchaseOrders.stat.received"), value: <span className="mz-num">{Number(stats.received ?? 0)}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseOrderStatusDTO | "all")}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("purchaseOrders.searchPlaceholder")}
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
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(o) => o.id}
        onRowClick={(o) => subPage.open(o.number ?? o.id)}
        rowAction={(o) => {
          // Only a sent or partly-received order still has goods to receive (R1.3).
          const receivable = o.status === "sent" || o.status === "partially_received";
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(o.number ?? o.id) },
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(o.number ?? o.id, "print") },
            ...(o.status === "draft"
              ? [{ key: "confirm", label: t("purchaseOrders.confirmSend"), onSelect: () => confirmSelected(o.id) }]
              : []),
            ...(receivable
              ? [
                  {
                    key: "receive",
                    label: t("purchaseOrders.row.newReceipt"),
                    onSelect: () => navigate("goods-receipts", { kind: "create", prefill: { purchaseOrderId: o.id } }),
                  },
                ]
              : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems} label={t("purchaseOrders.row.actionsFor", { doc: o.number ?? o.id })} />
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
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("purchaseOrders.showingSuffix")}</>}
        emptyState={
          <EmptyState
            title={t("purchaseOrders.empty")}
            description={t("purchaseOrders.emptyHint")}
            action={{ label: t("purchaseOrders.new"), onClick: () => openCreate() }}
          />
        }
      />
    </>
  );
}
