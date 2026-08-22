import type { ReactNode } from "react";
import { cn } from "@mezan/ui";

/**
 * Small local form primitives for the Items screen's add/edit panel. Mirrors
 * the shape of `apps/web/src/settings/form-controls.tsx` (Field/TextField/
 * SelectField/ToggleField) but kept local to `screens/` rather than importing
 * that settings-scoped module — `@mezan/ui` does not yet ship generic
 * text/select/toggle inputs (only the domain-specific
 * MoneyInput/QtyInput/EntityPicker).
 */

const controlClass =
  "w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none transition-colors focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-faint";

export interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, required, className, children }: FieldProps) {
  return (
    <label className={cn("flex flex-col gap-[6px]", className)}>
      <span className="text-xs font-semibold text-ink-muted">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

/**
 * Like `Field`, but for a group that contains MORE THAN ONE interactive
 * control (e.g. a repeatable list of barcode/unit rows plus an "add" button)
 * — a `<label>` wrapping several controls makes every descendant inherit its
 * text as their own accessible name (verified against the actual a11y-name
 * computation, not just visually), which breaks `getByRole("button", {name})`
 * for the nested "add" button and is a real screen-reader bug besides.
 * `<fieldset>`/`<legend>` is the correct semantic grouping instead: the
 * legend only names the fieldset, not its individual descendants.
 */
export function FieldGroup({ label, hint, className, children }: Omit<FieldProps, "required">) {
  return (
    <fieldset className={cn("flex flex-col gap-[6px] border-0 p-0 m-0", className)}>
      <legend className="mb-[2px] px-0 text-xs font-semibold text-ink-muted">{label}</legend>
      {children}
      {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
    </fieldset>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
}

export function TextField({ label, value, onChange, placeholder, hint, required, disabled, dir }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} required={required}>
      <input
        type="text"
        dir={dir}
        required={required}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={controlClass}
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
  required?: boolean;
  disabled?: boolean;
}

export function SelectField({ label, value, onChange, options, hint, required, disabled }: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} required={required}>
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

export interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  min?: number;
  disabled?: boolean;
}

export function NumberField({ label, value, onChange, hint, min, disabled }: NumberFieldProps) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        dir="ltr"
        min={min}
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={cn(controlClass, "mz-num")}
      />
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

export function ToggleField({ label, checked, onChange, hint, disabled }: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between gap-[14px] rounded-md border border-border px-[12px] py-[10px]">
      <div>
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {hint ? <div className="mt-[3px] max-w-[46ch] text-[11px] text-ink-muted">{hint}</div> : null}
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
