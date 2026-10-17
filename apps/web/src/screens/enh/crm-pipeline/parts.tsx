import { useMemo } from "react";
import type { LostReasonOptionDTO } from "@mezan/contracts";
import { SelectField } from "../../../settings/form-controls";
import { useAppTranslation, type Locale } from "../../../i18n";
import { useCrmAccess, useCrmLostReasons, useCrmOwners } from "./hooks";

export const UNASSIGNED_OWNER = "";

export function lostReasonLabel(option: LostReasonOptionDTO, locale: Locale): string {
  return locale === "en" ? option.labelEn : option.labelAr;
}

export function useLostReasonName(): (code: string | null) => string | null {
  const { locale } = useAppTranslation();
  const reasons = useCrmLostReasons().data;
  return useMemo(() => {
    const byCode = new Map((reasons ?? []).map((r) => [r.code as string, lostReasonLabel(r, locale)]));
    return (code) => (code === null ? null : (byCode.get(code) ?? code));
  }, [reasons, locale]);
}

export function useOwnerName(): (userId: string | null) => string {
  const { t } = useAppTranslation();
  const owners = useCrmOwners().data;
  return useMemo(() => {
    const byId = new Map((owners ?? []).map((o) => [o.id, o.name]));
    return (userId) => (userId === null ? t("crmPipeline.owner.none") : (byId.get(userId) ?? t("crmPipeline.owner.other")));
  }, [owners, t]);
}

interface OwnerSelectProps {
  readonly label?: string;
  readonly value: string;
  readonly onChange: (userId: string) => void;
  readonly allowNone?: boolean;
}

/**
 * The people a deal or follow-up may be handed to. A rep who may not assign
 * others is not shown a choice at all — the server gives them their own work.
 */
export function OwnerSelect({ label, value, onChange, allowNone = true }: OwnerSelectProps) {
  const { t } = useAppTranslation();
  const access = useCrmAccess();
  const owners = useCrmOwners().data ?? [];
  if (!access.mayAssign) return null;
  return (
    <SelectField
      label={label ?? t("crmPipeline.owner.label")}
      value={value}
      onChange={onChange}
      options={[
        ...(allowNone ? [{ value: UNASSIGNED_OWNER, label: t("crmPipeline.owner.none") }] : []),
        ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
      ]}
    />
  );
}
