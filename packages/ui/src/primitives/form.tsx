import {
  forwardRef,
  useCallback,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../lib/cn";

export type ControlSize = "sm" | "md";

const CONTROL_BASE =
  "rounded-md border bg-surface text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-border-strong focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-faint disabled:hover:border-border";

// `cn` concatenates without resolving Tailwind conflicts, so the default
// `w-full` is only applied when the caller has not sized the control itself.
const WIDTH_UTILITY = /(?:^|\s)(?:w-|min-w-|max-w-|flex-1|basis-)/;

const CONTROL_SIZE: Record<ControlSize, string> = {
  sm: "min-h-[34px] px-[10px] py-[7px] text-[12.5px]",
  md: "min-h-[38px] px-[11px] py-[9px] text-[13px]",
};

export function controlClassName(size: ControlSize = "md", invalid?: boolean, className?: string) {
  return cn(
    CONTROL_BASE,
    CONTROL_SIZE[size],
    invalid ? "border-danger" : "border-border",
    className && WIDTH_UTILITY.test(className) ? null : "w-full",
    className,
  );
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, the standard vertical field shape. */
export function Field({ label, hint, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-[6px]", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ink">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="text-[11.5px] text-danger">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-ink-faint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
  invalid?: boolean;
  /** Right-aligns and tabular-figures the value; use for numeric entry. */
  numeric?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = "md", invalid, numeric, className, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={controlClassName(size, invalid, cn(numeric && "mz-num", className))}
      {...rest}
    />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: ControlSize;
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { size = "md", invalid, className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={controlClassName(size, invalid, cn("resize-y", className))} {...rest} />;
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: ReactNode;
  hint?: ReactNode;
  indeterminate?: boolean;
}

/**
 * Checkbox — the native input stays in the tree (focus, form state, screen
 * readers) but is painted by the design system rather than the OS.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, disabled, indeterminate, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = rest.id ?? generatedId;
  const attach = useCallback(
    (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = indeterminate ?? false;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref, indeterminate],
  );

  return (
    <div className={cn("flex items-start gap-[8px]", className)}>
      <span className="relative flex h-[17px] w-[17px] flex-none items-center justify-center">
        <input
          ref={attach}
          type="checkbox"
          disabled={disabled}
          {...rest}
          id={inputId}
          className="peer h-[17px] w-[17px] cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface outline-none transition-colors checked:border-brand checked:bg-brand indeterminate:border-brand indeterminate:bg-brand focus-visible:border-brand disabled:cursor-not-allowed disabled:bg-surface-3"
        />
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          width="12"
          height="12"
          className={cn(
            "pointer-events-none absolute text-brand-ink",
            indeterminate ? "opacity-100" : "opacity-0 peer-checked:opacity-100",
          )}
        >
          {indeterminate ? (
            <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M3.5 8.5 6.5 11.5 12.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </span>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn("cursor-pointer text-[12.5px] text-ink", disabled && "cursor-not-allowed text-ink-faint")}
        >
          {label}
          {hint ? <span className="mt-[2px] block text-[11.5px] text-ink-faint">{hint}</span> : null}
        </label>
      ) : null}
    </div>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-describedby"?: string;
}

/** An on/off switch — the toggle shape used across the settings tabs. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  className,
  "aria-describedby": ariaDescribedBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[22px] w-[38px] flex-none rounded-pill border transition-colors",
        checked ? "border-brand bg-brand" : "border-border bg-surface-3",
        disabled && "cursor-not-allowed opacity-60",
        className,
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
  );
}

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  size?: ControlSize;
  className?: string;
}

/** Text field with a leading magnifier — the list/filter search box. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, size = "md", className, disabled, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        "flex items-center gap-[9px] rounded-md border border-border bg-surface transition-colors focus-within:border-brand",
        CONTROL_SIZE[size],
        className && WIDTH_UTILITY.test(className) ? null : "w-full",
        disabled && "bg-surface-3",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none text-ink-faint">
        <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        className="w-full border-none bg-transparent p-0 text-inherit text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
        {...rest}
      />
    </div>
  );
});
