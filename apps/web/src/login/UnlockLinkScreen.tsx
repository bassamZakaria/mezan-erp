import { useNavigate, useSearchParams } from "react-router";
import { Button, Card } from "@mezan/ui";
import { useUnlockAccountByLink } from "../data/hooks";
import { SignInNotice, markSignInNotice, persistTenantCode } from "../data/session";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "../signup/SignupLayout";

export function UnlockLinkScreen() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token");
  const tenant = params.get("tenant");
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
        <a href="/" className="text-[12.5px] font-semibold text-accent-strong hover:underline">
          {t("login.unlockLink.backToSignIn")}
        </a>
      </Card>
    </SignupLayout>
  );
}
