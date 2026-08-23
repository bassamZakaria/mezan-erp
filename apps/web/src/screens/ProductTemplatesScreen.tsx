import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  Money,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type PillTone,
} from "@mezan/ui";
import type { ProductTemplateDTO, ProductTemplateStatusDTO } from "@mezan/contracts";
import { MultiChipField, NumberField, SelectField, TextField } from "../settings/form-controls";
import { useItemCategories, useItemUnits } from "../data/item-catalog-hooks";
import {
  useCreateProductTemplate,
  useDeleteProductTemplate,
  useGenerateProductTemplateVariants,
  useItemSpecifications,
  useProductTemplates,
  useSetProductTemplateVariantPrice,
} from "../data/product-catalog-hooks";

/**
 * قوالب المنتجات ("منتجات بخيارات") — a template picks select-list
 * specifications (اللون × المقاس) and generates their cartesian product as
 * concrete catalog items, one SKU per combination. Distinct from المنتجات
 * القابلة للتهيئة, which computes made-to-order materials from formulas.
 */

const STATUS_LABEL: Record<ProductTemplateStatusDTO, string> = {
  draft: "مسودة",
  generated: "تم التوليد",
};
const STATUS_TONE: Record<ProductTemplateStatusDTO, PillTone> = {
  draft: "warning",
  generated: "success",
};

interface OptionDraft {
  specificationId: string;
  values: string[];
}

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  baseUnitCode: string;
  categoryId: string;
  basePrice: number | null;
  taxRatePercent: number;
  costingMethod: "WAC" | "FIFO";
  options: OptionDraft[];
}

function blankDraft(): Draft {
  return {
    code: "",
    nameAr: "",
    nameEn: "",
    baseUnitCode: "",
    categoryId: "",
    basePrice: null,
    taxRatePercent: 14,
    costingMethod: "WAC",
    options: [{ specificationId: "", values: [] }],
  };
}

function combinationsOf(options: readonly OptionDraft[]): number {
  const usable = options.filter((o) => o.specificationId !== "" && o.values.length > 0);
  if (usable.length === 0) return 0;
  return usable.reduce((total, option) => total * option.values.length, 1);
}

