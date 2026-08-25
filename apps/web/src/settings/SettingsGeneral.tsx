import { useState } from "react";
import { DocumentDetail, Button, Card, StatusPill } from "@mezan/ui";
import type { TenantSettingsDTO, UpdateTenantSettingsDTO } from "@mezan/contracts";
import { useSettings, useUpdateSettings } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { TextField, NumberField, SelectField, ToggleField, MultiChipField, SectionCard } from "./form-controls";

/**
 * Settings — عام hub (docs/catalog/09 §"الإعدادات — عام"): the tabbed
 * tenant-config screen. Four tabs cover the fields the assignment scoped —
 * general/regional, company profile, tax mode, and the credit-control /
 * inventory / purchase / treasury policy flags (grouped into one "Policies"
 * tab here rather than 4 separate ones, to keep the nav shallow).
 *
 * Real data: edits live in a local draft buffer and "حفظ الإعدادات" PUTs the
 * whole draft to /settings — the server re-validates it through the domain's
 * `updateSettings` and returns 422 on an invalid combination.
 */

const WEEKDAY_KEYS: { value: string; key: AppTranslationKey }[] = [
  { value: "0", key: "settingsGeneral.sunday" },
  { value: "1", key: "settingsGeneral.monday" },
  { value: "2", key: "settingsGeneral.tuesday" },
  { value: "3", key: "settingsGeneral.wednesday" },
  { value: "4", key: "settingsGeneral.thursday" },
  { value: "5", key: "settingsGeneral.friday" },
  { value: "6", key: "settingsGeneral.saturday" },
];

const CURRENCY_OPTIONS = [
  { value: "SAR", label: "SAR" },
  { value: "USD", label: "USD" },
  { value: "AED", label: "AED" },
  { value: "EUR", label: "EUR" },
  { value: "KWD", label: "KWD" },
  { value: "QAR", label: "QAR" },
  { value: "JOD", label: "JOD" },
];

