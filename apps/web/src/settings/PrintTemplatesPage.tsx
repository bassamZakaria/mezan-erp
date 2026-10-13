import { useMemo, useState } from "react";
import { ReadOnlyFields } from "../shell/ReadOnlyForm";
import {
  Button,
  DEFAULT_PRINT_TEMPLATE_CONFIG,
  DocumentDetail,
  PrintView,
  StatusPill,
  TextInput,
  createSampleInvoiceDocument,
} from "@mezan/ui";
import { amountInWords, EGP_WORDS } from "@mezan/domain";
import type { PrintTemplateConfigDTO, PrintTemplateOverrideDTO } from "@mezan/contracts";
import { usePrintTemplateConfig, useSavePrintTemplateConfig } from "../data/hooks";
import { TextField, NumberField, SelectField, ToggleField, SectionCard, Field } from "./form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * قوالب الطباعة (Print templates) — docs/archive/catalog/09 §"قوالب الطباعة": the
 * full 9-tab designer over a typed, versioned `PrintTemplateConfig`, real
 * API-backed (GET/PUT `/print-template-config`), with a live preview of a
 * sample sales invoice through the shared `PrintView` renderer (the same
 * renderer every real document print reuses).
 */

const DOCUMENT_TYPE_OPTIONS: { value: string; key: AppTranslationKey }[] = [
  { value: "SALES_INVOICE", key: "printTemplates.salesInvoice" },
  { value: "SALES_RETURN", key: "printTemplates.salesReturn" },
  { value: "SALES_QUOTE", key: "printTemplates.quotation" },
  { value: "PURCHASE_INVOICE", key: "printTemplates.purchaseInvoice" },
  { value: "PURCHASE_RETURN", key: "printTemplates.purchaseReturn" },
  { value: "PURCHASE_ORDER", key: "printTemplates.purchaseOrder" },
  { value: "GOODS_RECEIPT", key: "printTemplates.goodsReceipt" },
  { value: "CASH_VOUCHER", key: "printTemplates.cashVoucher" },
  { value: "PAYMENT_RECEIPT", key: "printTemplates.collectionVoucher" },
];

const TRI_STATE_FIELDS: {
  section: "header" | "content" | "columns" | "totals";
  key: string;
  labelKey: AppTranslationKey;
}[] = [
  { section: "header", key: "showAddress", labelKey: "printTemplates.address" },
  { section: "header", key: "showPhone", labelKey: "common.phone" },
  { section: "header", key: "showEmail", labelKey: "common.email" },
  { section: "header", key: "showTaxNumber", labelKey: "common.taxNumber" },
  { section: "header", key: "showCommercialRegister", labelKey: "printTemplates.commercialRegistration" },
  { section: "content", key: "showBranchName", labelKey: "printTemplates.branchName" },
  { section: "content", key: "showWarehouseName", labelKey: "printTemplates.warehouseName" },
  { section: "content", key: "showPartyTaxNumber", labelKey: "printTemplates.customerSupplierTaxNumber" },
  { section: "content", key: "showPaymentTerms", labelKey: "printTemplates.paymentTerms" },
  { section: "content", key: "showNotes", labelKey: "common.notes" },
  { section: "columns", key: "showItemCode", labelKey: "printTemplates.itemCode" },
  { section: "columns", key: "showUnit", labelKey: "common.unit" },
  { section: "columns", key: "showDescription", labelKey: "printTemplates.description" },
  { section: "columns", key: "showLineDiscount", labelKey: "printTemplates.lineDiscount" },
  { section: "columns", key: "showLineTaxPercent", labelKey: "printTemplates.lineTaxRate" },
  { section: "columns", key: "showLineTaxAmount", labelKey: "printTemplates.lineTaxAmount" },
  { section: "totals", key: "showSubtotal", labelKey: "printTemplates.subtotal" },
  { section: "totals", key: "showTotalDiscount", labelKey: "printTemplates.totalDiscount" },
  { section: "totals", key: "showTaxBreakdown", labelKey: "printTemplates.taxBreakdown" },
  { section: "totals", key: "showAmountInWords", labelKey: "printTemplates.amountInWords" },
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
  const { t } = useAppTranslation();
  return (
    <SelectField
      label={label}
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onChange={(v) => onChange(v === "inherit" ? undefined : v === "on")}
      options={[
        { value: "inherit", label: t("printTemplates.defaultNoOverride") },
        { value: "on", label: t("printTemplates.show") },
        { value: "off", label: t("printTemplates.hide") },
      ]}
    />
  );
}

