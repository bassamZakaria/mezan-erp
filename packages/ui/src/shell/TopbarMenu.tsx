import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface TopbarMenuTriggerProps {
  ref: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
}

export interface TopbarMenuProps {
  label: string;
  trigger: (props: TopbarMenuTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  panelClassName?: string;
}

/**
 * Anchored dropdown for the Topbar's bell and user menu: closes on outside
 * click and on Escape, returning focus to its trigger so keyboard users are
 * never stranded on a dismissed panel.
 */
export function TopbarMenu({ label, trigger, children, panelClassName }: TopbarMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function close() {
    setOpen(false);
  }

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

  return (
    <div ref={containerRef} className="relative">
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        onClick: () => setOpen((v) => !v),
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? panelId : undefined,
      })}

      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-[calc(100%+8px)] end-0 z-30 w-[300px] overflow-hidden rounded-lg border border-border bg-surface shadow-[0_14px_38px_-12px_rgba(0,0,0,0.34)]",
            panelClassName,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
