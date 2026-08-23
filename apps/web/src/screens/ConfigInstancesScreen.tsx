import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
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
  useCancelConfigInstance,
  useCloseConfigInstance,
  useConfigInstances,
  useConfigurableProducts,
  useCreateConfigInstance,
  useCustomers,
  useItems,
  usePreviewConfigInstance,
  useWarehouses,
  type ConfigInstanceRecord,
} from "../data/hooks";
import { TextField, NumberField } from "../settings/form-controls";

type Status = ConfigInstanceRecord["status"];

const STATUS_LABEL: Record<Status, string> = {
  configured: "مهيأة",
  in_progress: "في التنفيذ",
  produced: "تم الإنتاج",
  closed: "مغلقة",
  cancelled: "ملغاة",
};
const STATUS_TONE: Record<Status, PillTone> = {
  configured: "neutral",
  in_progress: "info",
  produced: "warning",
  closed: "success",
  cancelled: "danger",
};
const num = (v: string) => Number(v);
const today = () => new Date().toISOString().slice(0, 10);

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
  const canAct = instance.status !== "closed" && instance.status !== "cancelled";
  const actualCost = instance.actualCost !== null ? num(instance.actualCost) : num(instance.estimatedUnitCost) * num(instance.qty);
  const profitMargin = num(instance.sellTotal) - actualCost;

  return (
    <DocumentDetail
      title={`أمر تصنيع مخصص ${instance.number}`}
      statusLabel={STATUS_LABEL[instance.status]}
      statusTone={STATUS_TONE[instance.status]}
      subtitle={`${productName(instance.configurableProductId)} · ${customerName(instance.customerId)}`}
      actions={
        canAct ? (
          <>
            <Button variant="primary" onClick={onClose} disabled={closing}>
              إغلاق الأمر
            </Button>
            <Button onClick={onCancel} disabled={cancelling}>
              إلغاء
            </Button>
            <Button onClick={onBack}>رجوع للتصنيع المخصص</Button>
          </>
        ) : (
          <Button onClick={onBack}>رجوع للتصنيع المخصص</Button>
        )
      }
      summary={[
        { label: "المنتج", value: productName(instance.configurableProductId) },
        { label: "العميل", value: customerName(instance.customerId) },
        { label: "الكمية", value: <span className="mz-num">{instance.qty}</span> },
        { label: "المواصفات", value: specLabel(instance.spec) },
        { label: "إجمالي البيع", value: <MoneyValue value={num(instance.sellTotal)} /> },
        { label: "هامش الربح", value: <MoneyValue value={profitMargin} />, valueTone: profitMargin < 0 ? "danger" : "success" },
      ]}
      effects={[
        "يُنشأ أمر تصنيع (Work Order) مرتبط تلقائياً عند إنشاء أمر التصنيع المخصص لتنفيذ الإنتاج الفعلي.",
        "عند إغلاق الأمر تُحفظ التكلفة الفعلية من أمر التصنيع المرتبط.",
      ]}
      tabs={[
        {
          key: "materials",
          label: `الخامات المطلوبة (${instance.materials.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-end">الكمية (للوحدة)</th>
                    <th className="px-[12px] py-[9px] text-end">نسبة الهالك</th>
                    <th className="px-[12px] py-[9px] text-end">الإجمالي</th>
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
          label: "التكلفة الفعلية",
          content: (
            <dl className="grid grid-cols-2 gap-[12px] text-[13px]">
              <div><dt className="text-ink-muted">تكلفة المواد (للوحدة)</dt><dd className="mz-num"><MoneyValue value={num(instance.materialCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">العمالة (للوحدة)</dt><dd className="mz-num"><MoneyValue value={num(instance.laborCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">المصاريف (للوحدة)</dt><dd className="mz-num"><MoneyValue value={num(instance.overheadCostPerUnit)} /></dd></div>
              <div><dt className="text-ink-muted">التكلفة التقديرية (للوحدة)</dt><dd className="mz-num"><MoneyValue value={num(instance.estimatedUnitCost)} /></dd></div>
              <div>
                <dt className="text-ink-muted">التكلفة الفعلية</dt>
                <dd className="mz-num">{instance.actualCost !== null ? <MoneyValue value={num(instance.actualCost)} /> : "—"}</dd>
              </div>
              <div><dt className="text-ink-muted">أمر التشغيل</dt><dd className="mz-num">{instance.workOrderId}</dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function ConfigInstancesScreen() {
  const query = useConfigInstances();
  const productsQuery = useConfigurableProducts();
  const itemsQuery = useItems();
  const customersQuery = useCustomers();
  const warehousesQuery = useWarehouses();
  const createInstance = useCreateConfigInstance();
  const closeInstance = useCloseConfigInstance();
  const cancelInstance = useCancelConfigInstance();
  const preview = usePreviewConfigInstance();

  const instances = query.data ?? [];
  const products = (productsQuery.data ?? []).filter((p) => p.status === "active");
  const items = itemsQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const productName = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [products]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string | null) => (id === null ? "بدون عميل" : (map.get(id) ?? id));
  }, [customers]);

  const productOptions: EntityPickerOption[] = products.map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code }));
  const customerOptions: EntityPickerOption[] = customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code }));
  const warehouseOptions: EntityPickerOption[] = warehouses.map((w) => ({ id: w.id, label: w.name, sublabel: w.code }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const [product, setProduct] = useState<EntityPickerOption | null>(null);
  const [spec, setSpec] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [customer, setCustomer] = useState<EntityPickerOption | null>(null);
  const [sellUnitPrice, setSellUnitPrice] = useState<number | null>(null);
  const [notesText, setNotesText] = useState("");
  const [sourceWarehouse, setSourceWarehouse] = useState<EntityPickerOption | null>(null);
  const [destinationWarehouse, setDestinationWarehouse] = useState<EntityPickerOption | null>(null);
  const [scheduledStartDate, setScheduledStartDate] = useState(today());
  const [scheduledEndDate, setScheduledEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedProduct = products.find((p) => p.id === product?.id) ?? null;

  useEffect(() => {
    if (!selectedProduct) return;
    if (!panelOpen) return;
    if (selectedProduct.inputs.some((i) => (spec[i.id] ?? "").trim() === "")) return;
    preview.mutate({ configurableProductId: selectedProduct.id, spec });
  }, [selectedProduct, spec, panelOpen]);

  const selected = instances.find((i) => i.id === selectedId) ?? null;

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

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: instances.length },
    { key: "configured", label: STATUS_LABEL.configured, count: instances.filter((i) => i.status === "configured").length },
    { key: "in_progress", label: STATUS_LABEL.in_progress, count: instances.filter((i) => i.status === "in_progress").length },
    { key: "produced", label: STATUS_LABEL.produced, count: instances.filter((i) => i.status === "produced").length },
    { key: "closed", label: STATUS_LABEL.closed, count: instances.filter((i) => i.status === "closed").length },
    { key: "cancelled", label: STATUS_LABEL.cancelled, count: instances.filter((i) => i.status === "cancelled").length },
  ];

  const columns: DocumentListColumn<ConfigInstanceRecord>[] = [
    { key: "number", header: "رقم الأمر", render: (i) => <span className="mz-num font-semibold text-ink">{i.number}</span> },
    { key: "product", header: "المنتج", render: (i) => productName(i.configurableProductId) },
    { key: "spec", header: "المواصفات", render: (i) => specLabel(i.spec) },
    { key: "customer", header: "العميل", render: (i) => customerName(i.customerId) },
    { key: "qty", header: "الكمية", align: "end", render: (i) => <span className="mz-num">{i.qty}</span> },
    {
      key: "price",
      header: "سعر البيع (للوحدة)",
      align: "end",
      render: (i) => (i.sellUnitPrice !== null ? <MoneyValue value={num(i.sellUnitPrice)} /> : "—"),
    },
    { key: "status", header: "الحالة", render: (i) => <StatusPill label={STATUS_LABEL[i.status]} tone={STATUS_TONE[i.status]} /> },
  ];

  function openCreate() {
    setProduct(null);
    setSpec({});
    setQty(1);
    setCustomer(null);
    setSellUnitPrice(null);
    setNotesText("");
    setSourceWarehouse(null);
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
    destinationWarehouse !== null &&
    qty > 0 &&
    (selectedProduct?.inputs.every((i) => (spec[i.id] ?? "").trim() !== "") ?? false);

  async function save() {
    if (!product || !sourceWarehouse || !destinationWarehouse) return;
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
        destinationWarehouseId: destinationWarehouse.id,
        scheduledStartDate,
        scheduledEndDate: scheduledEndDate.trim() === "" ? null : scheduledEndDate,
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّر إنشاء أمر التصنيع المخصص.");
    }
  }

  async function doClose(id: string) {
    setActionError(null);
    try {
      await closeInstance.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر إغلاق الأمر.");
    }
  }

  async function doCancel(id: string) {
    setActionError(null);
    try {
      await cancelInstance.mutateAsync(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر إلغاء الأمر.");
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="أمر تصنيع مخصص جديد" description="اختر المنتج وأدخل المواصفات لمعاينة الخامات والتكلفة">
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <EntityPicker
          label="المنتج *"
          value={product}
          onChange={(opt) => {
            setProduct(opt);
            const p = products.find((x) => x.id === opt?.id);
            setSpec(p ? Object.fromEntries(p.inputs.map((i) => [i.id, ""])) : {});
            preview.reset();
          }}
          options={productOptions}
          placeholder="اختر منتجاً قابلاً للتهيئة…"
        />

        {selectedProduct ? (
          <div className="flex flex-col gap-[10px] rounded-lg border border-border bg-surface p-[12px]">
            <span className="text-[12.5px] font-semibold text-ink">المواصفات</span>
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
          <NumberField label="الكمية *" value={qty} min={0} onChange={setQty} />
          <NumberField
            label="سعر البيع (للوحدة)"
            value={sellUnitPrice ?? Number.NaN}
            min={0}
            onChange={(v) => setSellUnitPrice(Number.isNaN(v) ? null : v)}
          />
        </div>
        <EntityPicker label="العميل" value={customer} onChange={setCustomer} options={customerOptions} placeholder="بدون عميل" />
        <TextField label="ملاحظات" value={notesText} onChange={setNotesText} />
        <EntityPicker label="مستودع الخامات *" value={sourceWarehouse} onChange={setSourceWarehouse} options={warehouseOptions} placeholder="اختر المستودع…" />
        <EntityPicker
          label="مستودع المنتجات *"
          value={destinationWarehouse}
          onChange={setDestinationWarehouse}
          options={warehouseOptions}
          placeholder="اختر المستودع…"
        />
        <div className="grid grid-cols-2 gap-[10px]">
          <TextField label="تاريخ البدء" value={scheduledStartDate} onChange={setScheduledStartDate} placeholder="YYYY-MM-DD" />
          <TextField label="تاريخ الانتهاء المتوقع" value={scheduledEndDate} onChange={setScheduledEndDate} placeholder="YYYY-MM-DD" />
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-[12px]">
          <span className="text-[12.5px] font-semibold text-ink">معاينة الاحتياجات والتكلفة</span>
          {!selectedProduct ? (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">أنشئ أمرًا جديدًا باختيار منتج قابل للتهيئة وإدخال المواصفات.</p>
          ) : preview.isPending ? (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">جارِ الحساب…</p>
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
                <span>تكلفة الوحدة</span>
                <MoneyValue value={num(preview.data.materialCostPerUnit) + num(preview.data.laborCostPerUnit) + num(preview.data.overheadCostPerUnit)} />
              </div>
              {preview.data.unitPrice !== null ? (
                <div className="flex items-center justify-between font-semibold text-brand">
                  <span>السعر المقترح (للوحدة)</span>
                  <MoneyValue value={num(preview.data.unitPrice)} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-[8px] text-[12.5px] text-ink-muted">أكمل المواصفات لعرض المعاينة.</p>
          )}
        </div>

        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createInstance.isPending}>
            حفظ
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
          onClose={() => doClose(selected.id)}
          onCancel={() => doCancel(selected.id)}
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل أوامر التصنيع المخصص.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<ConfigInstanceRecord>
        eyebrow="Manufacturing · Custom orders"
        title="التصنيع المخصص"
        description="تصنيع حسب الطلب لمنتج قابل للتهيئة — يحسب النظام الخامات والسعر من مواصفات العميل عبر معادلات آمنة"
        actions={
          <Button variant="primary" onClick={openCreate}>
            أمر تصنيع مخصص جديد
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{instances.length}</span> },
          { label: STATUS_LABEL.configured, value: <span className="mz-num">{instances.filter((i) => i.status === "configured").length}</span> },
          {
            label: STATUS_LABEL.in_progress,
            value: <span className="mz-num">{instances.filter((i) => i.status === "in_progress" || i.status === "produced").length}</span>,
          },
          { label: STATUS_LABEL.closed, value: <span className="mz-num">{instances.filter((i) => i.status === "closed").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as Status | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الأمر أو المنتج أو العميل…"
        columns={columns}
        rows={filtered}
        rowKey={(i) => i.id}
        onRowClick={(i) => setSelectedId(i.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{instances.length}</span> أمر</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد أوامر تصنيع مخصص — أنشئ أمراً جديداً"}
          </div>
        }
      />
      {panel}
    </>
  );
}
