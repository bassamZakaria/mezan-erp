import { useId, useState } from "react";
import { PlatformPaymentRefusal } from "@mezan/contracts";
import { Button, Field, MoneyInput, SidePanel } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { FormError, TextAreaField, TextField } from "../settings/form-controls";
import { PlatformApiError } from "./api";
import { useRecordPaymentMutation } from "./hooks";

export interface RecordPaymentDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly tenantId: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** «تسجيل دفعة» — a manual payment against the tenant's live subscription; the backend renews the subscription's period from it, so on success the panel just closes and the caller's `TenantSummaryDTO` query refreshes from the mutation's own cache write. */
export function RecordPaymentDialog({ open, onClose, tenantId }: RecordPaymentDialogProps) {
  const { t } = useAppTranslation();
  const amountId = useId();
  const [amount, setAmount] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(today);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // ONE key per intended payment: it survives a failed attempt and the
  // duplicate-reference confirmation, so a retry is answered with the payment
  // already recorded, and is replaced only once that payment is saved.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [duplicateWarned, setDuplicateWarned] = useState(false);
  const recordPayment = useRecordPaymentMutation();

  function reset() {
    setAmount(null);
    setReference("");
    setPaidAt(today());
    setNote("");
    setFormError(null);
    setDuplicateWarned(false);
    setIdempotencyKey(crypto.randomUUID());
  }

  function changeReference(next: string) {
    setReference(next);
    if (!duplicateWarned) return;
    setDuplicateWarned(false);
    setFormError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    if (amount === null || amount <= 0 || reference.trim() === "") {
      setDuplicateWarned(false);
      setFormError(t("platform.recordPayment.error.required"));
      return;
    }
    if (!duplicateWarned) setFormError(null);
    recordPayment.mutate(
      {
        tenantId,
        body: {
          amount: amount.toFixed(2),
          reference: reference.trim(),
          paidAt: new Date(paidAt).toISOString(),
          note: note.trim() === "" ? null : note.trim(),
          idempotencyKey,
          ...(duplicateWarned ? { confirmDuplicateReference: true } : {}),
        },
      },
      {
        onSuccess: () => handleClose(),
        onError: (err) => {
          const refused = err instanceof PlatformApiError;
          setDuplicateWarned(refused && err.code === PlatformPaymentRefusal.ReferenceAlreadyRecorded);
          setFormError(refused ? err.message : t("platform.recordPayment.error.generic"));
        },
      },
    );
  }

  const submitLabel = duplicateWarned ? t("platform.recordPayment.confirmDuplicate") : t("platform.recordPayment.submit");

  return (
    <SidePanel open={open} onClose={handleClose} title={t("platform.recordPayment.title")}>
      <div className="flex flex-col gap-[14px]">
        <FormError message={formError} />
        <Field label={t("platform.recordPayment.amount")} htmlFor={amountId}>
          <MoneyInput id={amountId} value={amount} onChange={setAmount} />
        </Field>
        <TextField label={t("platform.recordPayment.reference")} value={reference} onChange={changeReference} />
        <TextField label={t("platform.recordPayment.paidAt")} type="date" value={paidAt} onChange={setPaidAt} />
        <TextAreaField
          label={t("platform.recordPayment.note")}
          value={note}
          onChange={setNote}
          placeholder={t("platform.recordPayment.noteOptional")}
          rows={2}
        />
        <div className="flex justify-end gap-[9px] border-t border-border pt-[14px]">
          <Button variant="ghost" onClick={handleClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={recordPayment.isPending} onClick={handleSubmit}>
            {recordPayment.isPending ? t("platform.recordPayment.saving") : submitLabel}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
