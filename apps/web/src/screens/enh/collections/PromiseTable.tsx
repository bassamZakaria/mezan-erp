import { useState } from "react";
import { Button, Money, StatusPill, useFormat, type PillTone } from "@mezan/ui";
import { PromiseToPayStatusDTO, type EvaluatedPromiseDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { useCancelPromise } from "./hooks";

const TONE: Record<PromiseToPayStatusDTO, PillTone> = {
  [PromiseToPayStatusDTO.Pending]: "info",
  [PromiseToPayStatusDTO.Kept]: "success",
  [PromiseToPayStatusDTO.Broken]: "danger",
  [PromiseToPayStatusDTO.Cancelled]: "neutral",
};

export interface PromiseTableProps {
  readonly promises: readonly EvaluatedPromiseDTO[];
  readonly showCustomer: boolean;
  readonly mayCancel: boolean;
}

export function PromiseTable({ promises, showCustomer, mayCancel }: PromiseTableProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  const cancel = useCancelPromise();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function cancelPromise(id: string) {
    if (pendingId !== null) return;
    setPendingId(id);
    setError(null);
    cancel.mutate(
      { id },
      {
        onError: (err) => setError(errorMessage(err, t("collections.promises.cancelFailed"))),
        onSettled: () => setPendingId((current) => (current === id ? null : current)),
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className="text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border text-[11.5px] font-semibold text-ink-faint">
              {showCustomer ? <th className="p-2 text-start">{t("collections.promises.customer")}</th> : null}
              <th className="p-2 text-start">{t("collections.promises.promisedDate")}</th>
              <th className="p-2 text-start">{t("collections.promises.amount")}</th>
              <th className="p-2 text-start">{t("collections.promises.collected")}</th>
              <th className="p-2 text-start">{t("collections.promises.status")}</th>
              <th className="p-2 text-start">{t("collections.promises.note")}</th>
              <th className="p-2 text-start" />
            </tr>
          </thead>
          <tbody>
            {promises.map((promise) => (
              <tr key={promise.id} className="border-b border-border">
                {showCustomer ? <td className="p-2">{promise.customerName}</td> : null}
                <td className="p-2">{fmt.date(promise.promisedDate)}</td>
                <td className="p-2">
                  <Money value={promise.amount} />
                </td>
                <td className="p-2">
                  <Money value={promise.collected} />
                </td>
                <td className="p-2">
                  <StatusPill tone={TONE[promise.status]} label={t(`collections.promises.status.${promise.status}` as AppTranslationKey)} />
                </td>
                <td className="p-2 text-ink-muted">{promise.note ?? t("collections.currency.none")}</td>
                <td className="p-2 text-end">
                  {mayCancel && promise.status === PromiseToPayStatusDTO.Pending ? (
                    <Button size="sm" variant="ghost" disabled={pendingId === promise.id} onClick={() => cancelPromise(promise.id)}>
                      {t("collections.promises.cancel")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11.5px] text-ink-faint">{t("collections.promises.determinedFromAllocations")}</div>
    </div>
  );
}
