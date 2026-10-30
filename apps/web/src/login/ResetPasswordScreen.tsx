import { useEffect, useId, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { Button, Card } from "@mezan/ui";
import { useResetPassword } from "../data/hooks";
import { persistTenantCode } from "../data/session";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "../signup/SignupLayout";
import { SIGN_IN_PATH } from "../routing";
import { MIN_PASSWORD_LENGTH, PasswordInput } from "./PasswordInput";

export function ResetPasswordScreen() {
  const { t } = useAppTranslation();
  const location = useLocation();
  const passwordId = useId();
  const confirmId = useId();
  // SECURITY: the token rides in the URL FRAGMENT (never sent to a server, proxy or Referer), is read once into memory and is taken out of the address bar at once.
  const [link] = useState(() => {
    const carried = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { token: carried.get("token"), tenant: carried.get("tenant") };
  });
  const { token, tenant } = link;
  useEffect(() => {
    window.history.replaceState(window.history.state, "", location.pathname);
  }, [location.pathname]);
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || reset.isPending) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t("login.password.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("profile.theNewPasswordAndIts"));
      return;
    }
    setError(null);
    reset.mutate(
      { token, password, tenant },
      {
        onSuccess: () => {
          // SECURITY: only a link the server accepted may change which company this browser signs in to.
          if (tenant) persistTenantCode(tenant);
          setDone(true);
        },
        onError: (err) => setError(err.message),
      },
    );
  }

  return (
    <SignupLayout maxWidthClassName="max-w-[460px]">
      <Card className="flex flex-col gap-[14px] p-[22px]">
        <h1 className="font-display text-lg font-bold text-ink">{t("resetPassword.title")}</h1>
        {done ? (
          <>
            <p role="status" className="text-[13px] font-semibold text-success-ink">
              {t("resetPassword.done")}
            </p>
            <Button variant="primary" className="w-full" onClick={() => window.location.assign(SIGN_IN_PATH)}>
              {t("login.unlockLink.backToSignIn")}
            </Button>
          </>
        ) : token ? (
          <form onSubmit={submit} noValidate className="flex flex-col gap-[12px]">
            <p className="text-[13px] leading-[1.8] text-ink-muted">{t("resetPassword.body")}</p>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={passwordId} className="text-xs font-semibold text-ink">
                {t("profile.newPassword")}
              </label>
              <PasswordInput id={passwordId} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="text-2xs text-ink-faint">{t("profile.atLeast8Characters")}</span>
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={confirmId} className="text-xs font-semibold text-ink">
                {t("profile.confirmTheNewPassword")}
              </label>
              <PasswordInput id={confirmId} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error ? (
              <p role="alert" className="text-[13px] font-semibold text-danger-ink">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" className="w-full" disabled={reset.isPending || password === ""}>
              {t("resetPassword.submit")}
            </Button>
          </form>
        ) : (
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {t("resetPassword.missing")}
          </p>
        )}
        {done ? null : (
          <a href={SIGN_IN_PATH} className="text-[12.5px] font-semibold text-accent-strong hover:underline">
            {t("login.unlockLink.backToSignIn")}
          </a>
        )}
      </Card>
    </SignupLayout>
  );
}
