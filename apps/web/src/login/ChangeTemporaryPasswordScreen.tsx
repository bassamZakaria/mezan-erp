import { useId, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Card } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { useChangePassword } from "../data/account-hooks";
import { useLogin } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "../signup/SignupLayout";
import { MIN_PASSWORD_LENGTH, PasswordInput } from "./PasswordInput";

export function ChangeTemporaryPasswordScreen({ onSignedOut }: { readonly onSignedOut?: () => void } = {}) {
  const { t } = useAppTranslation();
  const { session, setSession, request } = useApi();
  const queryClient = useQueryClient();
  const changePassword = useChangePassword();
  const login = useLogin();
  const currentId = useId();
  const nextId = useId();
  const confirmId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changedTo, setChangedTo] = useState<string | null>(null);
  const busy = changePassword.isPending || login.isPending;

  function signOut() {
    void request("/auth/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut?.();
    setSession(null);
    queryClient.clear();
  }

  async function signInWith(password: string) {
    if (session === null) return;
    setError(null);
    try {
      await login.mutateAsync({ username: session.email, password });
    } catch (err) {
      const said = err instanceof Error && err.message !== "" ? ` ${err.message}` : "";
      setError(`${t("changePassword.signInAgainFailed")}${said}`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || session === null) return;
    if (changedTo !== null) {
      await signInWith(changedTo);
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(t("login.password.tooShort"));
      return;
    }
    if (next !== confirm) {
      setError(t("profile.theNewPasswordAndIts"));
      return;
    }
    setError(null);
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.couldNotChangeThePassword"));
      return;
    }
    // The old session stays flagged server-side after the change, so a fresh sign-in with the new password is what unlocks the app; the temporary password no longer works.
    setChangedTo(next);
    await signInWith(next);
  }

  return (
    <SignupLayout maxWidthClassName="max-w-[420px]">
      <Card className="p-[22px]">
        <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-[12px]">
          <h1 className="font-display text-lg font-bold text-ink">{t("changePassword.title")}</h1>
          <p className="text-[13px] text-ink-muted">{t("changePassword.body")}</p>
          <span dir="ltr" className="mz-lat text-[12.5px] text-ink-muted">
            {session?.email}
          </span>
          {changedTo === null ? (
            <>
              <div className="flex flex-col gap-[6px]">
                <label htmlFor={currentId} className="text-xs font-semibold text-ink">
                  {t("changePassword.current")}
                </label>
                <PasswordInput id={currentId} autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label htmlFor={nextId} className="text-xs font-semibold text-ink">
                  {t("profile.newPassword")}
                </label>
                <PasswordInput id={nextId} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                <span className="text-2xs text-ink-faint">{t("profile.atLeast8Characters")}</span>
              </div>
              <div className="flex flex-col gap-[6px]">
                <label htmlFor={confirmId} className="text-xs font-semibold text-ink">
                  {t("profile.confirmTheNewPassword")}
                </label>
                <PasswordInput id={confirmId} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            </>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-semibold text-danger-ink">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy || (changedTo === null && (current === "" || next === ""))} className="w-full justify-center py-[12px]">
            {t(changedTo === null ? "changePassword.submit" : "changePassword.retrySignIn")}
          </Button>
          <Button type="button" variant="ghost" onClick={signOut} className="self-center">
            {t("shell.menu.signOut")}
          </Button>
        </form>
      </Card>
    </SignupLayout>
  );
}
