import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, StatusPill, Card, Button, SidePanel, type DocumentListColumn } from "@mezan/ui";
import type { CreateProductTemplateDTO, ProductTemplateDTO } from "@mezan/contracts";
import {
  ApiError,
  useAddAttributeValue,
  useAddTemplateAttribute,
  useCreateProductTemplate,
  useDeleteAttributeValue,
  useDeleteTemplateAttribute,
  useGenerateVariants,
  useProductTemplates,
  useTemplateVariants,
} from "../data/hooks";
import { TextField } from "../settings/form-controls";

/**
 * قوالب المنتجات (Product Templates) — docs/catalog/03-inventory.md §"قوالب
 * المنتجات". Attribute-driven variant/SKU generation: define a product once
 * with named characteristics (color, size, ...), enumerate each attribute's
 * values, then mass-generate the resulting combinations as real, independent
 * Items.
 */

interface CreateDraft {
  code: string;
  nameAr: string;
  baseUnitCode: string;
  defaultSalePrice: string;
  defaultCost: string;
}

function blankCreateDraft(): CreateDraft {
  return { code: "", nameAr: "", baseUnitCode: "PCS", defaultSalePrice: "", defaultCost: "" };
}

/** Order-independent key matching the domain's `variantKey` exactly. */
function comboKey(values: Record<string, string>): string {
  return Object.keys(values).sort().map((k) => `${k}=${values[k]}`).join("|");
}

function cartesianCombinations(attributes: ProductTemplateDTO["attributes"]): Record<string, string>[] {
  return attributes.reduce<Record<string, string>[]>((acc, attr) => {
    if (attr.values.length === 0) return acc;
    if (acc.length === 0) return attr.values.map((v) => ({ [attr.id]: v }));
    return acc.flatMap((combo) => attr.values.map((v) => ({ ...combo, [attr.id]: v })));
  }, []);
}

function comboLabel(attributes: ProductTemplateDTO["attributes"], values: Record<string, string>): string {
  return attributes.map((a) => values[a.id]).join(" / ");
}

