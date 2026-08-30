import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { FOCUSABLE_SELECTOR } from "../hooks/useFocusTrap";
import { POPUP_Z_CLASS, usePopupPosition } from "./popup-position";

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
  /**
   * Kept for callers that still name it; the panel now measures its own space
   * and flips up on its own (`usePopupPosition`), so this is advisory.
   */
  openUp?: boolean;
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  /*
   * PORTALED AND MEASURED. The user menu's trigger sits at the foot of the
   * workspace column — 200px wide, inside a `position: sticky` box, at the
   * bottom of the viewport. Anchored absolutely it did all three wrong things
   * at once: it dropped below the fold, it overflowed the column's width, and
   * being inside a sticky ancestor's stacking context the page painted over
   * it. `usePopupPosition` flips it above the trigger and pins it to the
   * viewport; the portal takes it out of the column's stacking context.
   */
  // "start", not "end": at the foot of the column the trigger's inline-END is
  // the viewport's own edge, and an end-aligned panel grows straight off the
  // screen. Anchored at the inline-START it opens toward the content, which is
  // also where there is room for it.
  const position = usePopupPosition(triggerRef, open, "start");

  function close() {
    setOpen(false);
  }

  /**
   * FOCUS. The panel is portaled to <body>, so it is nowhere near the trigger
   * in the DOM: without moving focus in, Tab from the trigger walks the page
   * behind the open menu, and an item activated from the keyboard takes the
   * focused element down with it and strands the user on <body> (D113).
   *
   * The one exception is a dismissal by clicking somewhere else — that click
   * owns the focus, and pulling it back to the trigger would fight it.
   */
  const dismissedByPointerRef = useRef(false);

  // A ref callback, not an effect: the panel mounts on a second render (the
  // position is measured in a layout effect), so an effect keyed on `open`
  // can run while the panel node does not exist yet.
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (!node) return;
    const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? node).focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    dismissedByPointerRef.current = false;
    return () => {
      if (dismissedByPointerRef.current) return;
      // The panel is already detached here, so focus that was inside it has
      // fallen to <body> — that, and only that, is what to catch.
      const active = document.activeElement;
      if (active === null || active === document.body) triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      dismissedByPointerRef.current = true;
      setOpen(false);
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

      {open && position
        ? createPortal(
            <div
              ref={attachPanel}
              id={panelId}
              role="menu"
              tabIndex={-1}
              aria-label={label}
              style={{
                position: "fixed",
                top: `${position.top}px`,
                insetInlineStart: `${position.inlineStart ?? 0}px`,
                maxHeight: `${position.maxHeight}px`,
              }}
              className={cn(
                POPUP_Z_CLASS,
                "w-[300px] overflow-y-auto rounded-lg border border-border bg-surface shadow-2",
                panelClassName,
              )}
            >
              {typeof children === "function" ? children(close) : children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
