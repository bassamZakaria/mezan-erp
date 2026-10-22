import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button, Card } from "@mezan/ui";
import { useUnlockAccountByLink } from "../data/hooks";
import { SignInNotice, markSignInNotice, persistTenantCode } from "../data/session";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "../signup/SignupLayout";
import { SIGN_IN_PATH } from "../routing";

export function UnlockLinkScreen() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // SECURITY: the token arrives in the URL FRAGMENT, which a browser never
  // sends to a server, a proxy or a Referer header. It is read once into
  // memory and taken out of the address bar at once, so it is not left in the
  // history, a bookmark or a screenshot. A token in the query string is not
  // accepted: it has already been through every log on the way here.
  const [link] = useState(() => {
    const carried = new URLSearchParams(location.hash.replace(/^#/, ""));
    return { token: carried.get("token"), tenant: carried.get("tenant") };
  });
  const { token, tenant } = link;
  useEffect(() => {
    window.history.replaceState(window.history.state, "", location.pathname);
  }, [location.pathname]);
  const unlock = useUnlockAccountByLink();

  // SECURITY: the link is spent by this press and never by the page loading —
  // a mail scanner that opens every address in a message must not use it up.
  function redeem() {
    if (!token || unlock.isPending) return;
    if (tenant) persistTenantCode(tenant);
    unlock.mutate(
      { token },
      {
        onSuccess: () => {
          markSignInNotice(SignInNotice.AccountUnlocked);
          void navigate("/", { replace: true });
        },
      },
    );
  }

  return (
    <SignupLayout maxWidthClassName="max-w-[460px]">
      <Card className="flex flex-col gap-[14px] p-[22px]">
        <h1 className="font-display text-lg font-bold text-ink">{t("login.unlockLink.title")}</h1>
        {token ? (
          <>
            <p className="text-[13px] leading-[1.8] text-ink-muted">{t("login.unlockLink.body")}</p>
            {unlock.error ? (
              <p role="alert" className="text-[13px] font-semibold text-danger-ink">
                {unlock.error.message}
              </p>
            ) : null}
            <Button variant="primary" className="w-full" disabled={unlock.isPending} onClick={redeem}>
              {t("login.unlock.submit")}
            </Button>
          </>
        ) : (
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {t("login.unlockLink.missing")}
          </p>
        )}
        <a href={SIGN_IN_PATH} className="text-[12.5px] font-semibold text-accent-strong hover:underline">
          {t("login.unlockLink.backToSignIn")}
        </a>
      </Card>
    </SignupLayout>
  );
}
