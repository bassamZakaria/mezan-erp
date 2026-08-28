import { useEffect, type RefObject } from "react";

/** The Tab stops a dialog cycles through; also what a panel focuses first. */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface FocusTrapOptions {
  /** Inert while false, so a closed-but-mounted panel does not steal Tab. */
  active: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  /** Escape is prevented before it reaches the page. Off for a panel that lets it bubble. */
  preventEscapeDefault?: boolean;
}

/**
 * Escape-to-close plus a Tab cycle confined to the container — the behaviour
 * every `role="dialog"` in this product needs.
 *
 * It was written three times (side panel, confirm dialog) and missed once (the
 * shortcuts sheet, which announced `aria-modal` while Tab walked straight out
 * behind it). One implementation is why that cannot happen to the next dialog.
 */
export function useFocusTrap({ active, containerRef, onEscape, preventEscapeDefault = false }: FocusTrapOptions): void {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (preventEscapeDefault) event.preventDefault();
        onEscape?.();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      // A control inside a closed-but-mounted subtree has no offsetParent; it
      // must not be a Tab stop, but the currently focused element always is.
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const activeEl = document.activeElement;
      if (event.shiftKey && (activeEl === first || activeEl === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef, onEscape, preventEscapeDefault]);
}
