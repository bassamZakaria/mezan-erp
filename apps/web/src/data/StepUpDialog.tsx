import { useId, useState, type FormEvent } from "react";
import { Button } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { PasswordInput } from "../login/PasswordInput";

export enum StepUpRefusal {
  IdentityUnconfirmed = "STEP_UP_IDENTITY_UNCONFIRMED",
}

export interface StepUpPrompt {
  readonly message: string;
  confirm(password: string): Promise<string | null>;
  /** Present on the cloud edition, where Firebase holds the credential. */
  confirmWithGoogle?(): Promise<string | null>;
  cancel(): void;
}

export function StepUpDialog({ prompt }: { prompt: StepUpPrompt }) {
  const { t } = useAppTranslation();
  const inputId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = password.length > 0;

  async function settle(attempt: Promise<string | null>) {
    setBusy(true);
    setError(null);
    const refusal = await attempt;
    setBusy(false);
    if (refusal !== null) {
      setError(refusal === StepUpRefusal.IdentityUnconfirmed ? t("login.firebase.wrongCredentials") : refusal);
      setPassword("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    await settle(prompt.confirm(password));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t("stepUp.passwordTitle")}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-[380px] rounded-lg border border-border bg-surface p-5 shadow-lg"
      >
        <h2 className="font-display text-lg font-bold text-ink">{t("stepUp.passwordTitle")}</h2>
        <p className="mt-2 text-[13px] text-ink-muted">{prompt.message}</p>
        <label htmlFor={inputId} className="mt-4 block text-xs text-ink-muted">
          {t("stepUp.password")}
        </label>
        <PasswordInput
          id={inputId}
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1"
        />
        {error ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}
        {prompt.confirmWithGoogle ? (
          <Button type="button" variant="default" disabled={busy} onClick={() => void settle(prompt.confirmWithGoogle!())} className="mt-3 w-full justify-center">
            {t("login.google")}
          </Button>
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
