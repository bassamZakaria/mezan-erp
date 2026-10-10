import { useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import type { CardCheckoutDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { FormError, TextAreaField, TextField, ToggleField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useApplyCardCheckoutMutation } from "./hooks";

export interface ApplyCardPaymentDialogProps {
  /** The unapplied checkout being applied; `null` keeps the panel closed. Mount with `key={checkout?.id}` so each checkout starts from its own blank form. */
  readonly checkout: CardCheckoutDTO | null;
  readonly onClose: () => void;
  readonly tenantId: string;
}

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const MIN_REASON_LENGTH = 3;
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** The wire amount carries six decimals; the operator reads and types piasters. Cut as text — a money figure never passes through a float here. */
function toPiasters(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function westernDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO))
    .replace(/٫/g, ".");
}

function isPositiveAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value) && /[1-9]/.test(value);
}

export function ApplyCardPaymentDialog({ checkout, onClose, tenantId }: ApplyCardPaymentDialogProps) {
  const { t } = useAppTranslation();
  const captured = checkout?.capturedAmount ? toPiasters(checkout.capturedAmount) : null;
  const [amount, setAmount] = useState(captured ?? "");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const applyCardCheckout = useApplyCardCheckoutMutation();

  const typedAmount = westernDigits(amount.trim());
  const differsFromCaptured = captured === null || !isPositiveAmount(typedAmount) || toPiasters(typedAmount) !== captured;

  function handleSubmit() {
    if (!checkout || applyCardCheckout.isPending) return;
    setFormError(null);
    const typedReason = reason.trim();
    if (!isPositiveAmount(typedAmount)) {
      setFormError(t("platform.cardCheckout.apply.error.amount"));
      return;
    }
    if (differsFromCaptured && !overrideConfirmed) {
      setFormError(t("platform.cardCheckout.apply.error.override"));
      return;
    }
    if (typedReason.length < MIN_REASON_LENGTH) {
      setFormError(t("platform.cardCheckout.apply.error.reason"));
      return;
    }
    applyCardCheckout.mutate(
      {
        tenantId,
        checkoutId: checkout.id,
        body: differsFromCaptured ? { amount: typedAmount, overrideAmount: true, reason: typedReason } : { reason: typedReason },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setFormError(err instanceof PlatformApiError ? err.message : t("platform.cardCheckout.apply.error.generic")),
      },
    );
  }

  return (
    <SidePanel open={checkout !== null} onClose={onClose} title={t("platform.cardCheckout.apply.title")}>
      <div className="flex flex-col gap-[14px]">
        <p className="text-[12.5px] text-ink-muted">{t("platform.cardCheckout.apply.consequence")}</p>
        {checkout?.providerRef ? <span className="mz-lat text-[12px] font-semibold text-ink">PAYMOB-{checkout.providerRef}</span> : null}
        <FormError message={formError} />
        <TextField
          label={t("platform.cardCheckout.apply.amount")}
          value={amount}
          onChange={setAmount}
          hint={
            captured === null
              ? t("platform.cardCheckout.apply.amountHintUnknown")
              : t("platform.cardCheckout.apply.amountHint", { captured, expected: checkout ? toPiasters(checkout.amount) : "" })
          }
          autoComplete="off"
        />
        {differsFromCaptured ? (
          <ToggleField
            label={t("platform.cardCheckout.apply.override")}
            hint={t("platform.cardCheckout.apply.overrideHint")}
            checked={overrideConfirmed}
            onChange={setOverrideConfirmed}
          />
        ) : null}
        <TextAreaField
          label={t("platform.cardCheckout.apply.reason")}
          value={reason}
          onChange={setReason}
          placeholder={t("platform.tenantDetail.reasonHint")}
          rows={3}
        />
        <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={applyCardCheckout.isPending} onClick={handleSubmit}>
            {applyCardCheckout.isPending ? t("platform.cardCheckout.apply.saving") : t("platform.cardCheckout.apply.submit")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
