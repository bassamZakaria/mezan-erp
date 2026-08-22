import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  Chip,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
} from "@mezan/ui";
import {
  Money,
  Qty,
  buildInvoiceLinesFromReceipt,
  purchaseInvoiceSubtotal,
  purchaseInvoiceTax,
  purchaseInvoiceTotal,
  purchaseInvoiceLineBase,
  purchaseInvoiceLineTax,
  type PurchaseInvoice,
  type PurchaseInvoiceStatus,
  type PurchaseInvoiceLine,
} from "@mezan/domain";
import { demoSuppliers } from "../partners-sample-data";
import {
  demoPurchaseInvoices,
  demoGoodsReceipts,
  demoPurchaseItems,
  itemName,
  supplierName,
} from "../purchasing-sample-data";
import { TextField, NumberField } from "../settings/form-controls";

const STATUS_LABEL: Record<PurchaseInvoiceStatus, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<PurchaseInvoiceStatus, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

const num = (m: Money) => Number(m.toString());
const taxRateFor = (itemId: string) => demoPurchaseItems.find((i) => i.id === itemId)?.taxRatePercent ?? 0;

const supplierOptions: EntityPickerOption[] = demoSuppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
const itemOptions: EntityPickerOption[] = demoPurchaseItems.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.unit }));
const confirmedReceipts = demoGoodsReceipts.filter((r) => r.status === "confirmed" && !r.invoiced);
const receiptOptions: EntityPickerOption[] = confirmedReceipts.map((r) => ({
  id: r.id,
  label: `${r.number} · ${supplierName(r.supplierId)}`,
  sublabel: r.date,
}));

let nextSeq = demoPurchaseInvoices.length + 1;

interface DraftLine {
  itemId: string;
  kind: "inventory" | "expense";
  qty: number;
  unitCost: number;
  taxRatePercent: number;
  description: string;
}

