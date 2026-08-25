import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  EntityPicker,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import {
  useBoms,
  useCompleteWorkOrder,
  useCreateWorkOrder,
  useIssueWorkOrderMaterials,
  useItems,
  useReceiveWorkOrderProduct,
  useStartWorkOrder,
  useWarehouses,
  useWorkOrders,
  type WorkOrderRecord,
  type WorkOrderStageRecord,
  type WorkOrderStatusRecord,
} from "../data/hooks";
import { TextField, NumberField, SelectField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const STATUS_KEY: Record<WorkOrderStatusRecord, AppTranslationKey> = {
  planned: "workOrders.status.planned",
  in_progress: "workOrders.status.in_progress",
  completed: "workOrders.status.completed",
  cancelled: "workOrders.status.cancelled",
};
const STATUS_TONE: Record<WorkOrderStatusRecord, PillTone> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};
/** An unknown priority shows its own code rather than a humanized key. */
function priorityLabel(priority: string, t: (key: AppTranslationKey) => string): string {
  const key = PRIORITY_KEY[priority];
  return key ? t(key) : priority;
}

const PRIORITY_KEY: Record<string, AppTranslationKey> = {
  low: "manufacturingHub.priority.low",
  normal: "manufacturingHub.priority.normal",
  high: "manufacturingHub.priority.high",
};
const num = (v: string) => Number(v);
const pct = (f: number) => `${Math.round(f * 100)}%`;
const today = () => new Date().toISOString().slice(0, 10);

const STAGE_STEPS: readonly { key: string; labelKey: AppTranslationKey }[] = [
  { key: "started", labelKey: "workOrders.stage.started" },
  { key: "materials_issued", labelKey: "workOrders.stage.materials_issued" },
  { key: "product_received", labelKey: "workOrders.stage.product_received" },
  { key: "completed", labelKey: "workOrders.stage.completed" },
];
/** The NEXT action for a stage, as a catalogue key. */
const STAGE_ACTION: Record<WorkOrderStageRecord, AppTranslationKey | null> = {
  not_started: "workOrders.stage.started",
  started: "workOrders.stage.materials_issued",
  materials_issued: "workOrders.stage.product_received",
  product_received: "workOrders.stage.completed",
  completed: null,
};
/** Map not_started onto the first step so the stepper reads before-issue. */
const stepperKey = (stage: WorkOrderStageRecord) => (stage === "not_started" ? "started" : stage);

