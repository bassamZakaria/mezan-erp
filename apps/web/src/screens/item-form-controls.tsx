import { useId, type ReactNode } from "react";
import { Select, Switch, TextInput, cn } from "@mezan/ui";

/**
 * Items-screen field wrappers over the @mezan/ui form primitives: they add
 * this panel's label/hint layout and its `(value) => void` change shape.
 */

export interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** `false` renders the label as a sibling — required when the control is not a labelable element (e.g. `Select`, whose trigger is a button). */
  wrapWithLabel?: boolean;
  /** The hint `<span>`'s `id`, referenced by the control's `aria-describedby` — keeps hint text out of the `<label>`'s accessible name (it's rendered as a sibling of the label, not inside it). */
  hintId?: string;
  children: ReactNode;
}

export function Field({ label, hint, required, className, hintId, wrapWithLabel = true, children }: FieldProps) {
  const Wrapper = wrapWithLabel ? "label" : "div";
  return (
    <div className={cn("flex flex-col gap-[6px]", className)}>
      <Wrapper className="flex flex-col gap-[6px]">
        <span className="text-xs font-semibold text-ink-muted">
          {label}
          {required ? " *" : ""}
        </span>
        {children}
      </Wrapper>
      {hint ? (
        <span id={hintId} className="text-[11px] text-ink-faint">
          {hint}
        </span>
      ) : null}
    </div>
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
    <fieldset className={cn("flex min-w-0 flex-col gap-[6px] border-0 p-0 m-0", className)}>
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
  const hintId = useId();
  return (
    <Field label={label} hint={hint} required={required} hintId={hint ? hintId : undefined}>
      <TextInput
        dir={dir}
        required={required}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
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
  required?: boolean;
  disabled?: boolean;
}

export function SelectField({ label, value, onChange, options, hint, required, disabled }: SelectFieldProps) {
  const hintId = useId();
  return (
    <Field label={label} hint={hint} required={required} hintId={hint ? hintId : undefined} wrapWithLabel={false}>
      <Select
        aria-label={label}
        value={value}
        options={options}
        disabled={disabled}
        required={required}
        onChange={onChange}
      />
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
  const hintId = useId();
  return (
    <Field label={label} hint={hint} hintId={hint ? hintId : undefined}>
      <TextInput
        type="number"
        numeric
        dir="ltr"
        min={min}
        disabled={disabled}
        value={value ?? ""}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
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
  const hintId = useId();
  return (
    <div className="flex items-start justify-between gap-[14px] rounded-md border border-border px-[12px] py-[10px]">
      <div>
        <div className="text-[12.5px] font-semibold text-ink">{label}</div>
        {hint ? (
          <div id={hintId} className="mt-[3px] max-w-[46ch] text-[11px] text-ink-muted">
            {hint}
          </div>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
      />
    </div>
  );
}
