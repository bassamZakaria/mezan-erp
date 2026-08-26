import { useEffect, useId, useRef, useState } from "react";
import { cn } from "../lib/cn";

export interface RowMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
  /** `danger` for destructive entries — cancel, void, delete. */
  tone?: "default" | "danger";
  disabled?: boolean;
}

export interface RowMenuProps {
  items: readonly RowMenuItem[];
  /** Accessible name, e.g. "إجراءات INV-000001". */
  label: string;
  className?: string;
}

/**
 * The overflow menu on a list row (docs/reference-parity/audit/REQUIREMENTS.md
 * R1.3). Its contents are the CALLER's job to derive from the row's lifecycle
 * state: a draft transfer offers تأكيد, a converted quote does not offer
 * تعديل, a paid invoice does not offer إلغاء. Passing an empty list renders
 * nothing rather than a menu that opens onto nothing.
 */
export function RowMenu({ items, label, className }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={containerRef} className={cn("relative", className)} onClick={(event) => event.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:border-border hover:bg-surface-2 hover:text-ink"
      >
        <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="h-[15px] w-[15px]">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute top-[calc(100%+4px)] end-0 z-30 min-w-[190px] overflow-hidden rounded-lg border border-border bg-surface py-[4px] shadow-2"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center px-[12px] py-[8px] text-start text-[12.5px] transition-colors",
                item.disabled
                  ? "cursor-not-allowed text-ink-faint"
                  : item.tone === "danger"
                    ? "text-danger-ink hover:bg-danger-soft"
                    : "text-ink hover:bg-surface-2",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