function WorkOrderDetail({
  order,
  itemName,
  warehouseName,
  onBack,
  onAdvance,
  advancing,
}: {
  order: WorkOrderRecord;
  itemName: (id: string) => string;
  warehouseName: (id: string) => string;
  onBack: () => void;
  onAdvance: () => void;
  advancing: boolean;
}) {
  const { t } = useAppTranslation();
  const action = STAGE_ACTION[order.stage];
  return (
    <DocumentDetail
      title={t("workOrders.detailTitle", { number: order.number })}
      statusLabel={t(STATUS_KEY[order.status])}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${itemName(order.productItemId)} · ${pct(order.progress)}`}
      actions={
        <>
          {action && order.status !== "cancelled" ? (
            <Button variant="primary" onClick={onAdvance} disabled={advancing}>
              {t(action)}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("workOrders.backToWorkOrders")}</Button>
        </>
      }
      summary={[
        { label: t("workOrders.finishedProduct"), value: itemName(order.productItemId) },
        { label: t("workOrders.plannedQuantity"), value: <span className="mz-num">{order.plannedQty}</span> },
        { label: t("workOrders.quantityProduced"), value: <span className="mz-num">{order.producedQty}</span> },
        { label: t("workOrders.rawMaterialsWarehouse"), value: warehouseName(order.sourceWarehouseId) },
        { label: t("workOrders.finishedGoodsWarehouse"), value: warehouseName(order.destinationWarehouseId) },
        { label: t("workOrders.priority"), value: priorityLabel(order.priority, t) },
        { label: t("workOrders.workInProgressValue"), value: <MoneyValue value={num(order.wipTotal)} /> },
      ]}
      effects={[
        t("workOrders.issuingMaterialsReducesRawStock"),
        t("workOrders.costMaterialsLabourAndOverhead"),
        t("workOrders.theFinishedProductOnlyEnters"),
      ]}
      aside={
        <div className="rounded-lg border border-border bg-surface p-[14px]">
          <div className="mb-[10px] text-[12.5px] font-semibold text-ink">{t("workOrders.currentStage")}</div>
          <DocumentStatusStepper
            steps={STAGE_STEPS.map((step) => ({ key: step.key, label: t(step.labelKey) }))}
            currentKey={stepperKey(order.stage)}
            tone={order.status === "cancelled" ? "danger" : "brand"}
          />
        </div>
      }
      tabs={[
        {
          key: "materials",
          label: t("workOrders.tab.materials", { count: order.materials.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.required")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.issued")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.returned")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.net")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.materials.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(m.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.requiredQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.issuedQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.returnedQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.netQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "costs",
          label: t("workOrders.costs"),
          content: (
            <dl className="grid grid-cols-2 gap-[12px] text-[13px]">
              <div><dt className="text-ink-muted">{t("workOrders.materialCost")}</dt><dd className="mz-num"><MoneyValue value={num(order.materialCost)} /></dd></div>
              <div><dt className="text-ink-muted">{t("workOrders.labour")}</dt><dd className="mz-num"><MoneyValue value={num(order.laborCost)} /></dd></div>
              <div><dt className="text-ink-muted">{t("workOrders.overhead")}</dt><dd className="mz-num"><MoneyValue value={num(order.overheadCost)} /></dd></div>
              <div><dt className="text-ink-muted">{t("workOrders.totalWorkInProgress")}</dt><dd className="mz-num"><MoneyValue value={num(order.wipTotal)} /></dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function WorkOrdersScreen() {
  const { t } = useAppTranslation();
  const query = useWorkOrders();
  const bomsQuery = useBoms();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();
  const createOrder = useCreateWorkOrder();
  const startOrder = useStartWorkOrder();
  const issueOrder = useIssueWorkOrderMaterials();
  const receiveOrder = useReceiveWorkOrderProduct();
  const completeOrder = useCompleteWorkOrder();

  const orders = query.data ?? [];
  const boms = (bomsQuery.data ?? []).filter((b) => b.status === "active");
  const items = itemsQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const bomOptions: EntityPickerOption[] = boms.map((b) => ({ id: b.id, label: `${b.number} — ${itemName(b.productItemId)}`, sublabel: `v${b.version}` }));
  const warehouseOptions: EntityPickerOption[] = warehouses.map((w) => ({ id: w.id, label: w.name, sublabel: w.code }));
  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusRecord | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [bom, setBom] = useState<EntityPickerOption | null>(null);
  const [plannedQty, setPlannedQty] = useState(1);
  const [sourceWarehouse, setSourceWarehouse] = useState<EntityPickerOption | null>(null);
  const [destinationWarehouse, setDestinationWarehouse] = useState<EntityPickerOption | null>(null);
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [scheduledStartDate, setScheduledStartDate] = useState(today());
  const [scheduledEndDate, setScheduledEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [receivePanelOpen, setReceivePanelOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || itemName(o.productItemId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [orders, statusFilter, search, itemName]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: orders.length },
    ...(Object.keys(STATUS_KEY) as WorkOrderStatusRecord[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<WorkOrderRecord>[] = [
    { key: "number", header: t("workOrders.workOrderNumber"), render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "product", header: t("workOrders.finishedProduct"), render: (o) => itemName(o.productItemId) },
    {
      key: "progress",
      header: t("workOrders.production"),
      align: "end",
      render: (o) => (
        <span className="mz-num">
          {o.producedQty}/{o.plannedQty} · {pct(o.progress)}
        </span>
      ),
    },
    { key: "priority", header: t("workOrders.priority"), render: (o) => priorityLabel(o.priority, t) },
    { key: "status", header: t("common.status"), render: (o) => <StatusPill label={t(STATUS_KEY[o.status])} tone={STATUS_TONE[o.status]} /> },
  ];

  function openCreate() {
    setBom(null);
    setPlannedQty(1);
    setSourceWarehouse(null);
    setDestinationWarehouse(null);
    setPriority("normal");
    setScheduledStartDate(today());
    setScheduledEndDate("");
    setNotes("");
    setFormError(null);
    setPanelOpen(true);
  }

  const canSave = bom !== null && sourceWarehouse !== null && destinationWarehouse !== null && plannedQty > 0;

  async function save() {
    if (!bom || !sourceWarehouse || !destinationWarehouse) return;
    setFormError(null);
    try {
      await createOrder.mutateAsync({
        id: crypto.randomUUID(),
        bomId: bom.id,
        plannedQty: String(plannedQty),
        sourceWarehouseId: sourceWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        priority,
        scheduledStartDate,
        scheduledEndDate: scheduledEndDate.trim() === "" ? null : scheduledEndDate,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("workOrders.theWorkOrderCouldNot"));
    }
  }

  async function advance(order: WorkOrderRecord) {
    setActionError(null);
    try {
      if (order.stage === "not_started") {
        await startOrder.mutateAsync(order.id);
      } else if (order.stage === "started") {
        await issueOrder.mutateAsync(order.id);
      } else if (order.stage === "materials_issued") {
        setReceiveQty(num(order.plannedQty));
        setReceivePanelOpen(true);
      } else if (order.stage === "product_received") {
        await completeOrder.mutateAsync(order.id);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("workOrders.thatActionCouldNotBe"));
    }
  }

  async function confirmReceive() {
    if (!selected) return;
    setActionError(null);
    try {
      await receiveOrder.mutateAsync({ id: selected.id, body: { producedQty: String(receiveQty) } });
      setReceivePanelOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("workOrders.theProductCouldNotBe"));
    }
  }

  const advancing = startOrder.isPending || issueOrder.isPending || completeOrder.isPending;

  const createPanel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("workOrders.newWorkOrder")} description={t("workOrders.chooseTheBillOfMaterials")}>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker label={t("workOrders.billOfMaterials")} value={bom} onChange={setBom} options={bomOptions} placeholder={t("workOrders.chooseABillOfMaterials")} />
        <NumberField label={t("workOrders.plannedQuantity")} value={plannedQty} min={0} onChange={setPlannedQty} />
        <EntityPicker label={t("workOrders.rawMaterialsWarehouse2")} value={sourceWarehouse} onChange={setSourceWarehouse} options={warehouseOptions} placeholder={t("workOrders.chooseAWarehouse")} />
        <EntityPicker
          label={t("workOrders.finishedGoodsWarehouse2")}
          value={destinationWarehouse}
          onChange={setDestinationWarehouse}
          options={warehouseOptions}
          placeholder={t("workOrders.chooseAWarehouse")}
        />
        <SelectField
          label={t("workOrders.priority")}
          value={priority}
          onChange={(v) => setPriority(v as "low" | "normal" | "high")}
          options={[
            { value: "low", label: t("manufacturingHub.priority.low") },
            { value: "normal", label: t("manufacturingHub.priority.normal") },
            { value: "high", label: t("manufacturingHub.priority.high") },
          ]}
        />
        <TextField label={t("workOrders.startDate")} value={scheduledStartDate} onChange={setScheduledStartDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("workOrders.expectedFinish")} value={scheduledEndDate} onChange={setScheduledEndDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createOrder.isPending}>
            {t("workOrders.saveWorkOrder")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  const receivePanel = (
    <SidePanel open={receivePanelOpen} onClose={() => setReceivePanelOpen(false)} title={t("workOrders.receiveProduct")} description={t("workOrders.enterTheQuantityActuallyProduced")}>
      <div className="flex flex-col gap-[14px]">
        {actionError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {actionError}
          </div>
        ) : null}
        <NumberField label={t("workOrders.quantityProduced")} value={receiveQty} min={0} onChange={setReceiveQty} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setReceivePanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={confirmReceive} disabled={receiveOrder.isPending || receiveQty <= 0}>
            {t("workOrders.confirmReceipt")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <WorkOrderDetail
          order={selected}
          itemName={itemName}
          warehouseName={warehouseName}
          onBack={() => setSelectedId(null)}
          onAdvance={() => advance(selected)}
          advancing={advancing}
        />
        {createPanel}
        {receivePanel}
      </>
    );
  }

  const overdueCount = orders.filter(
    (o) => (o.status === "in_progress" || o.status === "planned") && o.scheduledEndDate !== null && o.scheduledEndDate < today(),
  ).length;

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("workOrders.workOrdersCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<WorkOrderRecord>
        eyebrow={t("eyebrow.manufacturing.workOrders")}
        title={t("workOrders.workOrders")}
        description={t("workOrders.runningAProductionCycleAgainst")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("workOrders.newWorkOrder")}
          </Button>
        }
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{orders.length}</span> },
          { label: t("workOrders.planned"), value: <span className="mz-num">{orders.filter((o) => o.status === "planned").length}</span> },
          { label: t("workOrders.running"), value: <span className="mz-num">{orders.filter((o) => o.status === "in_progress").length}</span> },
          { label: t("workOrders.overdue"), value: <span className="mz-num">{overdueCount}</span>, valueTone: overdueCount > 0 ? "danger" : "default" },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as WorkOrderStatusRecord | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("workOrders.searchWorkOrders")}
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        onRowClick={(o) => setSelectedId(o.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{orders.length}</span> {t("workOrders.orders")}</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("common.loading") : t("workOrders.noMatchingWorkOrdersCreate")}
          </div>
        }
      />
      {createPanel}
      {receivePanel}
    </>
  );
}
