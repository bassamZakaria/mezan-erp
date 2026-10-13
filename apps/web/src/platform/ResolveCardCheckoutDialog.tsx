import { useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import { CardCheckoutResolution } from "@mezan/domain";
import type { CardCheckoutDTO, ResolveCardCheckoutRequestDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { Field, FormError, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
import { isPositiveAmount, toPiasters, westernDigits } from "./card-amount";
import { attentionCauseKey } from "./card-checkout-labels";

export enum ResolveOutcome {
  Saved = "saved",
  Busy = "busy",
}

export interface ResolveCardCheckoutDialogProps {
  readonly checkout: CardCheckoutDTO | null;
  readonly canApply: boolean;
  readonly saving: boolean;
  readonly onResolve: (checkout: CardCheckoutDTO, body: ResolveCardCheckoutRequestDTO) => Promise<ResolveOutcome>;
  readonly onClose: () => void;
}

const MIN_REASON_LENGTH = 3;
const TRANSACTION_NUMBER = /^[0-9]{1,20}$/;
const CHOICES: readonly CardCheckoutResolution[] = [
  CardCheckoutResolution.Reviewed,
  CardCheckoutResolution.AppliedByHand,
  CardCheckoutResolution.Refunded,
];

const CHOICE_KEY: Readonly<Record<CardCheckoutResolution, AppTranslationKey>> = {
  [CardCheckoutResolution.Reviewed]: "platform.cardCheckout.resolve.choice.REVIEWED",
  [CardCheckoutResolution.AppliedByHand]: "platform.cardCheckout.resolve.choice.APPLIED_BY_HAND",
  [CardCheckoutResolution.Refunded]: "platform.cardCheckout.resolve.choice.REFUNDED",
};

const CONSEQUENCE_KEY: Readonly<Record<CardCheckoutResolution, AppTranslationKey>> = {
  [CardCheckoutResolution.Reviewed]: "platform.cardCheckout.resolve.consequence.REVIEWED",
  [CardCheckoutResolution.AppliedByHand]: "platform.cardCheckout.resolve.consequence.APPLIED_BY_HAND",
  [CardCheckoutResolution.Refunded]: "platform.cardCheckout.resolve.consequence.REFUNDED",
};

export function ResolveCardCheckoutDialog({ checkout, canApply, saving, onResolve, onClose }: ResolveCardCheckoutDialogProps) {
  const { t } = useAppTranslation();
  const expected = checkout ? toPiasters(checkout.amount) : "";
  const [resolution, setResolution] = useState<CardCheckoutResolution | null>(null);
  const [reason, setReason] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [amount, setAmount] = useState(expected);
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [pendingBody, setPendingBody] = useState<ResolveCardCheckoutRequestDTO | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const byHand = resolution === CardCheckoutResolution.AppliedByHand;
  const typedAmount = westernDigits(amount.trim());
  const differs = !isPositiveAmount(typedAmount) || toPiasters(typedAmount) !== expected;

  function validated(): ResolveCardCheckoutRequestDTO | AppTranslationKey {
    if (resolution === null) return "platform.cardCheckout.resolve.error.decision";
    const typedReason = reason.trim();
    if (!byHand) {
      return typedReason.length < MIN_REASON_LENGTH ? "platform.cardCheckout.resolve.error.reason" : { resolution, reason: typedReason };
    }
    const typedRef = westernDigits(providerRef.trim());
    if (!TRANSACTION_NUMBER.test(typedRef)) return "platform.cardCheckout.resolve.error.providerRef";
    if (!isPositiveAmount(typedAmount)) return "platform.cardCheckout.apply.error.amount";
    if (differs && !overrideConfirmed) return "platform.cardCheckout.resolve.error.override";
    if (typedReason.length < MIN_REASON_LENGTH) return "platform.cardCheckout.resolve.error.reason";
    return { resolution, reason: typedReason, providerRef: typedRef, amount: typedAmount, ...(differs ? { overrideAmount: true } : {}) };
  }

  function handleContinue() {
    const result = validated();
    if (typeof result === "string") {
      setFormError(t(result));
      return;
    }
    setFormError(null);
    setPendingBody(result);
  }

  async function handleConfirm() {
    if (!checkout || !pendingBody || saving) return;
    setFormError(null);
    try {
      const outcome = await onResolve(checkout, pendingBody);
      if (outcome === ResolveOutcome.Busy) {
        setFormError(t("platform.cardCheckout.resolve.error.busy"));
        return;
      }
      onClose();
    } catch (err) {
      setPendingBody(null);
      setFormError(err instanceof Error ? err.message : t("platform.cardCheckout.resolve.error.generic"));
    }
  }

  return (
    <SidePanel open={checkout !== null} onClose={onClose} title={t("platform.cardCheckout.resolve.title")}>
      <div className="flex flex-col gap-[14px]">
        {checkout ? <p className="text-[12.5px] font-semibold text-warning-ink">{t(attentionCauseKey(checkout.attentionCause))}</p> : null}
        <FormError message={formError} />
        {pendingBody && resolution ? (
          <>
            <p className="text-[13px] font-bold text-ink">{t(CHOICE_KEY[resolution])}</p>
            <p className="text-[12.5px] text-ink-muted">{t(CONSEQUENCE_KEY[resolution])}</p>
            <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
              <Button variant="ghost" disabled={saving} onClick={() => setPendingBody(null)}>
                {t("platform.cardCheckout.resolve.back")}
              </Button>
              <Button variant={resolution === CardCheckoutResolution.Reviewed ? "primary" : "danger-outline"} disabled={saving} onClick={() => void handleConfirm()}>
                {t("platform.cardCheckout.resolve.confirm")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-muted">{t("platform.cardCheckout.resolve.intro")}</p>
            <Field label={t("platform.cardCheckout.resolve.decision")}>
              <div role="radiogroup" aria-label={t("platform.cardCheckout.resolve.decision")} className="flex flex-col gap-[8px]">
                {CHOICES.map((choice) => {
                  const unavailable = choice === CardCheckoutResolution.AppliedByHand && !canApply;
                  return (
                    <label key={choice} className="flex items-center gap-[8px] text-[13px] text-ink">
                      <input
                        type="radio"
                        name="card-checkout-resolution"
                        checked={resolution === choice}
                        disabled={unavailable}
                        onChange={() => setResolution(choice)}
                      />
                      {t(CHOICE_KEY[choice])}
                    </label>
                  );
                })}
              </div>
            </Field>
            {canApply || !checkout ? null : <p className="text-[11.5px] text-ink-muted">{t("platform.cardCheckout.apply.notRenewable")}</p>}
            {byHand ? (
              <>
                <TextField
                  label={t("platform.cardCheckout.resolve.providerRef")}
                  value={providerRef}
                  onChange={setProviderRef}
                  hint={t("platform.cardCheckout.resolve.providerRefHint")}
                  autoComplete="off"
                />
                <TextField
                  label={t("platform.cardCheckout.resolve.amount")}
                  value={amount}
                  onChange={setAmount}
                  hint={t("platform.cardCheckout.resolve.amountHint", { expected })}
                  autoComplete="off"
                />
                {differs ? (
                  <ToggleField
                    label={t("platform.cardCheckout.resolve.override")}
                    hint={t("platform.cardCheckout.apply.overrideHint")}
                    checked={overrideConfirmed}
                    onChange={setOverrideConfirmed}
                  />
                ) : null}
              </>
            ) : null}
            <TextAreaField
              label={t("platform.cardCheckout.resolve.reason")}
              value={reason}
              onChange={setReason}
              placeholder={t("platform.tenantDetail.reasonHint")}
              rows={3}
            />
            <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" onClick={handleContinue}>
                {t("platform.cardCheckout.resolve.continue")}
              </Button>
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}
