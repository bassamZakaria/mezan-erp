import { useState } from "react";
import { Button, Card, ConfirmDialog, StatusPill } from "@mezan/ui";
import { MAX_EXTRA_CAPACITY, MAX_EXTRA_STORAGE_MB, MAX_GRACE_DAYS, SubscriptionStatusCode, type PlanDTO, type TenantSummaryDTO } from "@mezan/contracts";
import { QuotaKind, formatStorageMb } from "@mezan/domain";
import { useAppTranslation } from "../i18n";
import { MultiChipField, NumberField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useSetSubscriptionExtrasMutation } from "./hooks";
import { entitlementModuleLabel } from "../domain-labels";
import { platformModuleOptions } from "./module-options";

type Subscription = NonNullable<TenantSummaryDTO["subscription"]>;

interface Draft {
  addOnModules: string[];
  extraSeats: number;
  extraBranches: number;
  extraWarehouses: number;
  extraStorageMb: number;
  graceDays: number;
}

function draftOf(s: Subscription): Draft {
  return {
    addOnModules: [...s.addOnModules],
    extraSeats: s.extraSeats,
    extraBranches: s.extraBranches,
    extraWarehouses: s.extraWarehouses,
    extraStorageMb: s.extraStorageMb ?? 0,
    graceDays: s.graceDays,
  };
}

const isCount = (n: number, max: number): boolean => Number.isInteger(n) && n >= 0 && n <= max;

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.extraSeats === b.extraSeats &&
    a.extraBranches === b.extraBranches &&
    a.extraWarehouses === b.extraWarehouses &&
    a.extraStorageMb === b.extraStorageMb &&
    a.graceDays === b.graceDays &&
    a.addOnModules.length === b.addOnModules.length &&
    a.addOnModules.every((m) => b.addOnModules.includes(m))
  );
}

/** Mirrors the states `setSubscriptionExtras` accepts in `packages/domain/src/platform/subscription.ts`. */
const EDITABLE_STATUSES: ReadonlySet<Subscription["status"]> = new Set([
  SubscriptionStatusCode.Trialing,
  SubscriptionStatusCode.Active,
  SubscriptionStatusCode.PastDue,
  SubscriptionStatusCode.Suspended,
]);

