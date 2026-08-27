import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * Stacking order for the whole shell, low to high. Every popup (Select,
 * RowMenu) must portal to `document.body` and use POPUP_Z — a popup that
 * stays in place inside a `sticky`/`fixed` ancestor is confined to THAT
 * ancestor's stacking context no matter how high its own z-index goes.
 *
 *   40  sticky in-page content (list headers, toolbars)
 *   50  shell chrome (top bar, sidebar)
 *   60  side panel scrim
 *   61  side panel
 *   70  notifications panel scrim
 *   71  notifications panel
 *   90  dialog scrim
 *   91  dialog
 *   95  popups — Select, RowMenu (this file)
 *  100  toasts
 *
 * Popups sit ABOVE dialogs on purpose: a Select or RowMenu is routinely
 * opened from a field or row inside a dialog (ConfirmDialog and friends).
 * If popups sat below the dialog layer (e.g. at 91 or lower), a menu opened
 * from inside a dialog would paint UNDER the dialog that opened it — trapped
 * beneath its own host. 95 keeps every popup reachable regardless of what
 * opened it; only toasts, which must stay legible over an open menu, sit
 * higher still.
 */
export const POPUP_Z_INDEX = 95;
export const POPUP_Z_CLASS = "z-[95]";

export type PopupAlign = "start" | "end";

export interface MenuPosition {
  top: number;
  maxHeight: number;
  /** Present when `align: "start"` — the popup's inline-start edge tracks the trigger's, and it takes the trigger's width. */
  inlineStart?: number;
  width?: number;
  /** Present when `align: "end"` — the popup's inline-end edge tracks the trigger's; width is left to content (`min-w-*`). */
  insetInlineEnd?: number;
}

export const MENU_GAP = 6;
export const MENU_MAX_HEIGHT = 288;
export const MENU_MIN_HEIGHT = 120;

/**
 * Measures where a portaled popup should render relative to its trigger.
 * Position is measured physically (`getBoundingClientRect`, `innerWidth`)
 * but expressed logically (`inlineStart` / `insetInlineEnd`) so the popup
 * tracks the trigger correctly in both LTR and RTL.
 */
export function measure(trigger: HTMLElement, align: PopupAlign = "start"): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const rtl = getComputedStyle(trigger).direction === "rtl";
  const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP - 8;
  const spaceAbove = rect.top - MENU_GAP - 8;
  const flipUp = spaceBelow < 160 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, flipUp ? spaceAbove : spaceBelow));
  const top = flipUp ? rect.top - MENU_GAP - maxHeight : rect.bottom + MENU_GAP;

  if (align === "end") {
    return {
      top,
      maxHeight,
      insetInlineEnd: rtl ? rect.left : window.innerWidth - rect.right,
    };
  }
  return {
    top,
    maxHeight,
    inlineStart: rtl ? window.innerWidth - rect.right : rect.left,
    width: rect.width,
  };
}

/**
 * Tracks a portaled popup's position against its trigger while `open`,
 * recomputing on scroll (any scrolling ancestor, hence `capture: true`) and
 * on resize. Does not reset position on close — the last measurement is
 * simply stale and unused until the next open, matching how `Select`
 * behaved before this was extracted.
 */
export function usePopupPosition<T extends HTMLElement = HTMLElement>(
  triggerRef: RefObject<T | null>,
  open: boolean,
  align: PopupAlign = "start",
): MenuPosition | null {
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const reposition = useCallback(() => {
    if (triggerRef.current) setPosition(measure(triggerRef.current, align));
  }, [triggerRef, align]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onScrollOrResize() {
      reposition();
    }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, reposition]);

  return position;
}
