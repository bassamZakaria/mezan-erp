import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { BrandMark, Button, Copyright, TextInput } from "@mezan/ui";
import type { PlatformSessionDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";
import { PlatformApiError, usePlatformApi } from "./api";
import { readServerMessage } from "../data/server-message";

/**
 * The platform console's own door — email + password, apart from a
 * company's sign-in (`LoginScreen`). An operator signs into ONE shared
 * dashboard from wherever they are, not into a specific till, so there is no
 * remembered-face row.
 */
export function PlatformLogin() {
  const { t } = useAppTranslation();
  const { request, setSession } = usePlatformApi();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  // Mirrors `LoginScreen`'s imperative-ref focusing: the door has exactly one
  // useful first keystroke, and it belongs in the email field, not wherever
  // the browser happens to have last put focus.
  useEffect(() => emailRef.current?.focus(), []);

  const login = useMutation<PlatformSessionDTO, PlatformApiError, { email: string; password: string }>({
    mutationFn: async (body) => {
      const res = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        throw new PlatformApiError(res.status, await readServerMessage(res, t("platform.login.error.generic")));
      }
      return res.json<PlatformSessionDTO>();
    },
    onSuccess: (session) => {
      setSession(session);
      navigate("/platform/tenants", { replace: true });
    },
    onError: (err) => {
      // A 401 is always a wrong email/password, whatever the server's own
      // wording — this screen names that refusal itself rather than trusting
      // a server message that may not exist (or may leak which of the two
      // fields was wrong). Every other status keeps the server's message.
      setError(err.status === 401 ? t("platform.login.error.invalidCredentials") : err.message);
      setPassword("");
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (email.trim() === "" || password === "" || login.isPending) return;
    setError(null);
    login.mutate({ email: email.trim(), password });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[24px]">
      <BrandMark
        aria-hidden
        className="pointer-events-none fixed bottom-[-70px] end-[-40px] h-[320px] w-[320px] text-brand opacity-10"
      />
      <form
        onSubmit={handleSubmit}
        noValidate
        className="relative w-full max-w-[380px] rounded-lg border border-border bg-surface p-[28px] pb-[18px] shadow-2"
      >
        <div className="flex items-center gap-[10px]">
          <BrandMark className="h-[30px] w-[30px] flex-none text-brand" />
          <span className="mz-disp text-[17px] font-bold text-ink">{t("platform.brand.name")}</span>
        </div>

        <h1 className="mt-[14px] font-display text-[21px] font-bold leading-[1.35] text-ink">
          {t("platform.login.title")}
        </h1>

        <label className="mt-[14px] flex flex-col gap-[6px]">
          <span className="text-xs font-semibold text-ink">{t("platform.login.email")}</span>
          <TextInput
            ref={emailRef}
            type="email"
            value={email}
            autoComplete="username"
            className="mz-lat"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="mt-[14px] flex flex-col gap-[6px]">
          <span className="text-xs font-semibold text-ink">{t("platform.login.password")}</span>
          <TextInput
            type="password"
            value={password}
            autoComplete="current-password"
            className="mz-lat"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="mt-[10px] text-xs font-semibold text-danger-ink">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={email.trim() === "" || password === "" || login.isPending}
          className="mt-[16px] w-full justify-center py-[12px]"
        >
          {t("platform.login.submit")}
        </Button>

        <div className="mt-[10px] border-t border-border pt-[10px] text-center">
          <Copyright />
        </div>
      </form>
    </div>
  );
}
