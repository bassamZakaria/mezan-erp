import { useMemo } from "react";
import { branchEditableFieldsOf, isBranchRestricted } from "../branch-restriction";
import { useApi } from "../data/ApiContext";
import { useAppTranslation } from "../i18n";

export interface LockedFields {
  isLocked(field: string): boolean;
  props(field: string, hint?: string): { readonly disabled?: boolean; readonly hint?: string };
  withoutLocked<Payload extends object>(payload: Payload): Partial<Payload>;
}

export function useLockedFields(apiPrefix: string): LockedFields {
  const { session } = useApi();
  const { t } = useAppTranslation();
  const restricted = isBranchRestricted(session);
  return useMemo(() => {
    const editable = restricted ? branchEditableFieldsOf(apiPrefix, false) : null;
    const isLocked = (field: string) => editable !== null && !editable.has(field);
    const reason = t("branchRestriction.fieldLocked");
    return {
      isLocked,
      props: (field, hint) => (isLocked(field) ? { disabled: true, hint: reason } : hint === undefined ? {} : { hint }),
      withoutLocked: (payload) => Object.fromEntries(Object.entries(payload).filter(([key]) => !isLocked(key))) as Partial<typeof payload>,
    };
  }, [apiPrefix, restricted, t]);
}
