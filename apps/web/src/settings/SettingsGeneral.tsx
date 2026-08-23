import { useEffect, useState } from "react";
import { DocumentDetail, Button, Card, StatusPill } from "@mezan/ui";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { useTenantSettings, useUpdateTenantSettings } from "../data/hooks";
import { TextField, NumberField, SelectField, ToggleField, MultiChipField, SectionCard } from "./form-controls";

/**
 * Settings — عام hub (docs/catalog/09 §"الإعدادات — عام"): the tabbed
 * tenant-config screen. Four tabs cover the fields the assignment scoped —
 * general/localization, company profile, tax mode, and the credit-control /
 * inventory / purchase / treasury policy flags (grouped into one "Policies"
 * tab here rather than 4 separate ones, to keep the nav shallow).
 *
 * Reads the live tenant-config bag from `GET /settings`; "حفظ الإعدادات"
 * PUTs the whole draft, which the server re-validates through the domain's
 * `updateSettings` before it persists.
 */

const WEEKDAY_OPTIONS = [
  { value: "0", label: "الأحد" },
  { value: "1", label: "الإثنين" },
  { value: "2", label: "الثلاثاء" },
  { value: "3", label: "الأربعاء" },
  { value: "4", label: "الخميس" },
  { value: "5", label: "الجمعة" },
  { value: "6", label: "السبت" },
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

export function SettingsGeneral() {
  const query = useTenantSettings();
  const saveSettings = useUpdateTenantSettings();
  const [draft, setDraft] = useState<TenantSettingsDTO | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = query.data ?? null;
  useEffect(() => {
    if (loaded && !dirty) setDraft(loaded);
  }, [loaded, dirty]);

  function patch(p: Partial<TenantSettingsDTO>) {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));
    setDirty(true);
  }

  async function handleSave() {
    if (!draft) return;
    try {
      const saved = await saveSettings.mutateAsync(draft);
      setDraft(saved);
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الإعدادات");
    }
  }

  if (!draft) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-ink-muted">
          {query.isError ? "تعذّر تحميل الإعدادات." : "جارٍ تحميل الإعدادات…"}
        </p>
        {query.isError ? (
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        ) : null}
      </Card>
    );
  }

  return (
    <DocumentDetail
      title="الإعدادات"
      statusLabel={dirty ? "تغييرات غير محفوظة" : undefined}
      statusTone={dirty ? "warning" : "neutral"}
      subtitle="الإعدادات العامة للمنشأة، الفوترة، والسياسات التشغيلية"
      actions={
        <>
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <Button variant="primary" disabled={!dirty || saveSettings.isPending} onClick={() => void handleSave()}>
            حفظ الإعدادات
          </Button>
        </>
      }
      tabs={[
        {
          key: "general",
          label: "عام",
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title="العملة واللغة">
                <TextField label="العملة الافتراضية" value={draft.currency} onChange={(v) => patch({ currency: v.toUpperCase() })} />
                <SelectField
                  label="اللغة الافتراضية"
                  value={draft.language}
                  onChange={(v) => patch({ language: v as TenantSettingsDTO["language"] })}
                  options={[
                    { value: "ar", label: "العربية" },
                    { value: "en", label: "English" },
                    { value: "de", label: "Deutsch" },
                  ]}
                />
                <MultiChipField
                  label="العملات الإضافية"
                  value={[...draft.secondaryCurrencies]}
                  onChange={(v) => patch({ secondaryCurrencies: v })}
                  options={CURRENCY_OPTIONS}
                />
                <SelectField
                  label="سياسة غياب سعر الصرف"
                  value={draft.fxRateMissingPolicy}
                  onChange={(v) => patch({ fxRateMissingPolicy: v as TenantSettingsDTO["fxRateMissingPolicy"] })}
                  options={[
                    { value: "STRICT", label: "صارم — رفض المستند إذا لم يوجد سعر صرف" },
                    { value: "ALLOW_MISSING", label: "السماح بالمتابعة بدون سعر صرف" },
                  ]}
                />
              </SectionCard>

              <SectionCard title="المنطقة الزمنية والتاريخ">
                <TextField label="المنطقة الزمنية" value={draft.timezone} onChange={(v) => patch({ timezone: v })} />
                <SelectField
                  label="اتجاه الواجهة"
                  value={draft.direction}
                  onChange={(v) => patch({ direction: v as TenantSettingsDTO["direction"] })}
                  options={[
                    { value: "RTL", label: "RTL" },
                    { value: "LTR", label: "LTR" },
                  ]}
                />
                <TextField label="تنسيق التاريخ" value={draft.dateFormat} onChange={(v) => patch({ dateFormat: v })} />
                <SelectField
                  label="نظام الأرقام"
                  value={draft.dateNumerals}
                  onChange={(v) => patch({ dateNumerals: v as TenantSettingsDTO["dateNumerals"] })}
                  options={[
                    { value: "western", label: "أرقام غربية (0, 1, 2, 3)" },
                    { value: "arabic", label: "أرقام عربية (٠, ١, ٢, ٣)" },
                  ]}
                />
                <MultiChipField
                  label="أيام نهاية الأسبوع"
                  value={draft.weekendDays.map(String)}
                  onChange={(v) => patch({ weekendDays: v.map(Number) })}
                  options={WEEKDAY_OPTIONS}
                />
                <NumberField
                  label="بداية السنة المالية (شهر)"
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
          label: "بيانات المنشأة",
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title="بيانات المنشأة">
                <TextField label="اسم المنشأة" value={draft.companyName} onChange={(v) => patch({ companyName: v })} />
                <TextField
                  label="الرقم الضريبي"
                  value={draft.taxRegistrationNumber}
                  onChange={(v) => patch({ taxRegistrationNumber: v })}
                  placeholder="300xxxxxxxxx"
                />
                <TextField
                  label="السجل التجاري"
                  value={draft.commercialRegistrationNumber}
                  onChange={(v) => patch({ commercialRegistrationNumber: v })}
                />
                <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => patch({ phone: v })} />
                <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => patch({ email: v })} />
                <TextField label="العنوان" value={draft.address} onChange={(v) => patch({ address: v })} />
              </SectionCard>

              <SectionCard title="سياسات الموارد البشرية المشتركة" description="تعتمد عليها خدمات الإجازات والحضور في حساب أيام العمل">
                <MultiChipField
                  label="أيام نهاية الأسبوع"
                  value={draft.weekendDays.map(String)}
                  onChange={(v) => patch({ weekendDays: v.map(Number) })}
                  options={WEEKDAY_OPTIONS}
                />
                <NumberField
                  label="فترة التنبيه على انتهاء العقد (يوم)"
                  value={draft.hrContractExpiryWarningDays}
                  min={7}
                  max={365}
                  onChange={(v) => patch({ hrContractExpiryWarningDays: v })}
                  hint="النطاق المسموح: 7-365، الافتراضي 30"
                />
                <NumberField
                  label="معامل العمل الإضافي"
                  value={draft.overtimeMultiplier}
                  step={0.1}
                  min={1}
                  onChange={(v) => patch({ overtimeMultiplier: v })}
                />
                <NumberField
                  label="ساعات العمل اليومية القياسية"
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
          label: "الضريبة",
          content: (
            <SectionCard title="ضريبة القيمة المضافة">
              <ToggleField
                label="تفعيل ضريبة القيمة المضافة"
                checked={draft.taxEnabled}
                onChange={(v) => patch({ taxEnabled: v })}
              />
              <NumberField
                label="نسبة الضريبة الافتراضية (%)"
                value={draft.defaultTaxRate}
                min={0}
                max={100}
                onChange={(v) => patch({ defaultTaxRate: v })}
              />
              <SelectField
                label="طريقة حساب الضريبة"
                value={draft.taxCalculation}
                onChange={(v) => patch({ taxCalculation: v as TenantSettingsDTO["taxCalculation"] })}
                options={[
                  { value: "EXCLUSIVE", label: "غير شاملة (تضاف على السعر)" },
                  { value: "INCLUSIVE", label: "شاملة (مضمنة في السعر)" },
                ]}
              />
              <SelectField
                label="إهلاك شهر الاقتناء"
                value={draft.depreciationProrate}
                onChange={(v) => patch({ depreciationProrate: v as TenantSettingsDTO["depreciationProrate"] })}
                options={[
                  { value: "DAILY", label: "يومي (نسبة الأيام) — IFRS" },
                  { value: "FULL_MONTH", label: "شهر كامل" },
                ]}
              />
              <TextField
                label="الرقم الضريبي"
                value={draft.taxRegistrationNumber}
                onChange={(v) => patch({ taxRegistrationNumber: v })}
                placeholder="300xxxxxxxxx"
              />
            </SectionCard>
          ),
        },
        {
          key: "policies",
          label: "السياسات",
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title="الرقابة الائتمانية">
                <ToggleField label="تفعيل قوائم الأسعار" checked={draft.priceListsEnabled} onChange={(v) => patch({ priceListsEnabled: v })} />
                <ToggleField
                  label="تفعيل الرقابة الائتمانية"
                  checked={draft.creditControlEnabled}
                  onChange={(v) => patch({ creditControlEnabled: v })}
                />
                <SelectField
                  label="وضع الرقابة"
                  value={draft.creditControlMode}
                  onChange={(v) => patch({ creditControlMode: v as TenantSettingsDTO["creditControlMode"] })}
                  options={[
                    { value: "WARNING", label: "تحذير فقط (WARNING)" },
                    { value: "BLOCK", label: "منع تام (BLOCK)" },
                  ]}
                />
              </SectionCard>

              <SectionCard title="سياسة المخزون">
                <ToggleField
                  label="السماح بالبيع من مستودع آخر"
                  checked={draft.allowCrossWarehouseSales}
                  onChange={(v) => patch({ allowCrossWarehouseSales: v })}
                />
                <ToggleField
                  label="عرض المخزون في المستودعات الأخرى"
                  checked={draft.showOtherWarehouseStock}
                  onChange={(v) => patch({ showOtherWarehouseStock: v })}
                />
                <ToggleField label="السماح بالطلبات المؤجلة" checked={draft.allowBackorder} onChange={(v) => patch({ allowBackorder: v })} />
                <ToggleField label="السماح بالمخزون السالب" checked={draft.allowNegativeStock} onChange={(v) => patch({ allowNegativeStock: v })} />
              </SectionCard>

              <SectionCard title="التحكم في المشتريات">
                <ToggleField
                  label="يجب وجود أمر شراء قبل استلام البضاعة"
                  checked={draft.requirePoForGrn}
                  onChange={(v) => patch({ requirePoForGrn: v })}
                />
                <ToggleField
                  label="يجب وجود استلام بضاعة قبل فاتورة الشراء"
                  checked={draft.requireGrnForInvoice}
                  onChange={(v) => patch({ requireGrnForInvoice: v })}
                />
                <ToggleField
                  label="تتبع البضاعة المستهلكة من فواتير الشراء"
                  checked={draft.trackSoldPurchaseItems}
                  onChange={(v) => patch({ trackSoldPurchaseItems: v })}
                />
              </SectionCard>

              <SectionCard title="سياسة الخزينة">
                <ToggleField
                  label="منع الرصيد السالب للحسابات النقدية"
                  checked={draft.preventNegativeCashBalance}
                  onChange={(v) => patch({ preventNegativeCashBalance: v })}
                  hint="ينطبق على حسابات الصندوق فقط — الحسابات البنكية غير متأثرة"
                />
                <ToggleField
                  label="السماح بالرصيد السالب للحسابات البنكية"
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
