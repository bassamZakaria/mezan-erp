import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { useInEditScope } from "@mezan/ui";

const ReadOnlyReasonContext = createContext<string | null>(null);
const ReadOnlyFieldsContext = createContext(false);

const KEEP_ATTRIBUTE = "data-read-only-keep";
const CLOSE_ATTRIBUTE = "data-read-only-close";
const WRITE_CONTROLS = `button[data-variant="primary"], button[data-variant="danger-outline"], button[type="submit"], [${CLOSE_ATTRIBUTE}]`;

/** Spread on the one control of a wrapped form that must stay usable: its Cancel. */
export const READ_ONLY_KEEP = { [KEEP_ATTRIBUTE]: "" } as const;
/** Spread on a write control the screen draws without a primary or danger button: a row's delete icon. */
export const READ_ONLY_CLOSE = { [CLOSE_ATTRIBUTE]: "" } as const;

type ClosableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

function useClosedControls(reason: string | null, selector: string) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = root.current;
    if (reason === null || !container) return;
    const close = () => {
      for (const control of container.querySelectorAll<ClosableControl>(selector)) {
        if (control.hasAttribute(KEEP_ATTRIBUTE) || control.disabled) continue;
        control.disabled = true;
        if (!control.title) control.title = reason;
      }
    };
    close();
    // A row added later, or a control a re-render re-enabled, is closed again.
    const observer = new MutationObserver(close);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [reason, selector]);
  return root;
}

/**
 * Says WHY the screen is read-only for this session, and closes what writes:
 * every create, submit and delete control under it carries the reason and is
 * disabled. A list's filters, search, paging, export and navigation stay open,
 * and so does a form's Cancel. Fields close in the shared panel a record is
 * edited in, and in any hand-built form a screen wraps in `ReadOnlyFields`.
 */
export function ReadOnlyForm({ reason, children }: { readonly reason: string | null; readonly children: ReactNode }) {
  const root = useClosedControls(reason, WRITE_CONTROLS);
  return (
    <ReadOnlyReasonContext.Provider value={reason}>
      <div ref={root} className="contents">
        {children}
      </div>
    </ReadOnlyReasonContext.Provider>
  );
}

export function useReadOnlyControl(disabled: boolean | undefined, hint: string | undefined): { readonly disabled: boolean | undefined; readonly hint: string | undefined } {
  const reason = useContext(ReadOnlyReasonContext);
  const inPanel = useInEditScope();
  const inFields = useContext(ReadOnlyFieldsContext);
  return reason !== null && (inPanel || inFields) ? { disabled: true, hint: reason } : { disabled, hint };
}

export function useReadOnlyReason(): string | null {
  return useContext(ReadOnlyReasonContext);
}

const CLOSABLE_CONTROLS = "input, select, textarea, button";

export function ReadOnlyFields({ children }: { readonly children: ReactNode }) {
  const reason = useContext(ReadOnlyReasonContext);
  const root = useClosedControls(reason, CLOSABLE_CONTROLS);

  return (
    <ReadOnlyFieldsContext.Provider value={reason !== null}>
      <div ref={root} className="contents" data-edit-scope="" data-testid={reason === null ? undefined : "read-only-fields"}>
        {reason === null ? null : (
          <p role="note" className="text-[11.5px] text-ink-faint">
            {reason}
          </p>
        )}
        {children}
      </div>
    </ReadOnlyFieldsContext.Provider>
  );
}
