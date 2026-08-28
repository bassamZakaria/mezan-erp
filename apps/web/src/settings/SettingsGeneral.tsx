import { useState } from "react";
import { DocumentDetail, Button, Card, StatusPill } from "@mezan/ui";
import type { TenantSettingsDTO, UpdateTenantSettingsDTO } from "@mezan/contracts";
import { useSettings, useUpdateSettings, useSendTestEmail } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import {
  TextField,
  NumberField,
  SelectField,
  ToggleField,
  MultiChipField,
  TextAreaField,
  SectionCard,
} from "./form-controls";

/**
 * Settings — the tenant-config screen. FIVE tabs, in the order a company is
 * described: who it is (بيانات المنشأة), where and in what money it trades
 * (الإقليمية والعملة), what it owes (الضريبة), the rules it runs by
 * (السياسات), and how it reaches people (البريد الإلكتروني).
 *
 * It was eight tabs, and two fields rendered on two of them at once —
 * `taxRegistrationNumber` on «بيانات المنشأة» and «الضريبة», `weekendDays` on
 * «عام» and «بيانات المنشأة». Two controls bound to one field behind one save
 * button means the last tab touched wins and the other edit disappears
 * without a word. Every field now has exactly one control.
 *
 * Every switch here is read by the behaviour it names — negative stock and
 * back-orders by the stock ledger, the purchase gates by the goods-receipt and
 * purchase-invoice use-cases, the treasury flags by the cash guard, tax by the
 * invoice totals, the currency flags by every document's currency, the aging
 * provision by the write-down batch. A switch that changed nothing would be
 * worse than no switch at all.
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

/** The document currencies the platform supports (R1.15), minus whichever is the base. */
const DOCUMENT_CURRENCIES = ["EGP", "SAR", "AED", "QAR", "KWD", "BHD", "OMR", "JOD", "USD", "EUR", "GBP"];

