import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
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
  useBoms,
  useCompleteWorkOrder,
  useCreateWorkOrder,
  useIssueWorkOrderMaterials,
  useExtraIssueWorkOrderMaterials,
  useReturnWorkOrderMaterials,
  useLogWorkOrderWaste,
  useLogWorkOrderCost,
  useItems,
  useReceiveWorkOrderProduct,
  useStartWorkOrder,
  useWarehouses,
  useWorkOrders,
  useWorkOrderCounts,
  useWorkOrderStats,
  useWorkOrderActivity,
  useWorkStations,
  useEmployees,
  type WorkOrderListFilter,
  type WorkOrderRecord,
  type WorkOrderStageRecord,
  type WorkOrderStatusRecord,
} from "../data/hooks";
import { TextField, NumberField, SelectField } from "../settings/form-controls";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { todayIso } from "../lib/dates";

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
const today = () => todayIso();

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

/**
 * إجراءات التشغيل (R9.1) — the shop-floor actions a real production run needs.
 *
 * All five routes existed on the server and none had a hook, so a work order
 * could only be started, issued in full, received and closed: a run that
 * needed one more sack of sugar, returned what it did not use, or scrapped a
 * batch had nowhere to record it, and the WIP cost was wrong from that moment
 * on.
 */
function ShopFloorPanel({ order, itemName }: { order: WorkOrderRecord; itemName: (id: string) => string }) {
  const { t } = useAppTranslation();
  const extraIssue = useExtraIssueWorkOrderMaterials();
  const returnMaterials = useReturnWorkOrderMaterials();
  const logWaste = useLogWorkOrderWaste();
  const logCost = useLogWorkOrderCost();
  const stations = (useWorkStations().data ?? []).filter((station) => station.status === "active");
  const employees = useEmployees().data ?? [];

  const [itemId, setItemId] = useState(order.materials[0]?.itemId ?? "");
  const [qty, setQty] = useState(0);
  const [stationId, setStationId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [costKind, setCostKind] = useState<"labor" | "overhead" | "other">("labor");
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * Both dimensions ride on every material action, so the movement the action
   * produces can be read back as "who, where" and not just "what". They are
   * ids into the two registries — never free text.
   */
  const attribution = { stationId: stationId === "" ? null : stationId, operatorId: operatorId === "" ? null : operatorId };

  const busy = extraIssue.isPending || returnMaterials.isPending || logWaste.isPending || logCost.isPending;
  // Only a started order has materials on the floor to add to, return or scrap.
  const canMoveMaterials = order.stage === "started" || order.stage === "materials_issued";

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setQty(0);
      setAmount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("workOrders.thatActionCouldNotBe"));
    }
  }

  const itemOptions = order.materials.map((m) => ({ value: m.itemId, label: itemName(m.itemId) }));
  const stationOptions = [
    { value: "", label: t("workOrders.station.none") },
    ...stations.map((station) => ({ value: station.id, label: `${station.code} — ${station.nameAr}` })),
  ];
  const operatorOptions = [
    { value: "", label: t("workOrders.operator.none") },
    ...employees.map((employee) => ({
      value: employee.id,
      label: `${employee.code} — ${[employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ") || `${employee.firstName} ${employee.lastName}`}`,
    })),
  ];

  return (
    <div className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-border p-[14px]">
        <div className="mb-[10px] text-[12.5px] font-semibold text-ink">{t("workOrders.shopFloor")}</div>
        <div className="grid gap-[10px] sm:grid-cols-2">
          <SelectField label={t("workOrders.pickItem")} value={itemId} onChange={setItemId} options={itemOptions} />
          <NumberField label={t("workOrders.qty")} value={qty} min={0} onChange={setQty} />
          <SelectField label={t("workOrders.station")} value={stationId} onChange={setStationId} options={stationOptions} />
          <SelectField label={t("workOrders.operator")} value={operatorId} onChange={setOperatorId} options={operatorOptions} />
        </div>
        <p className="mt-[8px] text-[11.5px] leading-[1.9] text-ink-muted">{t("workOrders.attributionHint")}</p>
        <div className="mt-[10px] flex flex-wrap gap-[8px]">
          <Button
            disabled={busy || !canMoveMaterials || qty <= 0 || itemId === ""}
            onClick={() => run(() => extraIssue.mutateAsync({ id: order.id, body: { ...attribution, lines: [{ itemId, qty: String(qty) }] } }))}
          >
            {t("workOrders.action.extraIssue")}
          </Button>
          <Button
            disabled={busy || !canMoveMaterials || qty <= 0 || itemId === ""}
            onClick={() => run(() => returnMaterials.mutateAsync({ id: order.id, body: { ...attribution, lines: [{ itemId, qty: String(qty) }] } }))}
          >
            {t("workOrders.action.returnMaterials")}
          </Button>
          <Button
            variant="danger-outline"
            disabled={busy || !canMoveMaterials || qty <= 0 || itemId === ""}
            onClick={() => run(() => logWaste.mutateAsync({ id: order.id, body: { ...attribution, lines: [{ itemId, qty: String(qty) }] } }))}
          >
            {t("workOrders.action.logWaste")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-[14px]">
        <div className="grid gap-[10px] sm:grid-cols-2">
          <SelectField
            label={t("workOrders.costKind")}
            value={costKind}
            onChange={(value) => setCostKind(value as "labor" | "overhead" | "other")}
            options={[
              { value: "labor", label: t("workOrders.costKind.labor") },
              { value: "overhead", label: t("workOrders.costKind.overhead") },
              { value: "other", label: t("workOrders.costKind.other") },
            ]}
          />
          <NumberField label={t("workOrders.amount")} value={amount} min={0} onChange={setAmount} />
        </div>
        <div className="mt-[10px]">
          <Button
            disabled={busy || amount <= 0 || order.status === "cancelled"}
            onClick={() => run(() => logCost.mutateAsync({ id: order.id, body: { kind: costKind, amount: String(amount) } }))}
          >
            {t("workOrders.action.logCost")}
          </Button>
        </div>
      </div>
    </div>
  );
}


