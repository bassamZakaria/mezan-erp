import { useState } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";

export interface QtyInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  "aria-label"?: string;
  className?: string;
}

/** QtyInput — a stepper-backed quantity field for document line items. */
export function QtyInput({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  disabled,
  id,
  name,
  className,
  ...aria
}: QtyInputProps) {
  const { t } = useUiTranslation();
  const [draft, setDraft] = useState<string | null>(null);

  function clamp(n: number): number {
    return Math.min(max, Math.max(min, n));
  }

  function commit(raw: string) {
    setDraft(null);
    const parsed = Number(raw);
    if (raw.trim() !== "" && !Number.isNaN(parsed)) onChange(clamp(parsed));
  }

  function stepBy(direction: 1 | -1) {
    if (disabled) return;
    onChange(clamp(value + direction * step));
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface p-[3px]",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => stepBy(-1)}
        aria-label={t("ui.qty.decrease")}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        &minus;
      </button>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        dir="ltr"
        disabled={disabled}
        value={draft ?? String(value)}
        onFocus={() => setDraft(String(value))}
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={(event) => commit(event.target.value)}
        className="mz-num w-[52px] border-none bg-transparent text-center text-[13px] text-ink outline-none"
        {...aria}
      />
      {unit ? <span className="me-1 whitespace-nowrap text-[11px] text-ink-faint">{unit}</span> : null}
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => stepBy(1)}
        aria-label={t("ui.qty.increase")}
        className="flex h-[26px] w-[26px] items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
