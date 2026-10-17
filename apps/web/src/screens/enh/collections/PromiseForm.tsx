import { useState } from "react";
import { Button, MoneyStringInput, TextInput } from "@mezan/ui";
import { Field } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";
import { errorMessage } from "../../../lib/error-message";
import { addDaysIso, todayIso } from "../../../lib/dates";
import { useCreatePromise } from "./hooks";

const DEFAULT_PROMISE_DAYS = 7;

export interface PromiseFormProps {
  readonly customerId: string;
  readonly overdue: string;
  readonly onDone: () => void;
}

export function PromiseForm({ customerId, overdue, onDone }: PromiseFormProps) {
  const { t } = useAppTranslation();
  const create = useCreatePromise();
  const [date, setDate] = useState(addDaysIso(todayIso(), DEFAULT_PROMISE_DAYS));
  const [amount, setAmount] = useState(overdue);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (create.isPending) return;
    setError(null);
    create.mutate(
      { customerId, promisedDate: date, amount, note: note.trim() === "" ? null : note.trim() },
      { onSuccess: onDone, onError: (err) => setError(errorMessage(err, t("collections.promises.saveFailed"))) },
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="text-[13px] font-semibold text-ink">{t("collections.promises.new")}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t("collections.promises.promisedDate")} htmlFor={`promise-date-${customerId}`}>
          <TextInput id={`promise-date-${customerId}`} type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("collections.promises.amount")} htmlFor={`promise-amount-${customerId}`}>
          <MoneyStringInput id={`promise-amount-${customerId}`} value={amount} onChange={setAmount} />
        </Field>
        <Field label={t("collections.promises.note")} htmlFor={`promise-note-${customerId}`}>
          <TextInput id={`promise-note-${customerId}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="text-[11.5px] text-ink-faint">{t("collections.promises.defaultCoverage")}</div>
      {error ? (
        <div role="alert" className="text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={create.isPending}>
          {t("collections.promises.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
