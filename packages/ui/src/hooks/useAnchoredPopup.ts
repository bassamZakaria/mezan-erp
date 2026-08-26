import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

export type AnchoredAlign = "stretch" | "start" | "end";

export interface AnchoredPopupOptions {
  gap?: number;
  maxHeight?: number;
  minHeight?: number;
  /** `stretch` matches the anchor's width; `start`/`end` only align one edge. */
  align?: AnchoredAlign;
  /** Below this much room underneath the anchor, the popup flips above it. */
  flipThreshold?: number;
}

export interface AnchoredPosition {
  top?: number;
  bottom?: number;
  inlineStart?: number;
  inlineEnd?: number;
  width?: number;
  maxHeight: number;
}

const VIEWPORT_EDGE = 8;

function measure(anchor: HTMLElement, options: AnchoredPopupOptions): AnchoredPosition {
  const { gap = 6, maxHeight: cap = 288, minHeight = 120, align = "stretch", flipThreshold = 160 } = options;
  const rect = anchor.getBoundingClientRect();
  const rtl = getComputedStyle(anchor).direction === "rtl";
  const spaceBelow = window.innerHeight - rect.bottom - gap - VIEWPORT_EDGE;
  const spaceAbove = rect.top - gap - VIEWPORT_EDGE;
  const flipUp = spaceBelow < flipThreshold && spaceAbove > spaceBelow;
  const maxHeight = Math.max(minHeight, Math.min(cap, flipUp ? spaceAbove : spaceBelow));

  // Measured physically, expressed logically, so the popup tracks the anchor
  // in both directions.
  const startOffset = rtl ? window.innerWidth - rect.right : rect.left;
  const endOffset = rtl ? rect.left : window.innerWidth - rect.right;

  return {
    // Anchored to the edge nearest the trigger, so a popup shorter than
    // maxHeight still sits against it instead of floating away.
    ...(flipUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    ...(align === "end" ? { inlineEnd: endOffset } : { inlineStart: startOffset }),
    ...(align === "stretch" ? { width: rect.width } : {}),
    maxHeight,
  };
}

/**
 * Positions a popup in a portal against its trigger.
 *
 * Popups that live where they are declared get clipped by any scrolling or
 * `overflow-x-auto` ancestor — and a table wrapper holding a single row is
 * only tall enough to show a sliver of the menu (D59). Rendering into
 * `document.body` at fixed coordinates removes every clipper; the trade is
 * that the position must be re-measured while the page scrolls.
 */
export function useAnchoredPopup(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  options: AnchoredPopupOptions = {},
): AnchoredPosition | null {
  const [position, setPosition] = useState<AnchoredPosition | null>(null);
  const { gap, maxHeight, minHeight, align, flipThreshold } = options;

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor) setPosition(measure(anchor, { gap, maxHeight, minHeight, align, flipThreshold }));
  }, [anchorRef, gap, maxHeight, minHeight, align, flipThreshold]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
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

export function anchoredStyle(position: AnchoredPosition): Record<string, number | undefined> {
  return {
    top: position.top,
    bottom: position.bottom,
    insetInlineStart: position.inlineStart,
    insetInlineEnd: position.inlineEnd,
    width: position.width,
    maxHeight: position.maxHeight,
  };
}
