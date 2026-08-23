import { useEffect, useState } from "react";
import { Card, DocumentDetail, Button, StatusPill, IconButton } from "@mezan/ui";
import { validateBarcodeConfig, type BarcodeConfig, type EmbeddedBarcodeRule } from "@mezan/domain";
import type { BarcodeConfigDTO } from "@mezan/contracts";
import { useBarcodeConfig, useUpdateBarcodeConfig, useParseBarcode } from "../data/barcode-config-hooks";
import { NumberField, SelectField, TextField, ToggleField } from "./form-controls";

/**
 * إعدادات الباركود (Barcode configuration) — tenant-wide symbology, whether
 * an item's barcode is auto-generated or entered manually, and the
 * embedded-barcode parsing rules a scanner relies on for a price/weight
 * baked into the code (common on Egyptian retail scale labels). Barcode
 * GRAPHICS/label printing are a separate screen — this is config + parsing
 * only. Real backend (`/barcode-config`) — no sample data; a fresh tenant
 * starts with zero rules (only the universal EAN13 default symbology).
 */

const SYMBOLOGY_OPTIONS = [
  { value: "EAN13", label: "EAN-13" },
  { value: "EAN8", label: "EAN-8" },
  { value: "UPC_A", label: "UPC-A" },
  { value: "CODE128", label: "Code 128" },
  { value: "CODE39", label: "Code 39" },
];

const MODE_OPTIONS = [
  { value: "MANUAL", label: "إدخال يدوي" },
  { value: "AUTO", label: "توليد تلقائي" },
];

const VALUE_TYPE_OPTIONS = [
  { value: "PRICE", label: "سعر" },
  { value: "WEIGHT", label: "وزن" },
];

function blankRule(): EmbeddedBarcodeRule {
  return {
    id: crypto.randomUUID(),
    nameAr: "",
    prefix: "2",
    totalLength: 13,
    itemCodeStart: 1,
    itemCodeLength: 5,
    valueStart: 7,
    valueLength: 5,
    valueType: "PRICE",
    valueDecimals: 2,
    active: true,
  };
}

function RuleCard({
  rule,
  onChange,
  onRemove,
}: {
  rule: EmbeddedBarcodeRule;
  onChange: (next: EmbeddedBarcodeRule) => void;
  onRemove: () => void;
}) {
  return (
    <Card className="flex flex-col gap-[12px] p-[16px_18px]">
      <div className="flex items-start justify-between gap-[10px]">
        <div className="flex-1">
          <TextField label="اسم القاعدة" value={rule.nameAr} onChange={(v) => onChange({ ...rule, nameAr: v })} />
        </div>
        <div className="flex items-center gap-[8px] pt-[22px]">
          <StatusPill label={rule.active ? "مفعّلة" : "معطّلة"} tone={rule.active ? "success" : "neutral"} />
          <IconButton aria-label="حذف القاعدة" onClick={onRemove}>
            ×
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <TextField label="البادئة" value={rule.prefix} onChange={(v) => onChange({ ...rule, prefix: v.replace(/\D/g, "") })} hint="أرقام فقط" />
        <NumberField label="الطول الكلي" value={rule.totalLength} onChange={(v) => onChange({ ...rule, totalLength: v })} min={1} />
        <NumberField label="بداية كود الصنف" value={rule.itemCodeStart} onChange={(v) => onChange({ ...rule, itemCodeStart: v })} min={0} />
        <NumberField label="طول كود الصنف" value={rule.itemCodeLength} onChange={(v) => onChange({ ...rule, itemCodeLength: v })} min={1} />
        <NumberField label="بداية القيمة" value={rule.valueStart} onChange={(v) => onChange({ ...rule, valueStart: v })} min={0} />
        <NumberField label="طول القيمة" value={rule.valueLength} onChange={(v) => onChange({ ...rule, valueLength: v })} min={1} />
        <SelectField
          label="نوع القيمة"
          value={rule.valueType}
          onChange={(v) => onChange({ ...rule, valueType: v as EmbeddedBarcodeRule["valueType"] })}
          options={VALUE_TYPE_OPTIONS}
        />
        <NumberField label="الخانات العشرية" value={rule.valueDecimals} onChange={(v) => onChange({ ...rule, valueDecimals: v })} min={0} />
      </div>
      <ToggleField label="القاعدة مفعّلة" checked={rule.active} onChange={(v) => onChange({ ...rule, active: v })} />
    </Card>
  );
}