function SettingsForm({ initial }: { initial: TenantSettingsDTO }) {
  const { t } = useAppTranslation();
  const updateSettingsMutation = useUpdateSettings();
  const testEmail = useSendTestEmail();
  const [draft, setDraft] = useState<TenantSettingsDTO>(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testRecipient, setTestRecipient] = useState(initial.email);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

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

  async function handleTestEmail() {
    setTestResult(null);
    try {
      const result = await testEmail.mutateAsync({ to: testRecipient });
      setTestResult({ ok: result.ok, message: result.message });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "" });
    }
  }

  const currencyOptions = DOCUMENT_CURRENCIES.filter((c) => c !== draft.currency).map((c) => ({ value: c, label: c }));
  // The weekday chips run from the tenant's own first day, so the Egyptian
  // week reads Saturday-first rather than starting on a Sunday nobody uses.
  const weekdayOptions = WEEKDAY_KEYS.map((_, i) => {
    const day = WEEKDAY_KEYS[(draft.weekStartDay + i) % 7] as (typeof WEEKDAY_KEYS)[number];
    return { value: day.value, label: t(day.key) };
  });

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
          key: "company",
          label: t("settingsGeneral.companyDetails"),
          content: (
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
          ),
        },
        {
          key: "regional",
          label: t("settingsGeneral.tabRegional"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("settingsGeneral.currency")}>
                <TextField label={t("settingsGeneral.defaultCurrency")} value={draft.currency} onChange={(v) => patch({ currency: v.toUpperCase() })} />
                <ToggleField
                  label={t("settingsGeneral.enableMultiCurrency")}
                  checked={draft.multiCurrencyEnabled}
                  onChange={(v) => patch({ multiCurrencyEnabled: v })}
                  hint={t("settingsGeneral.multiCurrencyHint")}
                />
                <MultiChipField
                  label={t("settingsGeneral.additionalCurrencies")}
                  hint={t("settingsGeneral.additionalCurrenciesHint")}
                  value={[...draft.secondaryCurrencies]}
                  onChange={(v) => patch({ secondaryCurrencies: v })}
                  options={currencyOptions}
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
                <SelectField
                  label={t("settingsGeneral.defaultLanguage")}
                  value={draft.language === "de" ? "ar" : draft.language}
                  onChange={(v) => patch({ language: v as TenantSettingsDTO["language"] })}
                  options={[
                    { value: "ar", label: "العربية" },
                    { value: "en", label: "English" },
                  ]}
                />
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
                <NumberField
                  label={t("settingsGeneral.financialYearStartsMonth")}
                  value={draft.fiscalYearStartMonth}
                  min={1}
                  max={12}
                  onChange={(v) => patch({ fiscalYearStartMonth: v })}
                />
                {/*
                  The working week lives here and ONLY here. It used to render
                  on «عام» AND on «بيانات المنشأة» — two controls bound to
                  weekendDays, on two tabs, behind one save button, so the tab
                  a user happened to touch last silently won.
                */}
                <SelectField
                  label={t("settingsGeneral.weekStartDay")}
                  value={String(draft.weekStartDay)}
                  onChange={(v) => patch({ weekStartDay: Number(v) })}
                  options={weekdayOptions}
                />
                <MultiChipField
                  label={t("settingsGeneral.weekendDays")}
                  value={draft.weekendDays.map(String)}
                  onChange={(v) => patch({ weekendDays: v.map(Number) })}
                  options={weekdayOptions}
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
              {/*
                The tax registration number is NOT repeated here. It identifies
                the company, it is edited on «بيانات المنشأة», and a second
                control writing the same field is a way to lose an edit.
              */}
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
            </SectionCard>
          ),
        },
        {
          key: "policies",
          label: t("settingsGeneral.tabPolicies"),
          content: (
            <div className="flex flex-col gap-[16px]">
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
                <ToggleField
                  label={t("settingsGeneral.allowBackOrders")}
                  checked={draft.allowBackorder}
                  onChange={(v) => patch({ allowBackorder: v })}
                  hint={t("settingsGeneral.allowBackOrdersHint")}
                />
                <ToggleField
                  label={t("settingsGeneral.allowNegativeStock")}
                  checked={draft.allowNegativeStock}
                  onChange={(v) => patch({ allowNegativeStock: v })}
                  hint={t("settingsGeneral.allowNegativeStockHint")}
                />
                <ToggleField
                  label={t("settingsGeneral.autoBatchNumbers")}
                  checked={draft.autoGenerateBatchNumbers}
                  onChange={(v) => patch({ autoGenerateBatchNumbers: v })}
                  hint={t("settingsGeneral.autoBatchNumbersHint")}
                />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.agingWritedown")} description={t("settingsGeneral.agingWritedownHint")}>
                <ToggleField
                  label={t("settingsGeneral.enableAgingWritedown")}
                  checked={draft.agingWritedownEnabled}
                  onChange={(v) => patch({ agingWritedownEnabled: v })}
                />
                <NumberField
                  label={t("settingsGeneral.agingWritedownMonths")}
                  value={draft.agingWritedownMonths}
                  min={1}
                  max={60}
                  onChange={(v) => patch({ agingWritedownMonths: v })}
                />
                <NumberField
                  label={t("settingsGeneral.agingWritedownRate")}
                  value={draft.agingWritedownRatePercent}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(v) => patch({ agingWritedownRatePercent: v })}
                />
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

              {/*
                Price lists are a SALES policy. They sat under «الرقابة
                الائتمانية» beside the credit limit, which described neither.
              */}
              <SectionCard title={t("settingsGeneral.salesAndCredit")}>
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
                <NumberField
                  label={t("settingsGeneral.maxLineDiscount")}
                  value={draft.maxLineDiscountPercent}
                  min={0}
                  max={100}
                  step={0.5}
                  onChange={(v) => patch({ maxLineDiscountPercent: v })}
                  hint={t("settingsGeneral.maxLineDiscountHint")}
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

              {/*
                Proration is how an asset depreciates in its first month. It was
                filed under «الضريبة», where nothing reads it.
              */}
              <SectionCard title={t("settingsGeneral.assetsPolicy")}>
                <SelectField
                  label={t("settingsGeneral.depreciationInTheMonthOf")}
                  value={draft.depreciationProrate}
                  onChange={(v) => patch({ depreciationProrate: v as TenantSettingsDTO["depreciationProrate"] })}
                  options={[
                    { value: "DAILY", label: t("settingsGeneral.dailyProRatedIfrs") },
                    { value: "FULL_MONTH", label: t("settingsGeneral.aWholeMonth") },
                  ]}
                />
              </SectionCard>

              {/*
                Who may hold an account at all. It lives beside the other
                policies rather than on «بيانات المنشأة», because it governs
                behaviour — the company's own address is identity.
              */}
              <SectionCard title={t("settingsGeneral.userAccounts")}>
                <MultiChipField
                  label={t("settingsGeneral.allowedEmailDomains")}
                  hint={t("settingsGeneral.allowedEmailDomainsHint")}
                  value={[...draft.allowedEmailDomains]}
                  onChange={(v) => patch({ allowedEmailDomains: v })}
                  options={[]}
                  allowCustom
                  customPlaceholder={t("settingsGeneral.addDomain")}
                />
              </SectionCard>

              <SectionCard title={t("settingsGeneral.sharedHrPolicies")} description={t("settingsGeneral.leaveAndAttendanceRelyOn")}>
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
          key: "email",
          label: t("settingsGeneral.email"),
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title={t("settingsGeneral.smtpServer")}>
                <ToggleField
                  label={t("settingsGeneral.enableEmail")}
                  checked={draft.smtpEnabled}
                  onChange={(v) => patch({ smtpEnabled: v })}
                />
                <TextField label={t("settingsGeneral.smtpHost")} value={draft.smtpHost} onChange={(v) => patch({ smtpHost: v })} placeholder="smtp.example.com" />
                <NumberField label={t("settingsGeneral.smtpPort")} value={draft.smtpPort} min={1} max={65535} onChange={(v) => patch({ smtpPort: v })} />
                <SelectField
                  label={t("settingsGeneral.smtpSecurity")}
                  value={draft.smtpSecurity}
                  onChange={(v) => patch({ smtpSecurity: v as TenantSettingsDTO["smtpSecurity"] })}
                  options={[
                    { value: "NONE", label: t("settingsGeneral.smtpSecurityNone") },
                    { value: "STARTTLS", label: "STARTTLS" },
                    { value: "TLS", label: "TLS" },
                  ]}
                />
                <TextField label={t("settingsGeneral.smtpUsername")} value={draft.smtpUsername} onChange={(v) => patch({ smtpUsername: v })} />
                <TextField
                  label={t("settingsGeneral.smtpPassword")}
                  type="password"
                  value={draft.smtpPassword}
                  onChange={(v) => patch({ smtpPassword: v })}
                  hint={t("settingsGeneral.smtpPasswordHint")}
                />
                <TextField label={t("settingsGeneral.smtpFromName")} value={draft.smtpFromName} onChange={(v) => patch({ smtpFromName: v })} />
                <TextField
                  label={t("settingsGeneral.smtpFromEmail")}
                  type="email"
                  value={draft.smtpFromEmail}
                  onChange={(v) => patch({ smtpFromEmail: v })}
                />
                <TextField
                  label={t("settingsGeneral.testEmailRecipient")}
                  type="email"
                  value={testRecipient}
                  onChange={setTestRecipient}
                  hint={dirty ? t("settingsGeneral.saveBeforeTest") : undefined}
                />
                <div className="flex items-center gap-[10px] self-end">
                  <Button
                    size="sm"
                    disabled={testEmail.isPending || !draft.smtpEnabled || testRecipient.trim() === ""}
                    onClick={handleTestEmail}
                  >
                    {testEmail.isPending ? t("settingsGeneral.sendingTestEmail") : t("settingsGeneral.sendTestEmail")}
                  </Button>
                  {testResult ? <StatusPill label={testResult.message} tone={testResult.ok ? "success" : "danger"} /> : null}
                </div>
              </SectionCard>

              <SectionCard title={t("settingsGeneral.emailTemplate")} description={t("settingsGeneral.emailTemplateHint")}>
                <TextField
                  label={t("settingsGeneral.emailTemplateSubject")}
                  value={draft.emailTemplateSubject}
                  onChange={(v) => patch({ emailTemplateSubject: v })}
                />
                <TextAreaField
                  label={t("settingsGeneral.emailTemplateBody")}
                  value={draft.emailTemplateBody}
                  onChange={(v) => patch({ emailTemplateBody: v })}
                  rows={6}
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
