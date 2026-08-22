import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  Money as MoneyValue,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import {
  workOrderWipTotal,
  workOrderProgress,
  type WorkOrder,
  type WorkOrderStatus,
  type WorkOrderStage,
} from "@mezan/domain";
import { demoWorkOrders, mfgItemName } from "../manufacturing-sample-data";

const STATUS_LABEL: Record<WorkOrderStatus, string> = {
  planned: "مخطط",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<WorkOrderStatus, PillTone> = {
  planned: "neutral",
  in_progress: "info",
  completed: "success",
  cancelled: "danger",
};
const PRIORITY_LABEL: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية" };
const num = (m: { toString(): string }) => Number(m.toString());
const pct = (f: number) => `${Math.round(f * 100)}%`;

const STAGE_STEPS = [
  { key: "started", label: "بدء العمل" },
  { key: "materials_issued", label: "صرف المواد" },
  { key: "product_received", label: "استلام المنتج" },
  { key: "completed", label: "إكمال أمر العمل" },
];
const STAGE_ACTION: Record<WorkOrderStage, { label: string } | null> = {
  not_started: { label: "بدء العمل" },
  started: { label: "صرف المواد" },
  materials_issued: { label: "استلام المنتج" },
  product_received: { label: "إكمال أمر العمل" },
  completed: null,
};
/** Map not_started onto the first step so the stepper reads before-issue. */
const stepperKey = (stage: WorkOrderStage) => (stage === "not_started" ? "started" : stage);

function WorkOrderDetail({ order, onBack, onAdvance }: { order: WorkOrder; onBack: () => void; onAdvance: () => void }) {
  const action = STAGE_ACTION[order.stage];
  const wip = workOrderWipTotal(order);
  return (
    <DocumentDetail
      title={`أمر تصنيع ${order.number}`}
      statusLabel={STATUS_LABEL[order.status]}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${mfgItemName(order.productItemId)} · ${pct(workOrderProgress(order))}`}
      actions={
        <>
          {action && order.status !== "cancelled" ? (
            <Button variant="primary" onClick={onAdvance}>
              {action.label}
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لأوامر التصنيع</Button>
        </>
      }
      summary={[
        { label: "المنتج النهائي", value: mfgItemName(order.productItemId) },
        { label: "الكمية المخططة", value: <span className="mz-num">{order.plannedQty.toString()}</span> },
        { label: "الكمية المنتجة", value: <span className="mz-num">{order.producedQty.toString()}</span> },
        { label: "مستودع الخامات", value: order.sourceWarehouseId },
        { label: "مستودع المنتجات", value: order.destinationWarehouseId },
        { label: "الأولوية", value: PRIORITY_LABEL[order.priority] },
        { label: "قيمة الإنتاج تحت التشغيل", value: <MoneyValue value={num(wip)} /> },
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
                      <td className="px-[12px] py-[10px]">{mfgItemName(m.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.requiredQty.toString()}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.issuedQty.toString()}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.returnedQty.toString()}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.issuedQty.subtract(m.returnedQty).toString()}</td>
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
              <div><dt className="text-ink-muted">إجمالي الإنتاج تحت التشغيل</dt><dd className="mz-num"><MoneyValue value={num(wip)} /></dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function WorkOrdersScreen() {
  const [orders, setOrders] = useState<WorkOrder[]>(demoWorkOrders);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | "all">("all");
  const [search, setSearch] = useState("");

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || mfgItemName(o.productItemId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [orders, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: orders.length },
    ...(Object.keys(STATUS_LABEL) as WorkOrderStatus[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<WorkOrder>[] = [
    { key: "number", header: "رقم أمر العمل", render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "product", header: "المنتج النهائي", render: (o) => mfgItemName(o.productItemId) },
    {
      key: "progress",
      header: "الإنتاج",
      align: "end",
      render: (o) => (
        <span className="mz-num">
          {o.producedQty.toString()}/{o.plannedQty.toString()} · {pct(workOrderProgress(o))}
        </span>
      ),
    },
    { key: "priority", header: "الأولوية", render: (o) => PRIORITY_LABEL[o.priority] },
    { key: "status", header: "الحالة", render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
  ];

  function advance(id: string) {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        const nextStage: Record<WorkOrderStage, WorkOrderStage> = {
          not_started: "started",
          started: "materials_issued",
          materials_issued: "product_received",
          product_received: "completed",
          completed: "completed",
        };
        const stage = nextStage[o.stage];
        const status: WorkOrderStatus = stage === "completed" ? "completed" : "in_progress";
        const producedQty = stage === "product_received" || stage === "completed" ? o.plannedQty : o.producedQty;
        return { ...o, stage, status, producedQty };
      }),
    );
  }

  if (selected) {
    return <WorkOrderDetail order={selected} onBack={() => setSelectedId(null)} onAdvance={() => advance(selected.id)} />;
  }

  const overdueCount = orders.filter(
    (o) => (o.status === "in_progress" || o.status === "planned") && o.scheduledEndDate !== null && o.scheduledEndDate < "2026-08-22",
  ).length;

  return (
    <DocumentList<WorkOrder>
      eyebrow="Manufacturing · Work Orders"
      title="أوامر التصنيع"
      description="تنفيذ دورة إنتاج مقابل قائمة مواد — صرف الخامات، تتبّع التكلفة تحت التشغيل، استلام المنتج التام"
      actions={<Button variant="primary">أمر عمل جديد</Button>}
      stats={[
        { label: "الإجمالي", value: <span className="mz-num">{orders.length}</span> },
        { label: "مخطط", value: <span className="mz-num">{orders.filter((o) => o.status === "planned").length}</span> },
        { label: "جار التنفيذ", value: <span className="mz-num">{orders.filter((o) => o.status === "in_progress").length}</span> },
        { label: "متأخر", value: <span className="mz-num">{overdueCount}</span>, valueTone: overdueCount > 0 ? "danger" : "default" },
      ]}
      statusChips={statusChips}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as WorkOrderStatus | "all")}
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
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أوامر تصنيع مطابقة</div>}
    />
  );
}