/**
 * A work order's history, in the four shapes the reference splits it into.
 *
 * All four come off ONE request: the split between material movements and
 * finished-goods receipts is a property of the same ledger rows, so asking the
 * server twice would only invite the two halves to disagree.
 */
function ActivityTable({ head, rows, empty }: { head: readonly string[]; rows: readonly (readonly ReactNode[])[]; empty: string }) {
  const emptyState = <p className="p-[18px] text-center text-[12.5px] text-ink-muted">{empty}</p>;
  if (rows.length === 0) return emptyState;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
            {head.map((h, i) => (
              <th key={h} className={`px-[12px] py-[9px] ${i === 0 ? "text-start" : "text-end"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, r) => (
            <tr key={r} className="border-b border-border last:border-b-0">
              {cells.map((cell, i) => (
                <td key={i} className={`px-[12px] py-[10px] ${i === 0 ? "text-start" : "mz-num text-end"}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  const activity = useWorkOrderActivity(order.id).data;
  const dirLabel = (d: string) => (d.toUpperCase() === "IN" ? t("workOrders.direction.in") : t("workOrders.direction.out"));
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
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.available")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.issued")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.returned")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.net")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("workOrders.shortage")}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.materials.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(m.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.requiredQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end text-ink-muted">{m.availableQty ?? "—"}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.issuedQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.returnedQty}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.netQty}</td>
                      <td className={`mz-num px-[12px] py-[10px] text-end ${Number(m.shortageQty ?? 0) > 0 ? "font-bold text-danger-ink" : "text-ink-faint"}`}>
                        {m.shortageQty ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "shopFloor",
          label: t("workOrders.shopFloor"),
          content: <ShopFloorPanel order={order} itemName={itemName} />,
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
        {
          key: "movements",
          label: t("workOrders.tab.movements"),
          content: (
            <ActivityTable
              head={[
                t("common.item"),
                t("workOrders.rawMaterialsWarehouse"),
                t("workOrders.direction.in"),
                t("common.qty"),
                t("workOrders.materialCost"),
                t("workOrders.station"),
                t("workOrders.operator"),
              ]}
              rows={(activity?.movements ?? []).map((m) => [
                itemName(m.itemId),
                warehouseName(m.warehouseId),
                dirLabel(m.direction),
                m.qty,
                <MoneyValue value={num(m.unitCost)} />,
                m.stationName ?? "—",
                m.operatorName ?? "—",
              ])}
              empty={t("workOrders.noMovements")}
            />
          ),
        },
        {
          key: "receipts",
          label: t("workOrders.tab.receipts"),
          content: (
            <ActivityTable
              head={[
                t("common.item"),
                t("workOrders.finishedGoodsWarehouse"),
                t("common.qty"),
                t("workOrders.materialCost"),
                t("workOrders.station"),
                t("workOrders.operator"),
              ]}
              rows={(activity?.receipts ?? []).map((m) => [
                itemName(m.itemId),
                warehouseName(m.warehouseId),
                m.qty,
                <MoneyValue value={num(m.unitCost)} />,
                m.stationName ?? "—",
                m.operatorName ?? "—",
              ])}
              empty={t("workOrders.noReceipts")}
            />
          ),
        },
        {
          key: "journal",
          label: t("workOrders.tab.journal"),
          content: (
            <ActivityTable
              head={[t("common.date"), t("workOrders.tab.journal"), t("common.debit"), t("common.credit")]}
              rows={(activity?.journalEntries ?? []).map((e) => [
                e.date,
                e.entryNo ?? e.id,
                <MoneyValue value={num(e.totalDebit)} />,
                <MoneyValue value={num(e.totalCredit)} />,
              ])}
              empty={t("workOrders.noJournal")}
            />
          ),
        },
        {
          key: "attachments",
          label: t("attachments.tab"),
          content: <AttachmentsTab entityType="work-order" entityId={order.id} />,
        },
        {
          key: "audit",
          label: t("workOrders.tab.audit"),
          content: (
            <ActivityTable
              head={[t("common.date"), t("audit.action"), t("audit.user")]}
              rows={(activity?.auditEvents ?? []).map((e) => [e.timestamp, e.action, e.actor])}
              empty={t("workOrders.noAudit")}
            />
          ),
        },
      ]}
    />
  );
}

