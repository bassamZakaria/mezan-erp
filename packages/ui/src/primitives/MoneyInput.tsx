import { useState } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";
import { formatMoney } from "../lib/format";

export interface MoneyInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  currencyLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

function sanitizeDraft(input: string): string {
  const negative = input.trim().startsWith("-");
  const digitsAndDot = input.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = digitsAndDot.split(".");
  const draft = rest.length > 0 ? `${whole}.${rest.join("")}` : whole;
  return negative ? `-${draft}` : draft;
}

/**
 * MoneyInput — a numeric field for entering monetary amounts. Shows the
 * committed value formatted with `formatMoney` (tabular-nums, LTR-isolated)
 * while blurred, and a raw editable draft while focused, so the cursor
 * never fights reformatting mid-keystroke.
 */
export function MoneyInput({
  value,
  onChange,
  currencyLabel,
  placeholder = "0.00",
  disabled,
  id,
  name,
  className,
  ...aria
}: MoneyInputProps) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState("");

  const displayValue = focused ? draft : value === null ? "" : formatMoney(value);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "-") {
      onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    onChange(Number.isNaN(parsed) ? null : parsed);
  }

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
          setDraft(value === null ? "" : String(value));
        }}
        onBlur={() => {
          setFocused(false);
          commit(draft);
        }}
        onChange={(event) => setDraft(sanitizeDraft(event.target.value))}
        className="mz-num w-full flex-1 border-none bg-transparent text-end text-[13px] text-ink outline-none placeholder:text-ink-faint"
        {...aria}
      />
      <span className="font-ar text-[12px] font-semibold text-ink-faint">{currencyLabel ?? t("ui.currency")}</span>
    </div>
  );
}
