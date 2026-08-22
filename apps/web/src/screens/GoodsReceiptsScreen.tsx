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
import type { GoodsReceiptDTO, GoodsReceiptStatusDTO } from "@mezan/contracts";
import { useConfirmGoodsReceipt, useCreateGoodsReceipt, useGoodsReceipts, useItems, usePurchaseOrders, useSuppliers } from "../data/hooks";
import { TextField } from "../settings/form-controls";

const STATUS_LABEL: Record<GoodsReceiptStatusDTO, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  cancelled: "ملغي",
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
  return (
    <DocumentDetail
      title={`إيصال استلام ${receipt.number}`}
      statusLabel={STATUS_LABEL[receipt.status]}
      statusTone={STATUS_TONE[receipt.status]}
      subtitle={`${supplierName(receipt.supplierId)} · مقابل ${order?.number ?? receipt.purchaseOrderId}`}
      actions={
        <>
          {receipt.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              تأكيد الاستلام
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لإيصالات الاستلام</Button>
        </>
      }
      summary={[
        { label: "المورد", value: supplierName(receipt.supplierId) },
        { label: "أمر الشراء", value: order?.number ?? receipt.purchaseOrderId },
        { label: "التاريخ", value: receipt.date.split("-").reverse().join("/") },
        { label: "المستودع", value: receipt.warehouseId },
        { label: "إجمالي التكلفة", value: <MoneyValue value={num(receipt.totalCost)} /> },
        { label: "حالة الفوترة", value: receipt.invoiced ? "مفوتر" : "غير مفوتر", valueTone: receipt.invoiced ? "success" : undefined },
      ]}
      effects={
        receipt.status === "confirmed"
          ? [
              "تمت زيادة كمية المخزون بأصناف هذا الإيصال في المستودع (استلام فعلي).",
              "لم تُسجّل الضريبة أو المستحق للمورد بعد — يتمّان عند فاتورة المشتريات المطابقة.",
              "تم تحديث حالة أمر الشراء (مستلم جزئياً / بالكامل).",
            ]
          : [
              "إيصال مسودة — أكّده ليثبت البضاعة في المخزون.",
              "الضريبة والمستحق للمورد يُسجّلان لاحقاً عند فاتورة المشتريات المطابقة.",
            ]
      }
      tabs={[
        {
          key: "lines",
          label: `البنود (${receipt.lines.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية المستلمة</th>
                    <th className="px-[12px] py-[9px] text-end">تكلفة الوحدة</th>
                    <th className="px-[12px] py-[9px] text-end">إجمالي البند</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(l.itemId)}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost) * Number(l.qty)} showUnit={false} /></td>
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

export function GoodsReceiptsScreen() {
  const query = useGoodsReceipts();
  const ordersQuery = usePurchaseOrders();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createReceipt = useCreateGoodsReceipt();
  const confirmReceipt = useConfirmGoodsReceipt();

  const receipts = query.data ?? [];
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

  /** Only sent / partially-received POs can be received against (docs/catalog/02). */
  const receivableOrders = orders.filter((o) => o.status === "sent" || o.status === "partially_received");
  const orderOptions: EntityPickerOption[] = receivableOrders.map((o) => ({
    id: o.id,
    label: `${o.number} · ${supplierName(o.supplierId)}`,
    sublabel: o.date,
  }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GoodsReceiptStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);

  const selected = receipts.find((r) => r.id === selectedId) ?? null;

  // create-from-PO preview only — the server auto-fills the real lines from the PO's outstanding qty on save.
  const previewLines: PreviewLine[] = useMemo(() => {
    const order = orders.find((o) => o.id === pickedOrder?.id);
    if (!order) return [];
    return order.lines
      .map((l) => ({ itemId: l.itemId, qty: Number(l.qty) - Number(l.receivedQty), unitCost: Number(l.unitPrice) }))
      .filter((l) => l.qty > 0);
  }, [pickedOrder, orders]);

  const filtered = useMemo(() => {
    let rows = receipts;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q) || supplierName(r.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [receipts, statusFilter, search, supplierName]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: receipts.length },
    ...(Object.keys(STATUS_LABEL) as GoodsReceiptStatusDTO[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: receipts.filter((r) => r.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<GoodsReceiptDTO>[] = [
    { key: "number", header: "رقم الإيصال", render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "supplier", header: "المورد", render: (r) => supplierName(r.supplierId) },
    { key: "order", header: "أمر الشراء", render: (r) => <span className="mz-num">{(r.purchaseOrderId ? orderById.get(r.purchaseOrderId)?.number : null) ?? "—"}</span> },
    { key: "total", header: "إجمالي التكلفة", align: "end", render: (r) => <MoneyValue value={num(r.totalCost)} /> },
    { key: "invoiced", header: "حالة الفاتورة", render: (r) => <StatusPill label={r.invoiced ? "مفوتر" : "غير مفوتر"} tone={r.invoiced ? "success" : "neutral"} /> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  function openCreate() {
    setPickedOrder(null);
    setDate(new Date().toISOString().slice(0, 10));
    setFormError(null);
    setPanelOpen(true);
  }

  async function confirmSelected(id: string) {
    try {
      await confirmReceipt.mutateAsync(id);
    } catch {
      // failure surfaces via the mutation's own error state on retry; nothing further to do here.
    }
  }

  async function save() {
    if (!pickedOrder || previewLines.length === 0) return;
    setFormError(null);
    try {
      await createReceipt.mutateAsync({ id: crypto.randomUUID(), purchaseOrderId: pickedOrder.id, date });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذر إنشاء إيصال الاستلام.");
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إيصال استلام جديد" description="الاستلام يبدأ دائماً من أمر شراء مؤكد">
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <div role="note" className="rounded-md border border-info bg-info-soft px-[12px] py-[10px] text-[12px] text-info-ink">
          إيصال مسودة — أكّده لاحقاً ليثبت البضاعة في المخزون. الضريبة تُسجّل عند فاتورة المشتريات المطابقة.
        </div>
        <EntityPicker label="أمر الشراء *" value={pickedOrder} onChange={setPickedOrder} options={orderOptions} placeholder="اختر أمر شراء مؤكد…" emptyMessage="لا توجد أوامر قابلة للاستلام" />
        <TextField label="تاريخ الاستلام" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        {previewLines.length > 0 ? (
          <div className="rounded-lg border border-border bg-surface p-[12px]">
            <div className="mb-[8px] text-[12.5px] font-semibold text-ink">البنود (معبأة تلقائياً من أمر الشراء)</div>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {previewLines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="py-[7px]">{itemName(l.itemId)}</td>
                    <td className="mz-num py-[7px] text-end">{l.qty}</td>
                    <td className="py-[7px] text-end"><MoneyValue value={l.unitCost} showUnit={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!pickedOrder || previewLines.length === 0}>
            حفظ مسودة
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <ReceiptDetail
          receipt={selected}
          order={selected.purchaseOrderId ? orderById.get(selected.purchaseOrderId) : undefined}
          supplierName={supplierName}
          itemName={itemName}
          onBack={() => setSelectedId(null)}
          onConfirm={() => confirmSelected(selected.id)}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل إيصالات الاستلام.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<GoodsReceiptDTO>
        eyebrow="Purchases · Goods Receipts"
        title="إيصالات الاستلام"
        description="تسجيل استلام البضائع مقابل أمر شراء مؤكد — يزيد رصيد المخزون قبل الفوترة"
        actions={
          <Button variant="primary" onClick={openCreate}>
            إيصال استلام جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الإيصالات", value: <span className="mz-num">{receipts.length}</span> },
          { label: "مؤكدة", value: <span className="mz-num">{receipts.filter((r) => r.status === "confirmed").length}</span> },
          { label: "إجمالي القيمة", value: <MoneyValue value={receipts.reduce((sum, r) => sum + num(r.totalCost), 0)} showUnit={false} /> },
          { label: "غير مفوترة", value: <span className="mz-num">{receipts.filter((r) => !r.invoiced).length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as GoodsReceiptStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الإيصال أو المورد…"
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelectedId(r.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{receipts.length}</span> إيصال</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد إيصالات استلام مطابقة</div>}
      />
      {panel}
    </>
  );
}
