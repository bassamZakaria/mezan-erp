import { StatusPill, type PillTone } from "@mezan/ui";
import { LicenseStateCode, SubscriptionStatusCode, type LicenseStateNameDTO, type SubscriptionStatusDTO, type TenantStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const TENANT_STATUS_TONE: Record<TenantStatusDTO, PillTone> = {
  provisioning: "info",
  active: "success",
  suspended: "warning",
  archived: "neutral",
};

const TENANT_STATUS_LABEL: Record<TenantStatusDTO, AppTranslationKey> = {
  provisioning: "platform.tenantStatus.provisioning",
  active: "platform.tenantStatus.active",
  suspended: "platform.tenantStatus.suspended",
  archived: "platform.tenantStatus.archived",
};

export function TenantStatusChip({ status }: { status: TenantStatusDTO }) {
  const { t } = useAppTranslation();
  return <StatusPill label={t(TENANT_STATUS_LABEL[status])} tone={TENANT_STATUS_TONE[status]} />;
}

/** ACTIVE reads green, GRACE amber, everything else (READ_ONLY, UNLICENSED, INVALID) red — the existing `StatusPill` tone tokens only. */
const LICENSE_STATE_TONE: Record<LicenseStateNameDTO, PillTone> = {
  ACTIVE: "success",
  GRACE: "warning",
  READ_ONLY: "danger",
  UNLICENSED: "danger",
  INVALID: "danger",
};

const LICENSE_STATE_LABEL: Record<LicenseStateNameDTO, AppTranslationKey> = {
  ACTIVE: "platform.licenseState.ACTIVE",
  GRACE: "platform.licenseState.GRACE",
  READ_ONLY: "platform.licenseState.READ_ONLY",
  UNLICENSED: "platform.licenseState.UNLICENSED",
  INVALID: "platform.licenseState.INVALID",
};

export function LicenseStateChip({ state }: { state: LicenseStateNameDTO }) {
  const { t } = useAppTranslation();
  return <StatusPill label={t(LICENSE_STATE_LABEL[state])} tone={LICENSE_STATE_TONE[state]} />;
}

export function TenantLicenceChip({ state, subscriptionStatus }: { state: LicenseStateNameDTO; subscriptionStatus: SubscriptionStatusDTO | null }) {
  const { t } = useAppTranslation();
  if (state === LicenseStateCode.Active && subscriptionStatus === SubscriptionStatusCode.Trialing) {
    return <StatusPill label={t("platform.subscriptionStatus.trialing")} tone="info" />;
  }
  return <LicenseStateChip state={state} />;
}
