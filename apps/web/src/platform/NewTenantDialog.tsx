import { useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import type { BillingCycleDTO, CreateTenantRequestDTO, PlanDTO, ProvisionResultDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { COMPANY_NAME_MAX_LENGTH } from "@mezan/contracts";
import { FormError, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useCreateTenantMutation } from "./hooks";

export interface NewTenantDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly plans: PlanDTO[];
}

interface TenantDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  ownerNameAr: string;
  ownerEmail: string;
  planId: string;
  billingCycle: BillingCycleDTO;
  trial: boolean;
}

function emptyDraft(): TenantDraft {
  return { code: "", nameAr: "", nameEn: "", ownerNameAr: "", ownerEmail: "", planId: "", billingCycle: "monthly", trial: true };
}

/**
 * «منشأة جديدة» — create a tenant and start its subscription in one call
 * (`provisionTenant`). The response carries a one-time admin PIN that the
 * backend never returns again, so a successful submit swaps the form for a
 * result panel instead of just closing — closing it would throw the PIN away
 * with nowhere else to read it from.
 */
export function NewTenantDialog({ open, onClose, plans }: NewTenantDialogProps) {
  const { t } = useAppTranslation();
  const [draft, setDraft] = useState<TenantDraft>(emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisionResultDTO | null>(null);
  const [copied, setCopied] = useState(false);
  const createTenant = useCreateTenantMutation();

  function handleClose() {
    setDraft(emptyDraft());
    setFormError(null);
    setResult(null);
    setCopied(false);
    onClose();
  }

  function handleSubmit() {
    setFormError(null);
    if (draft.code.trim() === "" || draft.nameAr.trim() === "" || draft.ownerNameAr.trim() === "" || draft.ownerEmail.trim() === "" || draft.planId === "") {
      setFormError(t("platform.newTenant.error.required"));
      return;
    }
    const body: CreateTenantRequestDTO = {
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      ownerEmail: draft.ownerEmail.trim().toLowerCase(),
      ownerNameAr: draft.ownerNameAr.trim(),
      planId: draft.planId,
      billingCycle: draft.billingCycle,
      trial: draft.trial,
    };
    createTenant.mutate(body, {
      onSuccess: (res) => setResult(res),
      onError: (err) => setFormError(err instanceof PlatformApiError ? err.message : t("platform.newTenant.error.generic")),
    });
  }

  const planOptions = plans
    .filter((p) => p.status === "active")
    .map((p) => ({ value: p.id, label: `${p.nameAr} — ${p.code}` }));
  const cycleOptions: { value: BillingCycleDTO; label: string }[] = [
    { value: "monthly", label: t("platform.billingCycle.monthly") },
    { value: "yearly", label: t("platform.billingCycle.yearly") },
  ];
  const clipboard = navigator.clipboard as Clipboard | undefined;

  return (
    <SidePanel open={open} onClose={handleClose} title={t("platform.newTenant.title")} description={t("platform.newTenant.description")}>
      {result ? (
        <div className="flex flex-col gap-[14px]">
          <p className="text-[12.5px] text-ink-muted">{t("platform.newTenant.result.hint")}</p>
          <div className="flex flex-col gap-[10px] rounded-md border border-border bg-surface-2 p-[14px]">
            <ResultRow label={t("platform.newTenant.result.code")} value={result.tenant.code} />
            <ResultRow label={t("platform.newTenant.result.adminEmail")} value={result.adminEmail} />
            <div>
              <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("platform.newTenant.result.adminPin")}</span>
              <div className="flex flex-wrap items-center gap-[10px]">
                <code
                  dir="ltr"
                  className="mz-num select-all break-all rounded-[6px] bg-surface px-[10px] py-[6px] text-[16px] font-bold text-ink"
                >
                  {result.adminPin ?? t("platform.newTenant.result.pinKept")}
                </code>
                {clipboard && result.adminPin ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void clipboard
                        .writeText(result.adminPin ?? "")
                        .then(() => setCopied(true))
                        .catch(() => setCopied(false));
                    }}
                  >
                    {t("platform.newTenant.result.copy")}
                  </Button>
                ) : null}
                {copied ? <span className="text-[12px] text-ink-muted">{t("platform.newTenant.result.copied")}</span> : null}
              </div>
            </div>
          </div>
          <p role="alert" className="text-[11.5px] font-semibold text-warning-ink">
            {t("platform.newTenant.result.oneTime")}
          </p>
          <div className="flex justify-end border-t border-border pt-[14px]">
            <Button variant="primary" onClick={handleClose}>
              {t("platform.newTenant.result.close")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[14px]">
          <FormError message={formError} />
          <TextField
            label={t("platform.newTenant.code")}
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.trim().toLowerCase() }))}
            hint={t("platform.newTenant.codeHint")}
          />
          <TextField label={t("platform.newTenant.nameAr")} value={draft.nameAr} maxLength={COMPANY_NAME_MAX_LENGTH} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField
            label={t("platform.newTenant.nameEn")}
            value={draft.nameEn}
            placeholder={t("platform.newTenant.nameEnOptional")}
            onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
          />
          <TextField label={t("platform.newTenant.ownerNameAr")} value={draft.ownerNameAr} onChange={(v) => setDraft((d) => ({ ...d, ownerNameAr: v }))} />
          <TextField
            label={t("platform.newTenant.ownerEmail")}
            type="email"
            value={draft.ownerEmail}
            onChange={(v) => setDraft((d) => ({ ...d, ownerEmail: v }))}
          />
          <SelectField
            label={t("platform.newTenant.plan")}
            value={draft.planId}
            onChange={(v) => setDraft((d) => ({ ...d, planId: v }))}
            options={planOptions}
          />
          <SelectField
            label={t("platform.newTenant.billingCycle")}
            value={draft.billingCycle}
            onChange={(v) => setDraft((d) => ({ ...d, billingCycle: v as BillingCycleDTO }))}
            options={cycleOptions}
          />
          <ToggleField label={t("platform.newTenant.trial")} checked={draft.trial} onChange={(v) => setDraft((d) => ({ ...d, trial: v }))} />
          <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
            <Button variant="ghost" onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={createTenant.isPending} onClick={handleSubmit}>
              {createTenant.isPending ? t("platform.newTenant.creating") : t("platform.newTenant.submit")}
            </Button>
          </div>
        </div>
      )}
    </SidePanel>
  );
}

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-[10px]">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <span className="mz-lat text-[13px] font-semibold text-ink">{value}</span>
    </div>
  );
}