export function ProductTemplatesScreen() {
  const query = useProductTemplates();
  const createTemplate = useCreateProductTemplate();
  const addAttribute = useAddTemplateAttribute();
  const deleteAttribute = useDeleteTemplateAttribute();
  const addValue = useAddAttributeValue();
  const deleteValue = useDeleteAttributeValue();
  const generate = useGenerateVariants();

  const templates = query.data ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(blankCreateDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attrError, setAttrError] = useState<string | null>(null);
  const [newAttrName, setNewAttrName] = useState("");
  const [newAttrValues, setNewAttrValues] = useState("");
  const [selectedCombos, setSelectedCombos] = useState<Set<string>>(new Set());

  const selected = selectedId ? templates.find((t) => t.id === selectedId) ?? null : null;
  const variantsQuery = useTemplateVariants(selectedId);
  const variants = variantsQuery.data ?? [];
  const existingKeys = useMemo(() => new Set(variants.map((v) => comboKey(v.values))), [variants]);
  const combos = useMemo(() => (selected ? cartesianCombinations(selected.attributes) : []), [selected]);

  function openCreateForm() {
    setDraft(blankCreateDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleCreateSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.code.trim() === "" || draft.nameAr.trim() === "" || draft.baseUnitCode.trim() === "") {
      setFormError("الكود والاسم ووحدة القياس مطلوبة.");
      return;
    }
    setFormError(null);
    const body: CreateProductTemplateDTO = {
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      baseUnitCode: draft.baseUnitCode.trim(),
      defaultSalePrice: draft.defaultSalePrice.trim() === "" ? null : draft.defaultSalePrice.trim(),
      defaultCost: draft.defaultCost.trim() === "" ? null : draft.defaultCost.trim(),
    };
    try {
      const created = await createTemplate.mutateAsync(body);
      setFormOpen(false);
      setSelectedId(created.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر إنشاء قالب المنتج.");
    }
  }

  async function handleAddAttribute() {
    if (!selected) return;
    const values = newAttrValues.split(",").map((v) => v.trim()).filter((v) => v !== "");
    if (newAttrName.trim() === "" || values.length === 0) {
      setAttrError("اسم الخاصية والقيم (مفصولة بفواصل) مطلوبة.");
      return;
    }
    setAttrError(null);
    try {
      await addAttribute.mutateAsync({ templateId: selected.id, body: { nameAr: newAttrName.trim(), values } });
      setNewAttrName("");
      setNewAttrValues("");
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : "تعذّر إضافة الخاصية.");
    }
  }

  async function handleDeleteAttribute(attributeId: string) {
    if (!selected) return;
    setAttrError(null);
    try {
      await deleteAttribute.mutateAsync({ templateId: selected.id, attributeId });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : "تعذّر حذف الخاصية.");
    }
  }

  async function handleDeleteValue(attributeId: string, value: string) {
    if (!selected) return;
    setAttrError(null);
    try {
      await deleteValue.mutateAsync({ templateId: selected.id, attributeId, value });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : "تعذّر حذف القيمة.");
    }
  }

  async function handleAddValue(attributeId: string, value: string) {
    if (!selected || value.trim() === "") return;
    setAttrError(null);
    try {
      await addValue.mutateAsync({ templateId: selected.id, attributeId, body: { value: value.trim() } });
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : "تعذّر إضافة القيمة.");
    }
  }

  function toggleCombo(key: string) {
    setSelectedCombos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleGenerate() {
    if (!selected) return;
    const selections = combos.filter((c) => selectedCombos.has(comboKey(c))).map((values) => ({ values }));
    if (selections.length === 0) return;
    setAttrError(null);
    try {
      await generate.mutateAsync({ templateId: selected.id, body: { selections } });
      setSelectedCombos(new Set());
    } catch (err) {
      setAttrError(err instanceof ApiError ? err.message : "تعذّر توليد المتغيرات.");
    }
  }

  const columns: DocumentListColumn<ProductTemplateDTO>[] = [
    { key: "name", header: "اسم المنتج", render: (t) => <span className="font-semibold text-ink">{t.nameAr}</span> },
    { key: "code", header: "الكود", render: (t) => <span className="mz-num text-ink-faint">{t.code}</span> },
    { key: "attributes", header: "الخصائص", align: "end", render: (t) => <span className="mz-num">{t.attributes.length}</span> },
    { key: "status", header: "الحالة", render: (t) => <StatusPill label={t.status === "active" ? "نشط" : "غير نشط"} tone={t.status === "active" ? "success" : "neutral"} /> },
  ];

  const newComboCount = combos.filter((c) => !existingKeys.has(comboKey(c))).length;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل قوالب المنتجات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<ProductTemplateDTO>
        eyebrow="Inventory · Product Templates"
        title="قوالب المنتجات"
        description="أنشئ منتجاً بخصائص (مثل اللون والمقاس) وولد المتغيرات كأصناف مستقلة"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            قالب جديد
          </Button>
        }
        stats={[{ label: "إجمالي القوالب", value: <span className="mz-num">{templates.length}</span> }]}
        columns={columns}
        rows={templates}
        rowKey={(t) => t.id}
        onRowClick={(t) => {
          setSelectedId(t.id);
          setSelectedCombos(new Set());
          setAttrError(null);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{templates.length}</span> من <span className="mz-num">{templates.length}</span> قالب
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد قوالب منتجات — أنشئ قالباً جديداً للبدء</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="قالب منتج جديد">
        <form onSubmit={handleCreateSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label="اسم المنتج *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label="الكود *" value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
          <TextField label="وحدة القياس الأساسية *" value={draft.baseUnitCode} onChange={(v) => setDraft((d) => ({ ...d, baseUnitCode: v }))} />
          <TextField label="السعر الافتراضي" value={draft.defaultSalePrice} onChange={(v) => setDraft((d) => ({ ...d, defaultSalePrice: v }))} placeholder="0.00" />
          <TextField label="التكلفة الافتراضية" value={draft.defaultCost} onChange={(v) => setDraft((d) => ({ ...d, defaultCost: v }))} placeholder="0.00" />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              إنشاء
            </Button>
          </div>
        </form>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? selected.nameAr : ""} description={selected ? selected.code : undefined}>
        {selected ? (
          <div className="flex flex-col gap-[18px]">
            {attrError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {attrError}
              </div>
            ) : null}

            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">الخصائص</h3>
              <div className="flex flex-col gap-[10px]">
                {selected.attributes.map((attr) => (
                  <Card key={attr.id} className="p-[12px_14px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-ink">
                        {attr.nameAr} <span className="text-ink-faint">({attr.values.length})</span>
                      </span>
                      <Button size="sm" onClick={() => void handleDeleteAttribute(attr.id)}>
                        حذف الخاصية
                      </Button>
                    </div>
                    <div className="mt-[8px] flex flex-wrap gap-[6px]">
                      {attr.values.map((value) => (
                        <span key={value} className="inline-flex items-center gap-[6px] rounded-full border border-border bg-surface-2 px-[10px] py-[3px] text-[12px] text-ink">
                          {value}
                          <button
                            type="button"
                            className="text-ink-faint hover:text-danger-ink"
                            aria-label={`حذف ${value}`}
                            onClick={() => void handleDeleteValue(attr.id, value)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <AddValueInline onAdd={(v) => void handleAddValue(attr.id, v)} />
                    </div>
                  </Card>
                ))}
                {selected.attributes.length === 0 ? <p className="text-[12.5px] text-ink-muted">لا توجد خصائص بعد.</p> : null}
              </div>

              <Card className="mt-[10px] p-[12px_14px]">
                <div className="flex flex-col gap-[8px]">
                  <TextField label="اسم الخاصية" value={newAttrName} onChange={setNewAttrName} placeholder="مثال: اللون" />
                  <TextField label="القيم مفصولة بفواصل" value={newAttrValues} onChange={setNewAttrValues} placeholder="أحمر, أزرق, أخضر" />
                  <Button size="sm" onClick={() => void handleAddAttribute()}>
                    إضافة خاصية
                  </Button>
                </div>
              </Card>
            </div>

            {selected.attributes.length > 0 ? (
              <div>
                <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">
                  توليد المتغيرات — <span className="mz-num">{combos.length}</span> تركيبة ممكنة،{" "}
                  <span className="mz-num">{existingKeys.size}</span> موجودة بالفعل
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-[12.5px]">
                    <thead className="bg-surface-2 text-ink-faint">
                      <tr>
                        <th className="p-[8px_10px] text-start font-semibold" />
                        <th className="p-[8px_10px] text-start font-semibold">التركيبة</th>
                        <th className="p-[8px_10px] text-end font-semibold">الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {combos.map((combo) => {
                        const key = comboKey(combo);
                        const exists = existingKeys.has(key);
                        return (
                          <tr key={key} className="border-t border-border">
                            <td className="p-[8px_10px]">
                              <input
                                type="checkbox"
                                disabled={exists}
                                checked={exists || selectedCombos.has(key)}
                                onChange={() => toggleCombo(key)}
                                aria-label={comboLabel(selected.attributes, combo)}
                              />
                            </td>
                            <td className="mz-num p-[8px_10px] text-ink">{comboLabel(selected.attributes, combo)}</td>
                            <td className="p-[8px_10px] text-end">{exists ? <StatusPill label="موجود" tone="neutral" /> : <StatusPill label="جديد" tone="success" />}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Button
                  variant="primary"
                  className="mt-[10px]"
                  disabled={selectedCombos.size === 0}
                  onClick={() => void handleGenerate()}
                >
                  توليد ({selectedCombos.size})
                </Button>
                {newComboCount === 0 && combos.length > 0 ? <p className="mt-[6px] text-[12px] text-ink-muted">تم توليد كل التركيبات الممكنة.</p> : null}
              </div>
            ) : null}

            <div>
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">
                المتغيرات (<span className="mz-num">{variants.length}</span>)
              </h3>
              <div className="flex flex-col gap-[8px]">
                {variants.map((v) => (
                  <Card key={v.id} className="flex items-center justify-between p-[10px_14px]">
                    <span className="text-[13px] font-semibold text-ink">{comboLabel(selected.attributes, v.values)}</span>
                    <span className="mz-num text-[12px] text-ink-faint">{v.itemCode}</span>
                  </Card>
                ))}
                {variants.length === 0 ? <p className="text-[12.5px] text-ink-muted">لم يتم توليد أي متغير بعد.</p> : null}
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

function AddValueInline({ onAdd }: { onAdd: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <span className="inline-flex items-center gap-[4px]">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="+ قيمة"
        aria-label="إضافة قيمة"
        className="w-[90px] rounded-full border border-dashed border-border bg-transparent px-[10px] py-[3px] text-[12px] text-ink outline-none focus:border-primary"
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim() !== "") {
            e.preventDefault();
            onAdd(value.trim());
            setValue("");
          }
        }}
      />
    </span>
  );
}