export function BarcodeConfigPage() {
  const query = useBarcodeConfig();
  const updateMutation = useUpdateBarcodeConfig();
  const parseMutation = useParseBarcode();

  const [draft, setDraft] = useState<BarcodeConfigDTO | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testCode, setTestCode] = useState("");

  useEffect(() => {
    if (query.data && !dirty) setDraft(query.data);
  }, [query.data, dirty]);

  function patch(p: Partial<BarcodeConfigDTO>) {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  }

  function updateRule(index: number, next: EmbeddedBarcodeRule) {
    if (!draft) return;
    const rules = [...draft.embeddedRules];
    rules[index] = next;
    patch({ embeddedRules: rules });
  }

  function addRule() {
    if (!draft) return;
    patch({ embeddedRules: [...draft.embeddedRules, blankRule()] });
  }

  function removeRule(index: number) {
    if (!draft) return;
    patch({ embeddedRules: draft.embeddedRules.filter((_, i) => i !== index) });
  }

  async function handleSave() {
    if (!draft) return;
    const reasons = validateBarcodeConfig(draft as BarcodeConfig);
    if (reasons.length > 0) {
      setError(reasons.join("، "));
      return;
    }
    try {
      const saved = await updateMutation.mutateAsync(draft);
      setDraft(saved);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ إعدادات الباركود");
    }
  }

  if (query.isLoading || draft === null) {
    return (
      <Card className="p-[24px] text-center text-[13px] text-ink-muted">
        {query.isError ? (
          <>
            <p className="font-semibold text-danger-ink">تعذّر تحميل إعدادات الباركود.</p>
            <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
              إعادة المحاولة
            </Button>
          </>
        ) : (
          "جارٍ التحميل…"
        )}
      </Card>
    );
  }

  const parseResult = parseMutation.data;

  return (
    <DocumentDetail
      title="إعدادات الباركود"
      subtitle="نوع الترميز، توليد باركود الصنف، وقواعد قراءة السعر أو الوزن المدمج داخل الباركود الممسوح"
      actions={
        <div className="flex items-center gap-[10px]">
          {error ? <span className="text-[12px] font-semibold text-danger-ink">{error}</span> : null}
          <Button variant="primary" onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
            {updateMutation.isPending ? "جارٍ الحفظ…" : "حفظ الإعدادات"}
          </Button>
        </div>
      }
      tabs={[
        {
          key: "general",
          label: "الإعدادات العامة",
          content: (
            <Card className="flex flex-col gap-[16px] p-[18px_20px]">
              <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                <SelectField
                  label="نوع الترميز الافتراضي"
                  value={draft.defaultSymbology}
                  onChange={(v) => patch({ defaultSymbology: v as BarcodeConfigDTO["defaultSymbology"] })}
                  options={SYMBOLOGY_OPTIONS}
                />
                <SelectField
                  label="طريقة تحديد باركود الصنف"
                  value={draft.itemBarcodeMode}
                  onChange={(v) => patch({ itemBarcodeMode: v as BarcodeConfigDTO["itemBarcodeMode"] })}
                  options={MODE_OPTIONS}
                  hint="يدوي: يُدخل المستخدم الباركود. تلقائي: يُولَّد رقم تسلسلي عند إنشاء الصنف."
                />
              </div>
              {draft.itemBarcodeMode === "AUTO" ? (
                <div className="max-w-[240px]">
                  <TextField
                    label="بادئة الترقيم التلقائي"
                    value={draft.autoGeneratePrefix ?? ""}
                    onChange={(v) => patch({ autoGeneratePrefix: v.replace(/\D/g, "") || null })}
                    hint="أرقام فقط، اختياري"
                  />
                </div>
              ) : null}
            </Card>
          ),
        },
        {
          key: "embedded",
          label: "قواعد الباركود المدمج",
          content: (
            <div className="flex flex-col gap-[16px]">
              <Card className="flex flex-col gap-[10px] p-[16px_18px]">
                <h3 className="font-display text-[13.5px] font-bold text-ink">اختبار مسح باركود</h3>
                <p className="text-[12px] text-ink-muted">
                  جرّب كود ممسوحًا ضوئيًا مقابل القواعد المحفوظة حاليًا (احفظ التغييرات أولًا لتظهر في نتيجة الاختبار).
                </p>
                <div className="flex flex-wrap items-end gap-[10px]">
                  <div className="max-w-[260px]">
                    <TextField label="الكود الممسوح" value={testCode} onChange={setTestCode} />
                  </div>
                  <Button onClick={() => parseMutation.mutate(testCode)} disabled={testCode.trim() === "" || parseMutation.isPending}>
                    اختبار
                  </Button>
                  {parseResult ? (
                    parseResult.matched ? (
                      <StatusPill
                        tone="success"
                        label={`تطابق: كود الصنف ${parseResult.itemCode} — ${parseResult.valueType === "PRICE" ? "سعر" : "وزن"} ${parseResult.value}`}
                      />
                    ) : (
                      <StatusPill tone="neutral" label="لا يوجد تطابق مع أي قاعدة" />
                    )
                  ) : null}
                </div>
              </Card>

              <div className="flex items-center justify-between">
                <h3 className="font-display text-[14px] font-bold text-ink">القواعد ({draft.embeddedRules.length})</h3>
                <Button size="sm" onClick={addRule}>
                  إضافة قاعدة
                </Button>
              </div>
              {draft.embeddedRules.length === 0 ? (
                <Card className="p-[18px] text-center text-[12.5px] text-ink-muted">
                  لا توجد قواعد باركود مدمج بعد. أضف قاعدة لقراءة سعر أو وزن مدمج داخل الباركود الممسوح.
                </Card>
              ) : (
                <div className="flex flex-col gap-[14px]">
                  {draft.embeddedRules.map((rule, i) => (
                    <RuleCard key={rule.id} rule={rule} onChange={(next) => updateRule(i, next)} onRemove={() => removeRule(i)} />
                  ))}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}
