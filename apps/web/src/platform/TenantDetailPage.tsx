import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Button, Card, ConfirmDialog, Money, Select, StatusPill, useFormat } from "@mezan/ui";
import { CardCheckoutFailureReason, CardCheckoutStatus, MODULES } from "@mezan/domain";
import type {
  BillingCycleDTO,
  CardCheckoutDTO,
  CardCheckoutSweepResultDTO,
  ProvisionResultDTO,
  SubscriptionStatusDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { moduleLabel } from "../domain-labels";
import { SelectField, TextAreaField, ToggleField } from "../settings/form-controls";
import { LicenseStateChip, TenantStatusChip } from "./chips";
import { PlatformApiError, usePlatformApi } from "./api";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import { ApplyCardPaymentDialog } from "./ApplyCardPaymentDialog";
import { CardCheckoutChip, CheckoutOutcomeNotice, TestModeChip, absoluteCheckoutUrl } from "../billing/CardCheckoutStatus";
import {
  useArchiveTenantMutation,
  useCancelSubscriptionMutation,
  useCardCheckoutsQuery,
  useCreateCardCheckoutMutation,
  useChangePlanMutation,
  usePlansQuery,
  useResumeSubscriptionMutation,
  useResumeTenantMutation,
  useRetryProvisionMutation,
  useSuspendSubscriptionMutation,
  useSuspendTenantMutation,
  useSweepCardCheckoutsMutation,
  useTenantQuery,
} from "./hooks";

const BILLING_CYCLE_LABEL: Record<BillingCycleDTO, AppTranslationKey> = {
  monthly: "platform.billingCycle.monthly",
  yearly: "platform.billingCycle.yearly",
};

const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatusDTO, AppTranslationKey> = {
  trialing: "platform.subscriptionStatus.trialing",
  active: "platform.subscriptionStatus.active",
  past_due: "platform.subscriptionStatus.past_due",
  suspended: "platform.subscriptionStatus.suspended",
  cancelled: "platform.subscriptionStatus.cancelled",
};

/** Mirrors `TRANSITIONS` in `packages/domain/src/platform/tenant.ts` — suspend only from `active`, resume only from `suspended`, archive from either. */
function canSuspendTenant(status: string): boolean {
  return status === "active";
}
function canResumeTenant(status: string): boolean {
  return status === "suspended";
}
function canArchiveTenant(status: string): boolean {
  return status === "active" || status === "suspended";
}
/** Mirrors `changePlan`/`cancelSubscription`/`suspendSubscription`/`resumeSubscription` in `packages/domain/src/platform/subscription.ts`. */
function canChangePlan(status: SubscriptionStatusDTO): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}
function canCancelSubscription(status: SubscriptionStatusDTO): boolean {
  return status !== "cancelled";
}
function canSuspendSubscription(status: SubscriptionStatusDTO): boolean {
  return status === "active" || status === "past_due";
}
function canResumeSubscription(status: SubscriptionStatusDTO): boolean {
  return status === "suspended";
}

const FAILURE_REASON_KEY: Readonly<Record<CardCheckoutFailureReason, AppTranslationKey>> = {
  [CardCheckoutFailureReason.Declined]: "platform.cardCheckout.reason.DECLINED",
  [CardCheckoutFailureReason.ProviderError]: "platform.cardCheckout.reason.PROVIDER_ERROR",
  [CardCheckoutFailureReason.AmountMismatch]: "platform.cardCheckout.reason.AMOUNT_MISMATCH",
  [CardCheckoutFailureReason.PriceChanged]: "platform.cardCheckout.reason.PRICE_CHANGED",
  [CardCheckoutFailureReason.SubscriptionNotRenewable]: "platform.cardCheckout.reason.SUBSCRIPTION_NOT_RENEWABLE",
  [CardCheckoutFailureReason.Expired]: "platform.cardCheckout.reason.EXPIRED",
  [CardCheckoutFailureReason.NeedsAttention]: "platform.cardCheckout.reason.NEEDS_ATTENTION",
  [CardCheckoutFailureReason.ReferenceAlreadyRecorded]: "platform.cardCheckout.reason.REFERENCE_ALREADY_RECORDED",
};

