import { assertValidPriceListShape, type PriceList, type PriceListLine } from "./price-list.js";
import type { PriceListRepository } from "./ports.js";
import { PriceListNotFoundError } from "./errors.js";

export interface UpdatePriceListCommand {
  readonly code?: string;
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly description?: string | null;
  readonly isBase?: boolean;
  readonly active?: boolean;
  readonly lines?: readonly PriceListLine[];
}

/**
 * Edits an existing price list (docs/archive/catalog/01 "قوائم الأسعار"). Re-validates
 * the shape (name, duplicate lines, non-negative prices) whenever `nameAr` or
 * `lines` are part of the patch.
 */
export async function updatePriceList(
  priceListId: string,
  command: UpdatePriceListCommand,
  repo: PriceListRepository,
): Promise<PriceList> {
  const current = await repo.findById(priceListId);
  if (!current) throw new PriceListNotFoundError(priceListId);

  const nextNameAr = command.nameAr ?? current.nameAr;
  const nextLines = command.lines ?? current.lines;
  assertValidPriceListShape(nextNameAr, nextLines);

  const updated: PriceList = {
    ...current,
    code: command.code ?? current.code,
    nameAr: nextNameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    description: command.description !== undefined ? command.description : current.description,
    isBase: command.isBase ?? current.isBase,
    active: command.active ?? current.active,
    lines: nextLines,
  };

  await repo.update(updated);
  return updated;
}
