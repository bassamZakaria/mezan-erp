import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Chip,
  cn,
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
  /** The id of the control inside. Without it the label names nothing (D67). */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, htmlFor, className, children }: FieldProps) {
  return (
    <UiField label={label} hint={hint} htmlFor={htmlFor} className={className}>
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
  type?: "text" | "email" | "tel" | "date" | "password";
}

export function TextField({ label, value, onChange, placeholder, hint, disabled, type = "text" }: TextFieldProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <TextInput
        id={id}
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
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <TextInput
        id={id}
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
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <TextArea
        id={id}
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
  /** Offered but not choosable — the option exists and this build cannot honour it. */
  disabled?: boolean;
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
  /**
   * Let the operator type values that are not in `options`. For a list whose
   * members cannot be enumerated in advance — email domains are the company's
   * own, not something the product can offer a menu of.
   */
  allowCustom?: boolean;
  customPlaceholder?: string;
}

/** Toggleable chip picker — used for weekend days, secondary currencies and email domains. */
export function MultiChipField({
  label,
  hint,
  options,
  value,
  onChange,
  allowCustom = false,
  customPlaceholder,
}: MultiChipFieldProps) {
  const [entry, setEntry] = useState("");

  function toggle(optValue: string) {
    onChange(value.includes(optValue) ? value.filter((v) => v !== optValue) : [...value, optValue]);
  }

  function commitEntry() {
    const next = entry.trim().toLowerCase().replace(/^[@.]+/, "");
    if (next === "" || value.includes(next)) {
      setEntry("");
      return;
    }
    onChange([...value, next]);
    setEntry("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter must not reach the form — this adds a chip, it does not save.
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitEntry();
    }
  }

  // A typed value has no option row to render, so the chips come from the
  // selected values themselves and clicking one removes it.
  const customChips = allowCustom ? value.filter((v) => !options.some((o) => o.value === v)) : [];

  return (
    <Field label={label} hint={hint}>
      <div className="flex flex-wrap gap-[8px]">
        {options.map((opt) => (
          <Chip
            key={opt.value}
            type="button"
            toggle
            active={value.includes(opt.value)}
            disabled={opt.disabled}
            className={opt.disabled ? "cursor-not-allowed opacity-55" : undefined}
            onClick={() => {
              if (opt.disabled) return;
              toggle(opt.value);
            }}
          >
            {opt.label}
          </Chip>
        ))}
        {customChips.map((v) => (
          <Chip key={v} type="button" toggle active onClick={() => toggle(v)}>
            <span className="mz-lat">{v}</span> ×
          </Chip>
        ))}
      </div>
      {allowCustom ? (
        <div className="mt-[8px]">
          <TextInput
            value={entry}
            placeholder={customPlaceholder}
            className="mz-lat"
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitEntry}
          />
        </div>
      ) : null}
    </Field>
  );
}

export function SectionCard({
  title,
  description,
  columns = 2,
  children,
}: {
  title: string;
  description?: string;
  /** 1 for sections whose controls are already full-width rows (barcodes, unit tables). */
  columns?: 1 | 2;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-[18px_20px] shadow-1">
      <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
      {description ? <p className="mt-[4px] text-[12px] text-ink-muted">{description}</p> : null}
      <div className={cn("mt-[14px] grid grid-cols-1 gap-[14px]", columns === 2 && "sm:grid-cols-2")}>{children}</div>
    </section>
  );
}

/**
 * The chrome a create/edit sub-page wears: eyebrow, title, optional
 * description, and the actions that commit or abandon it.
 *
 * Deliberately the SAME shape every other page in this app already uses — a
 * full-width `w-full` block and the eyebrow/h1 header the sales-quote form
 * page introduced. No centring and no max-width: those made these five pages
 * read as visitors from another product next to the lists they open from.
 * Width is spent by the caller's own `FormColumns`, the way the quote form
 * spends it.
 *
 * The actions are the ONLY way back: a sub-page has no scrim to dismiss, so a
 * form whose cancel is missing strands the user on an address with no exit.
 */
export function FormPage({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{eyebrow}</div>
          <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
          {description ? <p className="mt-[4px] max-w-[72ch] text-[12.5px] text-ink-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * The two-column body of a form page: the sections that carry the work, and an
 * `aside` of the ones that are usually left on their defaults. Same
 * `2fr_1fr` split the sales-quote form uses, so a form page and a document
 * page put their cards on the same grid.
 */
export function FormColumns({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {aside ? <aside className="flex min-w-0 flex-col gap-4">{aside}</aside> : null}
    </div>
  );
}

/** The error a form reports about itself, in the one place every form puts it. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
    >
      {message}
    </div>
  );
}
