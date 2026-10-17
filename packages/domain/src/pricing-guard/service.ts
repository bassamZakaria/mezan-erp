import { convertToBase } from "../exchange-rates/convert.js";
import { Money } from "../money/index.js";
import { evaluatePricingGuard } from "./evaluate.js";
import {
  PricingGuardCostBasis,
  PricingGuardLineOutcome,
  type PricingGuardDocumentInput,
  type PricingGuardEvaluation,
  type PricingGuardEvaluationLineInput,
  type PricingGuardOverride,
  type PricingGuardOverrideKind,
  type PricingGuardOverrideRepository,
  type PricingGuardRuleRepository,
} from "./types.js";

export interface PricingGuardCostSource {
  /**
   * Weighted-average cost of ONE BASE unit at the close of `date`, replayed
   * from the stock ledger — at `warehouseId`, or pooled over the branch's
   * warehouses when the document names none. Null when nothing was on hand.
   */
  unitCostAsOf(query: { readonly itemId: string; readonly warehouseId: string | null; readonly branchId: string; readonly date: string }): Promise<Money | null>;
  /** The item master's own cost price, used only when the ledger holds no position. */
  itemCostPrice(itemId: string): Promise<Money | null>;
}

export interface PricingGuardServiceDeps {
  readonly rules: Pick<PricingGuardRuleRepository, "list">;
  readonly overrides: PricingGuardOverrideRepository;
  readonly costs: PricingGuardCostSource;
  /** The item's category and every ancestor of it, nearest first. */
  readonly categoryAncestry: (itemId: string) => Promise<readonly string[]>;
  readonly customerCategory: (customerId: string) => Promise<string | null>;
  readonly rateOn: (currency: string, date: string) => Promise<string | null>;
  readonly baseCurrency: () => Promise<string>;
  readonly approvalChainConfigured: () => Promise<boolean>;
}

/** What a document confirm consults: evaluation, whether approve-mode has anywhere to go, and the override record. */
export interface DocumentPricingGuardPort {
  evaluate(input: PricingGuardDocumentInput): Promise<PricingGuardEvaluation>;
  approvalChainConfigured(): Promise<boolean>;
  recordOverrides(rows: readonly PricingGuardOverride[]): Promise<void>;
}

export class PricingGuardService implements DocumentPricingGuardPort {
  constructor(private readonly deps: PricingGuardServiceDeps) {}

  async evaluate(input: PricingGuardDocumentInput): Promise<PricingGuardEvaluation> {
    const [rules, customerCategory, rate] = await Promise.all([
      this.deps.rules.list(),
      this.deps.customerCategory(input.customerId),
      this.rateFor(input.currency, input.date),
    ]);
    const lines: PricingGuardEvaluationLineInput[] = await Promise.all(
      input.lines.map(async (line) => {
        const [categoryIds, cost] = await Promise.all([this.deps.categoryAncestry(line.itemId), this.costOf(line.itemId, input)]);
        return {
          lineId: line.lineId,
          itemId: line.itemId,
          categoryIds,
          baseQty: line.baseQty,
          netBase: rate === null ? null : rate === "1" ? line.netAmount : convertToBase(line.netAmount, rate),
          unitCostBase: cost.unitCost,
          costBasis: cost.basis,
        };
      }),
    );
    return evaluatePricingGuard(rules, lines, { customerCategory });
  }

  approvalChainConfigured(): Promise<boolean> {
    return this.deps.approvalChainConfigured();
  }

  async recordOverrides(rows: readonly PricingGuardOverride[]): Promise<void> {
    if (rows.length > 0) await this.deps.overrides.recordAll(rows);
  }

  private async rateFor(currency: string, date: string): Promise<string | null> {
    if (!currency || currency === (await this.deps.baseCurrency())) return "1";
    return this.deps.rateOn(currency, date);
  }

  private async costOf(itemId: string, input: PricingGuardDocumentInput): Promise<{ unitCost: Money | null; basis: PricingGuardCostBasis }> {
    const wac = await this.deps.costs.unitCostAsOf({ itemId, warehouseId: input.warehouseId, branchId: input.branchId, date: input.date });
    if (wac !== null && wac.scaled > 0n) return { unitCost: wac, basis: PricingGuardCostBasis.Wac };
    const fallback = await this.deps.costs.itemCostPrice(itemId);
    if (fallback !== null && fallback.scaled > 0n) return { unitCost: fallback, basis: PricingGuardCostBasis.ItemCostPrice };
    return { unitCost: null, basis: PricingGuardCostBasis.None };
  }
}

export interface PricingGuardOverrideMeta {
  readonly docNo: string | null;
  readonly customerNameAr: string;
  readonly kind: PricingGuardOverrideKind;
  readonly approvalRequestId: string | null;
  readonly actor: string;
  readonly recordedAt: string;
}

export function overridesOf(input: PricingGuardDocumentInput, evaluation: PricingGuardEvaluation, meta: PricingGuardOverrideMeta): PricingGuardOverride[] {
  const byLine = new Map(input.lines.map((line) => [line.lineId, line]));
  return evaluation.lines.flatMap((line) => {
    const source = byLine.get(line.lineId);
    if (!source || line.outcome === PricingGuardLineOutcome.Pass) return [];
    return [
      {
        id: `${input.docType}:${input.docId}:${line.lineId}`,
        docType: input.docType,
        docId: input.docId,
        docNo: meta.docNo,
        docDate: input.date,
        customerId: input.customerId,
        customerNameAr: meta.customerNameAr,
        branchId: input.branchId,
        lineId: line.lineId,
        itemId: line.itemId,
        baseQty: source.baseQty,
        netBase: line.netBase ?? Money.zero(),
        netUnitPrice: line.netUnitPrice ?? Money.zero(),
        unitCost: line.unitCost,
        costBasis: line.costBasis,
        marginBasisPoints: line.marginBasisPoints,
        breaches: line.breaches,
        kind: meta.kind,
        approvalRequestId: meta.approvalRequestId,
        actor: meta.actor,
        recordedAt: meta.recordedAt,
      },
    ];
  });
}