export function ProductTemplatesScreen() {
  const query = useProductTemplates();
  const specificationsQuery = useItemSpecifications();
  const unitsQuery = useItemUnits();
  const categoriesQuery = useItemCategories();
  const createTemplate = useCreateProductTemplate();
  const generateVariants = useGenerateProductTemplateVariants();
  const setVariantPrice = useSetProductTemplateVariantPrice();
  const deleteTemplate = useDeleteProductTemplate();

  const templates = query.data ?? [];
  const specifications = specificationsQuery.data ?? [];
  const selectSpecifications = specifications.filter((s) => s.type === "select");
  const units = unitsQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const specificationName = useMemo(() => {
    const map = new Map(specifications.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [specifications]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductTemplateStatusDTO | "all">("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [pricingSku, setPricingSku] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<number | null>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = templates;
    if (statusFilter !== "all") rows = rows.filter((t) => t.status === statusFilter);
    const q = search.trim();
    if (q !== "") {
      rows = rows.filter((t) => t.code.toLowerCase().includes(q.toLowerCase()) || t.nameAr.includes(q));
    }
    return rows;
  }, [templates, statusFilter, search]);

  function openCreate() {
    setDraft({ ...blankDraft(), baseUnitCode: units[0]?.code ?? "" });
    setFormError(null);
    setPanelOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const options = draft.options.filter((o) => o.specificationId !== "" && o.values.length > 0);
    if (!/^[A-Z0-9_-]{1,20}$/.test(draft.code.trim())) {
      setFormError("الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى).");
      return;
    }
    if (draft.nameAr.trim() === "") {
      setFormError("الاسم بالعربية مطلوب.");
      return;
    }
    if (draft.baseUnitCode.trim() === "") {
      setFormError("وحدة القياس مطلوبة.");
      return;
    }
    if (options.length === 0) {
      setFormError("اختر مواصفة واحدة على الأقل مع قيمها.");
      return;
    }
    setFormError(null);
    try {
      await createTemplate.mutateAsync({
        id: crypto.randomUUID(),
        code: draft.code.trim(),
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
        baseUnitCode: draft.baseUnitCode,
        categoryId: draft.categoryId === "" ? null : draft.categoryId,
        basePrice: draft.basePrice === null ? null : draft.basePrice.toFixed(2),
        taxRatePercent: draft.taxRatePercent,
        costingMethod: draft.costingMethod,
        options,
      });
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  async function generate(template: ProductTemplateDTO) {
    if (busyTemplateId) return;
    setBusyTemplateId(template.id);
    setActionError(null);
    try {
      await generateVariants.mutateAsync(template.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر توليد المتغيرات.");
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function remove(template: ProductTemplateDTO) {
    if (busyTemplateId) return;
    setBusyTemplateId(template.id);
    setActionError(null);
    try {
      await deleteTemplate.mutateAsync(template.id);
      if (selectedId === template.id) setSelectedId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر حذف القالب.");
    } finally {
      setBusyTemplateId(null);
    }
  }

  async function commitPrice(template: ProductTemplateDTO, sku: string) {
    setActionError(null);
    try {
      await setVariantPrice.mutateAsync({
        id: template.id,
        sku,
        salePrice: priceDraft === null ? null : priceDraft.toFixed(2),
      });
      setPricingSku(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "تعذّر تعديل سعر المتغير.");
    }
  }

  const columns: DocumentListColumn<ProductTemplateDTO>[] = [
    {
      key: "code",
      header: "الكود",
      render: (t) => <span className="font-semibold text-ink">{t.code}</span>,
    },
    { key: "nameAr", header: "الاسم", render: (t) => t.nameAr },
    {
      key: "options",
      header: "الخيارات",
      render: (t) =>
        t.options.length === 0
          ? "—"
          : t.options.map((o) => `${specificationName(o.specificationId)} (${o.values.length})`).join(" × "),
    },
    {
      key: "combinations",
      header: "التركيبات",
      align: "end",
      render: (t) => <span className="mz-num">{t.combinationCount}</span>,
    },
    {
      key: "variants",
      header: "متغيرات مولّدة",
      align: "end",
      render: (t) => <span className="mz-num">{t.variants.length}</span>,
    },
    {
      key: "status",
      header: "الحالة",
      render: (t) => <StatusPill label={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} />,
    },
  ];

  const panel = (
    <SidePanel
      open={panelOpen}
      onClose={() => setPanelOpen(false)}
      title="قالب منتج جديد"
      description="اختر المواصفات وقيمها — يولّد النظام صنفاً لكل تركيبة"
    >
      <form onSubmit={submit} className="flex flex-col gap-[14px]">
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
          >
            {formError}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-[10px]">
          <TextField
            label="الكود *"
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.toUpperCase() }))}
            hint="يبدأ به كود كل متغير"
          />
          <TextField
            label="الاسم بالعربية *"
            value={draft.nameAr}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
          />
        </div>
        <TextField
          label="الاسم بالإنجليزية"
          value={draft.nameEn}
          onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
        />
        <div className="grid grid-cols-2 gap-[10px]">
          <SelectField
            label="وحدة القياس *"
            value={draft.baseUnitCode}
            onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))}
            options={units.map((u) => ({ value: u.code, label: `${u.nameAr} (${u.code})` }))}
          />
          <SelectField
            label="التصنيف"
            value={draft.categoryId}
            onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
            options={[{ value: "", label: "بدون تصنيف" }, ...categories.map((c) => ({ value: c.id, label: c.nameAr }))]}
          />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">سعر البيع الأساسي</span>
            <MoneyInput
              value={draft.basePrice}
              onChange={(v) => setDraft((d) => ({ ...d, basePrice: v }))}
              aria-label="سعر البيع الأساسي"
            />
          </div>
          <NumberField
            label="نسبة الضريبة %"
            value={draft.taxRatePercent}
            min={0}
            onChange={(v) => setDraft((d) => ({ ...d, taxRatePercent: v }))}
          />
        </div>
        <SelectField
          label="طريقة التكلفة"
          value={draft.costingMethod}
          onChange={(v) => setDraft((d) => ({ ...d, costingMethod: v as "WAC" | "FIFO" }))}
          options={[
            { value: "WAC", label: "المتوسط المرجح" },
            { value: "FIFO", label: "الوارد أولاً صادر أولاً" },
          ]}
        />

        <div className="flex flex-col gap-[10px]">
          <span className="text-[12.5px] font-semibold text-ink">الخيارات *</span>
          {selectSpecifications.length === 0 ? (
            <p className="text-[12px] text-ink-muted">
              لا توجد مواصفات من نوع قائمة اختيار — أضفها أولاً من شاشة المواصفات.
            </p>
          ) : null}
          {draft.options.map((option, index) => {
            const specification = selectSpecifications.find((s) => s.id === option.specificationId);
            return (
              <div key={index} className="rounded-lg border border-border bg-surface p-[12px]">
                <SelectField
                  label="المواصفة"
                  value={option.specificationId}
                  onChange={(v) =>
                    setDraft((d) => ({
                      ...d,
                      options: d.options.map((o, j) =>
                        j === index ? { specificationId: v, values: [] } : o,
                      ),
                    }))
                  }
                  options={[
                    { value: "", label: "اختر مواصفة…" },
                    ...selectSpecifications.map((s) => ({ value: s.id, label: s.nameAr })),
                  ]}
                />
                {specification ? (
                  <div className="mt-[10px]">
                    <MultiChipField
                      label="القيم"
                      options={specification.values.map((v) => ({ value: v, label: v }))}
                      value={option.values}
                      onChange={(values) =>
                        setDraft((d) => ({
                          ...d,
                          options: d.options.map((o, j) => (j === index ? { ...o, values } : o)),
                        }))
                      }
                    />
                  </div>
                ) : null}
                {draft.options.length > 1 ? (
                  <div className="mt-[8px] flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        setDraft((d) => ({ ...d, options: d.options.filter((_, j) => j !== index) }))
                      }
                    >
                      حذف الخيار
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          <Button
            type="button"
            onClick={() =>
              setDraft((d) => ({ ...d, options: [...d.options, { specificationId: "", values: [] }] }))
            }
          >
            إضافة خيار
          </Button>
          <p className="text-[12px] text-ink-muted">
            التركيبات المتوقعة: <span className="mz-num">{combinationsOf(draft.options)}</span>
          </p>
        </div>

        <div className="flex justify-end gap-[9px]">
          <Button type="button" onClick={() => setPanelOpen(false)}>
            إلغاء
          </Button>
          <Button type="submit" variant="primary" disabled={createTemplate.isPending}>
            حفظ
          </Button>
        </div>
      </form>
    </SidePanel>
  );

  if (selected) {
    return (
      <>
        {actionError ? (
          <div
            role="alert"
            className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
          >
            {actionError}
          </div>
        ) : null}
        <DocumentDetail
          title={`${selected.nameAr} (${selected.code})`}
          statusLabel={STATUS_LABEL[selected.status]}
          statusTone={STATUS_TONE[selected.status]}
          subtitle="قالب منتج — منتج بخيارات"
          actions={
            <>
              {selected.status === "draft" ? (
                <Button
                  variant="primary"
                  onClick={() => generate(selected)}
                  disabled={busyTemplateId !== null}
                >
                  توليد المتغيرات
                </Button>
              ) : null}
              {selected.variants.length === 0 ? (
                <Button onClick={() => remove(selected)} disabled={busyTemplateId !== null}>
                  حذف القالب
                </Button>
              ) : null}
              <Button onClick={() => setSelectedId(null)}>رجوع لقوالب المنتجات</Button>
            </>
          }
          summary={[
            { label: "الكود", value: selected.code },
            { label: "وحدة القياس", value: selected.baseUnitCode },
            {
              label: "سعر البيع الأساسي",
              value: <Money value={Number(selected.basePrice ?? 0)} />,
            },
            { label: "نسبة الضريبة", value: <span className="mz-num">{selected.taxRatePercent}%</span> },
            { label: "التركيبات", value: <span className="mz-num">{selected.combinationCount}</span> },
            { label: "متغيرات مولّدة", value: <span className="mz-num">{selected.variants.length}</span> },
          ]}
          effects={[
            "التوليد ينشئ صنفاً حقيقياً في كتالوج الأصناف لكل تركيبة، بكود ومواصفات وسعر خاص به.",
            "بعد التوليد تُجمّد مصفوفة الخيارات — الأكواد المولّدة مرتبطة بترتيب القيم.",
          ]}
          tabs={[
            {
              key: "options",
              label: `الخيارات (${selected.options.length})`,
              content: (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                        <th className="px-[12px] py-[9px] text-start">المواصفة</th>
                        <th className="px-[12px] py-[9px] text-start">القيم</th>
                        <th className="px-[12px] py-[9px] text-end">عدد القيم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.options.map((option) => (
                        <tr key={option.specificationId} className="border-b border-border last:border-b-0">
                          <td className="px-[12px] py-[10px]">{specificationName(option.specificationId)}</td>
                          <td className="px-[12px] py-[10px]">{option.values.join("، ")}</td>
                          <td className="mz-num px-[12px] py-[10px] text-end">{option.values.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            },
            {
              key: "variants",
              label: `المتغيرات (${selected.variants.length})`,
              content:
                selected.variants.length === 0 ? (
                  <p className="p-[18px] text-center text-[13px] text-ink-muted">
                    لم تُولَّد متغيرات بعد — اضغط «توليد المتغيرات».
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                          <th className="px-[12px] py-[9px] text-start">الكود</th>
                          <th className="px-[12px] py-[9px] text-start">الاسم</th>
                          <th className="px-[12px] py-[9px] text-start">القيم</th>
                          <th className="px-[12px] py-[9px] text-end">سعر البيع</th>
                          <th className="px-[12px] py-[9px] text-end" />
                        </tr>
                      </thead>
                      <tbody>
                        {selected.variants.map((variant) => (
                          <tr key={variant.sku} className="border-b border-border last:border-b-0">
                            <td className="px-[12px] py-[10px] font-mono">{variant.sku}</td>
                            <td className="px-[12px] py-[10px]">{variant.nameAr}</td>
                            <td className="px-[12px] py-[10px]">{variant.values.join(" / ")}</td>
                            <td className="px-[12px] py-[10px] text-end">
                              {pricingSku === variant.sku ? (
                                <MoneyInput
                                  value={priceDraft}
                                  onChange={setPriceDraft}
                                  aria-label={`سعر ${variant.sku}`}
                                />
                              ) : (
                                <Money value={Number(variant.salePrice ?? 0)} />
                              )}
                            </td>
                            <td className="px-[12px] py-[10px] text-end">
                              {pricingSku === variant.sku ? (
                                <div className="flex justify-end gap-[6px]">
                                  <Button size="sm" onClick={() => setPricingSku(null)}>
                                    إلغاء
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={setVariantPrice.isPending}
                                    onClick={() => commitPrice(selected, variant.sku)}
                                  >
                                    حفظ
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setPricingSku(variant.sku);
                                    setPriceDraft(variant.salePrice === null ? null : Number(variant.salePrice));
                                  }}
                                >
                                  تعديل السعر
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ),
            },
          ]}
        />
        {panel}
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل قوالب المنتجات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div
          role="alert"
          className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
        >
          {actionError}
        </div>
      ) : null}
      <DocumentList<ProductTemplateDTO>
        eyebrow="Inventory · Product templates"
        title="منتجات بخيارات"
        description="قوالب تولّد صنفاً لكل تركيبة من المواصفات المختارة — كود وسعر مستقل لكل متغير"
        actions={
          <Button variant="primary" onClick={openCreate}>
            قالب منتج جديد
          </Button>
        }
        stats={[
          { label: "إجمالي القوالب", value: <span className="mz-num">{templates.length}</span> },
          {
            label: "مسودات",
            value: <span className="mz-num">{templates.filter((t) => t.status === "draft").length}</span>,
          },
          {
            label: "متغيرات مولّدة",
            value: (
              <span className="mz-num">{templates.reduce((sum, t) => sum + t.variants.length, 0)}</span>
            ),
          },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: templates.length },
          { key: "draft", label: STATUS_LABEL.draft, count: templates.filter((t) => t.status === "draft").length },
          {
            key: "generated",
            label: STATUS_LABEL.generated,
            count: templates.filter((t) => t.status === "generated").length,
          },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as ProductTemplateStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالكود أو الاسم…"
        columns={columns}
        rows={filtered}
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedId(t.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من{" "}
            <span className="mz-num">{templates.length}</span> قالب
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد قوالب منتجات — أضف قالباً جديداً"}
          </div>
        }
      />
      {panel}
    </>
  );
}