function SettingsForm({ initial }: { initial: TenantSettingsDTO }) {
  const { t } = useAppTranslation();
  const updateSettingsMutation = useUpdateSettings();
  const [draft, setDraft] = useState<TenantSettingsDTO>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(p: Partial<TenantSettingsDTO>) {
    setDraft((prev) => ({ ...prev, ...p }));
    setDirty(true);
  }

  async function handleSave() {
    try {
      const saved = await updateSettingsMutation.mutateAsync(draft as UpdateTenantSettingsDTO);
      setDraft(saved);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsGeneral.couldNotSaveTheSettings"));
    }
  }

  return (
    <DocumentDetail
      title={t("settingsGeneral.settings")}
      statusLabel={dirty ? t("settingsGeneral.unsavedChanges") : undefined}
      statusTone={dirty ? "warning" : "neutral"}
      subtitle={t("settingsGeneral.companyWideSettingsTheCompany")}
      actions={
        <>
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <Button variant="primary" disabled={!dirty} onClick={handleSave}>
            {t("settingsGeneral.saveTheSettings")}
          </Button>
        </>
      }
      tabs={[
        {
          key: "general",
          label: t("settingsGeneral.general"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("settingsGeneral.currency")}>
                <TextField label={t("settingsGeneral.defaultCurrency")} value={draft.currency} onChange={(v) => patch({ currency: v.toUpperCase() })} />
                <MultiChipField
                  label={t("settingsGeneral.additionalCurrencies")}
                  value={[...draft.secondaryCurrencies]}
                  onChange={(v) => patch({ secondaryCurrencies: v })}
                  options={CURRENCY_OPTIONS}
                />
                <SelectField
                  label={t("settingsGeneral.policyWhenNoExchangeRate")}
                  value={draft.fxRateMissingPolicy}
                  onChange={(v) => patch({ fxRateMissingPolicy: v as TenantSettingsDTO["fxRateMissingPolicy"] })}
                  options={[
                    { value: "STRICT", label: t("settingsGeneral.strictRejectTheDocumentWhen") },
                    { value: "ALLOW_MISSING", label: t("settingsGeneral.allowItToGoThrough") },
                  ]}
                />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.timeZoneAndDate")}>
                <TextField label={t("settingsGeneral.timeZone")} value={draft.timezone} onChange={(v) => patch({ timezone: v })} />
                <TextField label={t("settingsGeneral.dateFormat")} value={draft.dateFormat} onChange={(v) => patch({ dateFormat: v })} />
                <SelectField
                  label={t("settingsGeneral.numeralSystem")}
                  value={draft.dateNumerals}
                  onChange={(v) => patch({ dateNumerals: v as TenantSettingsDTO["dateNumerals"] })}
                  options={[
                    { value: "western", label: t("settingsGeneral.westernDigits012") },
                    { value: "arabic", label: t("settingsGeneral.arabicIndicDigits") },
                  ]}
                />
                <MultiChipField
                  label={t("settingsGeneral.weekendDays")}
                  value={draft.weekendDays.map(String)}
                  onChange={(v) => patch({ weekendDays: v.map(Number) })}
                  options={WEEKDAY_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
                />
                <NumberField
                  label={t("settingsGeneral.financialYearStartsMonth")}
                  value={draft.fiscalYearStartMonth}
                  min={1}
                  max={12}
                  onChange={(v) => patch({ fiscalYearStartMonth: v })}
                />
              </SectionCard>
            </div>
          ),
        },
        {
          key: "company",
          label: t("settingsGeneral.companyDetails"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("settingsGeneral.companyDetails")}>
                <TextField label={t("settingsGeneral.companyName")} value={draft.companyName} onChange={(v) => patch({ companyName: v })} />
                <TextField
                  label={t("common.taxNumber")}
                  value={draft.taxRegistrationNumber}
                  onChange={(v) => patch({ taxRegistrationNumber: v })}
                  placeholder="300xxxxxxxxx"
                />
                <TextField
                  label={t("settingsGeneral.commercialRegistration")}
                  value={draft.commercialRegistrationNumber}
                  onChange={(v) => patch({ commercialRegistrationNumber: v })}
                />
                <TextField label={t("common.phone")} type="tel" value={draft.phone} onChange={(v) => patch({ phone: v })} />
                <TextField label={t("common.email")} type="email" value={draft.email} onChange={(v) => patch({ email: v })} />
                <TextField label={t("settingsGeneral.address")} value={draft.address} onChange={(v) => patch({ address: v })} />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.sharedHrPolicies")} description={t("settingsGeneral.leaveAndAttendanceRelyOn")}>
                <MultiChipField
                  label={t("settingsGeneral.weekendDays")}
                  value={draft.weekendDays.map(String)}
                  onChange={(v) => patch({ weekendDays: v.map(Number) })}
                  options={WEEKDAY_KEYS.map(({ value, key }) => ({ value, label: t(key) }))}
                />
                <NumberField
                  label={t("settingsGeneral.contractExpiryWarningWindowDays")}
                  value={draft.hrContractExpiryWarningDays}
                  min={7}
                  max={365}
                  onChange={(v) => patch({ hrContractExpiryWarningDays: v })}
                  hint={t("settingsGeneral.allowedRange7365Default")}
                />
                <NumberField
                  label={t("settingsGeneral.overtimeMultiplier")}
                  value={draft.overtimeMultiplier}
                  step={0.1}
                  min={1}
                  onChange={(v) => patch({ overtimeMultiplier: v })}
                />
                <NumberField
                  label={t("settingsGeneral.standardWorkingHoursADay")}
                  value={draft.standardDailyWorkHours}
                  min={1}
                  max={24}
                  onChange={(v) => patch({ standardDailyWorkHours: v })}
                />
              </SectionCard>
            </div>
          ),
        },
        {
          key: "tax",
          label: t("settingsGeneral.tax"),
          content: (
            <SectionCard title={t("settingsGeneral.vat")}>
              <ToggleField
                label={t("settingsGeneral.enableVat")}
                checked={draft.taxEnabled}
                onChange={(v) => patch({ taxEnabled: v })}
              />
              <NumberField
                label={t("settingsGeneral.defaultTaxRate")}
                value={draft.defaultTaxRate}
                min={0}
                max={100}
                onChange={(v) => patch({ defaultTaxRate: v })}
              />
              <SelectField
                label={t("settingsGeneral.howTaxIsCalculated")}
                value={draft.taxCalculation}
                onChange={(v) => patch({ taxCalculation: v as TenantSettingsDTO["taxCalculation"] })}
                options={[
                  { value: "EXCLUSIVE", label: t("settingsGeneral.exclusiveAddedToThePrice") },
                  { value: "INCLUSIVE", label: t("settingsGeneral.inclusiveAlreadyInThePrice") },
                ]}
              />
              <SelectField
                label={t("settingsGeneral.depreciationInTheMonthOf")}
                value={draft.depreciationProrate}
                onChange={(v) => patch({ depreciationProrate: v as TenantSettingsDTO["depreciationProrate"] })}
                options={[
                  { value: "DAILY", label: t("settingsGeneral.dailyProRatedIfrs") },
                  { value: "FULL_MONTH", label: t("settingsGeneral.aWholeMonth") },
                ]}
              />
              <TextField
                label={t("common.taxNumber")}
                value={draft.taxRegistrationNumber}
                onChange={(v) => patch({ taxRegistrationNumber: v })}
                placeholder="300xxxxxxxxx"
              />
            </SectionCard>
          ),
        },
        {
          key: "policies",
          label: t("settingsGeneral.policies"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("settingsGeneral.creditControl")}>
                <ToggleField label={t("settingsGeneral.enablePriceLists")} checked={draft.priceListsEnabled} onChange={(v) => patch({ priceListsEnabled: v })} />
                <ToggleField
                  label={t("settingsGeneral.enableCreditControl")}
                  checked={draft.creditControlEnabled}
                  onChange={(v) => patch({ creditControlEnabled: v })}
                />
                <SelectField
                  label={t("settingsGeneral.controlMode")}
                  value={draft.creditControlMode}
                  onChange={(v) => patch({ creditControlMode: v as TenantSettingsDTO["creditControlMode"] })}
                  options={[
                    { value: "WARNING", label: t("settingsGeneral.warnOnlyWarning") },
                    { value: "BLOCK", label: t("settingsGeneral.blockOutrightBlock") },
                  ]}
                />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.stockPolicy")}>
                <ToggleField
                  label={t("settingsGeneral.allowSellingFromAnotherWarehouse")}
                  checked={draft.allowCrossWarehouseSales}
                  onChange={(v) => patch({ allowCrossWarehouseSales: v })}
                />
                <ToggleField
                  label={t("settingsGeneral.showStockInTheOther")}
                  checked={draft.showOtherWarehouseStock}
                  onChange={(v) => patch({ showOtherWarehouseStock: v })}
                />
                <ToggleField label={t("settingsGeneral.allowBackOrders")} checked={draft.allowBackorder} onChange={(v) => patch({ allowBackorder: v })} />
                <ToggleField label={t("settingsGeneral.allowNegativeStock")} checked={draft.allowNegativeStock} onChange={(v) => patch({ allowNegativeStock: v })} />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.purchasingControls")}>
                <ToggleField
                  label={t("settingsGeneral.aPurchaseOrderIsRequired")}
                  checked={draft.requirePoForGrn}
                  onChange={(v) => patch({ requirePoForGrn: v })}
                />
                <ToggleField
                  label={t("settingsGeneral.aGoodsReceiptIsRequired")}
                  checked={draft.requireGrnForInvoice}
                  onChange={(v) => patch({ requireGrnForInvoice: v })}
                />
                <ToggleField
                  label={t("settingsGeneral.trackGoodsConsumedFromPurchase")}
                  checked={draft.trackSoldPurchaseItems}
                  onChange={(v) => patch({ trackSoldPurchaseItems: v })}
                />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.treasuryPolicy")}>
                <ToggleField
                  label={t("settingsGeneral.blockANegativeBalanceOn")}
                  checked={draft.preventNegativeCashBalance}
                  onChange={(v) => patch({ preventNegativeCashBalance: v })}
                  hint={t("settingsGeneral.appliesToCashTillsOnly")}
                />
                <ToggleField
                  label={t("settingsGeneral.allowANegativeBalanceOn")}
                  checked={draft.allowNegativeTreasury}
                  onChange={(v) => patch({ allowNegativeTreasury: v })}
                />
              </SectionCard>
            </div>
          ),
        },
      ]}
    />
  );
}

export function SettingsGeneral() {
  const { t } = useAppTranslation();
  const query = useSettings();

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("settingsGeneral.couldNotLoadTheSettings")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  if (!query.data) return null;

  return <SettingsForm initial={query.data} />;
}