/** Mirrors `applyRenewal` in `packages/domain/src/platform/subscription.ts`: applying a payment renews, and only these can be renewed. */
function canRenewSubscription(status: SubscriptionStatusDTO | undefined): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}

type AppliableCheckout = { readonly status: string; readonly providerRef: string | null; readonly failureReason: string | null };

// A captured payment the server would let an owner apply by hand, were the
// subscription renewable (card-checkout.ts applyUnapplied). One whose
// reference is already a recorded payment is refused: applying it would renew
// the subscription a second time.
function isAppliable(checkout: AppliableCheckout): boolean {
  return (
    checkout.status === CardCheckoutStatus.Unapplied &&
    Boolean(checkout.providerRef) &&
    checkout.failureReason !== CardCheckoutFailureReason.ReferenceAlreadyRecorded
  );
}

function failureReasonKey(reason: string): AppTranslationKey {
  return (FAILURE_REASON_KEY as Readonly<Record<string, AppTranslationKey | undefined>>)[reason] ?? "platform.cardCheckout.reason.other";
}

/** `MODULE_CATALOG`/entitlement ids are the permission catalog's `MODULES` ids, except its one differing entry (`financial_papers` → `cheques`) — mirrors `PlanEditor.tsx`'s own mapping. */
const CATALOG_MODULE_ID: Readonly<Record<string, string>> = { financial_papers: "cheques" };

function entitlementModuleLabel(id: string, t: (key: AppTranslationKey) => string): string {
  const catalogId = CATALOG_MODULE_ID[id] ?? id;
  const entry = MODULES.find((m) => m.id === catalogId);
  return entry ? moduleLabel(entry, t) : id;
}