export function WorkOrdersScreen() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const bomsQuery = useBoms();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();
  const createOrder = useCreateWorkOrder();
  const startOrder = useStartWorkOrder();
  const issueOrder = useIssueWorkOrderMaterials();
  const receiveOrder = useReceiveWorkOrderProduct();
  const completeOrder = useCompleteWorkOrder();

  const activeStations = (useWorkStations().data ?? []).filter((station) => station.status === "active");
  const screenEmployees = useEmployees().data ?? [];
  const boms = (bomsQuery.data ?? []).filter((b) => b.status === "active");
  const items = itemsQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const bomOptions: EntityPickerOption[] = boms.map((b) => ({ id: b.id, label: `${b.number} — ${itemName(b.productItemId)}`, sublabel: `v${b.version}` }));
  const warehouseOptions: EntityPickerOption[] = warehouses.map((w) => ({ id: w.id, label: nameOf(w), sublabel: w.code }));
  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, nameOf(w)]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusRecord | "all">("all");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
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
  const [issuePanelOpen, setIssuePanelOpen] = useState(false);
  const [issueStationId, setIssueStationId] = useState("");
  const [issueOperatorId, setIssueOperatorId] = useState("");
  const [receivePanelOpen, setReceivePanelOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState(0);
  const [receiveStationId, setReceiveStationId] = useState("");
  const [receiveOperatorId, setReceiveOperatorId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1) — status,
   * priority, stage and search used to narrow the browser's own copy of every
   * order while the chips and the KPI strip kept counting the unfiltered set.
   */
  const filter = useMemo<WorkOrderListFilter>(
    () => ({
      status: statusFilter,
      priority: priorityFilter || undefined,
      stage: stageFilter || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, priorityFilter, stageFilter, search],
  );
  const query = useWorkOrders(filter);
  const orders = query.data ?? [];
  const counts = useWorkOrderCounts(filter).data ?? {};
  const stats = useWorkOrderStats(filter).data ?? {};

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => [...orders].sort((a, b) => b.number.localeCompare(a.number)), [orders]);

  const activeFilterCount = [priorityFilter, stageFilter].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    ...(Object.keys(STATUS_KEY) as WorkOrderStatusRecord[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: counts[s] ?? 0,
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
        // The first issue is a shop-floor action like any other, so it asks
        // where and by whom before it moves stock (R9.1).
        setIssuePanelOpen(true);
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

  async function confirmIssue() {
    if (!selected) return;
    setActionError(null);
    try {
      await issueOrder.mutateAsync({
        id: selected.id,
        body: {
          stationId: issueStationId === "" ? null : issueStationId,
          operatorId: issueOperatorId === "" ? null : issueOperatorId,
        },
      });
      setIssuePanelOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("workOrders.thatActionCouldNotBe"));
    }
  }

  async function confirmReceive() {
    if (!selected) return;
    setActionError(null);
    try {
      await receiveOrder.mutateAsync({
        id: selected.id,
        body: {
          producedQty: String(receiveQty),
          stationId: receiveStationId === "" ? null : receiveStationId,
          operatorId: receiveOperatorId === "" ? null : receiveOperatorId,
        },
      });
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

  const stationOptionsForPanel = [
    { value: "", label: t("workOrders.station.none") },
    ...activeStations.map((station) => ({ value: station.id, label: `${station.code} — ${station.nameAr}` })),
  ];
  const operatorOptionsForPanel = [
    { value: "", label: t("workOrders.operator.none") },
    ...screenEmployees.map((employee) => ({
      value: employee.id,
      label: `${employee.code} — ${[employee.firstNameAr, employee.lastNameAr].filter(Boolean).join(" ") || `${employee.firstName} ${employee.lastName}`}`,
    })),
  ];

  const issuePanel = (
    <SidePanel open={issuePanelOpen} onClose={() => setIssuePanelOpen(false)} title={t("workOrders.stage.materials_issued")} description={t("workOrders.attributionHint")}>
      <div className="flex flex-col gap-[14px]">
        {actionError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {actionError}
          </div>
        ) : null}
        <SelectField label={t("workOrders.station")} value={issueStationId} onChange={setIssueStationId} options={stationOptionsForPanel} />
        <SelectField label={t("workOrders.operator")} value={issueOperatorId} onChange={setIssueOperatorId} options={operatorOptionsForPanel} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setIssuePanelOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={confirmIssue} disabled={issueOrder.isPending}>
            {t("workOrders.stage.materials_issued")}
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
        <SelectField label={t("workOrders.station")} value={receiveStationId} onChange={setReceiveStationId} options={stationOptionsForPanel} />
        <SelectField label={t("workOrders.operator")} value={receiveOperatorId} onChange={setReceiveOperatorId} options={operatorOptionsForPanel} />
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
        {issuePanel}
        {receivePanel}
      </>
    );
  }

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
        title={t("workOrders.workOrders")}
        description={t("workOrders.runningAProductionCycleAgainst")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("workOrders.newWorkOrder")}
          </Button>
        }
        listKey="work-orders"
        statsCollapsible
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{stats.count ?? 0}</span> },
          { label: t("workOrders.planned"), value: <span className="mz-num">{stats.planned ?? 0}</span> },
          { label: t("workOrders.running"), value: <span className="mz-num">{stats.in_progress ?? 0}</span> },
          {
            label: t("workOrders.overdue"),
            value: <span className="mz-num">{stats.overdue ?? 0}</span>,
            valueTone: Number(stats.overdue ?? 0) > 0 ? "danger" : "default",
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as WorkOrderStatusRecord | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("workOrders.searchWorkOrders")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2">
            <SelectField
              label={t("workOrders.priority")}
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[
                { value: "", label: t("workOrders.allPriorities") },
                { value: "low", label: t("manufacturingHub.priority.low") },
                { value: "normal", label: t("manufacturingHub.priority.normal") },
                { value: "high", label: t("manufacturingHub.priority.high") },
              ]}
            />
            <SelectField
              label={t("workOrders.currentStage")}
              value={stageFilter}
              onChange={setStageFilter}
              options={[
                { value: "", label: t("workOrders.allStages") },
                { value: "not_started", label: t("workOrders.stage.started") },
                { value: "materials_issued", label: t("workOrders.stage.materials_issued") },
                { value: "product_received", label: t("workOrders.stage.product_received") },
                { value: "completed", label: t("workOrders.stage.completed") },
              ]}
            />
          </div>
        }
        columns={columns}
        rows={pageRows}
        rowKey={(o) => o.id}
        onRowClick={(o) => setSelectedId(o.id)}
        rowAction={(o) => {
          // The next action a run can actually take, read off THIS row's stage (R1.3).
          const next = STAGE_ACTION[o.stage];
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setSelectedId(o.id) },
            ...(next && o.status !== "cancelled" && o.status !== "completed"
              ? [{ key: "advance", label: t(next), onSelect: () => void advance(o) }]
              : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems} label={t("workOrders.row.actionsFor", { doc: o.number })} />
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
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("workOrders.orders")}</>}
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : (
            <EmptyState
              title={t("workOrders.noMatchingWorkOrdersCreate")}
              description={t("workOrders.emptyHint")}
              action={{ label: t("workOrders.newWorkOrder"), onClick: openCreate }}
            />
          )
        }
      />
      {createPanel}
      {issuePanel}
      {receivePanel}
    </>
  );
}
