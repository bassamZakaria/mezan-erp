import type { Money } from "../money/index.js";
import { checkBarcodeFit } from "./barcode-fit.js";
import { getLabelTemplate, type LabelTemplate, type LabelTemplateCode } from "./label-template.js";

/**
 * The label-print builder's batch model (docs/catalog/03-inventory.md
 * §"طباعة الملصقات"): a selected-items table + a chosen template, with the
 * per-line barcode-fit check computed up front so the web layer can render
 * the warning inline and disable "معاينة وطباعة" while any line is blocked.
 */

export interface LabelBatchLineInput {
  readonly itemId: string;
  readonly nameAr: string;
  readonly code: string;
  readonly barcode: string;
  /** Live-computed sale price (docs: "السعر المطبوع هو السعر الفعلي" — printing never changes price). */
  readonly price: Money;
  /** Copies to print for this item, minimum 1. */
  readonly copies: number;
}

export interface LabelBatchLine extends LabelBatchLineInput {
  readonly fits: boolean;
  readonly messageAr: string | null;
}

export interface LabelBatch {
  readonly template: LabelTemplate;
  readonly lines: readonly LabelBatchLine[];
  /** Sum of every line's copies (the "الإجمالي: N ملصق" running total). */
  readonly totalLabelCount: number;
  /** True when at least one line's barcode doesn't fit — blocks "معاينة وطباعة". */
  readonly hasBlockingIssues: boolean;
}

/** Pure — builds the batch model, computing the barcode-fit check for every line against `templateCode`. */
export function buildLabelBatch(templateCode: LabelTemplateCode, inputs: readonly LabelBatchLineInput[]): LabelBatch {
  const template = getLabelTemplate(templateCode);
  const lines: LabelBatchLine[] = inputs.map((input) => {
    const fit = checkBarcodeFit(input.barcode, template);
    return { ...input, fits: fit.fits, messageAr: fit.messageAr };
  });
  const totalLabelCount = lines.reduce((sum, l) => sum + Math.max(0, Math.trunc(l.copies)), 0);
  const hasBlockingIssues = lines.some((l) => !l.fits);
  return { template, lines, totalLabelCount, hasBlockingIssues };
}
