import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";

/**
 * The product's copyright line — «© <year> Cyag. All Rights Reserved.»
 *
 * One component rather than a string pasted twice: it is shown both signed-out
 * (the login card) and signed-in (the foot of the workspace rail), and a
 * notice that reads differently in the two places is worse than none.
 *
 * The year comes from the clock, so the notice does not go stale on the 1st of
 * January in an install nobody has updated — this edition ships to shops that
 * may run the same build for a year.
 *
 * NOT `mz-lat`: that forces an LTR run, and around an Arabic sentence it drags
 * the full stop to the wrong end. The line follows the document direction, and
 * the Arabic string puts its Latin run («© 2026 Cyag») last so the two orders
 * agree.
 */
export function Copyright({ className }: { className?: string }) {
  const { t } = useUiTranslation();
  return (
    <span className={cn("text-2xs text-ink-faint", className)}>
      {t("shell.copyright", { year: String(new Date().getFullYear()) })}
    </span>
  );
}
