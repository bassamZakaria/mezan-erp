import { useMemo, useState } from "react";
import {
  Button,
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
} from "@mezan/ui";
import {
  Money,
  Qty,
  purchaseOrderSubtotal,
  purchaseOrderLineTotal,
  lineOutstandingQty,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from "@mezan/domain";
import { demoSuppliers } from "../partners-sample-data";
import {
  demoPurchaseOrders,
  demoPurchaseItems,
  itemName,
  supplierName,
} from "../purchasing-sample-data";
import { TextField, NumberField } from "../settings/form-controls";

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "مسودة",
  sent: "مرسل",
  partially_received: "مستلم جزئياً",
  fully_received: "مستلم بالكامل",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<PurchaseOrderStatus, PillTone> = {
  draft: "neutral",
  sent: "info",
  partially_received: "warning",
  fully_received: "success",
  cancelled: "danger",
};

const num = (m: Money) => Number(m.toString());
const supplierOptions: EntityPickerOption[] = demoSuppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
const itemOptions: EntityPickerOption[] = demoPurchaseItems.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.unit }));

interface DraftLine {
  itemId: string;
  qty: number;
  unitPrice: number;
}

let nextSeq = demoPurchaseOrders.length + 1;

function OrderDetail({ order, onBack, onConfirm }: { order: PurchaseOrder; onBack: () => void; onConfirm: () => void }) {
  return (
    <DocumentDetail
      title={`أمر شراء ${order.number}`}
      statusLabel={STATUS_LABEL[order.status]}
      statusTone={STATUS_TONE[order.status]}
      subtitle={`${supplierName(order.supplierId)} · ${order.date.split("-").reverse().join("/")}`}
      actions={
        <>
          {order.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              تأكيد وإرسال
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لأوامر الشراء</Button>
        </>
      }
      summary={[
        { label: "المورد", value: supplierName(order.supplierId) },
        { label: "التاريخ", value: order.date.split("-").reverse().join("/") },
        { label: "التسليم المتوقع", value: order.expectedDeliveryDate?.split("-").reverse().join("/") ?? "—" },
        { label: "المستودع", value: order.warehouseId },
        { label: "الإجمالي", value: <MoneyValue value={num(purchaseOrderSubtotal(order))} /> },
        { label: "أنشئ بواسطة", value: order.createdBy },
      ]}
      effects={[
        "لا يؤثر أمر الشراء على المخزون أو الحسابات — يسجّل التزاماً بالشراء لدى المورد فقط.",
        "عند تأكيد إيصال الاستلام المرتبط تزيد كمية المخزون (استلام البضاعة).",
        "عند تأكيد فاتورة المشتريات يزيد المستحق للمورد وتُسجّل الضريبة.",
      ]}
      tabs={[
        {
          key: "lines",
          label: `البنود (${order.lines.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية</th>
                    <th className="px-[12px] py-[9px] text-end">سعر الوحدة</th>
                    <th className="px-[12px] py-[9px] text-end">مستلم</th>
                    <th className="px-[12px] py-[9px] text-end">المتبقي</th>
                    <th className="px-[12px] py-[9px] text-end">إجمالي البند</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty.toString()}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitPrice)} showUnit={false} /></td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.receivedQty.toString()}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{lineOutstandingQty(l).toString()}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(purchaseOrderLineTotal(l))} showUnit={false} /></td>
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
  const [orders, setOrders] = useState<PurchaseOrder[]>(demoPurchaseOrders);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState("2026-08-21");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, unitPrice: 0 }]);

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || supplierName(o.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [orders, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: orders.length },
    ...(Object.keys(STATUS_LABEL) as PurchaseOrderStatus[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<PurchaseOrder>[] = [
    { key: "number", header: "رقم الأمر", render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "supplier", header: "المورد", render: (o) => supplierName(o.supplierId) },
    { key: "date", header: "التاريخ", render: (o) => <span className="mz-num">{o.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: "الإجمالي", align: "end", render: (o) => <MoneyValue value={num(purchaseOrderSubtotal(o))} /> },
    { key: "status", header: "الحالة", render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
  ];

  function openCreate() {
    setSupplier(null);
    setDate("2026-08-21");
    setNotes("");
    setLines([{ itemId: "", qty: 1, unitPrice: 0 }]);
    setPanelOpen(true);
  }

  function confirmSelected(id: string) {
    setOrders((prev) => prev.map((o) => (o.id === id && o.status === "draft" ? { ...o, status: "sent" } : o)));
  }

  const draftSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const canSave = supplier !== null && lines.some((l) => l.itemId !== "" && l.qty > 0);

  function save() {
    if (!supplier) return;
    const order: PurchaseOrder = {
      id: `po-${nextSeq}`,
      number: `PO-${String(nextSeq).padStart(6, "0")}`,
      supplierId: supplier.id,
      date,
      expectedDeliveryDate: null,
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      currency: "EGP",
      notes: notes.trim() === "" ? null : notes.trim(),
      lines: lines
        .filter((l) => l.itemId !== "" && l.qty > 0)
        .map((l) => ({
          itemId: l.itemId,
          description: null,
          qty: Qty.fromMajor(String(l.qty)),
          unitPrice: Money.fromMajor(String(l.unitPrice || 0)),
          receivedQty: Qty.zero(),
        })),
      status: "draft",
      createdBy: "محمد الشهابي",
      createdAt: new Date().toISOString(),
    };
    nextSeq += 1;
    setOrders((prev) => [order, ...prev]);
    setPanelOpen(false);
  }

  const form = (
    <div className="flex flex-col gap-[14px]">
      <EntityPicker label="المورد *" value={supplier} onChange={setSupplier} options={supplierOptions} placeholder="اختر المورد…" />
      <TextField label="التاريخ" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
      <div className="flex flex-col gap-[10px]">
        <span className="text-[12.5px] font-semibold text-ink">بنود أمر الشراء</span>
        {lines.map((line, i) => (
          <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
            <EntityPicker
              label="الصنف"
              value={itemOptions.find((o) => o.id === line.itemId) ?? null}
              onChange={(opt) => {
                const item = demoPurchaseItems.find((it) => it.id === opt?.id);
                setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "", unitPrice: item ? Number(item.defaultCost) : l.unitPrice } : l)));
              }}
              options={itemOptions}
              placeholder="اختر صنفاً…"
            />
            <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
              <NumberField label="الكمية" value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
              <NumberField label="سعر الوحدة" value={line.unitPrice} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: v } : l)))} />
            </div>
            {lines.length > 1 ? (
              <div className="mt-[8px] flex justify-end">
                <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>حذف البند</Button>
              </div>
            ) : null}
          </div>
        ))}
        <Button onClick={() => setLines((prev) => [...prev, { itemId: "", qty: 1, unitPrice: 0 }])}>إضافة صنف</Button>
      </div>
      <TextField label="ملاحظات" value={notes} onChange={setNotes} />
      <div className="flex items-center justify-between border-t border-border pt-[12px]">
        <span className="text-[12.5px] text-ink-muted">الإجمالي</span>
        <MoneyValue value={draftSubtotal} />
      </div>
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
        <Button variant="primary" onClick={save} disabled={!canSave}>
          حفظ مسودة
        </Button>
      </div>
    </div>
  );

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="أمر شراء جديد" description="اختر المورد والأصناف والكميات">
      {form}
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <OrderDetail order={selected} onBack={() => setSelectedId(null)} onConfirm={() => confirmSelected(selected.id)} />
        {panel}
      </>
    );
  }

  return (
    <>
      <DocumentList<PurchaseOrder>
        eyebrow="Purchases · Orders"
        title="أوامر الشراء"
        description="أمر رسمي للمورد بطلب البضائع — يقود إيصالات الاستلام ثم فواتير المشتريات"
        actions={
          <Button variant="primary" onClick={openCreate}>
            أمر شراء جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الأوامر", value: <span className="mz-num">{orders.length}</span> },
          { label: "طلبات مرسلة", value: <span className="mz-num">{orders.filter((o) => o.status === "sent").length}</span> },
          { label: "إجمالي القيمة", value: <MoneyValue value={orders.reduce((sum, o) => sum + num(purchaseOrderSubtotal(o)), 0)} showUnit={false} /> },
          { label: "مستلم بالكامل", value: <span className="mz-num">{orders.filter((o) => o.status === "fully_received").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseOrderStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الأمر أو اسم المورد…"
        columns={columns}
        rows={filtered}
        rowKey={(o) => o.id}
        onRowClick={(o) => setSelectedId(o.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{orders.length}</span> أمر</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أوامر شراء مطابقة</div>}
      />
      {panel}
    </>
  );
}
