import { cn } from "../lib/cn";
import { useUiTranslation, type UiTranslationKey } from "../i18n";
import { TextInput } from "./form";

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

const PRESETS: { key: DateRangePreset; labelKey: UiTranslationKey }[] = [
  { key: "today", labelKey: "ui.dateRange.today" },
  { key: "week", labelKey: "ui.dateRange.week" },
  { key: "month", labelKey: "ui.dateRange.month" },
  { key: "quarter", labelKey: "ui.dateRange.quarter" },
  { key: "year", labelKey: "ui.dateRange.year" },
  { key: "custom", labelKey: "ui.dateRange.custom" },
];

/** DateRangeFilter — period chips (matches `.range-toggle`) plus a custom from/to pair. */
export function DateRangeFilter({ preset, onPresetChange, range, onRangeChange, className }: DateRangeFilterProps) {
  const { t } = useUiTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-[8px]", className)}>
      <div role="radiogroup" aria-label={t("ui.dateRange.legend")} className="flex gap-[2px] rounded-md border border-border bg-surface-2 p-[3px]">
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
            {t(option.labelKey)}
          </button>
        ))}
      </div>
      {preset === "custom" ? (
        <div className="flex items-center gap-[8px]">
          <TextInput
            type="date"
            size="sm"
            aria-label={t("ui.dateRange.from")}
            value={range.from ?? ""}
            onChange={(event) => onRangeChange({ ...range, from: event.target.value || null })}
          />
          <span className="text-xs text-ink-faint">{t("ui.dateRange.separator")}</span>
          <TextInput
            type="date"
            size="sm"
            aria-label={t("ui.dateRange.to")}
            value={range.to ?? ""}
            onChange={(event) => onRangeChange({ ...range, to: event.target.value || null })}
          />
        </div>
      ) : null}
    </div>
  );
}
