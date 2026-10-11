import { createContext, useContext, type ReactNode } from "react";

const ReadOnlyFormContext = createContext<string | null>(null);

export function ReadOnlyForm({ reason, children }: { readonly reason: string | null; readonly children: ReactNode }) {
  return <ReadOnlyFormContext.Provider value={reason}>{children}</ReadOnlyFormContext.Provider>;
}

export function useReadOnlyControl(disabled: boolean | undefined, hint: string | undefined): { readonly disabled: boolean | undefined; readonly hint: string | undefined } {
  const reason = useContext(ReadOnlyFormContext);
  return reason === null ? { disabled, hint } : { disabled: true, hint: reason };
}
