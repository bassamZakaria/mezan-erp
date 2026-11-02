import { useEffect, useState } from "react";
import { READ_ONLY_CLOSE, ReadOnlyFields } from "../shell/ReadOnlyForm";
import { Card, DocumentDetail, Button, StatusPill, IconButton } from "@mezan/ui";
import { validateBarcodeConfigBilingual, type BarcodeConfig, type EmbeddedBarcodeRule } from "@mezan/domain";
import type { BarcodeConfigDTO } from "@mezan/contracts";
import { useBarcodeConfig, useUpdateBarcodeConfig, useParseBarcode } from "../data/barcode-config-hooks";
import { NumberField, SelectField, TextField, ToggleField } from "./form-controls";
import { pickLocalized } from "../data/server-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

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

const MODE_OPTION_KEYS: { value: string; key: AppTranslationKey }[] = [
  { value: "MANUAL", key: "barcode.enteredByHand" },
  { value: "AUTO", key: "barcode.generatedAutomatically" },
];

const VALUE_TYPE_OPTION_KEYS: { value: string; key: AppTranslationKey }[] = [
  { value: "PRICE", key: "barcode.price" },
  { value: "WEIGHT", key: "barcode.weight" },
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
  const { t } = useAppTranslation();
  return (
    <Card className="flex flex-col gap-[12px] p-[16px_18px]">
      <div className="flex items-start justify-between gap-[10px]">
        <div className="flex-1">
          <TextField label={t("barcode.ruleName")} value={rule.nameAr} onChange={(v) => onChange({ ...rule, nameAr: v })} />
        </div>
        <div className="flex items-center gap-[8px] pt-[22px]">
          <StatusPill label={rule.active ? t("barcode.enabled") : t("barcode.disabled")} tone={rule.active ? "success" : "neutral"} />
          <IconButton {...READ_ONLY_CLOSE} aria-label={t("barcode.deleteTheRule")} onClick={onRemove}>
            ×
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <TextField label={t("barcode.prefix")} value={rule.prefix} onChange={(v) => onChange({ ...rule, prefix: v.replace(/\D/g, "") })} hint={t("barcode.digitsOnly")} />
        <NumberField label={t("barcode.totalLength")} value={rule.totalLength} onChange={(v) => onChange({ ...rule, totalLength: v })} min={1} />
        <NumberField label={t("barcode.itemCodeStartsAt")} value={rule.itemCodeStart} onChange={(v) => onChange({ ...rule, itemCodeStart: v })} min={0} />
        <NumberField label={t("barcode.itemCodeLength")} value={rule.itemCodeLength} onChange={(v) => onChange({ ...rule, itemCodeLength: v })} min={1} />
        <NumberField label={t("barcode.valueStartsAt")} value={rule.valueStart} onChange={(v) => onChange({ ...rule, valueStart: v })} min={0} />
        <NumberField label={t("barcode.valueLength")} value={rule.valueLength} onChange={(v) => onChange({ ...rule, valueLength: v })} min={1} />
        <SelectField
          label={t("barcode.valueType")}
          value={rule.valueType}
          onChange={(v) => onChange({ ...rule, valueType: v as EmbeddedBarcodeRule["valueType"] })}
          options={VALUE_TYPE_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
        />
        <NumberField label={t("barcode.decimalPlaces")} value={rule.valueDecimals} onChange={(v) => onChange({ ...rule, valueDecimals: v })} min={0} />
      </div>
      <ToggleField label={t("barcode.theRuleIsEnabled")} checked={rule.active} onChange={(v) => onChange({ ...rule, active: v })} />
    </Card>
  );
}

export function BarcodeConfigPage() {
  return (
    <ReadOnlyFields>
      <BarcodeConfigPageContent />
    </ReadOnlyFields>
  );
}

function BarcodeConfigPageContent() {
  const { t, locale } = useAppTranslation();
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
    const reasons = validateBarcodeConfigBilingual(draft as BarcodeConfig).map((reason) => pickLocalized(reason.ar, reason.en, locale) ?? reason.ar);
    if (reasons.length > 0) {
      setError(reasons.join(t("barcode.reasonSeparator")));
      return;
    }
    try {
      const saved = await updateMutation.mutateAsync(draft);
      setDraft(saved);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("barcode.couldNotSaveTheBarcode"));
    }
  }

  if (query.isLoading || draft === null) {
    return (
      <Card className="p-[24px] text-center text-[13px] text-ink-muted">
        {query.isError ? (
          <>
            <p className="font-semibold text-danger-ink">{query.error?.message ?? t("barcode.couldNotLoadTheBarcode")}</p>
            <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
              {t("common.retry")}
            </Button>
          </>
        ) : (
          t("common.loading")
        )}
      </Card>
    );
  }

  const parseResult = parseMutation.data;

  return (
    <DocumentDetail
      title={t("barcode.barcodeSettings")}
      subtitle={t("barcode.theSymbologyHowAnItem")}
      actions={
        <div className="flex items-center gap-[10px]">
          {error ? <span className="text-[12px] font-semibold text-danger-ink">{error}</span> : null}
          <Button variant="primary" onClick={handleSave} disabled={!dirty || updateMutation.isPending}>
            {updateMutation.isPending ? t("barcode.saving") : t("barcode.saveTheSettings")}
          </Button>
        </div>
      }
      tabs={[
        {
          key: "general",
          label: t("barcode.generalSettings"),
          content: (
            <Card className="flex flex-col gap-[16px] p-[18px_20px]">
              <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                <SelectField
                  label={t("barcode.defaultSymbology")}
                  value={draft.defaultSymbology}
                  onChange={(v) => patch({ defaultSymbology: v as BarcodeConfigDTO["defaultSymbology"] })}
                  options={SYMBOLOGY_OPTIONS}
                />
                <SelectField
                  label={t("barcode.howAnItemSBarcode")}
                  value={draft.itemBarcodeMode}
                  onChange={(v) => patch({ itemBarcodeMode: v as BarcodeConfigDTO["itemBarcodeMode"] })}
                  options={MODE_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
                  hint={t("barcode.byHandTheUserTypes")}
                />
              </div>
              {draft.itemBarcodeMode === "AUTO" ? (
                <div className="max-w-[240px]">
                  <TextField
                    label={t("barcode.automaticNumberingPrefix")}
                    value={draft.autoGeneratePrefix ?? ""}
                    onChange={(v) => patch({ autoGeneratePrefix: v.replace(/\D/g, "") || null })}
                    hint={t("barcode.digitsOnlyOptional")}
                  />
                </div>
              ) : null}
            </Card>
          ),
        },
        {
          key: "embedded",
          label: t("barcode.embeddedBarcodeRules"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <Card className="flex flex-col gap-[10px] p-[16px_18px]">
                <h3 className="font-display text-[13.5px] font-bold text-ink">{t("barcode.testAScan")}</h3>
                <p className="text-[12px] text-ink-muted">
                  {t("barcode.tryAScannedCodeAgainst")}
                </p>
                <div className="flex flex-wrap items-end gap-[10px]">
                  <div className="max-w-[260px]">
                    <TextField label={t("barcode.scannedCode")} value={testCode} onChange={setTestCode} />
                  </div>
                  <Button onClick={() => parseMutation.mutate(testCode)} disabled={testCode.trim() === "" || parseMutation.isPending}>
                    {t("barcode.test")}
                  </Button>
                  {parseResult ? (
                    parseResult.matched ? (
                      <StatusPill
                        tone="success"
                        label={t("barcode.matched", { code: parseResult.itemCode, type: parseResult.valueType === "PRICE" ? t("barcode.price") : t("barcode.weight"), value: String(parseResult.value) })}
                      />
                    ) : (
                      <StatusPill tone="neutral" label={t("barcode.noRuleMatches")} />
                    )
                  ) : null}
                </div>
              </Card>

              <div className="flex items-center justify-between">
                <h3 className="font-display text-[14px] font-bold text-ink">{t("barcode.rulesCount", { count: String(draft.embeddedRules.length) })}</h3>
                <Button size="sm" onClick={addRule}>
                  {t("barcode.addARule")}
                </Button>
              </div>
              {draft.embeddedRules.length === 0 ? (
                <Card className="p-[18px] text-center text-[12.5px] text-ink-muted">
                  {t("barcode.noEmbeddedBarcodeRulesYet")}
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
