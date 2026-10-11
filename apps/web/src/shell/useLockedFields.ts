import { useMemo } from "react";
import { isBranchRestricted, restrictedFieldsOf } from "../branch-restriction";
import { useApi } from "../data/ApiContext";
import { useAppTranslation } from "../i18n";

export interface LockedFields {
  isLocked(field: string): boolean;
  /** `disabled` and the reason, to spread onto a form control; empty for a field that is open. */
  props(field: string, hint?: string): { readonly disabled?: boolean; readonly hint?: string };
  /** The payload without the fields this session may not set, so the server's defaults stand. */
  withoutLocked<Payload extends object>(payload: Payload): Partial<Payload>;
}

/**
 * The fields of a shared record that apply to every branch, as the server's
 * policy table names them, locked for a branch-restricted session.
 */
export function useLockedFields(apiPrefix: string): LockedFields {
  const { session } = useApi();
  const { t } = useAppTranslation();
  const restricted = isBranchRestricted(session);
  return useMemo(() => {
    const locked = new Set(restricted ? restrictedFieldsOf(apiPrefix) : []);
    const reason = t("branchRestriction.fieldLocked");
    return {
      isLocked: (field) => locked.has(field),
      props: (field, hint) => (locked.has(field) ? { disabled: true, hint: reason } : hint === undefined ? {} : { hint }),
      withoutLocked: (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => !locked.has(key))) as Partial<typeof payload>,
    };
  }, [apiPrefix, restricted, t]);
}
