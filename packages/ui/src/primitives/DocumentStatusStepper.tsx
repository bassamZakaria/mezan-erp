import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";

/**
 * DocumentStatusStepper — the shared document-lifecycle stepper
 * (مسودة → بانتظار الموافقة → مرحل → معكوس). Every document module reuses it to
 * show where a document sits in the framework lifecycle. Steps before the
 * current one render as complete, the current one is highlighted, later ones are
 * upcoming; a terminal off-path state (معكوس / ملغي) tints the current step with
 * the `danger` tone.
 */

export interface DocumentStatusStep {
  key: string;
  label: string;
}

export interface DocumentStatusStepperProps {
  steps: DocumentStatusStep[];
  currentKey: string;
  /** Tone for the current step — "danger" for reversed/cancelled terminal states. */
  tone?: "brand" | "danger";
  className?: string;
}

export function DocumentStatusStepper({
  steps,
  currentKey,
  tone = "brand",
  className,
}: DocumentStatusStepperProps) {
  const { t } = useUiTranslation();
  const currentIndex = steps.findIndex((s) => s.key === currentKey);

  return (
    <ol className={cn("flex flex-wrap items-center gap-[6px]", className)} aria-label={t("ui.documentStatus.legend")}>
      {steps.map((step, i) => {
        const isDone = currentIndex >= 0 && i < currentIndex;
        const isCurrent = i === currentIndex;
        const dotClass = isCurrent
          ? tone === "danger"
            ? "bg-danger text-danger-ink"
            : "bg-brand text-brand-ink"
          : isDone
            ? "bg-success text-success-ink"
            : "bg-surface-3 text-ink-faint";
        const labelClass = isCurrent
          ? tone === "danger"
            ? "text-danger-ink font-bold"
            : "text-brand font-bold"
          : isDone
            ? "text-ink font-semibold"
            : "text-ink-faint";

        return (
          <li key={step.key} className="flex items-center gap-[6px]">
            <span
              aria-current={isCurrent ? "step" : undefined}
              className="flex items-center gap-[7px] rounded-pill px-[10px] py-[5px]"
            >
              <span
                className={cn(
                  "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] font-bold",
                  dotClass,
                )}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[12px]", labelClass)}>{step.label}</span>
            </span>
            {i < steps.length - 1 ? (
              <span aria-hidden className="h-px w-[16px] flex-none bg-border" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
