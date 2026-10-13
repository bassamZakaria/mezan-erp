import { useTranslation } from "../i18n";
import { DecimalStringInput, toExactDecimal } from "./DecimalStringInput";

export interface MoneyStringInputProps {
  value: string;
  onChange: (value: string) => void;
  currencyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

export const toMoneyDecimal = toExactDecimal;

export function MoneyStringInput({ currencyLabel, placeholder = "0.00", ...input }: MoneyStringInputProps) {
  const { t } = useTranslation();
  return <DecimalStringInput {...input} placeholder={placeholder} minimumFractionDigits={2} suffix={currencyLabel ?? t("ui.currency")} />;
}
