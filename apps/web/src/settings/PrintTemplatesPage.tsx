import { useMemo, useState } from "react";
import { DocumentDetail, Button, StatusPill, PrintView, DEFAULT_PRINT_TEMPLATE_CONFIG, createSampleInvoiceDocument } from "@mezan/ui";
import { amountInWords, EGP_WORDS } from "@mezan/domain";
import type { PrintTemplateConfigDTO, PrintTemplateOverrideDTO } from "@mezan/contracts";
import { usePrintTemplateConfig, useSavePrintTemplateConfig } from "../data/hooks";
import { TextField, NumberField, SelectField, ToggleField, SectionCard, Field } from "./form-controls";

/**
 * قوالب الطباعة (Print templates) — docs/catalog/09 §"قوالب الطباعة": the
 * full 9-tab designer over a typed, versioned `PrintTemplateConfig`, real
 * API-backed (GET/PUT `/print-template-config`), with a live preview of a
 * sample sales invoice through the shared `PrintView` renderer (the same
 * renderer every real document print reuses).
 */

const DOCUMENT_TYPE_OPTIONS = [
  { value: "SALES_INVOICE", label: "فاتورة مبيعات" },
  { value: "SALES_RETURN", label: "مرتجع مبيعات" },
  { value: "SALES_QUOTE", label: "عرض سعر" },
  { value: "PURCHASE_INVOICE", label: "فاتورة مشتريات" },
  { value: "PURCHASE_RETURN", label: "مرتجع مشتريات" },
  { value: "PURCHASE_ORDER", label: "أمر شراء" },
  { value: "GOODS_RECEIPT", label: "استلام بضاعة" },
  { value: "CASH_VOUCHER", label: "سند نقدي" },
  { value: "PAYMENT_RECEIPT", label: "سند تحصيل" },
];

const TRI_STATE_FIELDS: {
  section: "header" | "content" | "columns" | "totals";
  key: string;
  label: string;
}[] = [
  { section: "header", key: "showAddress", label: "العنوان" },
  { section: "header", key: "showPhone", label: "الهاتف" },
  { section: "header", key: "showEmail", label: "البريد الإلكتروني" },
  { section: "header", key: "showTaxNumber", label: "الرقم الضريبي" },
  { section: "header", key: "showCommercialRegister", label: "السجل التجاري" },
  { section: "content", key: "showBranchName", label: "اسم الفرع" },
  { section: "content", key: "showWarehouseName", label: "اسم المستودع" },
  { section: "content", key: "showPartyTaxNumber", label: "الرقم الضريبي للعميل/المورد" },
  { section: "content", key: "showPaymentTerms", label: "شروط الدفع" },
  { section: "content", key: "showNotes", label: "الملاحظات" },
  { section: "columns", key: "showItemCode", label: "كود الصنف" },
  { section: "columns", key: "showUnit", label: "الوحدة" },
  { section: "columns", key: "showDescription", label: "الوصف" },
  { section: "columns", key: "showLineDiscount", label: "خصم السطر" },
  { section: "columns", key: "showLineTaxPercent", label: "نسبة ضريبة السطر" },
  { section: "columns", key: "showLineTaxAmount", label: "مبلغ ضريبة السطر" },
  { section: "totals", key: "showSubtotal", label: "المجموع الفرعي" },
  { section: "totals", key: "showTotalDiscount", label: "إجمالي الخصم" },
  { section: "totals", key: "showTaxBreakdown", label: "تفاصيل الضريبة" },
  { section: "totals", key: "showAmountInWords", label: "المبلغ بالحروف" },
];

function TriStateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <SelectField
      label={label}
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onChange={(v) => onChange(v === "inherit" ? undefined : v === "on")}
      options={[
        { value: "inherit", label: "افتراضي (بدون تخصيص)" },
        { value: "on", label: "إظهار" },
        { value: "off", label: "إخفاء" },
      ]}
    />
  );
}

function signatureLabelList(count: number, labels: readonly string[]): string[] {
  const list = [...labels];
  while (list.length < count) list.push("");
  return list.slice(0, Math.max(count, list.length));
}

