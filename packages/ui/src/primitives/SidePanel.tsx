import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { IconButton } from "./atoms";

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * SidePanel — RTL drill-down drawer. Anchored to the inline-end edge (the
 * left edge in our RTL layout) via `end-0` / `border-s`, matching the
 * `.overlay` + `.panel` pattern in design/mezan-ui-mockups.html. The closed
 * state translates off-screen with `transform`, which is direction-neutral
 * and not something the repo's left/right lint flags.
 */
export function SidePanel({ open, onClose, title, description, children, className }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // `aria-hidden` is driven by this state (not directly by `open`) so closing
  // can blur any focused descendant first — setting aria-hidden on an element
  // that still contains focus is what triggers the browser's "Blocked
  // aria-hidden on an element because its descendant retained focus" warning.
  const [ariaHidden, setAriaHidden] = useState(!open);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setAriaHidden(false);
      return;
    }
    const active = document.activeElement;
    if (panelRef.current && active instanceof HTMLElement && panelRef.current.contains(active)) {
      active.blur();
      previousFocusRef.current?.focus();
    }
    setAriaHidden(true);
  }, [open]);

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[60] bg-[rgba(8,18,14,0.44)] backdrop-blur-[2px] transition-opacity duration-200",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        aria-hidden={ariaHidden}
        className={cn(
          "fixed inset-y-0 end-0 z-[61] w-[430px] max-w-[92vw] overflow-y-auto border-s border-border bg-surface shadow-2 transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)]",
          open ? "translate-x-0" : "-translate-x-[105%]",
          className,
        )}
      >
        <div className="sticky top-0 z-[2] flex items-start justify-between gap-[10px] border-b border-border bg-surface px-[21px] py-[19px]">
          <div>
            <h2 className="text-[15.5px] font-bold text-ink">{title}</h2>
            {description ? <p className="mt-1 text-[12px] text-ink-muted">{description}</p> : null}
          </div>
          <IconButton aria-label="إغلاق اللوحة" onClick={onClose}>
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[16px] w-[16px]">
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </IconButton>
        </div>
        <div className="px-[21px] py-[19px]">{children}</div>
      </div>
    </>
  );
}
