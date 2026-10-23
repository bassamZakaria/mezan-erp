import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  RowMenu,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import {
  useCancelConfigInstance,
  useCloseConfigInstance,
  useConfigInstances,
  useConfigurableProducts,
  useCreateConfigInstance,
  useCustomers,
  useItemsByIds,
  usePreviewConfigInstance,
  useWarehouses,
  type ConfigInstanceRecord,
} from "../data/hooks";
import { TextField, NumberField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

type Status = ConfigInstanceRecord["status"];

const STATUS_KEY: Record<Status, AppTranslationKey> = {
  configured: "customOrders.status.configured",
  in_progress: "customOrders.status.in_progress",
  produced: "customOrders.status.produced",
  closed: "customOrders.status.closed",
  cancelled: "customOrders.status.cancelled",
};
const STATUS_TONE: Record<Status, PillTone> = {
  configured: "neutral",
  in_progress: "info",
  produced: "warning",
  closed: "success",
  cancelled: "danger",
};
/** The single notion of "still open" shared by the row menu and the detail header. */
const canActOn = (status: Status) => status !== "closed" && status !== "cancelled";

const num = (v: string) => Number(v);
const PAGE_SIZES = [10, 25, 50, 100] as const;
const today = () => todayIso();

function specLabel(spec: Record<string, string>): string {
  const entries = Object.entries(spec);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k}=${v}`).join(" | ");
}

function InstanceDetail({
  instance,
  productName,
  customerName,
  itemName,
  onBack,
  onClose,
  onCancel,
  closing,
  cancelling,
}: {
  instance: ConfigInstanceRecord;
  productName: (id: string) => string;
  customerName: (id: string | null) => string;
  itemName: (id: string) => string;
  onBack: () => void;
  onClose: () => void;
  onCancel: () => void;
  closing: boolean;
  cancelling: boolean;
}) {
  const { t } = useAppTranslation();
  const canAct = canActOn(instance.status);
  const actualCost = instance.actualCost !== null ? num(instance.actualCost) : num(instance.estimatedUnitCost) * num(instance.qty);
  const profitMargin = num(instance.sellTotal) - actualCost;

  return (
    <DocumentDetail
      title={t("customOrders.detailTitle", { number: instance.number })}
      statusLabel={t(STATUS_KEY[instance.status])}
      statusTone={STATUS_TONE[instance.status]}
      subtitle={`${productName(instance.configurableProductId)} · ${customerName(instance.customerId)}`}
      actions={
        canAct ? (
          <>
            <Button variant="primary" onClick={onClose} disabled={closing}>
              {t("customOrders.closeOrder")}
            </Button>
            <Button onClick={onCancel} disabled={cancelling}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onBack}>{t("customOrders.backToCustomManufacturing")}</Button>
          </>
        ) : (
          <Button onClick={onBack}>{t("customOrders.backToCustomManufacturing")}</Button>
        )
      }
      summary={[
        { label: t("customOrders.product"), value: productName(instance.configurableProductId) },
        { label: t("common.customer"), value: customerName(instance.customerId) },
        { label: t("common.qty"), value: <span className="mz-num">{instance.qty}</span> },
        { label: t("customOrders.specification"), value: specLabel(instance.spec) },
        { label: t("customOrders.totalSale"), value: <MoneyValue value={num(instance.sellTotal)} /> },
        { label: t("customOrders.margin"), value: <MoneyValue value={profitMargin} />, valueTone: profitMargin < 0 ? "danger" : "success" },
      ]}
      effects={[
        t("customOrders.aLinkedWorkOrderIs"),
        t("customOrders.closingTheOrderRecordsThe"),
      ]}
      tabs={[
        {
          key: "materials",
          label: t("customOrders.tab.materials", { count: instance.materials.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("customOrders.quantityPerUnit")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("customOrders.scrapRate")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {instance.materials.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(m.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.qtyPerUnit}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.wastePercent}%</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(m.lineCost)} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "cost",
          label: t("customOrders.actualCost"),
          content: (
            <dl className="grid grid-cols-2 gap-[12px] text-[13px]">
              <div><dt className="text-ink-muted">{t("customOrders.materialCostPerUnit")}</dt><dd className="mz-num"><MoneyValue value={num(instance.materialCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">{t("customOrders.labourPerUnit")}</dt><dd className="mz-num"><MoneyValue value={num(instance.laborCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">{t("customOrders.overheadPerUnit")}</dt><dd className="mz-num"><MoneyValue value={num(instance.overheadCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">{t("customOrders.estimatedCostPerUnit")}</dt><dd className="mz-num"><MoneyValue value={num(instance.estimatedUnitCost)} /></dd></div>
              <div>
                <dt className="text-ink-muted">{t("customOrders.actualCost")}</dt>
                <dd className="mz-num">{instance.actualCost !== null ? <MoneyValue value={num(instance.actualCost)} /> : "—"}</dd>
              </div>
              <div><dt className="text-ink-muted">{t("customOrders.workOrder")}</dt><dd className="mz-num">{instance.workOrderId}</dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function ConfigInstancesScreen() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const query = useConfigInstances();
  const productsQuery = useConfigurableProducts();
  const customersQuery = useCustomers();
  const warehousesQuery = useWarehouses();
  const createInstance = useCreateConfigInstance();
  const closeInstance = useCloseConfigInstance();
  const cancelInstance = useCancelConfigInstance();
  const preview = usePreviewConfigInstance();
  const { mutate: previewMutate } = preview;

  const instances = query.data ?? EMPTY;
  const products = (productsQuery.data ?? []).filter((p) => p.status === "active");
  const customers = customersQuery.data ?? EMPTY;
  const warehouses = warehousesQuery.data ?? EMPTY;

  const productName = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [products]);
  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string | null) => (id === null ? t("customOrders.noCustomer") : (map.get(id) ?? id));
  }, [customers, t]);

  const productOptions: EntityPickerOption[] = products.map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code }));
  const customerOptions: EntityPickerOption[] = customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code }));
  const warehouseOptions: EntityPickerOption[] = warehouses.map((w) => ({ id: w.id, label: nameOf(w), sublabel: w.code }));
  /** مستودع التشغيل defaults to the shop's PRODUCTION warehouse when it has one. */
  const defaultWipWarehouse = useMemo(() => {
    const production = warehouses.find((w) => w.type === "PRODUCTION" && w.active);
    return production ? { id: production.id, label: nameOf(production), sublabel: production.code } : null;
  }, [warehouses, nameOf]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    Status | "all",
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [panelOpen, setPanelOpen] = useState(false);

  const [product, setProduct] = useState<EntityPickerOption | null>(null);
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [customer, setCustomer] = useState<EntityPickerOption | null>(null);
  const [sellUnitPrice, setSellUnitPrice] = useState<number | null>(null);
  const [notesText, setNotesText] = useState("");
  const [sourceWarehouse, setSourceWarehouse] = useState<EntityPickerOption | null>(null);
  const [wipWarehouse, setWipWarehouse] = useState<EntityPickerOption | null>(null);
  const [destinationWarehouse, setDestinationWarehouse] = useState<EntityPickerOption | null>(null);
  const [scheduledStartDate, setScheduledStartDate] = useState(today());
  const [scheduledEndDate, setScheduledEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const selectedProduct = products.find((p) => p.id === product?.id) ?? null;

  useEffect(() => {
    if (!selectedProduct) return;
    if (!panelOpen) return;
    if (selectedProduct.inputs.some((i) => (spec[i.id] ?? "").trim() === "")) return;
    previewMutate({ configurableProductId: selectedProduct.id, spec });
    // `previewMutate`, never the `preview` mutation object: the object gets a
    // new identity on every state transition it makes, so depending on it here
    // would re-fire this effect from its own result, forever. `mutate` is
    // stable for the life of the mutation.
  }, [selectedProduct, spec, panelOpen, previewMutate]);

  const selected = instances.find((i) => i.id === selectedId) ?? null;
  const { byId: itemById } = useItemsByIds([
    ...(selected?.materials ?? []).map((m) => m.itemId),
    ...(preview.data?.materials ?? []).map((m) => m.itemId),
  ]);
  const itemName = useMemo(() => (id: string) => itemById.get(id)?.nameAr ?? id, [itemById]);

  const filtered = useMemo(() => {
    let rows = instances;
    if (statusFilter !== "all") rows = rows.filter((i) => i.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (i) =>
          i.number.toLowerCase().includes(q) ||
          productName(i.configurableProductId).includes(search.trim()) ||
          customerName(i.customerId).includes(search.trim()),
      );
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [instances, statusFilter, search, productName, customerName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: instances.length },
    { key: "configured", label: t(STATUS_KEY.configured), count: instances.filter((i) => i.status === "configured").length },
    { key: "in_progress", label: t(STATUS_KEY.in_progress), count: instances.filter((i) => i.status === "in_progress").length },
    { key: "produced", label: t(STATUS_KEY.produced), count: instances.filter((i) => i.status === "produced").length },
    { key: "closed", label: t(STATUS_KEY.closed), count: instances.filter((i) => i.status === "closed").length },
    { key: "cancelled", label: t(STATUS_KEY.cancelled), count: instances.filter((i) => i.status === "cancelled").length },
  ];

  const columns: DocumentListColumn<ConfigInstanceRecord>[] = [
    { key: "number", header: t("customOrders.orderNumber"), render: (i) => <span className="mz-num font-semibold text-ink">{i.number}</span> },
    { key: "product", header: t("customOrders.product"), render: (i) => productName(i.configurableProductId) },
    { key: "spec", header: t("customOrders.specification"), render: (i) => specLabel(i.spec) },
    { key: "customer", header: t("common.customer"), render: (i) => customerName(i.customerId) },
    { key: "qty", header: t("common.qty"), align: "end", render: (i) => <span className="mz-num">{i.qty}</span> },
    {
      key: "price",
      header: t("customOrders.salePricePerUnit"),
      align: "end",
      render: (i) => (i.sellUnitPrice !== null ? <MoneyValue value={num(i.sellUnitPrice)} /> : "—"),
    },
    { key: "status", header: t("common.status"), render: (i) => <StatusPill label={t(STATUS_KEY[i.status])} tone={STATUS_TONE[i.status]} /> },
  ];

  function openCreate() {
    setProduct(null);
    setSpec({});
    setQty(1);
    setCustomer(null);
    setSellUnitPrice(null);
    setNotesText("");
    setSourceWarehouse(null);
    setWipWarehouse(defaultWipWarehouse);
    setDestinationWarehouse(null);
    setScheduledStartDate(today());
    setScheduledEndDate("");
    setFormError(null);
    preview.reset();
    setPanelOpen(true);
  }

  const canSave =
    product !== null &&
    sourceWarehouse !== null &&
    wipWarehouse !== null &&
    destinationWarehouse !== null &&
    qty > 0 &&
    (selectedProduct?.inputs.every((i) => (spec[i.id] ?? "").trim() !== "") ?? false);

  async function save() {
    if (!product || !sourceWarehouse || !wipWarehouse || !destinationWarehouse) return;
    setFormError(null);
    try {
      await createInstance.mutateAsync({
        id: crypto.randomUUID(),
        configurableProductId: product.id,
        spec,
        qty: String(qty),
        customerId: customer?.id ?? null,
        sellUnitPrice: sellUnitPrice !== null && sellUnitPrice > 0 ? String(sellUnitPrice) : null,
        notes: notesText.trim() === "" ? null : notesText.trim(),
        sourceWarehouseId: sourceWarehouse.id,
        wipWarehouseId: wipWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        scheduledStartDate,
        scheduledEndDate: scheduledEndDate.trim() === "" ? null : scheduledEndDate,
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("customOrders.theCustomOrderCouldNot"));
    }
  }

  async function doClose(id: string) {
    setActionError(null);
    try {
      await closeInstance.mutateAsync(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("customOrders.theOrderCouldNotBe");
      setActionError(message);
      // Re-thrown so the row menu's own success/failure toast — which awaits
      // this promise — learns the close actually failed, instead of reporting
      // a refused close as done.
      throw err instanceof Error ? err : new Error(message);
    }
  }

  async function doCancel(id: string) {
    setActionError(null);
    try {
      await cancelInstance.mutateAsync(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("customOrders.theOrderCouldNotBe2");
      setActionError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }

  async function runRowAction(id: string, action: "close" | "cancel") {
    if (pendingId) return;
    setPendingId(id);
    try {
      if (action === "close") await doClose(id);
      else await doCancel(id);
    } finally {
      setPendingId(null);
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("customOrders.newCustomOrder")} description={t("customOrders.chooseTheProductAndEnter")}>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker
          label={t("customOrders.product2")}
          value={product}
          onChange={(opt) => {
            setProduct(opt);
            const p = products.find((x) => x.id === opt?.id);
            setSpec(p ? Object.fromEntries(p.inputs.map((i) => [i.id, ""])) : {});
            preview.reset();
          }}
          options={productOptions}
          placeholder={t("customOrders.chooseAConfigurableProduct")}
        />

        {selectedProduct ? (
          <div className="flex flex-col gap-[10px] rounded-lg border border-border bg-surface p-[12px]">
            <span className="text-[12.5px] font-semibold text-ink">{t("customOrders.specification")}</span>
            {selectedProduct.inputs.map((inp) => (
              <TextField
                key={inp.id}
                label={`${inp.labelAr}${inp.min !== null || inp.max !== null ? ` (${inp.min ?? "—"} – ${inp.max ?? "—"})` : ""}`}
                value={spec[inp.id] ?? ""}
                onChange={(v) => setSpec((prev) => ({ ...prev, [inp.id]: v }))}
              />
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-[10px]">
          <NumberField label={t("customOrders.quantity")} value={qty} min={0} onChange={setQty} />
          <NumberField
            label={t("customOrders.salePricePerUnit")}
            value={sellUnitPrice ?? Number.NaN}
            min={0}
            onChange={(v) => setSellUnitPrice(Number.isNaN(v) ? null : v)}
          />
        </div>
        <EntityPicker label={t("common.customer")} value={customer} onChange={setCustomer} options={customerOptions} placeholder={t("customOrders.noCustomer")} />
        <TextField label={t("common.notes")} value={notesText} onChange={setNotesText} />
        <EntityPicker label={t("customOrders.rawMaterialsWarehouse")} value={sourceWarehouse} onChange={setSourceWarehouse} options={warehouseOptions} placeholder={t("customOrders.chooseAWarehouse")} />
        <EntityPicker
          label={t("customOrders.wipWarehouse")}
          value={wipWarehouse}
          onChange={setWipWarehouse}
          options={warehouseOptions}
          placeholder={t("customOrders.chooseAWarehouse")}
        />
        <EntityPicker
          label={t("customOrders.finishedGoodsWarehouse")}
          value={destinationWarehouse}
          onChange={setDestinationWarehouse}
          options={warehouseOptions}
          placeholder={t("customOrders.chooseAWarehouse")}
        />
        <div className="grid grid-cols-2 gap-[10px]">
          <TextField label={t("customOrders.startDate")} value={scheduledStartDate} onChange={setScheduledStartDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("customOrders.expectedFinish")} value={scheduledEndDate} onChange={setScheduledEndDate} placeholder="YYYY-MM-DD" />
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-[12px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("customOrders.previewRequirementsAndCost")}</span>
          {!selectedProduct ? (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">{t("customOrders.startANewOrderBy")}</p>
          ) : preview.isPending ? (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">{t("customOrders.calculating")}</p>
          ) : preview.isError ? (
            <p className="mt-[8px] text-[12.5px] text-danger-ink">{preview.error.message}</p>
          ) : preview.data ? (
            <div className="mt-[8px] flex flex-col gap-[8px] text-[12.5px]">
              {preview.data.materials.map((m, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span>{itemName(m.itemId)}</span>
                  <span className="mz-num text-ink-muted">
                    {m.effectiveQtyPerUnit} × <MoneyValue value={num(m.unitCost)} showUnit={false} /> = <MoneyValue value={num(m.lineCost)} showUnit={false} />
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border pt-[8px] font-semibold">
                <span>{t("customOrders.unitCost")}</span>
                <MoneyValue value={num(preview.data.materialCostPerUnit) + num(preview.data.laborCostPerUnit) + num(preview.data.overheadCostPerUnit)} />
              </div>
              {preview.data.unitPrice !== null ? (
                <div className="flex items-center justify-between font-semibold text-brand">
                  <span>{t("customOrders.suggestedPricePerUnit")}</span>
                  <MoneyValue value={num(preview.data.unitPrice)} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">{t("customOrders.completeTheSpecificationToSee")}</p>
          )}
        </div>

        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createInstance.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        {actionError ? (
          <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {actionError}
          </div>
        ) : null}
        <InstanceDetail
          instance={selected}
          productName={productName}
          customerName={customerName}
          itemName={itemName}
          onBack={() => setSelectedId(null)}
          onClose={() => {
            // Surfaced already via `actionError`, rendered just above.
            doClose(selected.id).catch(() => {});
          }}
          onCancel={() => {
            doCancel(selected.id).catch(() => {});
          }}
          closing={closeInstance.isPending}
          cancelling={cancelInstance.isPending}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("customOrders.customOrdersCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<ConfigInstanceRecord>
        title={t("customOrders.customManufacturing")}
        description={t("customOrders.madeToOrderManufacturingOf")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("customOrders.newCustomOrder")}
          </Button>
        }
        listKey="config-instances"
        statsCollapsible
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{instances.length}</span> },
          { label: t(STATUS_KEY.configured), value: <span className="mz-num">{instances.filter((i) => i.status === "configured").length}</span> },
          {
            label: t(STATUS_KEY.in_progress),
            value: <span className="mz-num">{instances.filter((i) => i.status === "in_progress" || i.status === "produced").length}</span>,
          },
          { label: t(STATUS_KEY.closed), value: <span className="mz-num">{instances.filter((i) => i.status === "closed").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key as Status | "all");
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("customOrders.searchByOrderNumberProduct")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(i) => i.id}
        onRowClick={(i) => setSelectedId(i.id)}
        rowAction={(i) => {
          const items: RowMenuItem[] = [{ key: "view", label: t("common.view"), onSelect: () => setSelectedId(i.id) }];
          if (canActOn(i.status)) {
            items.push(
              {
                key: "close",
                label: t("customOrders.closeOrder"),
                disabled: pendingId === i.id,
                onSelect: () => runRowAction(i.id, "close"),
              },
              {
                key: "cancel",
                label: t("common.cancel"),
                tone: "danger",
                disabled: pendingId === i.id,
                onSelect: () => runRowAction(i.id, "cancel"),
              },
            );
          }
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: i.number })} />;
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
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("customOrders.orders")}</>}
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : (
            <EmptyState
              title={t("customOrders.noCustomOrdersYetCreate")}
              description={t("customOrders.emptyBody")}
              action={{ label: t("customOrders.newCustomOrder"), onClick: openCreate }}
            />
          )
        }
      />
      {panel}
    </>
  );
}