function signatureLabelList(count: number, labels: readonly string[]): string[] {
  const list = [...labels];
  while (list.length < count) list.push("");
  return list.slice(0, count);
}

export function PrintTemplatesPage() {
  return (
    <ReadOnlyFields>
      <PrintTemplatesPageContent />
    </ReadOnlyFields>
  );
}

function PrintTemplatesPageContent() {
  const { t } = useAppTranslation();
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
    const base = createSampleInvoiceDocument({}, t);
    return { ...base, totals: { ...base.totals, amountInWords: amountInWords(base.totals.grandTotal, EGP_WORDS) } };
  }, [t]);

  const activeOverride = config.perDocumentOverrides[overrideDocType] ?? {};

  function handleSave() {
    save.mutate(config, { onSuccess: () => setDraft(null) });
  }

  if (query.isLoading) {
    return <p className="text-[13px] text-ink-muted">{t("printTemplates.loadingThePrintTemplate")}</p>;
  }
  if (query.isError) {
    return <StatusPill label={query.error?.message ?? t("printTemplates.couldNotLoadThePrint")} tone="danger" />;
  }

  return (
    <DocumentDetail
      title={t("printTemplates.printTemplates")}
      subtitle={t("printTemplates.designTheCompanySDefault")}
      statusLabel={dirty ? t("printTemplates.unsavedChanges") : undefined}
      statusTone={dirty ? "warning" : "neutral"}
      actions={
        <>
          {save.isError ? <StatusPill label={t("printTemplates.couldNotSaveTheTemplate")} tone="danger" /> : null}
          <Button variant="default" disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
            {t("printTemplates.discard")}
          </Button>
          <Button variant="primary" disabled={!dirty || save.isPending} onClick={handleSave}>
            {save.isPending ? t("printTemplates.saving") : t("printTemplates.saveTheTemplate")}
          </Button>
        </>
      }
      aside={
        <div className="flex flex-col gap-[8px]">
          <h3 className="text-[12.5px] font-semibold text-ink">{t("printTemplates.livePreview")}</h3>
          <div className="max-h-[720px] overflow-auto rounded-lg border border-border">
            <PrintView config={config} document={previewDocument} showToolbar={false} className="origin-top-left scale-[0.62]" />
          </div>
        </div>
      }
      tabs={[
        {
          key: "identity",
          label: t("printTemplates.identity"),
          content: (
            <SectionCard title={t("printTemplates.logoAndVisualIdentity")}>
              <TextField label={t("printTemplates.logoUrl")} value={config.identity.logoUrl ?? ""} onChange={(v) => patchSection("identity", { logoUrl: v || undefined })} placeholder="https://…/logo.png" />
              <SelectField
                label={t("printTemplates.logoPosition")}
                value={config.identity.logoPosition}
                onChange={(v) => patchSection("identity", { logoPosition: v as PrintTemplateConfigDTO["identity"]["logoPosition"] })}
                options={[
                  { value: "start", label: t("printTemplates.start") },
                  { value: "end", label: t("printTemplates.end") },
                  { value: "center", label: t("printTemplates.centre") },
                ]}
              />
              <SelectField
                label={t("printTemplates.logoSize")}
                value={config.identity.logoSize}
                onChange={(v) => patchSection("identity", { logoSize: v as PrintTemplateConfigDTO["identity"]["logoSize"] })}
                options={[
                  { value: "small", label: t("printTemplates.small") },
                  { value: "medium", label: t("printTemplates.medium") },
                  { value: "large", label: t("printTemplates.large") },
                ]}
              />
              <Field label={t("printTemplates.primaryColour")} hint={t("printTemplates.theColourOfTheDocument")}>
                <div className="flex items-center gap-[8px]">
                  <input
                    type="color"
                    value={config.identity.primaryColor}
                    onChange={(e) => patchSection("identity", { primaryColor: e.target.value })}
                    className="h-[36px] w-[44px] rounded-md border border-border bg-transparent"
                  />
                  <TextInput
                    value={config.identity.primaryColor}
                    onChange={(e) => patchSection("identity", { primaryColor: e.target.value })}
                  />
                </div>
              </Field>
              <TextField label={t("printTemplates.tagline")} value={config.identity.subtitle ?? ""} onChange={(v) => patchSection("identity", { subtitle: v || undefined })} placeholder={t("printTemplates.fullAccountingAndFinanceServices")} />
              <SelectField
                label={t("printTemplates.pageSize")}
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
          label: t("printTemplates.header"),
          content: (
            <SectionCard title={t("printTemplates.theCompanyDetailsShownIn")}>
              <ToggleField label={t("printTemplates.address")} checked={config.header.showAddress} onChange={(v) => patchSection("header", { showAddress: v })} />
              <ToggleField label={t("common.phone")} checked={config.header.showPhone} onChange={(v) => patchSection("header", { showPhone: v })} />
              <ToggleField label={t("common.email")} checked={config.header.showEmail} onChange={(v) => patchSection("header", { showEmail: v })} />
              <ToggleField label={t("common.taxNumber")} checked={config.header.showTaxNumber} onChange={(v) => patchSection("header", { showTaxNumber: v })} />
              <ToggleField label={t("printTemplates.commercialRegistration")} checked={config.header.showCommercialRegister} onChange={(v) => patchSection("header", { showCommercialRegister: v })} />
            </SectionCard>
          ),
        },
        {
          key: "content",
          label: t("printTemplates.content"),
          content: (
            <SectionCard title={t("printTemplates.documentContentFields")}>
              <ToggleField label={t("printTemplates.branchName")} checked={config.content.showBranchName} onChange={(v) => patchSection("content", { showBranchName: v })} />
              <ToggleField label={t("printTemplates.warehouseName")} checked={config.content.showWarehouseName} onChange={(v) => patchSection("content", { showWarehouseName: v })} />
              <ToggleField label={t("printTemplates.customerSupplierTaxNumber")} checked={config.content.showPartyTaxNumber} onChange={(v) => patchSection("content", { showPartyTaxNumber: v })} />
              <ToggleField label={t("printTemplates.paymentTerms")} checked={config.content.showPaymentTerms} onChange={(v) => patchSection("content", { showPaymentTerms: v })} />
              <ToggleField label={t("common.notes")} checked={config.content.showNotes} onChange={(v) => patchSection("content", { showNotes: v })} />
            </SectionCard>
          ),
        },
        {
          key: "columns",
          label: t("printTemplates.itemColumns"),
          content: (
            <SectionCard title={t("printTemplates.theColumnsOfTheItem")}>
              <ToggleField label={t("printTemplates.itemCode")} checked={config.columns.showItemCode} onChange={(v) => patchSection("columns", { showItemCode: v })} />
              <ToggleField label={t("common.unit")} checked={config.columns.showUnit} onChange={(v) => patchSection("columns", { showUnit: v })} />
              <ToggleField label={t("printTemplates.description")} checked={config.columns.showDescription} onChange={(v) => patchSection("columns", { showDescription: v })} />
              <ToggleField label={t("printTemplates.lineDiscount")} checked={config.columns.showLineDiscount} onChange={(v) => patchSection("columns", { showLineDiscount: v })} />
              <ToggleField label={t("printTemplates.lineTaxRate")} checked={config.columns.showLineTaxPercent} onChange={(v) => patchSection("columns", { showLineTaxPercent: v })} />
              <ToggleField label={t("printTemplates.lineTaxAmount")} checked={config.columns.showLineTaxAmount} onChange={(v) => patchSection("columns", { showLineTaxAmount: v })} />
            </SectionCard>
          ),
        },
        {
          key: "totals",
          label: t("printTemplates.totals"),
          content: (
            <SectionCard title={t("printTemplates.showingTheTotalsAndThe")}>
              <ToggleField label={t("printTemplates.subtotal")} checked={config.totals.showSubtotal} onChange={(v) => patchSection("totals", { showSubtotal: v })} />
              <ToggleField label={t("printTemplates.totalDiscount")} checked={config.totals.showTotalDiscount} onChange={(v) => patchSection("totals", { showTotalDiscount: v })} />
              <ToggleField label={t("printTemplates.taxBreakdown")} checked={config.totals.showTaxBreakdown} onChange={(v) => patchSection("totals", { showTaxBreakdown: v })} />
              <ToggleField
                label={t("printTemplates.writeTheAmountInWords")}
                checked={config.totals.showAmountInWords}
                onChange={(v) => patchSection("totals", { showAmountInWords: v })}
                hint={t("printTemplates.derivedFromTheDocumentTotal")}
              />
            </SectionCard>
          ),
        },
        {
          key: "footer",
          label: t("printTemplates.footer"),
          content: (
            <SectionCard title={t("printTemplates.footerTextAndSignatures")}>
              <TextField label={t("printTemplates.footerText")} value={config.footer.text ?? ""} onChange={(v) => patchSection("footer", { text: v || undefined })} />
              <ToggleField label={t("printTemplates.showSignatures")} checked={config.footer.showSignatures} onChange={(v) => patchSection("footer", { showSignatures: v })} />
              <NumberField
                label={t("printTemplates.numberOfSignatures")}
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
                  label={t("printTemplates.signatureLabel", { n: String(i + 1) })}
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
          label: t("printTemplates.watermark"),
          content: (
            <SectionCard title={t("printTemplates.watermark")} description={t("printTemplates.switchedOffAutomaticallyWhenThe")}>
              <TextField label={t("printTemplates.watermarkText")} value={config.watermark.text ?? ""} onChange={(v) => patchSection("watermark", { text: v || undefined })} placeholder={t("printTemplates.eGDraft")} />
              <NumberField label={t("printTemplates.opacity01")} value={config.watermark.opacity} min={0} max={1} step={0.01} onChange={(v) => patchSection("watermark", { opacity: v })} />
            </SectionCard>
          ),
        },
        {
          key: "pos",
          label: t("printTemplates.pointOfSaleReceipt"),
          content: (
            <SectionCard title={t("printTemplates.pointOfSalePosReceipt")}>
              <ToggleField label={t("printTemplates.showTheDocumentTitle")} checked={config.posReceipt.showTitle} onChange={(v) => patchSection("posReceipt", { showTitle: v })} />
              <ToggleField label={t("printTemplates.showTheTaxNumber")} checked={config.posReceipt.showTaxNumber} onChange={(v) => patchSection("posReceipt", { showTaxNumber: v })} />
              <ToggleField label={t("printTemplates.showTheCustomerName")} checked={config.posReceipt.showCustomerName} onChange={(v) => patchSection("posReceipt", { showCustomerName: v })} />
              <TextField label={t("printTemplates.thankYouText")} value={config.posReceipt.thankYouText ?? ""} onChange={(v) => patchSection("posReceipt", { thankYouText: v || undefined })} />
            </SectionCard>
          ),
        },
        {
          key: "overrides",
          label: t("printTemplates.perDocumentOverrides"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("printTemplates.pickADocumentTypeTo")}>
                <SelectField label={t("printTemplates.documentType")} value={overrideDocType} onChange={setOverrideDocType} options={DOCUMENT_TYPE_OPTIONS.map(({ value, key }) => ({ value, label: t(key) }))} />
              </SectionCard>
              <SectionCard
                title={t("printTemplates.overridesForThisDocument")}
                description={t("printTemplates.defaultMeansFollowTheGeneral")}
              >
                {TRI_STATE_FIELDS.map((f) => (
                  <TriStateField
                    key={`${f.section}.${f.key}`}
                    label={t(f.labelKey)}
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
