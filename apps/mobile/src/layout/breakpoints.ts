/**
 * Width breakpoints are Google's published window size classes — compact below
 * 600dp, medium from 600dp, expanded from 840dp — because they are the same
 * numbers Play's large-screen quality checks are written against.
 */
export enum SizeClass {
  Compact = "compact",
  Medium = "medium",
  Expanded = "expanded",
}

export const SIZE_CLASS_MIN_WIDTH: Readonly<Record<SizeClass, number>> = {
  [SizeClass.Compact]: 0,
  [SizeClass.Medium]: 600,
  [SizeClass.Expanded]: 840,
};

export function sizeClassFor(width: number): SizeClass {
  if (width >= SIZE_CLASS_MIN_WIDTH[SizeClass.Expanded]) return SizeClass.Expanded;
  if (width >= SIZE_CLASS_MIN_WIDTH[SizeClass.Medium]) return SizeClass.Medium;
  return SizeClass.Compact;
}

/**
 * A list keeps a detail pane beside it only in the expanded class. At medium —
 * a phone in landscape, or a small tablet in portrait — 600dp split in two
 * leaves two columns too narrow to read a customer name and an amount in.
 */
export function isSplit(sizeClass: SizeClass): boolean {
  return sizeClass === SizeClass.Expanded;
}

export const FORM_MAX_WIDTH = 640;
export const SPLIT_LIST_MAX_WIDTH = 420;

export const TILE_BASIS: Readonly<Record<SizeClass, `${number}%`>> = {
  [SizeClass.Compact]: "45%",
  [SizeClass.Medium]: "30%",
  [SizeClass.Expanded]: "22%",
};
