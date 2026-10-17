import { StatusPill, useFormat, type PillTone } from "@mezan/ui";
import {
  PricingGuardBreachKindDTO,
  PricingGuardCostBasisDTO,
  PricingGuardLineOutcomeDTO,
  type PricingGuardEvaluationDTO,
  type PricingGuardLineEvaluationDTO,
} from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

const OUTCOME_TONE: Record<PricingGuardLineOutcomeDTO, PillTone> = {
  [PricingGuardLineOutcomeDTO.Pass]: "success",
  [PricingGuardLineOutcomeDTO.NeedsApproval]: "warning",
  [PricingGuardLineOutcomeDTO.Blocked]: "danger",
};

const OUTCOME_LABEL: Record<PricingGuardLineOutcomeDTO, AppTranslationKey> = {
  [PricingGuardLineOutcomeDTO.Pass]: "pricingGuard.outcome.pass",
  [PricingGuardLineOutcomeDTO.NeedsApproval]: "pricingGuard.outcome.needs_approval",
  [PricingGuardLineOutcomeDTO.Blocked]: "pricingGuard.outcome.blocked",
};

export const BREACH_LABEL: Record<PricingGuardBreachKindDTO, AppTranslationKey> = {
  [PricingGuardBreachKindDTO.BelowFloor]: "pricingGuard.breach.below_floor",
  [PricingGuardBreachKindDTO.BelowMinMargin]: "pricingGuard.breach.below_min_margin",
};

export const COST_BASIS_LABEL: Record<PricingGuardCostBasisDTO, AppTranslationKey> = {
  [PricingGuardCostBasisDTO.Wac]: "pricingGuard.costBasis.wac",
  [PricingGuardCostBasisDTO.ItemCostPrice]: "pricingGuard.costBasis.item_cost_price",
  [PricingGuardCostBasisDTO.None]: "pricingGuard.costBasis.none",
};

/** One draft line's margin (only when the server sent cost) and its floor verdict. */
export function PricingGuardLineStatus({ line, costVisible }: { line: PricingGuardLineEvaluationDTO | undefined; costVisible: boolean }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  if (!line) return null;
  const floors = line.breaches.filter((breach) => breach.kind === PricingGuardBreachKindDTO.BelowFloor && breach.floorPrice !== null);
  const margins = line.breaches.filter((breach) => breach.kind === PricingGuardBreachKindDTO.BelowMinMargin && breach.minMarginPercent !== null);
  const hasVerdict = line.outcome !== PricingGuardLineOutcomeDTO.Pass;
  if (!hasVerdict && !costVisible) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] text-[11.5px] text-ink-muted" data-pricing-guard-line={line.lineId}>
      {costVisible ? (
        <span>
          {t("pricingGuard.lineMargin")}{" "}
          {line.marginPercent !== null && line.marginPercent !== undefined ? (
            <span className="mz-num font-semibold text-ink">{format.money(line.marginPercent)}%</span>
          ) : (
            <span className="text-ink-faint">{t("pricingGuard.costBasis.none")}</span>
          )}
          {line.costBasis && line.costBasis !== PricingGuardCostBasisDTO.None ? (
            <span className="text-ink-faint"> · {t(COST_BASIS_LABEL[line.costBasis])}</span>
          ) : null}
        </span>
      ) : null}
      {hasVerdict ? <StatusPill label={t(OUTCOME_LABEL[line.outcome])} tone={OUTCOME_TONE[line.outcome]} /> : null}
      {floors.map((breach) => (
        <span key={`${breach.ruleId}:floor`}>
          {t("pricingGuard.floorIs")} <span className="mz-num font-semibold text-ink">{format.money(breach.floorPrice ?? "0")}</span>
        </span>
      ))}
      {margins.map((breach) => (
        <span key={`${breach.ruleId}:margin`}>
          {t("pricingGuard.minMarginIs")} <span className="mz-num font-semibold text-ink">{format.number(breach.minMarginPercent ?? 0)}%</span>
        </span>
      ))}
    </div>
  );
}

/** A banner above the save buttons, so a blocked or approval-bound draft is known before it is confirmed. */
export function PricingGuardSummary({ evaluation }: { evaluation: PricingGuardEvaluationDTO | null }) {
  const { t } = useAppTranslation();
  if (!evaluation || evaluation.outcome === PricingGuardLineOutcomeDTO.Pass) return null;
  const blocked = evaluation.outcome === PricingGuardLineOutcomeDTO.Blocked;
  const count = evaluation.lines.filter((line) => line.outcome !== PricingGuardLineOutcomeDTO.Pass).length;
  return (
    <div
      role="status"
      className={
        blocked
          ? "rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
          : "rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink"
      }
    >
      {t(blocked ? "pricingGuard.summary.blocked" : "pricingGuard.summary.needsApproval", { count: String(count) })}
    </div>
  );
}
