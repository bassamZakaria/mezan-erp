import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import type { ConfigurableProduct, ActivationStatus } from "@mezan/domain";
import { demoConfigurableProducts, mfgItemName } from "../manufacturing-sample-data";

const STATUS_LABEL: Record<ActivationStatus, string> = { active: "نشط", inactive: "غير نشط" };
const STATUS_TONE: Record<ActivationStatus, PillTone> = { active: "success", inactive: "neutral" };
const PRICING_LABEL: Record<string, string> = { manual: "بدون — سعر يدوي", formula: "معادلة" };

function ProductDetail({ product, onBack }: { product: ConfigurableProduct; onBack: () => void }) {
  return (
    <DocumentDetail
      title={`${product.nameAr} (${product.code})`}
      statusLabel={STATUS_LABEL[product.status]}
      statusTone={STATUS_TONE[product.status]}
      subtitle={`منتج قابل للتهيئة · ${mfgItemName(product.outputItemId)}`}
      actions={<Button onClick={onBack}>رجوع للمنتجات القابلة للتهيئة</Button>}
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
                      <td className="px-[12px] py-[10px]">{mfgItemName(m.itemId)}</td>
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
  const [products] = useState<ConfigurableProduct[]>(demoConfigurableProducts);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActivationStatus | "all">("all");
  const [search, setSearch] = useState("");

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

  const columns: DocumentListColumn<ConfigurableProduct>[] = [
    { key: "code", header: "الكود", render: (p) => <span className="font-semibold text-ink">{p.code}</span> },
    { key: "name", header: "الاسم", render: (p) => p.nameAr },
    { key: "inputs", header: "مدخلات التهيئة", render: (p) => p.inputs.map((i) => i.labelAr).join("، ") },
    { key: "materials", header: "خامات التصنيع", align: "end", render: (p) => <span className="mz-num">{p.materials.length}</span> },
    { key: "unit", header: "وحدة المنتج", render: (p) => p.unit },
    { key: "status", header: "الحالة", render: (p) => <StatusPill label={STATUS_LABEL[p.status]} tone={STATUS_TONE[p.status]} /> },
  ];

  if (selected) {
    return <ProductDetail product={selected} onBack={() => setSelectedId(null)} />;
  }

  return (
    <DocumentList<ConfigurableProduct>
      eyebrow="Manufacturing · Configurable products"
      title="المنتجات القابلة للتهيئة"
      description="منتجات تُحسب موادها وسعرها من مدخلات العميل عبر معادلات آمنة — بيانات التصنيع المخصص"
      actions={<Button variant="primary">إضافة منتج قابل للتهيئة</Button>}
      stats={[
        { label: "الإجمالي", value: <span className="mz-num">{products.length}</span> },
        { label: "نشط", value: <span className="mz-num">{products.filter((p) => p.status === "active").length}</span> },
        { label: "غير نشط", value: <span className="mz-num">{products.filter((p) => p.status === "inactive").length}</span> },
      ]}
      statusChips={statusChips}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as ActivationStatus | "all")}
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
      emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد منتجات قابلة للتهيئة مطابقة</div>}
    />
  );
}
