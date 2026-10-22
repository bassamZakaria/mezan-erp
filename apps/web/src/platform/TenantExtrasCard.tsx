import { useEffect, useState } from "react";
import { Button, Card, ConfirmDialog } from "@mezan/ui";
import { SubscriptionStatusCode, type PlanDTO, type TenantSummaryDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { MultiChipField, NumberField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useSetSubscriptionExtrasMutation } from "./hooks";
import { platformModuleLabel, platformModuleOptions } from "./module-options";

type Subscription = NonNullable<TenantSummaryDTO["subscription"]>;

interface Draft {
  addOnModules: string[];
  extraSeats: number;
  extraBranches: number;
  extraWarehouses: number;
  graceDays: number;
}

function draftOf(s: Subscription): Draft {
  return {
    addOnModules: [...s.addOnModules],
    extraSeats: s.extraSeats,
    extraBranches: s.extraBranches,
    extraWarehouses: s.extraWarehouses,
    graceDays: s.graceDays,
  };
}

const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.extraSeats === b.extraSeats &&
    a.extraBranches === b.extraBranches &&
    a.extraWarehouses === b.extraWarehouses &&
    a.graceDays === b.graceDays &&
    a.addOnModules.length === b.addOnModules.length &&
    a.addOnModules.every((m) => b.addOnModules.includes(m))
  );
}

/** Mirrors the states `setSubscriptionExtras` accepts in `packages/domain/src/platform/subscription.ts`. */
function canEditExtras(status: Subscription["status"]): boolean {
  return status !== SubscriptionStatusCode.Cancelled && status !== SubscriptionStatusCode.Unknown;
}

export function TenantExtrasCard({
  tenantId,
  subscription,
  plan,
  isOwner,
  onError,
}: {
  tenantId: string;
  subscription: Subscription;
  plan: PlanDTO;
  isOwner: boolean;
  onError: (err: PlatformApiError) => void;
}) {
  const { t } = useAppTranslation();
  const save = useSetSubscriptionExtrasMutation();
  const [draft, setDraft] = useState<Draft>(() => draftOf(subscription));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setDraft(draftOf(subscription));
  }, [subscription]);

  const editable = isOwner && canEditExtras(subscription.status);
  const included = new Set(plan.modules);
  const options = platformModuleOptions(t).filter((o) => !included.has(o.value) || draft.addOnModules.includes(o.value));
  const valid = isCount(draft.extraSeats) && isCount(draft.extraBranches) && isCount(draft.extraWarehouses) && isCount(draft.graceDays);
  const changed = !sameDraft(draft, draftOf(subscription));

  return (
    <Card className="p-[16px]">
      <h2 className="text-[13px] font-bold text-ink">{t("platform.tenantDetail.extras.title")}</h2>
      <p className="mb-[12px] mt-[4px] text-[12px] text-ink-muted">{t("platform.tenantDetail.extras.description")}</p>
      <div className="flex flex-col gap-[14px]">
        <div>
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("platform.tenantDetail.extras.included")}</span>
          <p className="text-[12.5px] text-ink">{plan.modules.map((id) => platformModuleLabel(id, t)).join("، ") || "—"}</p>
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
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraSeats: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.extras.extraBranches")}
            hint={t("platform.tenantDetail.extras.planHas", { count: plan.branchesIncluded })}
            value={draft.extraBranches}
            min={0}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraBranches: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.extras.extraWarehouses")}
            hint={t("platform.tenantDetail.extras.planHas", { count: plan.warehousesIncluded })}
            value={draft.extraWarehouses}
            min={0}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, extraWarehouses: v }))}
          />
          <NumberField
            label={t("platform.tenantDetail.graceDays")}
            value={draft.graceDays}
            min={0}
            disabled={!editable}
            onChange={(v) => setDraft((d) => ({ ...d, graceDays: v }))}
          />
        </div>
        {editable ? (
          <div className="flex flex-wrap items-center gap-[9px] border-t border-border pt-[12px]">
            <Button variant="primary" size="sm" disabled={!changed || !valid || save.isPending} onClick={() => setConfirming(true)}>
              {save.isPending ? t("platform.tenantDetail.extras.saving") : t("platform.tenantDetail.extras.save")}
            </Button>
            <Button size="sm" disabled={!changed || save.isPending} onClick={() => setDraft(draftOf(subscription))}>
              {t("common.cancel")}
            </Button>
            {!valid ? <span role="alert" className="text-[12px] font-semibold text-danger-ink">{t("platform.tenantDetail.extras.invalid")}</span> : null}
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
          save.mutate({ tenantId, body: draft }, { onError });
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
