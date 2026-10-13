import { useState } from "react";
import { cn } from "../lib/cn";
import { formatMoney } from "../lib/format";

export interface DecimalStringInputProps {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  minimumFractionDigits?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

const EXACT_DECIMAL = /^-?\d+(\.\d{1,6})?$/;

function sanitizeDraft(input: string): string {
  const negative = input.trim().startsWith("-");
  const digitsAndDot = input.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = digitsAndDot.split(".");
  const draft = rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
  return negative ? `-${draft}` : draft;
}

export function toExactDecimal(raw: string): string {
  const draft = sanitizeDraft(raw).replace(/\.$/, "");
  const sign = draft.startsWith("-") ? "-" : "";
  const unsigned = draft.replace("-", "");
  const decimal = unsigned.startsWith(".") ? `0${unsigned}` : unsigned;
  const candidate = `${sign}${decimal}`;
  return EXACT_DECIMAL.test(candidate) ? candidate : "";
}

export function DecimalStringInput({ value, onChange, suffix, minimumFractionDigits = 0, placeholder = "0", disabled, id, name, className, ...aria }: DecimalStringInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const displayValue = focused ? draft : value === "" ? "" : formatMoney(value, { minimumFractionDigits, maximumFractionDigits: 6 });

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-surface px-[11px] py-[9px] transition-colors focus-within:border-brand",
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
        onFocus={() => {
          setFocused(true);
          setDraft(value);
        }}
        onBlur={() => {
          setFocused(false);
          onChange(toExactDecimal(draft));
        }}
        onChange={(event) => setDraft(sanitizeDraft(event.target.value))}
        className="mz-num w-full flex-1 border-none bg-transparent text-end text-[13px] text-ink outline-none placeholder:text-ink-faint"
        {...aria}
      />
      {suffix ? <span className="font-ar text-[12px] font-semibold text-ink-faint">{suffix}</span> : null}
    </div>
  );
}
