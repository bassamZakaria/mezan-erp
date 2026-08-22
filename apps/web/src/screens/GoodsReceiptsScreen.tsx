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
  buildReceiptLinesFromOrder,
  goodsReceiptTotalCost,
  type GoodsReceipt,
  type GoodsReceiptStatus,
  type GoodsReceiptLine,
} from "@mezan/domain";
import {
  demoGoodsReceipts,
  demoPurchaseOrders,
  itemName,
  supplierName,
} from "../purchasing-sample-data";
import { TextField } from "../settings/form-controls";

const STATUS_LABEL: Record<GoodsReceiptStatus, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<GoodsReceiptStatus, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

const num = (m: Money) => Number(m.toString());

/** Only sent / partially-received POs can be received against (docs/catalog/02). */
const receivableOrders = demoPurchaseOrders.filter((o) => o.status === "sent" || o.status === "partially_received");
const orderOptions: EntityPickerOption[] = receivableOrders.map((o) => ({
  id: o.id,
  label: `${o.number} · ${supplierName(o.supplierId)}`,
  sublabel: o.date,
}));

let nextSeq = demoGoodsReceipts.length + 1;

function ReceiptDetail({ receipt, onBack, onConfirm }: { receipt: GoodsReceipt; onBack: () => void; onConfirm: () => void }) {
  const order = demoPurchaseOrders.find((o) => o.id === receipt.purchaseOrderId);
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
        { label: "إجمالي التكلفة", value: <MoneyValue value={num(goodsReceiptTotalCost(receipt))} /> },
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
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty.toString()}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost) * Number(l.qty.toString())} showUnit={false} /></td>
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
  const [receipts, setReceipts] = useState<GoodsReceipt[]>(demoGoodsReceipts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GoodsReceiptStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [pickedOrder, setPickedOrder] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState("2026-08-21");

  const selected = receipts.find((r) => r.id === selectedId) ?? null;

  // create-from-PO auto-fill: lines come from the chosen PO's outstanding qty.
  const autoLines: GoodsReceiptLine[] = useMemo(() => {
    const order = demoPurchaseOrders.find((o) => o.id === pickedOrder?.id);
    return order ? buildReceiptLinesFromOrder(order) : [];
  }, [pickedOrder]);

  const filtered = useMemo(() => {
    let rows = receipts;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q) || supplierName(r.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [receipts, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: receipts.length },
    ...(Object.keys(STATUS_LABEL) as GoodsReceiptStatus[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: receipts.filter((r) => r.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<GoodsReceipt>[] = [
    { key: "number", header: "رقم الإيصال", render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    { key: "supplier", header: "المورد", render: (r) => supplierName(r.supplierId) },
    { key: "order", header: "أمر الشراء", render: (r) => <span className="mz-num">{demoPurchaseOrders.find((o) => o.id === r.purchaseOrderId)?.number ?? "—"}</span> },
    { key: "total", header: "إجمالي التكلفة", align: "end", render: (r) => <MoneyValue value={num(goodsReceiptTotalCost(r))} /> },
    { key: "invoiced", header: "حالة الفاتورة", render: (r) => <StatusPill label={r.invoiced ? "مفوتر" : "غير مفوتر"} tone={r.invoiced ? "success" : "neutral"} /> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  function openCreate() {
    setPickedOrder(null);
    setDate("2026-08-21");
    setPanelOpen(true);
  }

  function confirmSelected(id: string) {
    setReceipts((prev) => prev.map((r) => (r.id === id && r.status === "draft" ? { ...r, status: "confirmed" } : r)));
  }

  function save() {
    const order = demoPurchaseOrders.find((o) => o.id === pickedOrder?.id);
    if (!order || autoLines.length === 0) return;
    const receipt: GoodsReceipt = {
      id: `gr-${nextSeq}`,
      number: `GR-${String(nextSeq).padStart(6, "0")}`,
      purchaseOrderId: order.id,
      supplierId: order.supplierId,
      warehouseId: order.warehouseId,
      date,
      notes: null,
      lines: autoLines,
      status: "draft",
      invoiced: false,
      createdBy: "محمد الشهابي",
      createdAt: new Date().toISOString(),
    };
    nextSeq += 1;
    setReceipts((prev) => [receipt, ...prev]);
    setPanelOpen(false);
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إيصال استلام جديد" description="الاستلام يبدأ دائماً من أمر شراء مؤكد">
      <div className="flex flex-col gap-[14px]">
        <div role="note" className="rounded-md border border-info bg-info-soft px-[12px] py-[10px] text-[12px] text-info-ink">
          إيصال مسودة — أكّده لاحقاً ليثبت البضاعة في المخزون. الضريبة تُسجّل عند فاتورة المشتريات المطابقة.
        </div>
        <EntityPicker label="أمر الشراء *" value={pickedOrder} onChange={setPickedOrder} options={orderOptions} placeholder="اختر أمر شراء مؤكد…" emptyMessage="لا توجد أوامر قابلة للاستلام" />
        <TextField label="تاريخ الاستلام" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        {autoLines.length > 0 ? (
          <div className="rounded-lg border border-border bg-surface p-[12px]">
            <div className="mb-[8px] text-[12.5px] font-semibold text-ink">البنود (معبأة تلقائياً من أمر الشراء)</div>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {autoLines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-b-0">
                    <td className="py-[7px]">{itemName(l.itemId)}</td>
                    <td className="mz-num py-[7px] text-end">{l.qty.toString()}</td>
                    <td className="py-[7px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!pickedOrder || autoLines.length === 0}>
            حفظ مسودة
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <ReceiptDetail receipt={selected} onBack={() => setSelectedId(null)} onConfirm={() => confirmSelected(selected.id)} />
        {panel}
      </>
    );
  }

  return (
    <>
      <DocumentList<GoodsReceipt>
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
          { label: "إجمالي القيمة", value: <MoneyValue value={receipts.reduce((sum, r) => sum + num(goodsReceiptTotalCost(r)), 0)} showUnit={false} /> },
          { label: "غير مفوترة", value: <span className="mz-num">{receipts.filter((r) => !r.invoiced).length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as GoodsReceiptStatus | "all")}
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