function InvoiceDetail({ invoice, onBack, onConfirm }: { invoice: PurchaseInvoice; onBack: () => void; onConfirm: () => void }) {
  return (
    <DocumentDetail
      title={`فاتورة مشتريات ${invoice.number}`}
      statusLabel={STATUS_LABEL[invoice.status]}
      statusTone={STATUS_TONE[invoice.status]}
      subtitle={`${supplierName(invoice.supplierId)} · ${invoice.date.split("-").reverse().join("/")}`}
      actions={
        <>
          {invoice.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              تأكيد الفاتورة
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع لفواتير المشتريات</Button>
        </>
      }
      summary={[
        { label: "المورد", value: supplierName(invoice.supplierId) },
        { label: "التاريخ", value: invoice.date.split("-").reverse().join("/") },
        { label: "تاريخ الاستحقاق", value: invoice.dueDate?.split("-").reverse().join("/") ?? "—" },
        { label: "رقم فاتورة المورد", value: invoice.supplierInvoiceNumber ?? "—" },
        { label: "المصدر", value: invoice.receiptId ? "من إيصال استلام" : "إدخال يدوي" },
        { label: "الإجمالي الكلي", value: <MoneyValue value={num(purchaseInvoiceTotal(invoice))} /> },
      ]}
      effects={[
        invoice.receiptId
          ? "تمّت إضافة الأصناف للمخزون سابقاً عند إيصال الاستلام — لا تُضاف مرة أخرى (تجنّب الازدواج)."
          : "تُضاف الأصناف المخزنية إلى المخزون في المستودع (فاتورة يدوية بدون إيصال).",
        "يزيد المستحق للمورد بقيمة الفاتورة شاملة الضريبة (قيد: مدين المخزون + ضريبة المدخلات / دائن الموردون).",
        "لا يوجد دفع تلقائي — استخدم صرف دفعة لتسجيل السداد لاحقاً.",
      ]}
      tabs={[
        {
          key: "lines",
          label: `البنود (${invoice.lines.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-start">النوع</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية</th>
                    <th className="px-[12px] py-[9px] text-end">تكلفة الوحدة</th>
                    <th className="px-[12px] py-[9px] text-end">ضريبة %</th>
                    <th className="px-[12px] py-[9px] text-end">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{l.kind === "expense" ? (l.description ?? "مصروف") : itemName(l.itemId)}</td>
                      <td className="px-[12px] py-[10px]">{l.kind === "inventory" ? "مخزني" : "مصروف شحن"}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.qty.toString()}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.taxRatePercent}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(purchaseInvoiceLineBase(l).add(purchaseInvoiceLineTax(l)))} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-[12px] py-[10px]" colSpan={5}>المجموع الفرعي / الضريبة / الإجمالي</td>
                    <td className="px-[12px] py-[10px] text-end">
                      <div><MoneyValue value={num(purchaseInvoiceSubtotal(invoice))} showUnit={false} /></div>
                      <div className="text-ink-muted"><MoneyValue value={num(purchaseInvoiceTax(invoice))} showUnit={false} /></div>
                      <div><MoneyValue value={num(purchaseInvoiceTotal(invoice))} showUnit={false} /></div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ),
        },
      ]}
    />
  );
}

export function PurchaseInvoicesScreen() {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>(demoPurchaseInvoices);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseInvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [method, setMethod] = useState<"manual" | "from-receipt">("manual");
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [pickedReceipt, setPickedReceipt] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState("2026-08-21");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }]);

  const selected = invoices.find((inv) => inv.id === selectedId) ?? null;

  // create-from-receipt auto-fill.
  const receiptLines: PurchaseInvoiceLine[] = useMemo(() => {
    const receipt = confirmedReceipts.find((r) => r.id === pickedReceipt?.id);
    return receipt ? buildInvoiceLinesFromReceipt(receipt, taxRateFor) : [];
  }, [pickedReceipt]);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== "all") rows = rows.filter((inv) => inv.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((inv) => inv.number.toLowerCase().includes(q) || supplierName(inv.supplierId).includes(search.trim()));
    }
    return [...rows].sort((a, b) => b.number.localeCompare(a.number));
  }, [invoices, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: invoices.length },
    ...(Object.keys(STATUS_LABEL) as PurchaseInvoiceStatus[]).map((s) => ({
      key: s,
      label: STATUS_LABEL[s],
      count: invoices.filter((inv) => inv.status === s).length,
    })),
  ];

  const columns: DocumentListColumn<PurchaseInvoice>[] = [
    { key: "number", header: "رقم الفاتورة", render: (inv) => <span className="mz-num font-semibold text-ink">{inv.number}</span> },
    { key: "supplier", header: "المورد", render: (inv) => supplierName(inv.supplierId) },
    { key: "date", header: "التاريخ", render: (inv) => <span className="mz-num">{inv.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: "الإجمالي", align: "end", render: (inv) => <MoneyValue value={num(purchaseInvoiceTotal(inv))} /> },
    { key: "status", header: "الحالة", render: (inv) => <StatusPill label={STATUS_LABEL[inv.status]} tone={STATUS_TONE[inv.status]} /> },
  ];

  function openCreate() {
    setMethod("manual");
    setSupplier(null);
    setPickedReceipt(null);
    setDate("2026-08-21");
    setSupplierInvoiceNumber("");
    setLines([{ itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }]);
    setPanelOpen(true);
  }

  function confirmSelected(id: string) {
    setInvoices((prev) => prev.map((inv) => (inv.id === id && inv.status === "draft" ? { ...inv, status: "confirmed" } : inv)));
  }

  function save() {
    let invoiceLines: PurchaseInvoiceLine[];
    let supplierId: string;
    let receiptId: string | null = null;

    if (method === "from-receipt") {
      const receipt = confirmedReceipts.find((r) => r.id === pickedReceipt?.id);
      if (!receipt || receiptLines.length === 0) return;
      invoiceLines = receiptLines;
      supplierId = receipt.supplierId;
      receiptId = receipt.id;
    } else {
      if (!supplier) return;
      const usable = lines.filter((l) => l.qty > 0 && (l.kind === "expense" || l.itemId !== ""));
      if (usable.length === 0) return;
      invoiceLines = usable.map((l) => ({
        itemId: l.kind === "expense" ? null : l.itemId,
        description: l.description.trim() === "" ? null : l.description.trim(),
        kind: l.kind,
        qty: Qty.fromMajor(String(l.qty)),
        unitCost: Money.fromMajor(String(l.unitCost || 0)),
        taxRatePercent: l.taxRatePercent,
      }));
      supplierId = supplier.id;
    }

    const invoice: PurchaseInvoice = {
      id: `pi-${nextSeq}`,
      number: `PI-${String(nextSeq).padStart(6, "0")}`,
      supplierId,
      date,
      dueDate: null,
      supplierInvoiceNumber: supplierInvoiceNumber.trim() === "" ? null : supplierInvoiceNumber.trim(),
      branchId: "MAIN",
      warehouseId: "MAIN-WH",
      currency: "EGP",
      notes: null,
      receiptId,
      lines: invoiceLines,
      status: "draft",
      createdBy: "محمد الشهابي",
      createdAt: new Date().toISOString(),
    };
    nextSeq += 1;
    setInvoices((prev) => [invoice, ...prev]);
    setPanelOpen(false);
  }

  const manualSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
  const canSave = method === "from-receipt" ? pickedReceipt !== null && receiptLines.length > 0 : supplier !== null && lines.some((l) => l.qty > 0 && (l.kind === "expense" || l.itemId !== ""));

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="فاتورة مشتريات جديدة" description="إدخال يدوي أو من إيصال استلام مؤكد">
      <div className="flex flex-col gap-[14px]">
        <div className="flex flex-col gap-[6px]">
          <span className="text-[12.5px] font-semibold text-ink">طريقة الإنشاء</span>
          <div className="flex gap-[8px]">
            <Chip type="button" active={method === "manual"} onClick={() => setMethod("manual")}>إنشاء فاتورة جديدة</Chip>
            <Chip type="button" active={method === "from-receipt"} onClick={() => setMethod("from-receipt")}>من إيصال استلام</Chip>
          </div>
        </div>

        {method === "from-receipt" ? (
          <>
            <EntityPicker label="إيصال الاستلام *" value={pickedReceipt} onChange={setPickedReceipt} options={receiptOptions} placeholder="اختر إيصالاً مؤكداً…" emptyMessage="لا توجد إيصالات غير مفوترة" />
            {receiptLines.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-[12px]">
                <div className="mb-[8px] text-[12.5px] font-semibold text-ink">البنود (معبأة تلقائياً من الإيصال)</div>
                <table className="w-full border-collapse text-[12.5px]">
                  <tbody>
                    {receiptLines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td className="py-[7px]">{itemName(l.itemId)}</td>
                        <td className="mz-num py-[7px] text-end">{l.qty.toString()}</td>
                        <td className="py-[7px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                        <td className="mz-num py-[7px] text-end">{l.taxRatePercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <EntityPicker label="المورد *" value={supplier} onChange={setSupplier} options={supplierOptions} placeholder="اختر المورد…" />
            {lines.map((line, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
                <div className="mb-[8px] flex gap-[8px]">
                  <Chip type="button" active={line.kind === "inventory"} onClick={() => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, kind: "inventory" } : l)))}>مخزني</Chip>
                  <Chip type="button" active={line.kind === "expense"} onClick={() => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, kind: "expense", taxRatePercent: 0 } : l)))}>مصروف شحن</Chip>
                </div>
                {line.kind === "inventory" ? (
                  <EntityPicker
                    label="الصنف"
                    value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                    onChange={(opt) => {
                      const item = demoPurchaseItems.find((it) => it.id === opt?.id);
                      setLines((prev) => prev.map((l, j) => (j === i ? { ...l, itemId: opt?.id ?? "", unitCost: item ? Number(item.defaultCost) : l.unitCost, taxRatePercent: item?.taxRatePercent ?? l.taxRatePercent } : l)));
                    }}
                    options={itemOptions}
                    placeholder="اختر صنفاً…"
                  />
                ) : (
                  <TextField label="وصف المصروف" value={line.description} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, description: v } : l)))} placeholder="شحن / جمارك…" />
                )}
                <div className="mt-[10px] grid grid-cols-3 gap-[8px]">
                  <NumberField label="الكمية" value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                  <NumberField label="التكلفة" value={line.unitCost} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitCost: v } : l)))} />
                  <NumberField label="ضريبة %" value={line.taxRatePercent} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, taxRatePercent: v } : l)))} />
                </div>
                {lines.length > 1 ? (
                  <div className="mt-[8px] flex justify-end">
                    <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>حذف البند</Button>
                  </div>
                ) : null}
              </div>
            ))}
            <Button onClick={() => setLines((prev) => [...prev, { itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }])}>إضافة صنف</Button>
            <div className="flex items-center justify-between border-t border-border pt-[10px]">
              <span className="text-[12.5px] text-ink-muted">المجموع الفرعي (قبل الضريبة)</span>
              <MoneyValue value={manualSubtotal} />
            </div>
          </>
        )}

        <TextField label="التاريخ" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label="رقم فاتورة المورد" value={supplierInvoiceNumber} onChange={setSupplierInvoiceNumber} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>حفظ مسودة</Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <InvoiceDetail invoice={selected} onBack={() => setSelectedId(null)} onConfirm={() => confirmSelected(selected.id)} />
        {panel}
      </>
    );
  }

  return (
    <>
      <DocumentList<PurchaseInvoice>
        eyebrow="Purchases · Invoices"
        title="فواتير المشتريات"
        description="فاتورة المورد — تزيد المخزون والمستحق للمورد وتسجّل الضريبة عند التأكيد"
        actions={
          <Button variant="primary" onClick={openCreate}>
            فاتورة مشتريات جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي الفواتير", value: <span className="mz-num">{invoices.length}</span> },
          { label: "مؤكدة", value: <span className="mz-num">{invoices.filter((inv) => inv.status === "confirmed").length}</span> },
          { label: "إجمالي المشتريات", value: <MoneyValue value={invoices.reduce((sum, inv) => sum + num(purchaseInvoiceTotal(inv)), 0)} showUnit={false} /> },
          { label: "مسودة", value: <span className="mz-num">{invoices.filter((inv) => inv.status === "draft").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseInvoiceStatus | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الفاتورة أو اسم المورد…"
        columns={columns}
        rows={filtered}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => setSelectedId(inv.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{invoices.length}</span> فاتورة</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فواتير مطابقة</div>}
      />
      {panel}
    </>
  );
}
