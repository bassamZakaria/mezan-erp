import { useCallback, useState } from "react";
import { Button, ConfirmDialog, useFormat } from "@mezan/ui";
import { PERIOD_CLOSE_OVERRIDE_REASON_MAX, PERIOD_CLOSE_OVERRIDE_REASON_MIN, type PeriodCloseChecklistDTO } from "@mezan/contracts";
import { TextAreaField } from "../../../settings/form-controls";
import { errorMessage } from "../../../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { PeriodCloseAction, usePeriodCloseTransition } from "./hooks";

interface ActionCopy {
  readonly label: AppTranslationKey;
  readonly overrideLabel: AppTranslationKey;
  readonly confirmTitle: AppTranslationKey;
  readonly confirmBody: AppTranslationKey;
  readonly done: AppTranslationKey;
}

const ACTION_COPY: Readonly<Record<PeriodCloseAction, ActionCopy>> = {
  [PeriodCloseAction.Close]: {
    label: "periodClose.close",
    overrideLabel: "periodClose.closeOverride",
    confirmTitle: "periodClose.closeConfirmTitle",
    confirmBody: "periodClose.closeConfirmBody",
    done: "periodClose.closed",
  },
  [PeriodCloseAction.Lock]: {
    label: "periodClose.lock",
    overrideLabel: "periodClose.lockOverride",
    confirmTitle: "periodClose.lockConfirmTitle",
    confirmBody: "periodClose.lockConfirmBody",
    done: "periodClose.locked",
  },
};

export interface CloseActionsProps {
  readonly checklist: PeriodCloseChecklistDTO;
  readonly action: PeriodCloseAction;
  readonly periodLabel: string;
  readonly onStart: () => void;
  readonly onDone: (message: string) => void;
  readonly onError: (message: string) => void;
}

export function CloseActions({ checklist, action, periodLabel, onStart, onDone, onError }: CloseActionsProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const transition = usePeriodCloseTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");

  const copy = ACTION_COPY[action];
  const blockedCount = checklist.blocking.length;
  const needsOverride = blockedCount > 0;
  const trimmedReason = reason.trim();
  const reasonValid = trimmedReason.length >= PERIOD_CLOSE_OVERRIDE_REASON_MIN && trimmedReason.length <= PERIOD_CLOSE_OVERRIDE_REASON_MAX;
  const { periodId } = checklist;
  const { mutateAsync, isPending } = transition;

  const openDialog = useCallback(() => setDialogOpen(true), []);
  const closeDialog = useCallback(() => setDialogOpen(false), []);

  const confirm = useCallback(async () => {
    if (isPending) return;
    setDialogOpen(false);
    onStart();
    try {
      await mutateAsync({ periodId, action, ...(needsOverride ? { overrideReason: trimmedReason } : {}) });
      setReason("");
      onDone(t(copy.done, { period: periodLabel }));
    } catch (err) {
      onError(errorMessage(err, t("periodClose.actionFailed")));
    }
  }, [action, copy.done, isPending, mutateAsync, needsOverride, onDone, onError, onStart, periodId, periodLabel, t, trimmedReason]);

  const onConfirm = useCallback(() => void confirm(), [confirm]);

  if (needsOverride && !checklist.canOverride) {
    return (
      <div className="flex flex-wrap items-center gap-[10px]">
        <Button variant="primary" disabled>
          {t(copy.label)}
        </Button>
        <p className="max-w-[60ch] text-[12.5px] text-ink-muted">{t("periodClose.overrideNotAllowed")}</p>
      </div>
    );
  }

  return (
    <>
      <Button variant={needsOverride ? "danger-outline" : "primary"} disabled={isPending} onClick={openDialog}>
        {isPending ? t("periodClose.closing") : t(needsOverride ? copy.overrideLabel : copy.label)}
      </Button>
      <ConfirmDialog
        open={dialogOpen}
        tone={needsOverride || action === PeriodCloseAction.Lock ? "danger" : "default"}
        title={t(needsOverride ? "periodClose.overrideTitle" : copy.confirmTitle, { period: periodLabel })}
        consequence={
          needsOverride ? (
            <div className="flex flex-col gap-3">
              <p>{t("periodClose.overrideBody", { count: fmt.number(blockedCount) })}</p>
              <p>{t(copy.confirmBody)}</p>
              <TextAreaField
                label={t("periodClose.overrideReason")}
                hint={t("periodClose.overrideReasonHint", { min: fmt.number(PERIOD_CLOSE_OVERRIDE_REASON_MIN) })}
                value={reason}
                onChange={setReason}
                rows={3}
              />
            </div>
          ) : (
            t(copy.confirmBody)
          )
        }
        confirmLabel={t(needsOverride ? copy.overrideLabel : copy.label)}
        cancelLabel={t("common.cancel")}
        confirmDisabled={isPending || (needsOverride && !reasonValid)}
        onCancel={closeDialog}
        onConfirm={onConfirm}
      />
    </>
  );
}