export function TenantExtrasCard({
  tenantId,
  subscription,
  plan,
  isOwner,
}: {
  tenantId: string;
  subscription: Subscription;
  plan: PlanDTO;
  isOwner: boolean;
}) {
  const { t } = useAppTranslation();
  const save = useSetSubscriptionExtrasMutation();
  const [edits, setEdits] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const stored = draftOf(subscription);
  // REQUIRED: extra storage is sent only when edited here; an approved request can land while this form is open.
  const [storageTouched, setStorageTouched] = useState(false);
  const draft = edits ? { ...edits, extraStorageMb: storageTouched ? edits.extraStorageMb : stored.extraStorageMb } : stored;
  const setDraft = (change: (d: Draft) => Draft) => setEdits(change(draft));

  const editable = isOwner && EDITABLE_STATUSES.has(subscription.status);
  const planStorage = plan.quotas[QuotaKind.StorageMb];
  const included = new Set(plan.modules);
  const options = platformModuleOptions(t).filter((o) => !included.has(o.value) || draft.addOnModules.includes(o.value));
  const valid =
    isCount(draft.extraSeats, MAX_EXTRA_CAPACITY) &&
    isCount(draft.extraBranches, MAX_EXTRA_CAPACITY) &&
    isCount(draft.extraWarehouses, MAX_EXTRA_CAPACITY) &&
    isCount(draft.extraStorageMb, MAX_EXTRA_STORAGE_MB) &&
    isCount(draft.graceDays, MAX_GRACE_DAYS);
  const changed = !sameDraft(draft, stored);
  const saveError = save.error instanceof PlatformApiError ? save.error.message : save.error ? t("platform.error.network") : null;

  return (
    <Card className="p-[16px]">
      <h2 className="text-[13px] font-bold text-ink">{t("platform.tenantDetail.extras.title")}</h2>
      <p className="mb-[12px] mt-[4px] text-[12px] text-ink-muted">{t("platform.tenantDetail.extras.description")}</p>
      <div className="flex flex-col gap-[14px]">
        <div>
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("platform.tenantDetail.extras.included")}</span>
          <div className="flex flex-wrap gap-[6px]">
            {plan.modules.map((id) => (
              <StatusPill key={id} label={entitlementModuleLabel(id, t)} tone="neutral" />
            ))}
          </div>
        </div>
        <MultiChipField
          label={t("platform.tenantDetail.extras.addOnModules")}
          options={options}
          value={draft.addOnModules}
          disabled={!editable}
          onChange={(v) => setDraft((d) => ({ ...d, addOnModules: v }))}
        />
        {editable ? (
          <div className="flex flex-wrap gap-[8px]">
            <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, addOnModules: options.map((o) => o.value).filter((v) => !included.has(v)) }))}>
              {t("platform.modules.selectAll")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, addOnModules: [] }))}>
              {t("platform.modules.clearAll")}
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
          <NumberField
            label={t("platform.tenantDetail.extras.extraSeats")}
            hint={t("platform.tenantDetail.extras.planHas", { count: plan.seatsIncluded })}
            value={draft.extraSeats}
            min={0}
            max={MAX_EXTRA_CAPACITY}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraSeats: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.extras.extraBranches")}
            hint={t("platform.tenantDetail.extras.planHas", { count: plan.branchesIncluded })}
            value={draft.extraBranches}
            min={0}
            max={MAX_EXTRA_CAPACITY}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraBranches: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.extras.extraWarehouses")}
            hint={t("platform.tenantDetail.extras.planHas", { count: plan.warehousesIncluded })}
            value={draft.extraWarehouses}
            min={0}
            max={MAX_EXTRA_CAPACITY}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraWarehouses: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.extras.extraStorageMb")}
            hint={
              planStorage === undefined
                ? t("platform.tenantDetail.extras.storageUnlimited")
                : t("platform.tenantDetail.extras.planHasStorage", { size: formatStorageMb(planStorage) })
            }
            value={draft.extraStorageMb}
            min={0}
            max={MAX_EXTRA_STORAGE_MB}
            disabled={!editable || planStorage === undefined}
            onChange={(v) => {
              setStorageTouched(true);
              setDraft((d) => ({ ...d, extraStorageMb: v }));
            }}
          />
          <NumberField
            label={t("platform.tenantDetail.graceDays")}
            value={draft.graceDays}
            min={0}
            max={MAX_GRACE_DAYS}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, graceDays: v }))}
          />
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-[9px] border-t border-border pt-[12px]">
            <Button variant="primary" size="sm" disabled={!changed || !valid || save.isPending} onClick={() => setConfirming(true)}>
              {save.isPending ? t("platform.tenantDetail.extras.saving") : t("platform.tenantDetail.extras.save")}
            </Button>
            <Button size="sm" disabled={!changed || save.isPending} onClick={() => {
                setEdits(null);
                setStorageTouched(false);
                save.reset();
              }}>
              {t("common.cancel")}
            </Button>
            {!valid ? <span role="alert" className="text-[12px] font-semibold text-danger-ink">{t("platform.tenantDetail.extras.invalid", { maxCapacity: MAX_EXTRA_CAPACITY, maxGrace: MAX_GRACE_DAYS, maxStorage: MAX_EXTRA_STORAGE_MB })}</span> : null}
            {valid && saveError ? <span role="alert" className="text-[12px] font-semibold text-danger-ink">{saveError}</span> : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        title={t("platform.tenantDetail.extras.confirm.title")}
        consequence={t("platform.tenantDetail.extras.confirm.consequence")}
        confirmLabel={t("platform.tenantDetail.extras.save")}
        onConfirm={() => {
          setConfirming(false);
          const { extraStorageMb: _untouched, ...rest } = draft;
          save.mutate(
            { tenantId, body: storageTouched ? draft : rest },
            {
              onSuccess: () => {
                setEdits(null);
                setStorageTouched(false);
              },
            },
          );
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
