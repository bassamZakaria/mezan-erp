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
} from "@mezan/ui";
import type { PurchaseOrderDTO, PurchaseOrderLineDTO, PurchaseOrderStatusDTO } from "@mezan/contracts";
import { useConfirmPurchaseOrder, useCreatePurchaseOrder, useItems, usePurchaseOrders, useSuppliers } from "../data/hooks";
import { useUnitLabel } from "../lib/item-labels";
import { TextField, NumberField } from "../settings/form-controls";

const STATUS_LABEL: Record<PurchaseOrderStatusDTO, string> = {
  draft: "مسودة",
  sent: "مرسل",
  partially_received: "مستلم جزئياً",
  fully_received: "مستلم بالكامل",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<PurchaseOrderStatusDTO, PillTone> = {
  draft: "neutral",
  sent: "info",
  partially_received: "warning",
  fully_received: "success",
  cancelled: "danger",
};

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
}: {
  order: PurchaseOrderDTO;
  supplierName: (id: string) => string;
  itemName: (id: string) => string;
  onBack: () => void;
  onConfirm: () => void;
}) {
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
        { label: "الإجمالي", value: <MoneyValue value={num(order.subtotal)} /> },
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
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty}</td>
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
      ]}
    />
  );
}

export function PurchaseOrdersScreen() {
  const query = usePurchaseOrders();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createOrder = useCreatePurchaseOrder();
  const confirmOrder = useConfirmPurchaseOrder();

  const orders = query.data ?? [];
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

  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
  const unitLabel = useUnitLabel();
  const itemOptions: EntityPickerOption[] = items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: unitLabel(i.baseUnitCode) }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", qty: 1, unitPrice: 0 }]);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = orders.find((o) => o.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter !== "all") rows = rows.filter((o) => o.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((o) => o.number.toLowerCase().includes(q) || supplierName(o.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [orders, statusFilter, search, supplierName]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: orders.length },
    ...(Object.keys(STATUS_LABEL) as PurchaseOrderStatusDTO[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: orders.filter((o) => o.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<PurchaseOrderDTO>[] = [
    { key: "number", header: "رقم الأمر", render: (o) => <span className="mz-num font-semibold text-ink">{o.number}</span> },
    { key: "supplier", header: "المورد", render: (o) => supplierName(o.supplierId) },
    { key: "date", header: "التاريخ", render: (o) => <span className="mz-num">{o.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: "الإجمالي", align: "end", render: (o) => <MoneyValue value={num(o.subtotal)} /> },
    { key: "status", header: "الحالة", render: (o) => <StatusPill label={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /> },
  ];

  function openCreate() {
    setSupplier(null);
    setDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setLines([{ itemId: "", qty: 1, unitPrice: 0 }]);
    setFormError(null);
    setPanelOpen(true);
  }

  async function confirmSelected(id: string) {
    try {
      await confirmOrder.mutateAsync(id);
    } catch {
      // The list/detail re-render from the failed mutation's settled cache; nothing further to do here.
    }
  }

  const draftSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const canSave = supplier !== null && lines.some((l) => l.itemId !== "" && l.qty > 0);

  async function save() {
    if (!supplier) return;
    setFormError(null);
    try {
      await createOrder.mutateAsync({
        id: crypto.randomUUID(),
        supplierId: supplier.id,
        date,
        branchId: "MAIN",
        warehouseId: "MAIN-WH",
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: lines
          .filter((l) => l.itemId !== "" && l.qty > 0)
          .map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitPrice: String(l.unitPrice || 0) })),
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر حفظ أمر الشراء.");
    }
  }

  const form = (
    <div className="flex flex-col gap-[14px]">
      {formError ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {formError}
        </div>
      ) : null}
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
                const item = items.find((it) => it.id === opt?.id);
                setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "", unitPrice: item?.costPrice ? Number(item.costPrice) : l.unitPrice } : l)));
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
        <OrderDetail order={selected} supplierName={supplierName} itemName={itemName} onBack={() => setSelectedId(null)} onConfirm={() => confirmSelected(selected.id)} />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل أوامر الشراء.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<PurchaseOrderDTO>
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
          { label: "إجمالي القيمة", value: <MoneyValue value={orders.reduce((sum, o) => sum + num(o.subtotal), 0)} showUnit={false} /> },
          { label: "مستلم بالكامل", value: <span className="mz-num">{orders.filter((o) => o.status === "fully_received").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseOrderStatusDTO | "all")}
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
