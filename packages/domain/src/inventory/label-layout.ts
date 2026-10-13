/**
 * تخطيطات الملصقات (label layouts) — docs/archive/catalog/03 §"طباعة الباركود
 * والملصقات". A layout is the printable geometry of one label sheet: how many
 * labels fit across and down a page, the size of each label, and which item
 * fields (name, code, price, unit, barcode) appear on it.
 *
 * It is tenant CONFIGURATION, not master data derived from anything else: a
 * shop buys a specific sticker stationery and describes it once. Millimetre
 * geometry is plain numbers — Money/Qty are for money and quantities, and a
 * label's height is neither; the only monetary field a label carries (the
 * item's sale price) is rendered from the item's own `Money` string.
 */

export const LABEL_PAGE_SIZES = ["A4", "A5"] as const;
export type LabelPageSize = (typeof LABEL_PAGE_SIZES)[number];

export interface LabelLayout {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly pageSize: LabelPageSize;
  /** Labels per row / per column on one printed page. */
  readonly columns: number;
  readonly rows: number;
  readonly labelWidthMm: number;
  readonly labelHeightMm: number;
  /** Gutter between adjacent labels. */
  readonly columnGapMm: number;
  readonly rowGapMm: number;
  /** Page margins — `marginInlineMm` is logical (start/end), not left/right. */
  readonly marginBlockMm: number;
  readonly marginInlineMm: number;
  readonly showItemName: boolean;
  readonly showItemCode: boolean;
  readonly showPrice: boolean;
  readonly showUnit: boolean;
  readonly showBarcode: boolean;
  readonly showBarcodeText: boolean;
  readonly barcodeHeightMm: number;
  readonly active: boolean;
}

export interface LabelLayoutRepository {
  list(): Promise<LabelLayout[]>;
  findById(id: string): Promise<LabelLayout | null>;
  findByCode(code: string): Promise<LabelLayout | null>;
  save(layout: LabelLayout): Promise<void>;
  insert(layout: LabelLayout): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CreateLabelLayoutCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly pageSize?: LabelPageSize;
  readonly columns: number;
  readonly rows: number;
  readonly labelWidthMm: number;
  readonly labelHeightMm: number;
  readonly columnGapMm?: number;
  readonly rowGapMm?: number;
  readonly marginBlockMm?: number;
  readonly marginInlineMm?: number;
  readonly showItemName?: boolean;
  readonly showItemCode?: boolean;
  readonly showPrice?: boolean;
  readonly showUnit?: boolean;
  readonly showBarcode?: boolean;
  readonly showBarcodeText?: boolean;
  readonly barcodeHeightMm?: number;
  readonly active?: boolean;
}

export type UpdateLabelLayoutCommand = Partial<Omit<CreateLabelLayoutCommand, "id" | "code">>;

export class LabelLayoutNotFoundError extends Error {
  readonly code = "LABEL_LAYOUT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Label layout "${id}" was not found.`);
    this.name = "LabelLayoutNotFoundError";
  }
}

export class DuplicateLabelLayoutCodeError extends Error {
  readonly code = "DUPLICATE_LABEL_LAYOUT_CODE";
  constructor(readonly layoutCode: string) {
    super(`Label layout code "${layoutCode}" already exists.`);
    this.name = "DuplicateLabelLayoutCodeError";
  }
}

