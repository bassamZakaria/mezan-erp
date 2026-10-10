import { useMemo } from "react";
import { TaxRateStatusCode, inferTaxRateByPercent } from "@mezan/domain";
import type { TaxRateDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { SelectField } from "../settings/form-controls";

export enum TaxChoiceKind {
  Derived = "derived",
  Rate = "rate",
}

export type TaxChoice =
  | { readonly kind: TaxChoiceKind.Derived }
  | { readonly kind: TaxChoiceKind.Rate; readonly taxRateId: string };

export const DERIVED_TAX: TaxChoice = { kind: TaxChoiceKind.Derived };

const UNNAMED_OPTION = "";

// INVARIANT: a line the user has not named a rate for derives one with the
// SAME rule the server applies (`inferTaxRateByPercent`: one active rate at a
// percent above zero), at render and again at submit — never once at item-pick
// time, when the tax rates may not have loaded yet. So what the picker shows is
// what the request will make the server store.
export function chosenTaxRateId(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): string | null {
  if (choice.kind === TaxChoiceKind.Rate) return choice.taxRateId;
  return inferTaxRateByPercent(taxRates, fallbackPercent)?.id ?? null;
}

export function appliedTaxPercent(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): number {
  const taxRateId = chosenTaxRateId(choice, taxRates, fallbackPercent);
  return taxRates.find((r) => r.id === taxRateId)?.rate ?? fallbackPercent;
}

export type LineTaxPayload = { readonly taxRateId: string } | { readonly taxRatePercent: number };

// EXTERNAL CONTRACT: a line that names a rate sends the id ALONE — the server
// reads the percent off the row and refuses one that disagrees. A line with no
// rate sends its percent alone, and the server stores no id for it at 0%.
export function lineTaxPayload(choice: TaxChoice, taxRates: readonly TaxRateDTO[], fallbackPercent: number): LineTaxPayload {
  const taxRateId = chosenTaxRateId(choice, taxRates, fallbackPercent);
  return taxRateId === null ? { taxRatePercent: fallbackPercent } : { taxRateId };
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
  // The unnamed option is offered only where it is what an untouched line
  // already is: at 0%, or when no single rate has the percent. Where a rate IS
  // derivable, "no named rate" would be a line charged tax under no rate.
  const unnamedIsDerived = chosenTaxRateId(DERIVED_TAX, taxRates, fallbackPercent) === null;
  const options = useMemo(
    () => [
      ...(unnamedIsDerived ? [{ value: UNNAMED_OPTION, label: t("taxRateField.byPercent", { percent: fallbackPercent }) }] : []),
      ...selectableTaxRates(taxRates, selectedId).map((r) => ({
        value: r.id,
        label: t("taxRateField.option", { name: r.name, rate: r.rate }),
      })),
    ],
    [taxRates, selectedId, fallbackPercent, unnamedIsDerived, t],
  );
  return (
    <SelectField
      label={label}
      value={selectedId ?? UNNAMED_OPTION}
      onChange={(value) => onChange(value === UNNAMED_OPTION ? DERIVED_TAX : { kind: TaxChoiceKind.Rate, taxRateId: value })}
      options={options}
      disabled={disabled}
    />
  );
}
