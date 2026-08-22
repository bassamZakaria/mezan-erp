import { cn } from "../lib/cn";

export type DateRangePreset = "today" | "week" | "month" | "quarter" | "year" | "custom";

export interface DateRange {
  from: string | null;
  to: string | null;
}

export interface DateRangeFilterProps {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  className?: string;
}

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "اليوم" },
  { key: "week", label: "هذا الأسبوع" },
  { key: "month", label: "هذا الشهر" },
  { key: "quarter", label: "هذا الربع" },
  { key: "year", label: "هذه السنة" },
  { key: "custom", label: "نطاق مخصص" },
];

/** DateRangeFilter — period chips (matches `.range-toggle`) plus a custom from/to pair. */
export function DateRangeFilter({ preset, onPresetChange, range, onRangeChange, className }: DateRangeFilterProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-[8px]", className)}>
      <div role="radiogroup" aria-label="الفترة الزمنية" className="flex gap-[2px] rounded-md border border-border bg-surface-2 p-[3px]">
        {PRESETS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={preset === option.key}
            onClick={() => onPresetChange(option.key)}
            className={cn(
              "rounded-[6px] px-[12px] py-[6px] text-[11.5px] font-semibold text-ink-muted transition-colors",
              preset === option.key && "bg-surface text-ink shadow-1",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {preset === "custom" ? (
        <div className="flex items-center gap-[8px]">
          <input
            type="date"
            aria-label="من تاريخ"
            value={range.from ?? ""}
            onChange={(event) => onRangeChange({ ...range, from: event.target.value || null })}
            className="rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink"
          />
          <span className="text-xs text-ink-faint">إلى</span>
          <input
            type="date"
            aria-label="إلى تاريخ"
            value={range.to ?? ""}
            onChange={(event) => onRangeChange({ ...range, to: event.target.value || null })}
            className="rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink"
          />
        </div>
      ) : null}
    </div>
  );
}
