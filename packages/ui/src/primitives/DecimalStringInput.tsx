import { useId, useState } from "react";
import { cn } from "../lib/cn";
import { formatMoney } from "../lib/format";
import { useTranslation } from "../i18n";

export interface DecimalStringInputProps {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  allowNegative?: boolean;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

export const DECIMAL_STRING_MAX_FRACTION_DIGITS = 6;

const EASTERN_ARABIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;
const ARABIC_DECIMAL_SEPARATOR = "٫";

function toAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - EASTERN_ARABIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - PERSIAN_ZERO))
    .split(ARABIC_DECIMAL_SEPARATOR)
    .join(".");
}

enum DecimalRejection {
  TooManyDecimals = "tooManyDecimals",
  Negative = "negative",
}

function sanitizeDraft(input: string): string {
  const ascii = toAsciiDigits(input);
  const negative = ascii.trim().startsWith("-");
  const digitsAndDot = ascii.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = digitsAndDot.split(".");
  const draft = rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
  return negative ? `-${draft}` : draft;
}

function fractionDigitsOf(draft: string): number {
  const dot = draft.indexOf(".");
  return dot === -1 ? 0 : draft.length - dot - 1;
}

export function toExactDecimal(raw: string, options: { readonly allowNegative?: boolean; readonly maximumFractionDigits?: number } = {}): string {
  const maximumFractionDigits = Math.min(options.maximumFractionDigits ?? DECIMAL_STRING_MAX_FRACTION_DIGITS, DECIMAL_STRING_MAX_FRACTION_DIGITS);
  const draft = sanitizeDraft(raw).replace(/\.$/, "");
  const sign = draft.startsWith("-") ? "-" : "";
  if (sign !== "" && options.allowNegative === false) return "";
  const unsigned = draft.replace("-", "");
  const decimal = unsigned.startsWith(".") ? `0${unsigned}` : unsigned;
  if (!/^\d+(\.\d+)?$/.test(decimal) || fractionDigitsOf(decimal) > maximumFractionDigits) return "";
  return `${sign}${decimal}`;
}

export function DecimalStringInput({
  value,
  onChange,
  suffix,
  minimumFractionDigits = 0,
  maximumFractionDigits = DECIMAL_STRING_MAX_FRACTION_DIGITS,
  allowNegative = false,
  placeholder = "0",
  disabled,
  id,
  name,
  className,
  ...aria
}: DecimalStringInputProps) {
  const { t } = useTranslation();
  const errorId = useId();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState<{ readonly text: string; readonly reason: DecimalRejection } | null>(null);

  const committed = value === "" ? "" : formatMoney(value, { minimumFractionDigits, maximumFractionDigits: DECIMAL_STRING_MAX_FRACTION_DIGITS });
  const displayValue = focused ? draft : value === "" && rejected !== null ? rejected.text : committed;
  const refusal = !focused && value === "" && rejected !== null ? rejected.reason : null;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-surface px-[11px] py-[9px] transition-colors focus-within:border-brand",
          refusal !== null && "border-danger",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <input
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          dir="ltr"
          disabled={disabled}
          placeholder={placeholder}
          value={displayValue}
          aria-invalid={refusal !== null ? true : undefined}
          aria-describedby={refusal !== null ? errorId : undefined}
          onFocus={() => {
            setFocused(true);
            setDraft(value === "" && rejected !== null ? rejected.text : value);
          }}
          onBlur={() => {
            setFocused(false);
            const exact = toExactDecimal(draft, { allowNegative, maximumFractionDigits });
            const unsigned = draft.replace("-", "").replace(/\.$/, "");
            const negativeRefused = !allowNegative && draft.startsWith("-") && /^(\d+\.?\d*|\.\d+)$/.test(unsigned);
            const tooManyDecimals = exact === "" && /^\d*\.\d+$/.test(unsigned) && fractionDigitsOf(unsigned) > maximumFractionDigits;
            setRejected(negativeRefused ? { text: draft, reason: DecimalRejection.Negative } : tooManyDecimals ? { text: draft, reason: DecimalRejection.TooManyDecimals } : null);
            onChange(exact);
          }}
          onChange={(event) => setDraft(sanitizeDraft(event.target.value))}
          className="mz-num w-full flex-1 border-none bg-transparent text-end text-[13px] text-ink outline-none placeholder:text-ink-faint"
          {...aria}
        />
        {suffix ? <span className="font-ar text-[12px] font-semibold text-ink-faint">{suffix}</span> : null}
      </div>
      {refusal !== null ? (
        <p id={errorId} role="alert" className="mt-[4px] text-[11.5px] text-danger-ink">
          {refusal === DecimalRejection.Negative ? t("ui.decimal.negativeNotAllowed") : t("ui.decimal.tooManyDecimals", { max: String(maximumFractionDigits) })}
        </p>
      ) : null}
    </div>
  );
}
