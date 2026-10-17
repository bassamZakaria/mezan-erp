import { useState, type FormEvent } from "react";
import { Button, TextInput } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

const PIN_LENGTH = 6;

export enum StepUpSecret {
  Pin = "pin",
  Password = "password",
}

export interface StepUpPrompt {
  readonly message: string;
  readonly secret?: StepUpSecret;
  confirm(pin: string): Promise<string | null>;
  cancel(): void;
}

export function StepUpDialog({ prompt }: { prompt: StepUpPrompt }) {
  const { t } = useAppTranslation();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byPassword = prompt.secret === StepUpSecret.Password;
  const ready = byPassword ? pin.length > 0 : pin.length === PIN_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const refusal = await prompt.confirm(pin);
    setBusy(false);
    if (refusal !== null) {
      setError(refusal);
      setPin("");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t(byPassword ? "stepUp.passwordTitle" : "stepUp.title")}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-[380px] rounded-lg border border-border bg-surface p-5 shadow-lg"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t(byPassword ? "stepUp.passwordTitle" : "stepUp.title")}</h2>
        <p className="mt-2 text-[13px] text-ink-muted">{prompt.message}</p>
        <label className="mt-4 block text-xs text-ink-muted">
          {t(byPassword ? "stepUp.password" : "stepUp.pin")}
          <TextInput
            type="password"
            inputMode={byPassword ? undefined : "numeric"}
            autoComplete={byPassword ? "current-password" : "off"}
            autoFocus
            dir="ltr"
            maxLength={byPassword ? undefined : PIN_LENGTH}
            value={pin}
            onChange={(event) => setPin(byPassword ? event.target.value : event.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={prompt.cancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !ready}>
            {t("stepUp.confirm")}
          </Button>
        </div>
      </form>
    </div>
  );
}