/** «تفاصيل المنشأة» — a routed page (not an overlay: this is a document, not a short form), reached from `TenantsPage`'s row click. */
export function TenantDetailPage() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const { id = "" } = useParams();
  const { session } = usePlatformApi();
  const isOwner = session?.user.role === "owner";

  const tenantQuery = useTenantQuery(id);
  const plansQuery = usePlansQuery();
  const suspendTenant = useSuspendTenantMutation();
  const resumeTenant = useResumeTenantMutation();
  const archiveTenant = useArchiveTenantMutation();
  const changePlan = useChangePlanMutation();
  const cancelSubscription = useCancelSubscriptionMutation();
  const suspendSubscription = useSuspendSubscriptionMutation();
  const resumeSubscription = useResumeSubscriptionMutation();
  const retryProvision = useRetryProvisionMutation();
  const cardCheckouts = useCardCheckoutsQuery(id);
  const createCardCheckout = useCreateCardCheckoutMutation();
  const sweepCardCheckouts = useSweepCardCheckoutsMutation();
  const [applyTarget, setApplyTarget] = useState<CardCheckoutDTO | null>(null);
  const [searchParams] = useSearchParams();
  const returnedCheckoutId = searchParams.get("checkout");
  const [cardLink, setCardLink] = useState<string | null>(null);
  const [cardLinkCopied, setCardLinkCopied] = useState(false);

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSuspendSubscription, setConfirmSuspendSubscription] = useState(false);
  const [confirmResumeSubscription, setConfirmResumeSubscription] = useState(false);
  const [suspendSubscriptionReason, setSuspendSubscriptionReason] = useState("");
  const [resumeSubscriptionReason, setResumeSubscriptionReason] = useState("");
  const [planPickerId, setPlanPickerId] = useState("");
  const [retryResult, setRetryResult] = useState<ProvisionResultDTO | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [showRetryPicker, setShowRetryPicker] = useState(false);
  const [retryPlanId, setRetryPlanId] = useState("");
  const [retryBillingCycle, setRetryBillingCycle] = useState<BillingCycleDTO>("monthly");
  const [retryTrial, setRetryTrial] = useState(true);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const onMutationError = (err: PlatformApiError) => setMutationError(err.message);

  const summary = tenantQuery.data;
  if (!summary) {
    return <div className="p-8 text-center text-sm text-ink-muted">{tenantQuery.isError ? t("platform.tenantDetail.notFound") : t("common.loading")}</div>;
  }

  const { tenant, subscription, plan, licenseState, entitlements, payments } = summary;
  const checkoutsData = cardCheckouts.data;
  const returnedCheckout = returnedCheckoutId ? checkoutsData?.checkouts.find((c) => c.id === returnedCheckoutId) : undefined;

  function payByCard() {
    if (createCardCheckout.isPending) return;
    setMutationError(null);
    setCardLink(null);
    setCardLinkCopied(false);
    createCardCheckout.mutate(tenant.id, {
      onSuccess: (checkout) => setCardLink(absoluteCheckoutUrl(checkout)),
      onError: onMutationError,
    });
  }
  const planOptions = (plansQuery.data ?? [])
    .filter((p) => p.status === "active" && p.id !== subscription?.planId)
    .map((p) => ({ value: p.id, label: `${p.nameAr} — ${p.code}` }));
  const retryPlanOptions = (plansQuery.data ?? []).filter((p) => p.status === "active").map((p) => ({ value: p.id, label: `${p.nameAr} — ${p.code}` }));
  const cycleOptions: { value: BillingCycleDTO; label: string }[] = [
    { value: "monthly", label: t("platform.billingCycle.monthly") },
    { value: "yearly", label: t("platform.billingCycle.yearly") },
  ];

  function submitRetry(body?: { planId: string; billingCycle: BillingCycleDTO; trial: boolean }) {
    setRetryError(null);
    retryProvision.mutate(
      { tenantId: tenant.id, ...(body ? { body } : {}) },
      {
        onSuccess: (res) => {
          setRetryResult(res);
          setShowRetryPicker(false);
        },
        onError: (err) => setRetryError(err instanceof PlatformApiError ? err.message : t("platform.tenantDetail.retryProvision.error.generic")),
      },
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <Link to="/platform/tenants" className="text-[12px] font-semibold text-brand hover:underline">
          {t("platform.tenantDetail.back")}
        </Link>
        <div className="mt-[6px] flex flex-wrap items-center gap-[10px]">
          <h1 className="font-display text-[19px] font-bold text-ink">{tenant.nameAr}</h1>
          <span className="mz-lat text-[12.5px] text-ink-faint">{tenant.code}</span>
          <TenantStatusChip status={tenant.status} />
          <LicenseStateChip state={licenseState.state} />
        </div>
        <p className="mt-[2px] text-[12.5px] text-ink-muted">{t("platform.tenantDetail.ownerEmail")}: {tenant.ownerEmail}</p>
      </div>

      {mutationError ? (
        <Card className="p-[14px_16px]">
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {mutationError}
          </p>
        </Card>
      ) : null}

      {isOwner ? (
        <div className="flex flex-wrap gap-[9px]">
          {tenant.status === "provisioning" ? (
            <Button
              variant="primary"
              disabled={retryProvision.isPending}
              onClick={() => (subscription ? submitRetry() : setShowRetryPicker(true))}
            >
              {retryProvision.isPending ? t("platform.tenantDetail.retrying") : t("platform.tenantDetail.retryProvision")}
            </Button>
          ) : null}
          {canSuspendTenant(tenant.status) ? (
            <Button
              variant="default"
              disabled={suspendTenant.isPending}
              onClick={() => {
                setMutationError(null);
                suspendTenant.mutate(tenant.id, { onError: onMutationError });
              }}
            >
              {t("platform.tenantDetail.suspend")}
            </Button>
          ) : null}
          {canResumeTenant(tenant.status) ? (
            <Button
              variant="default"
              disabled={resumeTenant.isPending}
              onClick={() => {
                setMutationError(null);
                resumeTenant.mutate(tenant.id, { onError: onMutationError });
              }}
            >
              {t("platform.tenantDetail.resume")}
            </Button>
          ) : null}
          {canArchiveTenant(tenant.status) ? (
            <Button variant="danger-outline" disabled={archiveTenant.isPending} onClick={() => setConfirmArchive(true)}>
              {t("platform.tenantDetail.archive")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {tenant.status === "provisioning" && showRetryPicker && !subscription ? (
        <Card className="p-[16px]">
          <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("platform.tenantDetail.retryProvision")}</h2>
          <div className="flex flex-col gap-[14px]">
            <SelectField label={t("platform.newTenant.plan")} value={retryPlanId} onChange={setRetryPlanId} options={retryPlanOptions} />
            <SelectField
              label={t("platform.newTenant.billingCycle")}
              value={retryBillingCycle}
              onChange={(v) => setRetryBillingCycle(v as BillingCycleDTO)}
              options={cycleOptions}
            />
            <ToggleField label={t("platform.newTenant.trial")} checked={retryTrial} onChange={setRetryTrial} />
            <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
              <Button variant="ghost" onClick={() => setShowRetryPicker(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={retryPlanId === "" || retryProvision.isPending}
                onClick={() => {
                  if (retryPlanId === "") return;
                  submitRetry({ planId: retryPlanId, billingCycle: retryBillingCycle, trial: retryTrial });
                }}
              >
                {retryProvision.isPending ? t("platform.tenantDetail.retrying") : t("platform.tenantDetail.retryProvision")}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {retryError ? (
        <Card className="p-[16px]">
          <p role="alert" className="text-[12.5px] font-semibold text-danger-ink">{retryError}</p>
        </Card>
      ) : null}
      {retryResult ? (
        <Card className="p-[16px]">
          <div className="flex flex-col gap-[10px]">
            <p className="text-[12.5px] text-ink-muted">{t("platform.newTenant.result.hint")}</p>
            <div className="flex flex-col gap-[10px] rounded-md border border-border bg-surface-2 p-[14px]">
              <div>
                <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("platform.newTenant.result.adminPin")}</span>
                <code dir="ltr" className="mz-num select-all break-all rounded-[6px] bg-surface px-[10px] py-[6px] text-[16px] font-bold text-ink">
                  {retryResult.adminPin ?? t("platform.newTenant.result.pinKept")}
                </code>
              </div>
            </div>
            <p role="alert" className="text-[11.5px] font-semibold text-warning-ink">{t("platform.newTenant.result.oneTime")}</p>
          </div>
        </Card>
      ) : null}

      <Card className="p-[16px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("platform.tenantDetail.subscription")}</h2>
        {subscription && plan ? (
          <div className="flex flex-col gap-[10px]">
            <Fact label={t("platform.tenantDetail.plan")} value={`${plan.nameAr} — ${plan.code}`} />
            <Fact label={t("platform.tenantDetail.billingCycle")} value={t(BILLING_CYCLE_LABEL[subscription.billingCycle])} />
            <Fact label={t("platform.tenantDetail.subscriptionStatus")} value={t(SUBSCRIPTION_STATUS_LABEL[subscription.status])} />
            <Fact numeric label={t("platform.tenantDetail.periodStart")} value={format.date(subscription.currentPeriodStart)} />
            <Fact numeric label={t("platform.tenantDetail.periodEnd")} value={format.date(subscription.currentPeriodEnd)} />
            {subscription.trialEndsAt ? <Fact numeric label={t("platform.tenantDetail.trialEndsAt")} value={format.date(subscription.trialEndsAt)} /> : null}
            <Fact numeric label={t("platform.tenantDetail.graceDays")} value={String(subscription.graceDays)} />

            {isOwner ? (
              <div className="mt-[6px] flex flex-wrap items-center gap-[9px] border-t border-border pt-[12px]">
                {canChangePlan(subscription.status) ? (
                  <>
                    <Select
                      value={planPickerId}
                      onChange={setPlanPickerId}
                      options={planOptions}
                      placeholder={t("platform.tenantDetail.changePlan")}
                      aria-label={t("platform.tenantDetail.changePlan")}
                      size="sm"
                    />
                    <Button
                      variant="default"
                      size="sm"
                      disabled={planPickerId === "" || changePlan.isPending}
                      onClick={() => {
                        if (planPickerId === "") return;
                        setMutationError(null);
                        changePlan.mutate(
                          { tenantId: tenant.id, body: { planId: planPickerId } },
                          { onSuccess: () => setPlanPickerId(""), onError: onMutationError },
                        );
                      }}
                    >
                      {t("platform.tenantDetail.apply")}
                    </Button>
                  </>
                ) : null}
                {canSuspendSubscription(subscription.status) ? (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={suspendSubscription.isPending}
                    onClick={() => {
                      setSuspendSubscriptionReason("");
                      setConfirmSuspendSubscription(true);
                    }}
                  >
                    {t("platform.tenantDetail.suspendSubscription")}
                  </Button>
                ) : null}
                {canResumeSubscription(subscription.status) ? (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={resumeSubscription.isPending}
                    onClick={() => {
                      setResumeSubscriptionReason("");
                      setConfirmResumeSubscription(true);
                    }}
                  >
                    {t("platform.tenantDetail.resumeSubscription")}
                  </Button>
                ) : null}
                {canCancelSubscription(subscription.status) ? (
                  <Button variant="danger-outline" size="sm" disabled={cancelSubscription.isPending} onClick={() => setConfirmCancel(true)}>
                    {t("platform.tenantDetail.cancelSubscription")}
                  </Button>
                ) : null}
                <Button variant="primary" size="sm" onClick={() => setPaymentDialogOpen(true)}>
                  {t("platform.tenantDetail.recordPayment")}
                </Button>
                {checkoutsData?.cardCheckout && canChangePlan(subscription.status) ? (
                  <Button variant="default" size="sm" disabled={createCardCheckout.isPending} onClick={payByCard}>
                    {createCardCheckout.isPending ? t("platform.cardCheckout.creating") : t("platform.cardCheckout.payByCard")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("platform.tenantDetail.noSubscription")}</p>
        )}
      </Card>

      {cardLink || returnedCheckoutId || (checkoutsData && checkoutsData.checkouts.length > 0) ? (
        <Card className="p-[16px]">
          <div className="mb-[12px] flex flex-wrap items-center gap-[8px]">
            <h2 className="text-[13px] font-bold text-ink">{t("platform.cardCheckout.title")}</h2>
            {checkoutsData?.testMode ? <TestModeChip /> : null}
            {isOwner && checkoutsData?.cardCheckout ? (
              <Button
                className="ms-auto"
                variant="default"
                size="sm"
                title={t("platform.cardCheckout.sweep.hint")}
                disabled={sweepCardCheckouts.isPending}
                onClick={() => {
                  setMutationError(null);
                  sweepCardCheckouts.mutate(undefined, { onError: onMutationError });
                }}
              >
                {sweepCardCheckouts.isPending ? t("platform.cardCheckout.sweep.running") : t("platform.cardCheckout.sweep.run")}
              </Button>
            ) : null}
          </div>
          {sweepCardCheckouts.data ? <SweepOutcome result={sweepCardCheckouts.data} /> : null}
          {returnedCheckoutId ? (
            <div className="mb-[12px] rounded-md border border-border bg-surface-2 p-[12px]">
              <CheckoutOutcomeNotice checkout={returnedCheckout} timedOut={false} />
            </div>
          ) : null}
          {cardLink ? (
            <div className="mb-[12px] flex flex-col gap-[8px] rounded-md border border-border bg-surface-2 p-[12px]">
              <span className="text-xs font-semibold text-ink-muted">{t("platform.cardCheckout.linkReady")}</span>
              <code dir="ltr" className="mz-lat select-all break-all rounded-[6px] bg-surface px-[10px] py-[6px] text-[12px] text-ink">
                {cardLink}
              </code>
              <div className="flex flex-wrap gap-[9px]">
                <Button variant="primary" size="sm" onClick={() => window.open(cardLink, "_blank", "noopener")}>
                  {t("platform.cardCheckout.open")}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(cardLink).then(() => setCardLinkCopied(true));
                  }}
                >
                  {cardLinkCopied ? t("platform.cardCheckout.copied") : t("platform.cardCheckout.copy")}
                </Button>
              </div>
              <p className="text-[11.5px] text-ink-faint">{t("platform.cardCheckout.linkHint")}</p>
            </div>
          ) : null}
          {checkoutsData && checkoutsData.checkouts.length > 0 ? (
            <div className="flex flex-col gap-[8px]">
              {checkoutsData.checkouts.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-[10px] border-b border-border pb-[8px] last:border-none last:pb-0">
                  <div className="flex flex-col gap-[3px]">
                    <div className="flex items-center gap-[8px]">
                      <CardCheckoutChip status={c.status} />
                      {c.providerRef ? <span className="mz-lat text-[11.5px] text-ink-muted">PAYMOB-{c.providerRef}</span> : null}
                    </div>
                    <span className="text-[11px] text-ink-faint">
                      {format.date(c.createdAt)}
                      {c.failureReason ? ` — ${t(failureReasonKey(c.failureReason))}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-[10px]">
                    {isOwner && isAppliable(c) && canRenewSubscription(subscription?.status) ? (
                      <Button variant="default" size="sm" onClick={() => setApplyTarget(c)}>
                        {t("platform.cardCheckout.apply.action")}
                      </Button>
                    ) : null}
                    {isAppliable(c) && !canRenewSubscription(subscription?.status) ? (
                      <span className="text-[11px] text-ink-muted">{t("platform.cardCheckout.apply.notRenewable")}</span>
                    ) : null}
                    {c.status === CardCheckoutStatus.Unapplied && c.failureReason === CardCheckoutFailureReason.ReferenceAlreadyRecorded ? (
                      <span className="text-[11px] text-ink-muted">{t("platform.cardCheckout.apply.alreadyRecorded")}</span>
                    ) : null}
                    <Money value={Number(c.amount)} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-[16px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("platform.tenantDetail.entitlements")}</h2>
        {entitlements ? (
          <div className="flex flex-col gap-[10px]">
            <Fact label={t("platform.tenantDetail.entitlementsPlanCode")} value={entitlements.plan} />
            <Fact numeric label={t("platform.tenantDetail.entitlementsSeats")} value={String(entitlements.seats)} />
            {entitlements.limits ? (
              <>
                <Fact numeric label={t("platform.tenantDetail.entitlementsBranches")} value={String(entitlements.limits.branches)} />
                <Fact numeric label={t("platform.tenantDetail.entitlementsWarehouses")} value={String(entitlements.limits.warehouses)} />
              </>
            ) : null}
            <Fact
              numeric={entitlements.expiresAt !== null}
              label={t("platform.tenantDetail.entitlementsExpiry")}
              value={entitlements.expiresAt ? format.date(entitlements.expiresAt) : t("platform.tenantDetail.entitlementsNoExpiry")}
            />
            <div>
              <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("platform.tenantDetail.entitlementsModules")}</span>
              <div className="flex flex-wrap gap-[6px]">
                {entitlements.activeModules.map((id) => (
                  <StatusPill key={id} label={entitlementModuleLabel(id, t)} tone="neutral" />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("platform.tenantDetail.noEntitlements")}</p>
        )}
      </Card>

      <Card className="p-[16px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("platform.tenantDetail.payments")}</h2>
        {payments.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">{t("platform.tenantDetail.noPayments")}</p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-[10px] border-b border-border pb-[8px] last:border-none last:pb-0">
                <div>
                  <div className="mz-lat text-[12.5px] font-semibold text-ink">{p.reference}</div>
                  <div className="text-[11px] text-ink-faint">{format.date(p.paidAt)}</div>
                </div>
                <Money value={Number(p.amount)} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <RecordPaymentDialog open={paymentDialogOpen} onClose={() => setPaymentDialogOpen(false)} tenantId={tenant.id} />
      <ApplyCardPaymentDialog
        key={applyTarget?.id ?? "closed"}
        checkout={applyTarget}
        onClose={() => setApplyTarget(null)}
        tenantId={tenant.id}
      />

      <ConfirmDialog
        open={confirmArchive}
        title={t("platform.tenantDetail.confirmArchive.title")}
        consequence={t("platform.tenantDetail.confirmArchive.consequence")}
        confirmLabel={t("platform.tenantDetail.archive")}
        tone="danger"
        onConfirm={() => {
          setConfirmArchive(false);
          setMutationError(null);
          archiveTenant.mutate(tenant.id, { onError: onMutationError });
        }}
        onCancel={() => setConfirmArchive(false)}
      />
      <ConfirmDialog
        open={confirmCancel}
        title={t("platform.tenantDetail.confirmCancel.title")}
        consequence={t("platform.tenantDetail.confirmCancel.consequence")}
        confirmLabel={t("platform.tenantDetail.cancelSubscription")}
        tone="danger"
        onConfirm={() => {
          setConfirmCancel(false);
          setMutationError(null);
          cancelSubscription.mutate(tenant.id, { onError: onMutationError });
        }}
        onCancel={() => setConfirmCancel(false)}
      />
      <ConfirmDialog
        open={confirmSuspendSubscription}
        title={t("platform.tenantDetail.confirmSuspendSubscription.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.tenantDetail.confirmSuspendSubscription.consequence")}</p>
            <TextAreaField
              label={t("platform.tenantDetail.reason")}
              value={suspendSubscriptionReason}
              onChange={setSuspendSubscriptionReason}
              placeholder={t("platform.tenantDetail.reasonHint")}
              rows={2}
            />
          </div>
        }
        confirmLabel={t("platform.tenantDetail.suspendSubscription")}
        tone="danger"
        confirmDisabled={suspendSubscriptionReason.trim() === ""}
        onConfirm={() => {
          const reason = suspendSubscriptionReason.trim();
          if (reason === "") return;
          setConfirmSuspendSubscription(false);
          setMutationError(null);
          suspendSubscription.mutate({ tenantId: tenant.id, body: { reason } }, { onError: onMutationError });
        }}
        onCancel={() => setConfirmSuspendSubscription(false)}
      />
      <ConfirmDialog
        open={confirmResumeSubscription}
        title={t("platform.tenantDetail.confirmResumeSubscription.title")}
        consequence={
          <div className="flex flex-col gap-[10px]">
            <p>{t("platform.tenantDetail.confirmResumeSubscription.consequence")}</p>
            <TextAreaField
              label={t("platform.tenantDetail.reason")}
              value={resumeSubscriptionReason}
              onChange={setResumeSubscriptionReason}
              placeholder={t("platform.tenantDetail.reasonHint")}
              rows={2}
            />
          </div>
        }
        confirmLabel={t("platform.tenantDetail.resumeSubscription")}
        confirmDisabled={resumeSubscriptionReason.trim() === ""}
        onConfirm={() => {
          const reason = resumeSubscriptionReason.trim();
          if (reason === "") return;
          setConfirmResumeSubscription(false);
          setMutationError(null);
          resumeSubscription.mutate({ tenantId: tenant.id, body: { reason } }, { onError: onMutationError });
        }}
        onCancel={() => setConfirmResumeSubscription(false)}
      />
    </div>
  );
}

function SweepOutcome({ result }: { result: CardCheckoutSweepResultDTO }) {
  const { t } = useAppTranslation();
  return (
    <div role="status" className="mb-[12px] flex flex-col gap-[4px] rounded-md border border-border bg-surface-2 p-[12px] text-[12px] text-ink">
      <p>
        {t("platform.cardCheckout.sweep.result", {
          examined: result.examined,
          paid: result.paid,
          declined: result.declined,
          unapplied: result.unapplied,
          expired: result.expired,
          stillPending: result.stillPending,
          alreadySettled: result.alreadySettled,
        })}
      </p>
      {result.needsAttention > 0 ? (
        <p className="text-warning-ink">{t("platform.cardCheckout.sweep.needsAttention", { count: result.needsAttention })}</p>
      ) : null}
      {result.unavailable + result.failed > 0 ? (
        <p className="text-warning-ink">
          {t("platform.cardCheckout.sweep.unavailable", { unavailable: result.unavailable, failed: result.failed })}
        </p>
      ) : null}
      {result.deferred > 0 ? <p>{t("platform.cardCheckout.sweep.deferred", { count: result.deferred })}</p> : null}
    </div>
  );
}

function Fact({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className={numeric ? "mz-num font-semibold text-ink" : "font-semibold text-ink"}>{value}</span>
    </div>
  );
}
