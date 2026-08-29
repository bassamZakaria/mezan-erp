import { assertValidPriceListShape, type PriceList, type PriceListLine } from "./price-list.js";
import type { PriceListRepository } from "./ports.js";
import { DuplicatePriceListError } from "./errors.js";

export interface CreatePriceListCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly description?: string | null;
  readonly isBase?: boolean;
  readonly lines?: readonly PriceListLine[];
}

/**
 * Validates a new-price-list command against the existing list (docs/archive/catalog/01
 * "قوائم الأسعار"): the code must be unique and the shape must pass
 * `assertValidPriceListShape`.
 */
export function validateNewPriceList(command: CreatePriceListCommand, existing: readonly PriceList[]): void {
  if (existing.some((pl) => pl.code === command.code)) {
    throw new DuplicatePriceListError(command.code);
  }
  assertValidPriceListShape(command.nameAr, command.lines ?? []);
}

/**
 * Creates and persists a new price list. New lists always start `active`.
 * `Money` values are supplied directly on `lines` — parsing wire strings into
 * `Money` is the API layer's job, not the domain's.
 */
export async function createPriceList(command: CreatePriceListCommand, repo: PriceListRepository): Promise<PriceList> {
  const existing = await repo.list();
  validateNewPriceList(command, existing);

  const priceList: PriceList = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    description: command.description ?? null,
    isBase: command.isBase ?? false,
    active: true,
    lines: command.lines ?? [],
    createdAt: new Date().toISOString(),
  };

  await repo.save(priceList);
  return priceList;
}
