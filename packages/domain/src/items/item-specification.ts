import type { BilingualReason } from "../collections/errors.js";
import {
  DuplicateItemSpecificationCodeError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  ItemSpecificationNotFoundError,
} from "./errors.js";
import type { ItemCatalogStatus } from "./item-catalog.js";

/**
 * المواصفات — a reusable specification/attribute registry over the item
 * catalog, alongside وحدة القياس and تصنيفات الأصناف. A specification is either
 * a select list (a closed set of allowed values, e.g. اللون → احمر، اخضر), a
 * number (with an optional unit label, e.g. الوزن → كجم) or free text.
 * `filterable` marks the ones the catalog exposes as a filter facet. A tenant
 * defines its own; nothing is seeded, so an empty registry is a real, correct
 * state.
 *
 * Identity is the uppercase `code`, matching `ItemUnit` — a product template's
 * attribute stores that code, so it is the value everything else points at.
 */

export type ItemSpecificationType = "select" | "number" | "text";

export const ITEM_SPECIFICATION_TYPES: readonly ItemSpecificationType[] = ["select", "number", "text"];

export interface ItemSpecification {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: ItemSpecificationType;
  /** Allowed values — `select` only; always empty for `number`/`text`. */
  readonly values: readonly string[];
  /** Unit label — `number` only (e.g. "كجم"); always null for `select`/`text`. */
  readonly unit: string | null;
  readonly filterable: boolean;
  readonly status: ItemCatalogStatus;
}

export interface ItemSpecificationRepository {
  findByCode(code: string): Promise<ItemSpecification | null>;
  list(): Promise<ItemSpecification[]>;
  create(specification: ItemSpecification): Promise<void>;
  update(specification: ItemSpecification): Promise<void>;
  delete(code: string): Promise<void>;
}

/**
 * How many records bind to a specification code — the registry's الاستخدام
 * column, and the guard on delete. Kept as a port so `items/` never has to
 * reach into the modules that consume specifications.
 */
export interface ItemSpecificationUsageCounter {
  count(specificationCode: string): Promise<number>;
}

export interface CreateItemSpecificationCommand {
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type: ItemSpecificationType;
  readonly values?: readonly string[];
  readonly unit?: string | null;
  readonly filterable?: boolean;
}

export interface UpdateItemSpecificationCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly values?: readonly string[];
  readonly unit?: string | null;
  readonly filterable?: boolean;
  readonly status?: ItemCatalogStatus;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

function normalizeValues(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value !== "");
}

function normalizeUnit(unit: string | null | undefined): string | null {
  if (unit === undefined || unit === null) return null;
  const trimmed = unit.trim();
  return trimmed === "" ? null : trimmed;
}

const SPECIFICATION_TYPE_LABELS_AR: Readonly<Record<ItemSpecificationType, string>> = {
  select: "قائمة اختيار",
  number: "رقم",
  text: "نص",
};

function collectErrors(specification: ItemSpecification): BilingualReason[] {
  const reasons: BilingualReason[] = [];
  if (!CODE_PATTERN.test(specification.code)) {
    reasons.push({
      ar: "الكود يجب أن يتكون من 1 إلى 20 حرفًا/رقمًا إنجليزيًا كبيرًا أو -/_",
      en: "The code must be 1 to 20 uppercase English letters, digits, hyphens or underscores",
    });
  }
  if (specification.nameAr.trim() === "") reasons.push({ ar: "اسم المواصفة بالعربية مطلوب", en: "The Arabic specification name is required" });

  if (specification.type === "select") {
    if (specification.values.length === 0) {
      reasons.push({
        ar: "مواصفة من نوع قائمة اختيار تحتاج قيمة واحدة مسموحة على الأقل",
        en: "A select-list specification needs at least one allowed value",
      });
    }
    if (new Set(specification.values).size !== specification.values.length) {
      reasons.push({ ar: "القيم المسموحة يجب أن تكون فريدة", en: "The allowed values must be unique" });
    }
    if (specification.unit !== null) reasons.push({ ar: "مواصفة من نوع قائمة اختيار لا يمكن أن تحمل وحدة قياس", en: "A select-list specification cannot carry a unit of measure" });
  } else {
    if (specification.values.length > 0) {
      reasons.push({
        ar: `مواصفة من نوع "${SPECIFICATION_TYPE_LABELS_AR[specification.type]}" لا يمكن أن تحمل قيمًا مسموحة`,
        en: `A ${specification.type} specification cannot carry allowed values`,
      });
    }
    if (specification.type === "text" && specification.unit !== null) {
      reasons.push({ ar: "مواصفة من نوع نص لا يمكن أن تحمل وحدة قياس", en: "A text specification cannot carry a unit of measure" });
    }
  }
  return reasons;
}

function build(
  identity: Pick<ItemSpecification, "code" | "type">,
  fields: {
    nameAr: string;
    nameEn: string | null;
    values: readonly string[] | undefined;
    unit: string | null | undefined;
    filterable: boolean;
    status: ItemCatalogStatus;
  },
): ItemSpecification {
  return {
    code: identity.code,
    nameAr: fields.nameAr.trim(),
    nameEn: fields.nameEn,
    type: identity.type,
    values: normalizeValues(fields.values),
    unit: normalizeUnit(fields.unit),
    filterable: fields.filterable,
    status: fields.status,
  };
}

export async function createItemSpecification(
  command: CreateItemSpecificationCommand,
  repo: ItemSpecificationRepository,
): Promise<ItemSpecification> {
  const specification = build(
    { code: command.code.toUpperCase(), type: command.type },
    {
      nameAr: command.nameAr,
      nameEn: command.nameEn ?? null,
      values: command.values,
      unit: command.unit,
      filterable: command.filterable ?? false,
      status: "active",
    },
  );
  const reasons = collectErrors(specification);
  if (reasons.length > 0) throw new InvalidItemSpecificationError(reasons);
  if (await repo.findByCode(specification.code)) {
    throw new DuplicateItemSpecificationCodeError(specification.code);
  }
  await repo.create(specification);
  return specification;
}

/** Applies a patch. `code` and `type` are immutable — product templates bind to both. */
export async function updateItemSpecification(
  code: string,
  command: UpdateItemSpecificationCommand,
  repo: ItemSpecificationRepository,
): Promise<ItemSpecification> {
  const current = await repo.findByCode(code);
  if (!current) throw new ItemSpecificationNotFoundError(code);
  const next = build(
    { code: current.code, type: current.type },
    {
      nameAr: command.nameAr ?? current.nameAr,
      nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
      values: command.values ?? current.values,
      unit: command.unit !== undefined ? command.unit : current.unit,
      filterable: command.filterable ?? current.filterable,
      status: command.status ?? current.status,
    },
  );
  const reasons = collectErrors(next);
  if (reasons.length > 0) throw new InvalidItemSpecificationError(reasons);
  await repo.update(next);
  return next;
}

/** Deletes a specification nothing binds to. */
export async function deleteItemSpecification(
  code: string,
  repo: ItemSpecificationRepository,
  usage: ItemSpecificationUsageCounter,
): Promise<void> {
  const specification = await repo.findByCode(code);
  if (!specification) throw new ItemSpecificationNotFoundError(code);
  const count = await usage.count(specification.code);
  if (count > 0) throw new ItemSpecificationInUseError(specification.code, count);
  await repo.delete(specification.code);
}