export class InvalidLabelLayoutError extends Error {
  readonly code = "INVALID_LABEL_LAYOUT";
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid label layout: ${reasons.join("; ")}`);
    this.name = "InvalidLabelLayoutError";
  }
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

/** Usable print area of each page size, in millimetres. */
const PAGE_WIDTH_MM: Record<LabelPageSize, number> = { A4: 210, A5: 148 };
const PAGE_HEIGHT_MM: Record<LabelPageSize, number> = { A4: 297, A5: 210 };

function validate(layout: LabelLayout): string[] {
  const reasons: string[] = [];
  if (layout.id.trim() === "") reasons.push("id is required");
  if (!CODE_PATTERN.test(layout.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (layout.nameAr.trim() === "") reasons.push("nameAr is required");
  if (!Number.isInteger(layout.columns) || layout.columns < 1) reasons.push("columns must be a positive integer");
  if (!Number.isInteger(layout.rows) || layout.rows < 1) reasons.push("rows must be a positive integer");
  if (layout.labelWidthMm <= 0) reasons.push("labelWidthMm must be greater than zero");
  if (layout.labelHeightMm <= 0) reasons.push("labelHeightMm must be greater than zero");
  if (layout.columnGapMm < 0 || layout.rowGapMm < 0) reasons.push("gaps cannot be negative");
  if (layout.marginBlockMm < 0 || layout.marginInlineMm < 0) reasons.push("margins cannot be negative");
  if (layout.barcodeHeightMm < 0) reasons.push("barcodeHeightMm cannot be negative");
  if (layout.showBarcode && layout.barcodeHeightMm >= layout.labelHeightMm) {
    reasons.push("barcodeHeightMm must be smaller than labelHeightMm");
  }

  const usedWidth =
    layout.columns * layout.labelWidthMm +
    (layout.columns - 1) * layout.columnGapMm +
    2 * layout.marginInlineMm;
  const usedHeight =
    layout.rows * layout.labelHeightMm + (layout.rows - 1) * layout.rowGapMm + 2 * layout.marginBlockMm;
  if (usedWidth > PAGE_WIDTH_MM[layout.pageSize] + 0.001) {
    reasons.push(`the grid is ${usedWidth.toFixed(1)}mm wide — wider than the ${layout.pageSize} page`);
  }
  if (usedHeight > PAGE_HEIGHT_MM[layout.pageSize] + 0.001) {
    reasons.push(`the grid is ${usedHeight.toFixed(1)}mm tall — taller than the ${layout.pageSize} page`);
  }
  return reasons;
}

function materialize(command: CreateLabelLayoutCommand): LabelLayout {
  return {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    pageSize: command.pageSize ?? "A4",
    columns: command.columns,
    rows: command.rows,
    labelWidthMm: command.labelWidthMm,
    labelHeightMm: command.labelHeightMm,
    columnGapMm: command.columnGapMm ?? 0,
    rowGapMm: command.rowGapMm ?? 0,
    marginBlockMm: command.marginBlockMm ?? 0,
    marginInlineMm: command.marginInlineMm ?? 0,
    showItemName: command.showItemName ?? true,
    showItemCode: command.showItemCode ?? true,
    showPrice: command.showPrice ?? true,
    showUnit: command.showUnit ?? false,
    showBarcode: command.showBarcode ?? true,
    showBarcodeText: command.showBarcodeText ?? true,
    barcodeHeightMm: command.barcodeHeightMm ?? 10,
    active: command.active ?? true,
  };
}

export async function createLabelLayout(
  command: CreateLabelLayoutCommand,
  repo: LabelLayoutRepository,
): Promise<LabelLayout> {
  const layout = materialize(command);
  const reasons = validate(layout);
  if (reasons.length > 0) throw new InvalidLabelLayoutError(reasons);
  if (await repo.findByCode(layout.code)) throw new DuplicateLabelLayoutCodeError(layout.code);
  await repo.insert(layout);
  return layout;
}

/** Applies a patch to an existing layout. `code` is immutable after creation. */
export async function updateLabelLayout(
  id: string,
  patch: UpdateLabelLayoutCommand,
  repo: LabelLayoutRepository,
): Promise<LabelLayout> {
  const current = await repo.findById(id);
  if (!current) throw new LabelLayoutNotFoundError(id);
  const next: LabelLayout = {
    ...current,
    pageSize: patch.pageSize ?? current.pageSize,
    nameAr: patch.nameAr ?? current.nameAr,
    columns: patch.columns ?? current.columns,
    rows: patch.rows ?? current.rows,
    labelWidthMm: patch.labelWidthMm ?? current.labelWidthMm,
    labelHeightMm: patch.labelHeightMm ?? current.labelHeightMm,
    columnGapMm: patch.columnGapMm ?? current.columnGapMm,
    rowGapMm: patch.rowGapMm ?? current.rowGapMm,
    marginBlockMm: patch.marginBlockMm ?? current.marginBlockMm,
    marginInlineMm: patch.marginInlineMm ?? current.marginInlineMm,
    showItemName: patch.showItemName ?? current.showItemName,
    showItemCode: patch.showItemCode ?? current.showItemCode,
    showPrice: patch.showPrice ?? current.showPrice,
    showUnit: patch.showUnit ?? current.showUnit,
    showBarcode: patch.showBarcode ?? current.showBarcode,
    showBarcodeText: patch.showBarcodeText ?? current.showBarcodeText,
    barcodeHeightMm: patch.barcodeHeightMm ?? current.barcodeHeightMm,
    active: patch.active ?? current.active,
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidLabelLayoutError(reasons);
  await repo.save(next);
  return next;
}

export async function deleteLabelLayout(id: string, repo: LabelLayoutRepository): Promise<void> {
  const layout = await repo.findById(id);
  if (!layout) throw new LabelLayoutNotFoundError(id);
  await repo.delete(id);
}

/** Labels one page of this layout holds. */
export function labelsPerPage(layout: LabelLayout): number {
  return layout.columns * layout.rows;
}
