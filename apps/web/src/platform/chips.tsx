import { StatusPill, type PillTone } from "@mezan/ui";
import { LicenseStateCode, SubscriptionStatusCode, TenantWireStatus, type LicenseStateNameDTO, type SubscriptionStatusDTO, type TenantStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const TENANT_STATUS_TONE: Record<TenantStatusDTO, PillTone> = {
  [TenantWireStatus.Provisioning]: "info",
  [TenantWireStatus.Active]: "success",
  [TenantWireStatus.Suspended]: "warning",
  [TenantWireStatus.Archived]: "neutral",
  [TenantWireStatus.Unknown]: "danger",
};

const TENANT_STATUS_LABEL: Record<TenantStatusDTO, AppTranslationKey> = {
  [TenantWireStatus.Provisioning]: "platform.tenantStatus.provisioning",
  [TenantWireStatus.Active]: "platform.tenantStatus.active",
  [TenantWireStatus.Suspended]: "platform.tenantStatus.suspended",
  [TenantWireStatus.Archived]: "platform.tenantStatus.archived",
  [TenantWireStatus.Unknown]: "platform.status.unknown",
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

export function OwnerContactChip({ verified }: { verified: boolean }) {
  const { t } = useAppTranslation();
  return verified ? null : <StatusPill label={t("platform.tenants.ownerUnverified")} tone="warning" />;
}

export function BillingDayReviewChip({ needsReview }: { needsReview: boolean }) {
  const { t } = useAppTranslation();
  return needsReview ? <StatusPill label={t("platform.tenantDetail.anchorDay.review")} tone="warning" /> : null;
}

export function TenantLicenceChip({ state, subscriptionStatus }: { state: LicenseStateNameDTO; subscriptionStatus: SubscriptionStatusDTO | null }) {
  const { t } = useAppTranslation();
  if (subscriptionStatus === SubscriptionStatusCode.Unknown) {
    return <StatusPill label={t("platform.status.unknown")} tone="danger" />;
  }
  if (state === LicenseStateCode.Active && subscriptionStatus === SubscriptionStatusCode.Trialing) {
    return <StatusPill label={t("platform.subscriptionStatus.trialing")} tone="info" />;
  }
  return <LicenseStateChip state={state} />;
}
