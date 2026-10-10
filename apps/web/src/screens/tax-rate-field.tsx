import { useMemo } from "react";
import { findSoleActiveTaxRateByPercent } from "@mezan/domain";
import type { TaxRateDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { SelectField } from "../settings/form-controls";

export const NO_TAX_RATE = "";

export function soleActiveTaxRateId(taxRates: readonly TaxRateDTO[], percent: number): string {
  return findSoleActiveTaxRateByPercent(taxRates, percent)?.id ?? NO_TAX_RATE;
}

export function appliedTaxPercent(taxRates: readonly TaxRateDTO[], taxRateId: string, fallbackPercent: number): number {
  return taxRates.find((r) => r.id === taxRateId)?.rate ?? fallbackPercent;
}

export type LineTaxPayload =
  | { readonly taxRateId: string; readonly taxRatePercent?: undefined }
  | { readonly taxRateId?: undefined; readonly taxRatePercent: number };

// EXTERNAL CONTRACT: a line that names a rate sends the id ALONE. The server
// reads the percent off the row and refuses a percent that disagrees with it.
export function lineTaxPayload(taxRateId: string, fallbackPercent: number): LineTaxPayload {
  return taxRateId === NO_TAX_RATE ? { taxRatePercent: fallbackPercent } : { taxRateId };
}

export function selectableTaxRates(taxRates: readonly TaxRateDTO[], selectedId: string): TaxRateDTO[] {
  return taxRates.filter((r) => r.status === "active" || r.id === selectedId);
}

export interface TaxRateFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (taxRateId: string) => void;
  readonly taxRates: readonly TaxRateDTO[];
  readonly fallbackPercent: number;
  readonly disabled?: boolean;
}

export function TaxRateField({ label, value, onChange, taxRates, fallbackPercent, disabled }: TaxRateFieldProps) {
  const { t } = useAppTranslation();
  const options = useMemo(
    () => [
      { value: NO_TAX_RATE, label: t("taxRateField.byPercent", { percent: fallbackPercent }) },
      ...selectableTaxRates(taxRates, value).map((r) => ({
        value: r.id,
        label: t("taxRateField.option", { name: r.name, rate: r.rate }),
      })),
    ],
    [taxRates, value, fallbackPercent, t],
  );
  return <SelectField label={label} value={value} onChange={onChange} options={options} disabled={disabled} />;
}