export function PrintTemplatesPage() {
  const query = usePrintTemplateConfig();
  const save = useSavePrintTemplateConfig();
  const [draft, setDraft] = useState<PrintTemplateConfigDTO | null>(null);
  const [overrideDocType, setOverrideDocType] = useState(DOCUMENT_TYPE_OPTIONS[0]!.value);

  const config = draft ?? query.data ?? (DEFAULT_PRINT_TEMPLATE_CONFIG as PrintTemplateConfigDTO);
  const dirty = draft !== null;

  function patch(p: Partial<PrintTemplateConfigDTO>) {
    setDraft({ ...config, ...p });
  }
  function patchSection<K extends keyof PrintTemplateConfigDTO>(section: K, p: Partial<PrintTemplateConfigDTO[K]>) {
    setDraft({ ...config, [section]: { ...(config[section] as object), ...p } });
  }
  function patchOverride(docType: string, p: PrintTemplateOverrideDTO) {
    const current = config.perDocumentOverrides[docType] ?? {};
    setDraft({
      ...config,
      perDocumentOverrides: { ...config.perDocumentOverrides, [docType]: { ...current, ...p } },
    });
  }

  const previewDocument = useMemo(() => {
    const base = createSampleInvoiceDocument();
    return { ...base, totals: { ...base.totals, amountInWords: amountInWords(base.totals.grandTotal, EGP_WORDS) } };
  }, []);

  const activeOverride = config.perDocumentOverrides[overrideDocType] ?? {};

  function handleSave() {
    save.mutate(config, { onSuccess: () => setDraft(null) });
  }

  if (query.isLoading) {
    return <p className="text-[13px] text-ink-muted">جارِ تحميل قالب الطباعة…</p>;
  }
  if (query.isError) {
    return <StatusPill label="تعذّر تحميل قالب الطباعة." tone="danger" />;
  }

  return (
    <DocumentDetail
      title="قوالب الطباعة"
      subtitle="تصميم قالب الطباعة الافتراضي للمنشأة — يستخدمه محرك الطباعة الموحّد لكل أنواع المستندات."
      statusLabel={dirty ? "تغييرات غير محفوظة" : undefined}
      statusTone={dirty ? "warning" : "neutral"}
      actions={
        <>
          {save.isError ? <StatusPill label="تعذر حفظ القالب" tone="danger" /> : null}
          <Button variant="default" disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
            تراجع
          </Button>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={handleSave}>
            {save.isPending ? "جارِ الحفظ…" : "حفظ القالب"}
          </Button>
        </>
      }
      aside={
        <div className="flex flex-col gap-[8px]">
          <h3 className="text-[12.5px] font-semibold text-ink">معاينة حية</h3>
          <div className="max-h-[720px] overflow-auto rounded-lg border border-border">
            <PrintView config={config} document={previewDocument} showToolbar={false} className="origin-top-left scale-[0.62]" />
          </div>
        </div>
      }
      tabs={[
        {
          key: "identity",
          label: "الهوية",
          content: (
            <SectionCard title="الشعار والهوية البصرية">
              <TextField label="رابط الشعار" value={config.identity.logoUrl ?? ""} onChange={(v) => patchSection("identity", { logoUrl: v || undefined })} placeholder="https://…/logo.png" />
              <SelectField
                label="موضع الشعار"
                value={config.identity.logoPosition}
                onChange={(v) => patchSection("identity", { logoPosition: v as PrintTemplateConfigDTO["identity"]["logoPosition"] })}
                options={[
                  { value: "start", label: "البداية" },
                  { value: "end", label: "النهاية" },
                  { value: "center", label: "الوسط" },
                ]}
              />
              <SelectField
                label="حجم الشعار"
                value={config.identity.logoSize}
                onChange={(v) => patchSection("identity", { logoSize: v as PrintTemplateConfigDTO["identity"]["logoSize"] })}
                options={[
                  { value: "small", label: "صغير" },
                  { value: "medium", label: "متوسط" },
                  { value: "large", label: "كبير" },
                ]}
              />
              <Field label="اللون الأساسي" hint="لون عنوان المستند والحدود والفواصل">
                <div className="flex items-center gap-[8px]">
                  <input
                    type="color"
                    value={config.identity.primaryColor}
                    onChange={(e) => patchSection("identity", { primaryColor: e.target.value })}
                    className="h-[36px] w-[44px] rounded-md border border-border bg-transparent"
                  />
                  <input
                    type="text"
                    value={config.identity.primaryColor}
                    onChange={(e) => patchSection("identity", { primaryColor: e.target.value })}
                    className="w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
                  />
                </div>
              </Field>
              <TextField label="الوصف الفرعي (Tagline)" value={config.identity.subtitle ?? ""} onChange={(v) => patchSection("identity", { subtitle: v || undefined })} placeholder="خدمات محاسبية ومالية متكاملة" />
              <SelectField
                label="مقاس الصفحة"
                value={config.pageSize}
                onChange={(v) => patch({ pageSize: v as PrintTemplateConfigDTO["pageSize"] })}
                options={[
                  { value: "A4", label: "A4" },
                  { value: "A5", label: "A5" },
                ]}
              />
            </SectionCard>
          ),
        },
        {
          key: "header",
          label: "الترويسة",
          content: (
            <SectionCard title="بيانات المنشأة الظاهرة في الترويسة">
              <ToggleField label="العنوان" checked={config.header.showAddress} onChange={(v) => patchSection("header", { showAddress: v })} />
              <ToggleField label="الهاتف" checked={config.header.showPhone} onChange={(v) => patchSection("header", { showPhone: v })} />
              <ToggleField label="البريد الإلكتروني" checked={config.header.showEmail} onChange={(v) => patchSection("header", { showEmail: v })} />
              <ToggleField label="الرقم الضريبي" checked={config.header.showTaxNumber} onChange={(v) => patchSection("header", { showTaxNumber: v })} />
              <ToggleField label="السجل التجاري" checked={config.header.showCommercialRegister} onChange={(v) => patchSection("header", { showCommercialRegister: v })} />
            </SectionCard>
          ),
        },
        {
          key: "content",
          label: "المحتوى",
          content: (
            <SectionCard title="حقول محتوى المستند">
              <ToggleField label="اسم الفرع" checked={config.content.showBranchName} onChange={(v) => patchSection("content", { showBranchName: v })} />
              <ToggleField label="اسم المستودع" checked={config.content.showWarehouseName} onChange={(v) => patchSection("content", { showWarehouseName: v })} />
              <ToggleField label="الرقم الضريبي للعميل/المورد" checked={config.content.showPartyTaxNumber} onChange={(v) => patchSection("content", { showPartyTaxNumber: v })} />
              <ToggleField label="شروط الدفع" checked={config.content.showPaymentTerms} onChange={(v) => patchSection("content", { showPaymentTerms: v })} />
              <ToggleField label="الملاحظات" checked={config.content.showNotes} onChange={(v) => patchSection("content", { showNotes: v })} />
            </SectionCard>
          ),
        },
        {
          key: "columns",
          label: "أعمدة الأصناف",
          content: (
            <SectionCard title="أعمدة جدول الأصناف">
              <ToggleField label="كود الصنف" checked={config.columns.showItemCode} onChange={(v) => patchSection("columns", { showItemCode: v })} />
              <ToggleField label="الوحدة" checked={config.columns.showUnit} onChange={(v) => patchSection("columns", { showUnit: v })} />
              <ToggleField label="الوصف" checked={config.columns.showDescription} onChange={(v) => patchSection("columns", { showDescription: v })} />
              <ToggleField label="خصم السطر" checked={config.columns.showLineDiscount} onChange={(v) => patchSection("columns", { showLineDiscount: v })} />
              <ToggleField label="نسبة ضريبة السطر" checked={config.columns.showLineTaxPercent} onChange={(v) => patchSection("columns", { showLineTaxPercent: v })} />
              <ToggleField label="مبلغ ضريبة السطر" checked={config.columns.showLineTaxAmount} onChange={(v) => patchSection("columns", { showLineTaxAmount: v })} />
            </SectionCard>
          ),
        },
        {
          key: "totals",
          label: "الإجماليات",
          content: (
            <SectionCard title="عرض الإجماليات والمبلغ بالحروف">
              <ToggleField label="المجموع الفرعي" checked={config.totals.showSubtotal} onChange={(v) => patchSection("totals", { showSubtotal: v })} />
              <ToggleField label="إجمالي الخصم" checked={config.totals.showTotalDiscount} onChange={(v) => patchSection("totals", { showTotalDiscount: v })} />
              <ToggleField label="تفاصيل الضريبة" checked={config.totals.showTaxBreakdown} onChange={(v) => patchSection("totals", { showTaxBreakdown: v })} />
              <ToggleField
                label="كتابة المبلغ بالحروف"
                checked={config.totals.showAmountInWords}
                onChange={(v) => patchSection("totals", { showAmountInWords: v })}
                hint="يُحسب تلقائيًا من إجمالي المستند عبر محرك تحويل الأرقام إلى حروف عربية"
              />
            </SectionCard>
          ),
        },
        {
          key: "footer",
          label: "التذييل",
          content: (
            <SectionCard title="نص التذييل والتوقيعات">
              <TextField label="نص التذييل" value={config.footer.text ?? ""} onChange={(v) => patchSection("footer", { text: v || undefined })} />
              <ToggleField label="إظهار التوقيعات" checked={config.footer.showSignatures} onChange={(v) => patchSection("footer", { showSignatures: v })} />
              <NumberField
                label="عدد التوقيعات"
                value={config.footer.signatureCount}
                min={0}
                max={6}
                onChange={(v) =>
                  patchSection("footer", {
                    signatureCount: v,
                    signatureLabels: signatureLabelList(v, config.footer.signatureLabels),
                  })
                }
              />
              {signatureLabelList(config.footer.signatureCount, config.footer.signatureLabels).map((label, i) => (
                <TextField
                  key={i}
                  label={`تسمية التوقيع ${i + 1}`}
                  value={label}
                  onChange={(v) => {
                    const labels = signatureLabelList(config.footer.signatureCount, config.footer.signatureLabels);
                    labels[i] = v;
                    patchSection("footer", { signatureLabels: labels });
                  }}
                />
              ))}
            </SectionCard>
          ),
        },
        {
          key: "watermark",
          label: "العلامة المائية",
          content: (
            <SectionCard title="العلامة المائية" description="تُعطَّل تلقائيًا عند ترك النص فارغًا، بصرف النظر عن الشفافية">
              <TextField label="نص العلامة المائية" value={config.watermark.text ?? ""} onChange={(v) => patchSection("watermark", { text: v || undefined })} placeholder="مثال: مسودة" />
              <NumberField label="الشفافية (0-1)" value={config.watermark.opacity} min={0} max={1} step={0.01} onChange={(v) => patchSection("watermark", { opacity: v })} />
            </SectionCard>
          ),
        },
        {
          key: "pos",
          label: "إيصال نقطة البيع",
          content: (
            <SectionCard title="تنسيق إيصال نقطة البيع (POS)">
              <ToggleField label="إظهار عنوان المستند" checked={config.posReceipt.showTitle} onChange={(v) => patchSection("posReceipt", { showTitle: v })} />
              <ToggleField label="إظهار الرقم الضريبي" checked={config.posReceipt.showTaxNumber} onChange={(v) => patchSection("posReceipt", { showTaxNumber: v })} />
              <ToggleField label="إظهار اسم العميل" checked={config.posReceipt.showCustomerName} onChange={(v) => patchSection("posReceipt", { showCustomerName: v })} />
              <TextField label="نص الشكر" value={config.posReceipt.thankYouText ?? ""} onChange={(v) => patchSection("posReceipt", { thankYouText: v || undefined })} />
            </SectionCard>
          ),
        },
        {
          key: "overrides",
          label: "تخصيص حسب الوثيقة",
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title="اختر نوع المستند لتخصيصه">
                <SelectField label="نوع المستند" value={overrideDocType} onChange={setOverrideDocType} options={DOCUMENT_TYPE_OPTIONS} />
              </SectionCard>
              <SectionCard
                title="تخصيصات هذا المستند"
                description="القيمة «افتراضي» تعني اتباع إعداد القالب العام أعلاه — أي تخصيص هنا يطبَّق فقط على هذا النوع من المستندات"
              >
                {TRI_STATE_FIELDS.map((f) => (
                  <TriStateField
                    key={`${f.section}.${f.key}`}
                    label={f.label}
                    value={(activeOverride[f.section] as Record<string, boolean> | undefined)?.[f.key]}
                    onChange={(v) => {
                      const section = (activeOverride[f.section] as Record<string, boolean> | undefined) ?? {};
                      const next = { ...section, [f.key]: v };
                      if (v === undefined) delete next[f.key];
                      patchOverride(overrideDocType, { [f.section]: next } as PrintTemplateOverrideDTO);
                    }}
                  />
                ))}
              </SectionCard>
            </div>
          ),
        },
      ]}
    />
  );
}
