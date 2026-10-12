import { createContext, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { useInEditScope } from "@mezan/ui";

const ReadOnlyReasonContext = createContext<string | null>(null);
const ReadOnlyFieldsContext = createContext(false);

/**
 * Says WHY the screen is read-only for this session. It disables nothing by
 * itself: a list's filters, search, paging, export and navigation stay open.
 * Only an edit form closes — the shared panel a record is edited in, and any
 * hand-built form a screen wraps in `ReadOnlyFields`.
 */
export function ReadOnlyForm({ reason, children }: { readonly reason: string | null; readonly children: ReactNode }) {
  return <ReadOnlyReasonContext.Provider value={reason}>{children}</ReadOnlyReasonContext.Provider>;
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

const KEEP_ATTRIBUTE = "data-read-only-keep";
const CLOSABLE_CONTROLS = "input, select, textarea, button";

/** Spread on the one control of a wrapped form that must stay usable: its Cancel. */
export const READ_ONLY_KEEP = { [KEEP_ATTRIBUTE]: "" } as const;

type ClosableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;

export function ReadOnlyFields({ children }: { readonly children: ReactNode }) {
  const reason = useContext(ReadOnlyReasonContext);
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = root.current;
    if (reason === null || !container) return;
    const close = () => {
      for (const control of container.querySelectorAll<ClosableControl>(CLOSABLE_CONTROLS)) {
        if (!control.hasAttribute(KEEP_ATTRIBUTE) && !control.disabled) control.disabled = true;
      }
    };
    close();
    // A row added later, or a control a re-render re-enabled, is closed again.
    const observer = new MutationObserver(close);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => observer.disconnect();
  }, [reason]);

  if (reason === null) return <>{children}</>;
  return (
    <ReadOnlyFieldsContext.Provider value={true}>
      <div ref={root} className="contents" data-testid="read-only-fields">
        <p role="note" className="text-[11.5px] text-ink-faint">
          {reason}
        </p>
        {children}
      </div>
    </ReadOnlyFieldsContext.Provider>
  );
}
