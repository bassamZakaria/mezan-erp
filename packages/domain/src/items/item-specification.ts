import {
  DuplicateItemSpecificationCodeError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  ItemSpecificationNotFoundError,
} from "./product-catalog-errors.js";
import type { ProductTemplateRepository } from "./product-template.js";

/**
 * المواصفات — a reusable specification/attribute registry over the catalog.
 * A specification is either a select list (a closed set of allowed values, e.g.
 * اللون → احمر، اخضر), a number (with an optional unit label, e.g. الوزن → كجم)
 * or free text. `filterable` marks the ones the catalog exposes as a filter
 * facet. A tenant defines its own; nothing is seeded, so an empty registry is
 * a real, correct state.
 */
export type ItemSpecificationType = "select" | "number" | "text";

export interface ItemSpecification {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly type: ItemSpecificationType;
  /** Allowed values — `select` only; always empty for `number`/`text`. */
  readonly values: readonly string[];
  /** Unit label — `number` only (e.g. "كجم"); always null for `select`/`text`. */
  readonly unit: string | null;
  readonly filterable: boolean;
  readonly active: boolean;
}

export interface ItemSpecificationRepository {
  list(): Promise<ItemSpecification[]>;
  findById(id: string): Promise<ItemSpecification | null>;
  findByCode(code: string): Promise<ItemSpecification | null>;
  save(specification: ItemSpecification): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CreateItemSpecificationCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly type: ItemSpecificationType;
  readonly values?: readonly string[];
  readonly unit?: string | null;
  readonly filterable?: boolean;
  readonly active?: boolean;
}

export interface UpdateItemSpecificationCommand {
  readonly nameAr?: string;
  readonly values?: readonly string[];
  readonly unit?: string | null;
  readonly filterable?: boolean;
  readonly active?: boolean;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

function normalizeValues(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter((v) => v !== "");
}

function validate(specification: ItemSpecification): string[] {
  const reasons: string[] = [];
  if (specification.id.trim() === "") reasons.push("id is required");
  if (!CODE_PATTERN.test(specification.code)) {
    reasons.push("code must be 1-20 uppercase alphanumeric/-/_ characters");
  }
  if (specification.nameAr.trim() === "") reasons.push("nameAr is required");

  if (specification.type === "select") {
    if (specification.values.length === 0) {
      reasons.push("a select-list specification needs at least one allowed value");
    }
    if (new Set(specification.values).size !== specification.values.length) {
      reasons.push("allowed values must be unique");
    }
    if (specification.unit !== null) reasons.push("a select-list specification cannot carry a unit");
  } else {
    if (specification.values.length > 0) {
      reasons.push(`a ${specification.type} specification cannot carry allowed values`);
    }
    if (specification.type === "text" && specification.unit !== null) {
      reasons.push("a text specification cannot carry a unit");
    }
  }
  return reasons;
}

function build(
  base: Pick<ItemSpecification, "id" | "code" | "type">,
  fields: {
    nameAr: string;
    values: readonly string[] | undefined;
    unit: string | null | undefined;
    filterable: boolean | undefined;
    active: boolean | undefined;
  },
): ItemSpecification {
  const unit = fields.unit === undefined || fields.unit === null ? null : fields.unit.trim();
  return {
    id: base.id,
    code: base.code,
    nameAr: fields.nameAr.trim(),
    type: base.type,
    values: normalizeValues(fields.values),
    unit: unit === "" ? null : unit,
    filterable: fields.filterable ?? false,
    active: fields.active ?? true,
  };
}

export async function createItemSpecification(
  command: CreateItemSpecificationCommand,
  repo: ItemSpecificationRepository,
): Promise<ItemSpecification> {
  const specification = build(
    { id: command.id, code: command.code, type: command.type },
    {
      nameAr: command.nameAr,
      values: command.values,
      unit: command.unit,
      filterable: command.filterable,
      active: command.active,
    },
  );
  const reasons = validate(specification);
  if (reasons.length > 0) throw new InvalidItemSpecificationError(reasons);
  if (await repo.findByCode(specification.code)) {
    throw new DuplicateItemSpecificationCodeError(specification.code);
  }
  await repo.save(specification);
  return specification;
}

/** Applies a patch. `code` and `type` are immutable — templates bind to both. */
export async function updateItemSpecification(
  id: string,
  patch: UpdateItemSpecificationCommand,
  repo: ItemSpecificationRepository,
): Promise<ItemSpecification> {
  const current = await repo.findById(id);
  if (!current) throw new ItemSpecificationNotFoundError(id);
  const next = build(
    { id: current.id, code: current.code, type: current.type },
    {
      nameAr: patch.nameAr ?? current.nameAr,
      values: patch.values ?? current.values,
      unit: patch.unit === undefined ? current.unit : patch.unit,
      filterable: patch.filterable ?? current.filterable,
      active: patch.active ?? current.active,
    },
  );
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidItemSpecificationError(reasons);
  await repo.save(next);
  return next;
}

/** How many product templates pick this specification — the registry's "Usage" column. */
export async function countItemSpecificationUsage(
  specificationId: string,
  templates: ProductTemplateRepository,
): Promise<number> {
  const all = await templates.list();
  return all.filter((t) => t.options.some((o) => o.specificationId === specificationId)).length;
}

/** Deletes a specification no product template picks. */
export async function deleteItemSpecification(
  id: string,
  repo: ItemSpecificationRepository,
  templates: ProductTemplateRepository,
): Promise<void> {
  const specification = await repo.findById(id);
  if (!specification) throw new ItemSpecificationNotFoundError(id);
  const usage = await countItemSpecificationUsage(id, templates);
  if (usage > 0) throw new ItemSpecificationInUseError(specification.code, usage);
  await repo.delete(id);
}
