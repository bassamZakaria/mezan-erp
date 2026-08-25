import type { ReactNode } from "react";
import { cn, Chip } from "@mezan/ui";

/**
 * Small local form primitives for the Settings tabs. @mezan/ui does not yet
 * ship generic text/select/toggle inputs (only the domain-specific
 * MoneyInput/QtyInput/EntityPicker), so these compose its `cn` + `Chip` and
 * match the input styling already used by DocumentList's search box.
 */

const controlClass =
  "w-full rounded-md border border-border bg-surface px-[13px] py-[9px] text-[13px] text-ink outline-none transition-colors focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-faint";

export interface FieldProps {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-[6px]", className)}>
      <span className="text-[12.5px] font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  type?: "text" | "email" | "tel" | "date";
}

export function TextField({ label, value, onChange, placeholder, hint, disabled, type = "text" }: TextFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
      />
    </Field>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export function NumberField({ label, value, onChange, hint, min, max, step, disabled }: NumberFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        value={Number.isNaN(value) ? "" : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className={cn(controlClass, "mz-num")}
      />
    </Field>
  );
}

export interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  rows?: number;
}

export function TextAreaField({ label, value, onChange, placeholder, hint, disabled, rows = 3 }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className={cn(controlClass, "resize-y")}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  hint?: string;
  disabled?: boolean;
}

export function SelectField({ label, value, onChange, options, hint, disabled }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={controlClass}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}

/** A labeled on/off switch — the shape used repeatedly across the policy tabs. */
export function ToggleField({ label, checked, onChange, hint, disabled }: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between gap-[14px] py-[10px]">
      <div>
        <div className="text-[13px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-[3px] max-w-[52ch] text-[11.5px] text-ink-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-[22px] w-[38px] flex-none rounded-pill border transition-colors",
          checked ? "border-brand bg-brand" : "border-border bg-surface-3",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-[2px] h-[16px] w-[16px] rounded-full bg-surface shadow-1 transition-[inset-inline-start]",
            checked ? "start-[18px]" : "start-[2px]",
          )}
        />
      </button>
    </div>
  );
}

export interface MultiChipFieldProps {
  label: string;
  hint?: string;
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
}

/** Toggleable chip picker — used for weekend days and secondary currencies. */
export function MultiChipField({ label, hint, options, value, onChange }: MultiChipFieldProps) {
  function toggle(optValue: string) {
    onChange(value.includes(optValue) ? value.filter((v) => v !== optValue) : [...value, optValue]);
  }
  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-[8px]">
        {options.map((opt) => (
          <Chip key={opt.value} type="button" active={value.includes(opt.value)} onClick={() => toggle(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>
    </Field>
  );
}

export function SectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[18px_20px] shadow-1">
      <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
      {description ? <p className="mt-[4px] text-[12px] text-ink-muted">{description}</p> : null}
      <div className="mt-[14px] grid grid-cols-1 gap-[14px] sm:grid-cols-2">{children}</div>
    </div>
  );
}
