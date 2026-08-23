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

const STATUS_LABEL: Record<WorkOrderStatusRecord, string> = {
  planned: "مخطط",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<WorkOrderStatusRecord, PillTone> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};
const PRIORITY_LABEL: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية" };
const num = (v: string) => Number(v);
const pct = (f: number) => `${Math.round(f * 100)}%`;
const today = () => new Date().toISOString().slice(0, 10);

const STAGE_STEPS = [
  { key: "started", label: "بدء العمل" },
  { key: "materials_issued", label: "صرف المواد" },
  { key: "product_received", label: "استلام المنتج" },
  { key: "completed", label: "إكمال أمر العمل" },
];
const STAGE_ACTION: Record<WorkOrderStageRecord, string | null> = {
  not_started: "بدء العمل",
  started: "صرف المواد",
  materials_issued: "استلام المنتج",
  product_received: "إكمال أمر العمل",
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
  const action = STAGE_ACTION[order.stage];
  return (
    <DocumentDetail
      title={`أمر تصنيع ${order.number}`}
      statusLabel={STATUS_LABEL[order.status]}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${itemName(order.productItemId)} · ${pct(order.progress)}`}
      actions={
        <>
          {action && order.status !== "cancelled" ? (
            <Button variant="primary" onClick={onAdvance} disabled={advancing}>
              {action}
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لأوامر التصنيع</Button>
        </>
      }
      summary={[
        { label: "المنتج النهائي", value: itemName(order.productItemId) },
        { label: "الكمية المخططة", value: <span className="mz-num">{order.plannedQty}</span> },
        { label: "الكمية المنتجة", value: <span className="mz-num">{order.producedQty}</span> },
        { label: "مستودع الخامات", value: warehouseName(order.sourceWarehouseId) },
        { label: "مستودع المنتجات", value: warehouseName(order.destinationWarehouseId) },
        { label: "الأولوية", value: PRIORITY_LABEL[order.priority] },
        { label: "قيمة الإنتاج تحت التشغيل", value: <MoneyValue value={num(order.wipTotal)} /> },
      ]}
      effects={[
        "عند صرف المواد تنخفض كمية المخزون الخام (صرف عبر سجل المخزون).",
        "تتراكم التكلفة (مواد + عمالة + مصاريف) كإنتاج تحت التشغيل أثناء التصنيع.",
        "المنتج النهائي لا يدخل المخزون إلا عند الاستلام؛ وعند الإكمال تُرحَّل قيود رسملة الإنتاج تحت التشغيل تلقائياً.",
      ]}
      aside={
        <div className="rounded-lg border border-border bg-surface p-[14px]">
          <div className="mb-[10px] text-[12.5px] font-semibold text-ink">المرحلة الحالية</div>
          <DocumentStatusStepper
            steps={STAGE_STEPS}
            currentKey={stepperKey(order.stage)}
            tone={order.status === "cancelled" ? "danger" : "brand"}
          />
        </div>
      }
      tabs={[
        {
          key: "materials",
          label: `المواد (${order.materials.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">المطلوبة</th>
                    <th className="px-[12px] py-[9px] text-end">الصادرة</th>
                    <th className="px-[12px] py-[9px] text-end">المرجعة</th>
                    <th className="px-[12px] py-[9px] text-end">الصافي</th>
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
          label: "التكاليف",
          content: (
            <dl className="grid grid-cols-2 gap-[12px] text-[13px]">
              <div><dt className="text-ink-muted">تكلفة المواد</dt><dd className="mz-num"><MoneyValue value={num(order.materialCost)} /></dd></div>
              <div><dt className="text-ink-muted">العمالة</dt><dd className="mz-num"><MoneyValue value={num(order.laborCost)} /></dd></div>
              <div><dt className="text-ink-muted">المصاريف</dt><dd className="mz-num"><MoneyValue value={num(order.overheadCost)} /></dd></div>
              <div><dt className="text-ink-muted">إجمالي الإنتاج تحت التشغيل</dt><dd className="mz-num"><MoneyValue value={num(order.wipTotal)} /></dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function WorkOrdersScreen() {
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
    { key: "all", label: "الكل", count: orders.length },
    ...(Object.keys(STATUS_LABEL) as WorkOrderStatusRecord[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<WorkOrderRecord>[] = [
    { key: "number", header: "رقم أمر العمل", render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "product", header: "المنتج النهائي", render: (o) => itemName(o.productItemId) },
    {
      key: "progress",
      header: "الإنتاج",
      align: "end",
      render: (o) => (
        <span className="mz-num">
          {o.producedQty}/{o.plannedQty} · {pct(o.progress)}
        </span>
      ),
    },
    { key: "priority", header: "الأولوية", render: (o) => PRIORITY_LABEL[o.priority] },
    { key: "status", header: "الحالة", render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
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
      setFormError(err instanceof Error ? err.message : "تعذّر إنشاء أمر التصنيع.");
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
      setActionError(err instanceof Error ? err.message : "تعذّر تنفيذ العملية.");
    }
  }

  async function confirmReceive() {
    if (!selected) return;
    setActionError(null);
    try {
      await receiveOrder.mutateAsync({ id: selected.id, body: { producedQty: String(receiveQty) } });
      setReceivePanelOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر استلام المنتج.");
    }
  }

  const advancing = startOrder.isPending || issueOrder.isPending || completeOrder.isPending;

  const createPanel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="أمر عمل جديد" description="اختر قائمة المواد والكمية المخططة">
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker label="قائمة المواد *" value={bom} onChange={setBom} options={bomOptions} placeholder="اختر قائمة المواد…" />
        <NumberField label="الكمية المخططة" value={plannedQty} min={0} onChange={setPlannedQty} />
        <EntityPicker label="مستودع الخامات *" value={sourceWarehouse} onChange={setSourceWarehouse} options={warehouseOptions} placeholder="اختر المستودع…" />
        <EntityPicker
          label="مستودع المنتجات *"
          value={destinationWarehouse}
          onChange={setDestinationWarehouse}
          options={warehouseOptions}
          placeholder="اختر المستودع…"
        />
        <SelectField
          label="الأولوية"
          value={priority}
          onChange={(v) => setPriority(v as "low" | "normal" | "high")}
          options={[
            { value: "low", label: "منخفضة" },
            { value: "normal", label: "عادية" },
            { value: "high", label: "عالية" },
          ]}
        />
        <TextField label="تاريخ البدء" value={scheduledStartDate} onChange={setScheduledStartDate} placeholder="YYYY-MM-DD" />
        <TextField label="تاريخ الانتهاء المتوقع" value={scheduledEndDate} onChange={setScheduledEndDate} placeholder="YYYY-MM-DD" />
        <TextField label="ملاحظات" value={notes} onChange={setNotes} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createOrder.isPending}>
            حفظ أمر العمل
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  const receivePanel = (
    <SidePanel open={receivePanelOpen} onClose={() => setReceivePanelOpen(false)} title="استلام المنتج" description="أدخل الكمية المنتجة فعلياً">
      <div className="flex flex-col gap-[14px]">
        {actionError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {actionError}
          </div>
        ) : null}
        <NumberField label="الكمية المنتجة" value={receiveQty} min={0} onChange={setReceiveQty} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setReceivePanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={confirmReceive} disabled={receiveOrder.isPending || receiveQty <= 0}>
            تأكيد الاستلام
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل أوامر التصنيع.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<WorkOrderRecord>
        eyebrow="Manufacturing · Work Orders"
        title="أوامر التصنيع"
        description="تنفيذ دورة إنتاج مقابل قائمة مواد — صرف الخامات، تتبّع التكلفة تحت التشغيل، استلام المنتج التام"
        actions={
          <Button variant="primary" onClick={openCreate}>
            أمر عمل جديد
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{orders.length}</span> },
          { label: "مخطط", value: <span className="mz-num">{orders.filter((o) => o.status === "planned").length}</span> },
          { label: "جار التنفيذ", value: <span className="mz-num">{orders.filter((o) => o.status === "in_progress").length}</span> },
          { label: "متأخر", value: <span className="mz-num">{overdueCount}</span>, valueTone: overdueCount > 0 ? "danger" : "default" },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as WorkOrderStatusRecord | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث في أوامر العمل…"
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        onRowClick={(o) => setSelectedId(o.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{orders.length}</span> أمر</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد أوامر تصنيع مطابقة — أنشئ أمراً جديداً"}
          </div>
        }
      />
      {createPanel}
      {receivePanel}
    </>
  );
}
