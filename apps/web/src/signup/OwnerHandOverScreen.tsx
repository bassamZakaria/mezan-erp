import { useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Card } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { SignupLayout } from "./SignupLayout";
import { confirmOwnerHandOver, type SignupApiError } from "./signup-api";

// SECURITY: opening this page confirms nothing. Mail scanners follow links
// before a person does, so the hand-over is confirmed only by the button.
export function OwnerHandOverScreen() {
  const { t } = useAppTranslation();
  const [params] = useSearchParams();
  const token = params.get("token");
  const confirm = useMutation<void, SignupApiError, string>({ mutationFn: confirmOwnerHandOver });

  return (
    <SignupLayout>
      <Card className="flex flex-col gap-[14px] p-[22px]">
        <h1 className="font-display text-lg font-bold text-ink">{t("signup.ownerHandOver.title")}</h1>
        {!token ? (
          <p role="alert" className="text-[13px] font-semibold text-danger-ink">
            {t("signup.ownerHandOver.missingToken")}
          </p>
        ) : confirm.isSuccess ? (
          <p className="text-[13px] font-semibold text-ink">{t("signup.ownerHandOver.done")}</p>
        ) : (
          <>
            <p className="text-[13px] leading-[1.9] text-ink-muted">{t("signup.ownerHandOver.explain")}</p>
            {confirm.isError ? (
              <p role="alert" className="text-[13px] font-semibold text-danger-ink">
                {confirm.error.message}
              </p>
            ) : null}
            <Button variant="primary" className="w-full" disabled={confirm.isPending} onClick={() => confirm.mutate(token)}>
              {confirm.isPending ? t("signup.ownerHandOver.working") : t("signup.ownerHandOver.confirm")}
            </Button>
          </>
        )}
      </Card>
    </SignupLayout>
  );
}
