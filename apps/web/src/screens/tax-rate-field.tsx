import { useMemo } from "react";
import { TaxRateStatusCode, inferTaxRateByPercent } from "@mezan/domain";
import type { TaxRateDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { SelectField } from "../settings/form-controls";

export enum TaxChoiceKind {
  Derived = "derived",
  None = "none",
  Rate = "rate",
}

export type TaxChoice =
  | { readonly kind: TaxChoiceKind.Derived }
  | { readonly kind: TaxChoiceKind.None }
  | { readonly kind: TaxChoiceKind.Rate; readonly taxRateId: string };

export const DERIVED_TAX: TaxChoice = { kind: TaxChoiceKind.Derived };

const NONE_OPTION = "";

// INVARIANT: an untouched line derives its rate with the SAME rule the server
// applies (`inferTaxRateByPercent`: one active rate at a percent above zero),
// at render and again at submit — never once at item-pick time, when the tax
// rates may not have loaded yet.
export function chosenTaxRateId(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): string | null {
  if (choice.kind === TaxChoiceKind.Rate) return choice.taxRateId;
  if (choice.kind === TaxChoiceKind.None) return null;
  return inferTaxRateByPercent(taxRates, fallbackPercent)?.id ?? null;
}

export function appliedTaxPercent(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): number {
  const taxRateId = chosenTaxRateId(choice, taxRates, fallbackPercent);
  return taxRates.find((r) => r.id === taxRateId)?.rate ?? fallbackPercent;
}

export type LineTaxPayload =
  | { readonly taxRateId: string }
  | { readonly taxRateId: null; readonly taxRatePercent: number }
  | { readonly taxRatePercent: number };

// EXTERNAL CONTRACT: a line that names a rate sends the id ALONE — the server
// reads the percent off the row and refuses one that disagrees. `taxRateId:
// null` tells the server the user chose no rate, so it stores none; leaving
// the key out lets the server infer one from the percent.
export function lineTaxPayload(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): LineTaxPayload {
  const taxRateId = chosenTaxRateId(choice, taxRates, fallbackPercent);
  if (taxRateId !== null) return { taxRateId };
  return choice.kind === TaxChoiceKind.None
    ? { taxRateId: null, taxRatePercent: fallbackPercent }
    : { taxRatePercent: fallbackPercent };
}

export function selectableTaxRates(taxRates: readonly TaxRateDTO[], selectedId: string | null): TaxRateDTO[] {
  return taxRates.filter((r) => r.status === TaxRateStatusCode.Active || r.id === selectedId);
}

export interface TaxRateFieldProps {
  readonly label: string;
  readonly choice: TaxChoice;
  readonly onChange: (choice: TaxChoice) => void;
  readonly taxRates: readonly TaxRateDTO[];
  readonly fallbackPercent: number;
  readonly disabled?: boolean;
}

export function TaxRateField({ label, choice, onChange, taxRates, fallbackPercent, disabled }: TaxRateFieldProps) {
  const { t } = useAppTranslation();
  const selectedId = chosenTaxRateId(choice, taxRates, fallbackPercent);
  const options = useMemo(
    () => [
      { value: NONE_OPTION, label: t("taxRateField.byPercent", { percent: fallbackPercent }) },
      ...selectableTaxRates(taxRates, selectedId).map((r) => ({
        value: r.id,
        label: t("taxRateField.option", { name: r.name, rate: r.rate }),
      })),
    ],
    [taxRates, selectedId, fallbackPercent, t],
  );
  return (
    <SelectField
      label={label}
      value={selectedId ?? NONE_OPTION}
      onChange={(value) =>
        onChange(value === NONE_OPTION ? { kind: TaxChoiceKind.None } : { kind: TaxChoiceKind.Rate, taxRateId: value })
      }
      options={options}
      disabled={disabled}
    />
  );
}
