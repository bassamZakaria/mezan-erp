import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Card } from "@mezan/ui";
import { SignupRefusalCode, type VerifySignupResultDTO } from "@mezan/contracts";
import { handOffSignIn } from "../data/session";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "./SignupLayout";
import { SignupApiError, SignupErrorCode, verifySignup } from "./signup-api";
import { SIGN_IN_PATH } from "../routing";

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-[10px]">
      <span className="text-xs font-semibold text-ink-muted">{label}</span>
      <span className="mz-lat text-[13px] font-semibold text-ink" dir="ltr">
        {value}
      </span>
    </div>
  );
}

function VerifiedPanel({ result }: { result: VerifySignupResultDTO }) {
  const { t } = useAppTranslation();
  return (
    <Card className="flex flex-col gap-[14px] p-[22px]">
      <h1 className="font-display text-lg font-bold text-ink">
        {result.alreadyVerified ? t("signup.verify.alreadyTitle") : t("signup.verify.successTitle")}
      </h1>
      <div className="flex flex-col gap-[10px] rounded-md border border-border bg-surface-2 p-[14px]">
        <ResultRow label={t("signup.verify.code")} value={result.tenant.code} />
        <ResultRow label={t("signup.verify.adminEmail")} value={result.adminEmail} />
        <div>
          <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("signup.verify.adminPin")}</span>
          <code dir="ltr" className="mz-num select-all break-all rounded-[6px] bg-surface px-[10px] py-[6px] text-[16px] font-bold text-ink">
            {result.adminPin ?? t("signup.verify.pinKept")}
          </code>
        </div>
      </div>
      {result.adminPin ? (
        <p role="alert" className="text-[11.5px] font-semibold text-warning-ink">
          {t("signup.verify.oneTime")}
        </p>
      ) : null}
      <Button variant="primary" className="w-full" onClick={() => goSignInAs(result)}>
        {t("signup.verify.goSignIn")}
      </Button>
    </Card>
  );
}

function goSignInAs(result: VerifySignupResultDTO) {
  handOffSignIn(result.tenant.code, result.adminEmail);
  goSignIn();
}

function goSignIn() {
  window.location.href = SIGN_IN_PATH;
}

function AlreadyActivatedPanel({ message }: { message: string }) {
  const { t } = useAppTranslation();
  return (
    <Card className="flex flex-col gap-[14px] p-[22px]">
      <h1 className="font-display text-lg font-bold text-ink">{t("signup.verify.alreadyTitle")}</h1>
      <p className="text-[13px] text-ink-muted">{message}</p>
      <Button variant="primary" className="w-full" onClick={goSignIn}>
        {t("signup.verify.goSignIn")}
      </Button>
    </Card>
  );
}

export function VerifyScreen() {
  const { t } = useAppTranslation();
  const [params] = useSearchParams();
  const token = params.get("token");

  const query = useQuery<VerifySignupResultDTO, SignupApiError>({
    queryKey: ["signup", "verify", token],
    queryFn: () => verifySignup(token!),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  let body: ReactNode;
  if (!token) {
    body = (
      <Card className="flex flex-col gap-[10px] p-[22px]">
        <p role="alert" className="text-[13px] font-semibold text-danger-ink">
          {t("signup.verify.missingToken")}
        </p>
        <a href="/signup" className="text-[12.5px] font-semibold text-accent-strong hover:underline">
          {t("signup.footer.backHome")}
        </a>
      </Card>
    );
  } else if (query.isPending) {
    body = (
      <Card className="flex flex-col items-center gap-[10px] p-[28px] text-center">
        <p className="text-[13px] text-ink-muted">{t("signup.verify.working")}</p>
      </Card>
    );
  } else if (query.isError && query.error instanceof SignupApiError && query.error.code === SignupRefusalCode.AwaitingApproval) {
    body = (
      <Card className="flex flex-col gap-[12px] p-[22px]">
        <h1 className="font-display text-lg font-bold text-ink">{t("signup.verify.awaitingTitle")}</h1>
        <p role="status" className="text-[13px] text-ink-muted">
          {query.error.message}
        </p>
      </Card>
    );
  } else if (query.isError && query.error instanceof SignupApiError && query.error.code === SignupErrorCode.AlreadyActivated) {
    body = <AlreadyActivatedPanel message={query.error.message} />;
  } else if (query.isError) {
    body = (
      <Card className="flex flex-col gap-[10px] p-[22px]">
        <p role="alert" className="text-[13px] font-semibold text-danger-ink">
          {query.error instanceof SignupApiError ? query.error.message : t("signup.verify.error")}
        </p>
        <a href="/signup" className="text-[12.5px] font-semibold text-accent-strong hover:underline">
          {t("signup.footer.backHome")}
        </a>
      </Card>
    );
  } else {
    body = <VerifiedPanel result={query.data} />;
  }

  return <SignupLayout>{body}</SignupLayout>;
}
