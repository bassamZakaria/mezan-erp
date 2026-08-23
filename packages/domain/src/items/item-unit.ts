import {
  DuplicateItemUnitCodeError,
  InvalidItemUnitError,
  ItemUnitInUseError,
  ItemUnitNotFoundError,
} from "./errors.js";
import type { ItemRepository } from "./item.js";

/**
 * Unit of measure (docs/catalog/03-inventory.md "وحدات القياس"). A unit is
 * either a base unit (`baseUnitCode === null`, `factor === 1`) or an alternate
 * unit expressed against a base unit — "1 كرتونة = 12 قطعة" is
 * `{ code: "CTN", baseUnitCode: "PCS", factor: 12 }`.
 */
export interface ItemUnit {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly baseUnitCode: string | null;
  /** 1 of this unit = `factor` base units. Always 1 for a base unit. */
  readonly factor: number;
  readonly active: boolean;
}

export interface ItemUnitRepository {
  list(): Promise<ItemUnit[]>;
  findById(id: string): Promise<ItemUnit | null>;
  findByCode(code: string): Promise<ItemUnit | null>;
  save(unit: ItemUnit): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CreateItemUnitCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly baseUnitCode?: string | null;
  readonly factor?: number;
  readonly active?: boolean;
}

export interface UpdateItemUnitCommand {
  readonly nameAr?: string;
  readonly baseUnitCode?: string | null;
  readonly factor?: number;
  readonly active?: boolean;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

function validate(unit: ItemUnit): string[] {
  const reasons: string[] = [];
  if (unit.id.trim() === "") reasons.push("id is required");
  if (!CODE_PATTERN.test(unit.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (unit.nameAr.trim() === "") reasons.push("nameAr is required");
  if (!Number.isFinite(unit.factor) || unit.factor <= 0) {
    reasons.push("factor must be a positive finite number");
  }
  if (unit.baseUnitCode === null) {
    if (unit.factor !== 1) reasons.push("a base unit must have factor 1");
  } else {
    if (unit.baseUnitCode.trim() === "") reasons.push("baseUnitCode must not be blank");
    if (unit.baseUnitCode === unit.code) reasons.push("a unit cannot convert into itself");
  }
  return reasons;
}

function normalize(unit: ItemUnit): ItemUnit {
  return { ...unit, factor: unit.baseUnitCode === null ? 1 : unit.factor };
}

async function assertBaseUnitResolves(unit: ItemUnit, repo: ItemUnitRepository): Promise<void> {
  if (unit.baseUnitCode === null) return;
  const base = await repo.findByCode(unit.baseUnitCode);
  if (!base) throw new InvalidItemUnitError([`base unit "${unit.baseUnitCode}" does not exist`]);
  if (base.baseUnitCode !== null) {
    throw new InvalidItemUnitError([`base unit "${unit.baseUnitCode}" is itself an alternate unit`]);
  }
}

export async function createItemUnit(command: CreateItemUnitCommand, repo: ItemUnitRepository): Promise<ItemUnit> {
  const unit = normalize({
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    baseUnitCode: command.baseUnitCode ?? null,
    factor: command.factor ?? 1,
    active: command.active ?? true,
  });
  const reasons = validate(unit);
  if (reasons.length > 0) throw new InvalidItemUnitError(reasons);
  if (await repo.findByCode(unit.code)) throw new DuplicateItemUnitCodeError(unit.code);
  await assertBaseUnitResolves(unit, repo);
  await repo.save(unit);
  return unit;
}

/** Applies a patch to an existing unit. `code` is immutable — items reference units by code. */
export async function updateItemUnit(
  id: string,
  patch: UpdateItemUnitCommand,
  repo: ItemUnitRepository,
): Promise<ItemUnit> {
  const current = await repo.findById(id);
  if (!current) throw new ItemUnitNotFoundError(id);
  const next = normalize({
    ...current,
    nameAr: patch.nameAr ?? current.nameAr,
    baseUnitCode: patch.baseUnitCode === undefined ? current.baseUnitCode : patch.baseUnitCode,
    factor: patch.factor ?? current.factor,
    active: patch.active ?? current.active,
  });
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidItemUnitError(reasons);
  if (next.baseUnitCode !== current.baseUnitCode) await assertBaseUnitResolves(next, repo);
  await repo.save(next);
  return next;
}

/**
 * Deletes a unit that nothing references. A unit is "in use" when an item
 * uses it as its base or alternate unit, or another unit converts into it.
 */
export async function deleteItemUnit(id: string, repo: ItemUnitRepository, items: ItemRepository): Promise<void> {
  const unit = await repo.findById(id);
  if (!unit) throw new ItemUnitNotFoundError(id);

  const all = await items.list();
  const usedByItems = all.filter(
    (item) => item.baseUnitCode === unit.code || item.alternateUnits.some((alt) => alt.code === unit.code),
  ).length;
  const usedByUnits = (await repo.list()).filter((other) => other.baseUnitCode === unit.code).length;
  if (usedByItems + usedByUnits > 0) {
    throw new ItemUnitInUseError(unit.code, usedByItems + usedByUnits);
  }

  await repo.delete(id);
}
