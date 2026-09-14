import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, ConfirmDialog, Money, Select, useFormat } from "@mezan/ui";
import type { BillingCycleDTO, SubscriptionStatusDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { LicenseStateChip, TenantStatusChip } from "./chips";
import { usePlatformApi } from "./api";
import { RecordPaymentDialog } from "./RecordPaymentDialog";
import {
  useArchiveTenantMutation,
  useCancelSubscriptionMutation,
  useChangePlanMutation,
  usePlansQuery,
  useResumeTenantMutation,
  useSuspendTenantMutation,
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
/** Mirrors `changePlan`/`cancelSubscription` in `packages/domain/src/platform/subscription.ts`. */
function canChangePlan(status: SubscriptionStatusDTO): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}
function canCancelSubscription(status: SubscriptionStatusDTO): boolean {
  return status !== "cancelled";
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

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [planPickerId, setPlanPickerId] = useState("");

  const summary = tenantQuery.data;
  if (!summary) {
    return <div className="p-8 text-center text-sm text-ink-muted">{tenantQuery.isError ? t("platform.tenantDetail.notFound") : t("common.loading")}</div>;
  }

  const { tenant, subscription, plan, licenseState, payments } = summary;
  const planOptions = (plansQuery.data ?? [])
    .filter((p) => p.status === "active" && p.id !== subscription?.planId)
    .map((p) => ({ value: p.id, label: `${p.nameAr} — ${p.code}` }));

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

      {isOwner ? (
        <div className="flex flex-wrap gap-[9px]">
          {canSuspendTenant(tenant.status) ? (
            <Button variant="default" disabled={suspendTenant.isPending} onClick={() => suspendTenant.mutate(tenant.id)}>
              {t("platform.tenantDetail.suspend")}
            </Button>
          ) : null}
          {canResumeTenant(tenant.status) ? (
            <Button variant="default" disabled={resumeTenant.isPending} onClick={() => resumeTenant.mutate(tenant.id)}>
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

      <Card className="p-[16px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("platform.tenantDetail.subscription")}</h2>
        {subscription && plan ? (
          <div className="flex flex-col gap-[10px]">
            <Fact label={t("platform.tenantDetail.plan")} value={`${plan.nameAr} — ${plan.code}`} />
            <Fact label={t("platform.tenantDetail.billingCycle")} value={t(BILLING_CYCLE_LABEL[subscription.billingCycle])} />
            <Fact label={t("platform.tenantDetail.subscriptionStatus")} value={t(SUBSCRIPTION_STATUS_LABEL[subscription.status])} />
            <Fact label={t("platform.tenantDetail.periodStart")} value={format.date(subscription.currentPeriodStart)} />
            <Fact label={t("platform.tenantDetail.periodEnd")} value={format.date(subscription.currentPeriodEnd)} />
            {subscription.trialEndsAt ? <Fact label={t("platform.tenantDetail.trialEndsAt")} value={format.date(subscription.trialEndsAt)} /> : null}
            <Fact label={t("platform.tenantDetail.graceDays")} value={String(subscription.graceDays)} />

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
                        changePlan.mutate({ tenantId: tenant.id, body: { planId: planPickerId } }, { onSuccess: () => setPlanPickerId("") });
                      }}
                    >
                      {t("platform.tenantDetail.apply")}
                    </Button>
                  </>
                ) : null}
                {canCancelSubscription(subscription.status) ? (
                  <Button variant="danger-outline" size="sm" disabled={cancelSubscription.isPending} onClick={() => setConfirmCancel(true)}>
                    {t("platform.tenantDetail.cancelSubscription")}
                  </Button>
                ) : null}
                <Button variant="primary" size="sm" onClick={() => setPaymentDialogOpen(true)}>
                  {t("platform.tenantDetail.recordPayment")}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t("platform.tenantDetail.noSubscription")}</p>
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

      <ConfirmDialog
        open={confirmArchive}
        title={t("platform.tenantDetail.confirmArchive.title")}
        consequence={t("platform.tenantDetail.confirmArchive.consequence")}
        confirmLabel={t("platform.tenantDetail.archive")}
        tone="danger"
        onConfirm={() => {
          setConfirmArchive(false);
          archiveTenant.mutate(tenant.id);
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
          cancelSubscription.mutate(tenant.id);
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-[10px] text-[12.5px]">
      <span className="text-ink-muted">{label}</span>
      <span className="mz-num font-semibold text-ink">{value}</span>
    </div>
  );
}
