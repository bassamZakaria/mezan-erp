import type { ReactNode } from "react";
import {
  Chip,
  Field as UiField,
  Select,
  Switch,
  TextArea,
  TextInput,
} from "@mezan/ui";

/**
 * Thin Settings-tab wrappers over the @mezan/ui form primitives: they only
 * bind the tabs' `(value) => void` change shape to the primitives' native
 * event signature.
 */

export interface FieldProps {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, className, children }: FieldProps) {
  return (
    <UiField label={label} hint={hint} className={className}>
      {children}
    </UiField>
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
      <TextInput
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
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
      <TextInput
        type="number"
        numeric
        value={Number.isNaN(value) ? "" : value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(e.target.valueAsNumber)}
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
      <TextArea
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
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
      <Select value={value} onChange={onChange} options={options} disabled={disabled} aria-label={label} />
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
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
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
