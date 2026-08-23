import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EntityPicker,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import {
  useConfigurableProducts,
  useCreateConfigurableProduct,
  useDeactivateConfigurableProduct,
  useItems,
  type ConfigurableProductRecord,
} from "../data/hooks";
import { TextField, NumberField, SelectField } from "../settings/form-controls";

type Status = ConfigurableProductRecord["status"];

const STATUS_LABEL: Record<Status, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<Status, PillTone> = { active: "success", inactive: "neutral" };
const PRICING_LABEL: Record<string, string> = { manual: "بدون — سعر يدوي", formula: "معادلة" };

interface DraftInput {
  id: string;
  labelAr: string;
  min: number | null;
  max: number | null;
}

interface DraftMaterial {
  itemId: string;
  qtyFormula: string;
  wastePercent: number;
}

function ProductDetail({
  product,
  itemName,
  onBack,
  onDeactivate,
  deactivating,
}: {
  product: ConfigurableProductRecord;
  itemName: (id: string) => string;
  onBack: () => void;
  onDeactivate: () => void;
  deactivating: boolean;
}) {
  return (
    <DocumentDetail
      title={`${product.nameAr} (${product.code})`}
      statusLabel={STATUS_LABEL[product.status]}
      statusTone={STATUS_TONE[product.status]}
      subtitle={`منتج قابل للتهيئة · ${itemName(product.outputItemId)}`}
      actions={
        <>
          {product.status === "active" ? (
            <Button onClick={onDeactivate} disabled={deactivating}>
              تعطيل
            </Button>
          ) : null}
          <Button onClick={onBack}>رجوع للمنتجات القابلة للتهيئة</Button>
        </>
      }
      summary={[
        { label: "الكود", value: product.code },
        { label: "وحدة المنتج النهائي", value: product.unit },
        { label: "عدد المدخلات", value: <span className="mz-num">{product.inputs.length}</span> },
        { label: "عدد الخامات", value: <span className="mz-num">{product.materials.length}</span> },
        { label: "طريقة التسعير", value: PRICING_LABEL[product.pricingMethod] },
      ]}
      effects={[
        "المعادلات تُقيَّم عبر مُقيِّم آمن (Sandbox) — لا يستخدم eval إطلاقاً.",
        "كل أمر تصنيع مخصص يُقيّم هذه المعادلات مقابل مواصفات العميل لحساب الخامات والسعر.",
      ]}
      tabs={[
        {
          key: "inputs",
          label: `مدخلات التهيئة (${product.inputs.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">المعرف</th>
                    <th className="px-[12px] py-[9px] text-start">التسمية</th>
                    <th className="px-[12px] py-[9px] text-end">الحد الأدنى</th>
                    <th className="px-[12px] py-[9px] text-end">الحد الأقصى</th>
                  </tr>
                </thead>
                <tbody>
                  {product.inputs.map((inp, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px] font-mono">{inp.id}</td>
                      <td className="px-[12px] py-[10px]">{inp.labelAr}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{inp.min ?? "—"}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{inp.max ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "materials",
          label: `خامات التصنيع (${product.materials.length})`,
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">الصنف</th>
                    <th className="px-[12px] py-[9px] text-start">معادلة الكمية</th>
                    <th className="px-[12px] py-[9px] text-end">نسبة الهالك</th>
                  </tr>
                </thead>
                <tbody>
                  {product.materials.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{itemName(m.itemId)}</td>
                      <td className="px-[12px] py-[10px] font-mono">{m.qtyFormula}</td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{m.wastePercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ),
        },
        {
          key: "pricing",
          label: "التسعير والتكلفة",
          content: (
            <dl className="grid grid-cols-1 gap-[10px] text-[13px]">
              <div><dt className="text-ink-muted">معادلة السعر</dt><dd className="font-mono">{product.priceFormula ?? "— (سعر يدوي)"}</dd></div>
              <div><dt className="text-ink-muted">معادلة العمالة</dt><dd className="font-mono">{product.laborFormula ?? "—"}</dd></div>
              <div><dt className="text-ink-muted">معادلة المصاريف</dt><dd className="font-mono">{product.overheadFormula ?? "—"}</dd></div>
            </dl>
          ),
        },
      ]}
    />
  );
}

export function ConfigurableProductsScreen() {
  const query = useConfigurableProducts();
  const itemsQuery = useItems();
  const createProduct = useCreateConfigurableProduct();
  const deactivateProduct = useDeactivateConfigurableProduct();

  const products = query.data ?? [];
  const items = itemsQuery.data ?? [];

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const itemOptions: EntityPickerOption[] = items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.code }));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [outputItem, setOutputItem] = useState<EntityPickerOption | null>(null);
  const [unit, setUnit] = useState("PCS");
  const [description, setDescription] = useState("");
  const [inputs, setInputs] = useState<DraftInput[]>([{ id: "", labelAr: "", min: null, max: null }]);
  const [materials, setMaterials] = useState<DraftMaterial[]>([{ itemId: "", qtyFormula: "", wastePercent: 0 }]);
  const [pricingMethod, setPricingMethod] = useState<"manual" | "formula">("manual");
  const [priceFormula, setPriceFormula] = useState("");
  const [laborFormula, setLaborFormula] = useState("");
  const [overheadFormula, setOverheadFormula] = useState("");
  const [itemPolicy, setItemPolicy] = useState<"per_order" | "per_spec">("per_order");
  const [formError, setFormError] = useState<string | null>(null);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = products;
    if (statusFilter !== "all") rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => p.code.toLowerCase().includes(q) || p.nameAr.includes(search.trim()));
    }
    return rows;
  }, [products, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: products.length },
    { key: "active", label: "نشط", count: products.filter((p) => p.status === "active").length },
    { key: "inactive", label: "غير نشط", count: products.filter((p) => p.status === "inactive").length },
  ];

  const columns: DocumentListColumn<ConfigurableProductRecord>[] = [
    { key: "code", header: "الكود", render: (p) => <span className="font-semibold text-ink">{p.code}</span> },
    { key: "name", header: "الاسم", render: (p) => p.nameAr },
    { key: "inputs", header: "مدخلات التهيئة", render: (p) => p.inputs.map((i) => i.labelAr).join("، ") },
    { key: "materials", header: "خامات التصنيع", align: "end", render: (p) => <span className="mz-num">{p.materials.length}</span> },
    { key: "unit", header: "وحدة المنتج", render: (p) => p.unit },
    { key: "status", header: "الحالة", render: (p) => <StatusPill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /> },
  ];

  function openCreate() {
    setCode("");
    setNameAr("");
    setNameEn("");
    setOutputItem(null);
    setUnit("PCS");
    setDescription("");
    setInputs([{ id: "", labelAr: "", min: null, max: null }]);
    setMaterials([{ itemId: "", qtyFormula: "", wastePercent: 0 }]);
    setPricingMethod("manual");
    setPriceFormula("");
    setLaborFormula("");
    setOverheadFormula("");
    setItemPolicy("per_order");
    setFormError(null);
    setPanelOpen(true);
  }

  const validInputs = inputs.filter((i) => i.id.trim() !== "" && i.labelAr.trim() !== "");
  const validMaterials = materials.filter((m) => m.itemId !== "" && m.qtyFormula.trim() !== "");
  const canSave =
    code.trim() !== "" &&
    nameAr.trim() !== "" &&
    outputItem !== null &&
    validInputs.length > 0 &&
    validMaterials.length > 0 &&
    (pricingMethod !== "formula" || priceFormula.trim() !== "");

  async function save() {
    if (!outputItem) return;
    setFormError(null);
    try {
      await createProduct.mutateAsync({
        id: crypto.randomUUID(),
        code: code.trim(),
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim() === "" ? null : nameEn.trim(),
        outputItemId: outputItem.id,
        unit,
        description: description.trim() === "" ? null : description.trim(),
        inputs: validInputs.map((i) => ({ id: i.id.trim(), labelAr: i.labelAr.trim(), min: i.min, max: i.max })),
        materials: validMaterials.map((m) => ({ itemId: m.itemId, qtyFormula: m.qtyFormula.trim(), wastePercent: m.wastePercent })),
        pricingMethod,
        priceFormula: pricingMethod === "formula" && priceFormula.trim() !== "" ? priceFormula.trim() : null,
        laborFormula: laborFormula.trim() === "" ? null : laborFormula.trim(),
        overheadFormula: overheadFormula.trim() === "" ? null : overheadFormula.trim(),
        itemPolicy,
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّر إضافة المنتج القابل للتهيئة.");
    }
  }

  async function deactivate(id: string) {
    try {
      await deactivateProduct.mutateAsync(id);
    } catch {
      // The list/detail re-render from the failed mutation's settled cache; nothing further to do here.
    }
  }

  const panel = (
    <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="منتج قابل للتهيئة جديد" description="عرّف المدخلات وصيغ حساب الخامات والتسعير">
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-[10px]">
          <TextField label="الكود *" value={code} onChange={setCode} />
          <TextField label="الاسم بالعربية *" value={nameAr} onChange={setNameAr} />
        </div>
        <TextField label="الاسم بالإنجليزية" value={nameEn} onChange={setNameEn} />
        <EntityPicker
          label="المنتج الناتج *"
          value={outputItem}
          onChange={(opt) => {
            setOutputItem(opt);
            const item = items.find((i) => i.id === opt?.id);
            if (item) setUnit(item.baseUnitCode);
          }}
          options={itemOptions}
          placeholder="اختر المنتج الناتج…"
        />
        <TextField label="وحدة المنتج النهائي" value={unit} onChange={setUnit} />
        <TextField label="الوصف" value={description} onChange={setDescription} />

        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">مدخلات التهيئة *</span>
          {inputs.map((inp, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <div className="grid grid-cols-2 gap-[10px]">
                <TextField
                  label="المعرف (للمعادلات)"
                  value={inp.id}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, id: v } : x)))}
                  placeholder="width"
                />
                <TextField
                  label="التسمية"
                  value={inp.labelAr}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, labelAr: v } : x)))}
                  placeholder="العرض"
                />
              </div>
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <NumberField
                  label="الحد الأدنى"
                  value={inp.min ?? Number.NaN}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, min: Number.isNaN(v) ? null : v } : x)))}
                />
                <NumberField
                  label="الحد الأقصى"
                  value={inp.max ?? Number.NaN}
                  onChange={(v) => setInputs((prev) => prev.map((x, j) => (j === i ? { ...x, max: Number.isNaN(v) ? null : v } : x)))}
                />
              </div>
              {inputs.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setInputs((prev) => prev.filter((_, j) => j !== i))}>حذف المدخل</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setInputs((prev) => [...prev, { id: "", labelAr: "", min: null, max: null }])}>إضافة مدخل</Button>
        </div>

        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">خامات التصنيع *</span>
          {materials.map((m, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
              <EntityPicker
                label="الصنف"
                value={itemOptions.find((o) => o.id === m.itemId) ?? null}
                onChange={(opt) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, itemId: opt?.id ?? "" } : x)))}
                options={itemOptions}
                placeholder="اختر صنفاً…"
              />
              <div className="mt-[10px] grid grid-cols-2 gap-[10px]">
                <TextField
                  label="معادلة الكمية"
                  value={m.qtyFormula}
                  onChange={(v) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, qtyFormula: v } : x)))}
                  placeholder="width*height/10000"
                />
                <NumberField
                  label="نسبة الهالك %"
                  value={m.wastePercent}
                  min={0}
                  onChange={(v) => setMaterials((prev) => prev.map((x, j) => (j === i ? { ...x, wastePercent: v } : x)))}
                />
              </div>
              {materials.length > 1 ? (
                <div className="mt-[8px] flex justify-end">
                  <Button onClick={() => setMaterials((prev) => prev.filter((_, j) => j !== i))}>حذف الخامة</Button>
                </div>
              ) : null}
            </div>
          ))}
          <Button onClick={() => setMaterials((prev) => [...prev, { itemId: "", qtyFormula: "", wastePercent: 0 }])}>إضافة خامة</Button>
        </div>

        <SelectField
          label="طريقة التسعير"
          value={pricingMethod}
          onChange={(v) => setPricingMethod(v as "manual" | "formula")}
          options={[
            { value: "manual", label: "بدون — سعر يدوي" },
            { value: "formula", label: "معادلة" },
          ]}
        />
        {pricingMethod === "formula" ? (
          <TextField label="معادلة السعر (للوحدة) *" value={priceFormula} onChange={setPriceFormula} placeholder="width*height*3.5/100" />
        ) : null}
        <TextField label="معادلة تكلفة العمالة (للوحدة)" value={laborFormula} onChange={setLaborFormula} placeholder="width/10" />
        <TextField label="معادلة التكاليف الإضافية (للوحدة)" value={overheadFormula} onChange={setOverheadFormula} placeholder="5" />
        <SelectField
          label="سياسة الأصناف"
          value={itemPolicy}
          onChange={(v) => setItemPolicy(v as "per_order" | "per_spec")}
          options={[
            { value: "per_order", label: "صنف لكل أمر" },
            { value: "per_spec", label: "صنف لكل مواصفات" },
          ]}
        />

        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || createProduct.isPending}>
            حفظ
          </Button>
        </div>
      </div>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        <ProductDetail
          product={selected}
          itemName={itemName}
          onBack={() => setSelectedId(null)}
          onDeactivate={() => deactivate(selected.id)}
          deactivating={deactivateProduct.isPending}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل المنتجات القابلة للتهيئة.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<ConfigurableProductRecord>
        eyebrow="Manufacturing · Configurable products"
        title="المنتجات القابلة للتهيئة"
        description="منتجات تُحسب موادها وسعرها من مدخلات العميل عبر معادلات آمنة — بيانات التصنيع المخصص"
        actions={
          <Button variant="primary" onClick={openCreate}>
            إضافة منتج قابل للتهيئة
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{products.length}</span> },
          { label: "نشط", value: <span className="mz-num">{products.filter((p) => p.status === "active").length}</span> },
          { label: "غير نشط", value: <span className="mz-num">{products.filter((p) => p.status === "inactive").length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as Status | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالكود أو الاسم…"
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={(p) => setSelectedId(p.id)}
        page={1}
        pageCount={1}
        pageSummary={<>عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{products.length}</span> منتج</>}
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد منتجات قابلة للتهيئة مطابقة — أضف منتجاً جديداً"}
          </div>
        }
      />
      {panel}
    </>
  );
}
