import { useAppTranslation } from "../i18n";

export function BackendStartingScreen({ detail }: { detail?: string | null }) {
  const { t } = useAppTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[24px] text-ink">
      <div role="status" aria-label={t("boot.starting.title")} className="flex max-w-[460px] flex-col items-center gap-[10px] text-center">
        <span aria-hidden className="h-[28px] w-[28px] animate-spin rounded-pill border-2 border-border border-t-brand" />
        <p className="text-lg font-bold">{t("boot.starting.title")}</p>
        <p className="text-sm text-ink-muted">{detail ?? t("boot.starting.body")}</p>
      </div>
    </div>
  );
}

export function BackendRefusedScreen({ message }: { message: string }) {
  const { t } = useAppTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[24px] text-ink">
      <div role="alert" className="flex max-w-[560px] flex-col gap-[10px] rounded-lg border border-border-strong bg-surface p-[24px] shadow-1">
        <h1 className="text-lg font-bold">{t("boot.refused.title")}</h1>
        <p className="whitespace-pre-line break-words text-sm leading-[1.8]">{message}</p>
        <p className="text-sm text-ink-muted">{t("boot.refused.next")}</p>
      </div>
    </div>
  );
}
