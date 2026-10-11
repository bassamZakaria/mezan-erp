import { Lock } from "lucide-react";
import { Button } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

/** What a branch-restricted user sees at the address of a screen that exists only for the whole company. */
export function BranchUnavailableState({ onGoHome }: { readonly onGoHome: () => void }) {
  const { t } = useAppTranslation();
  return (
    <section data-testid="branch-unavailable" role="status" className="mx-auto flex max-w-[52ch] flex-col items-center gap-[12px] px-[16px] py-[56px] text-center">
      <Lock aria-hidden className="size-[28px] text-ink-faint" />
      <h1 className="font-display text-[20px] font-bold text-ink">{t("branchRestriction.unavailable.title")}</h1>
      <p className="text-[13px] text-ink-muted">{t("branchRestriction.unavailable.body")}</p>
      <Button variant="default" onClick={onGoHome}>
        {t("branchRestriction.unavailable.goHome")}
      </Button>
    </section>
  );
}

/** Shown above a shared configuration screen a branch-restricted user may read and not change. */
export function BranchReadOnlyNotice() {
  const { t } = useAppTranslation();
  return (
    <p data-testid="branch-read-only" role="note" className="mb-[12px] flex items-center gap-[8px] rounded-[8px] border border-border bg-surface-2 px-[12px] py-[8px] text-[12px] text-ink-muted">
      <Lock aria-hidden className="size-[14px] shrink-0" />
      <span>{t("branchRestriction.readOnly")}</span>
    </p>
  );
}
