import {
  AttributeInUseError,
  AttributeNotFoundError,
  AttributeValueInUseError,
  DuplicateAttributeNameError,
  DuplicateAttributeValueError,
  InvalidProductTemplateError,
  ProductTemplateNotFoundError,
} from "./errors.js";
import type {
  ProductTemplate,
  ProductTemplateAttribute,
  ProductTemplateRepository,
  ProductTemplateVariantRepository,
} from "./product-template.js";

/**
 * Attribute CRUD on a Product Template (docs/archive/catalog/03-inventory.md
 * §"قوالب المنتجات" — الخصائص section). Delete of an attribute or a single
 * value is guarded: it's rejected while at least one generated variant still
 * references it, mirroring the reference UI's disabled-delete tooltip
 * ("هذه الخاصية مستخدمة في N متغير — احذف المتغيرات أولاً").
 */

interface TemplateDeps {
  readonly templates: ProductTemplateRepository;
  readonly variants: ProductTemplateVariantRepository;
}

async function loadTemplate(templateId: string, templates: ProductTemplateRepository): Promise<ProductTemplate> {
  const template = await templates.findById(templateId);
  if (!template) throw new ProductTemplateNotFoundError(templateId);
  return template;
}

function findAttribute(template: ProductTemplate, attributeId: string): ProductTemplateAttribute {
  const attr = template.attributes.find((a) => a.id === attributeId);
  if (!attr) throw new AttributeNotFoundError(template.id, attributeId);
  return attr;
}

export interface AddTemplateAttributeCommand {
  readonly templateId: string;
  readonly attributeId: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  /** Ordered, unique value labels. Must be non-empty. */
  readonly values: readonly string[];
  /** المواصفات registry entry this attribute is built from, when it came from the registry. */
  readonly specificationCode?: string | null;
}

export async function addTemplateAttribute(cmd: AddTemplateAttributeCommand, deps: TemplateDeps): Promise<ProductTemplate> {
  const template = await loadTemplate(cmd.templateId, deps.templates);

  if (cmd.nameAr.trim() === "") throw new InvalidProductTemplateError([{ ar: "اسم الخاصية مطلوب", en: "The attribute name is required" }]);
  if (template.attributes.some((a) => a.nameAr === cmd.nameAr)) throw new DuplicateAttributeNameError(cmd.nameAr);

  const trimmedValues = cmd.values.map((v) => v.trim()).filter((v) => v !== "");
  if (trimmedValues.length === 0) throw new InvalidProductTemplateError([{ ar: "يجب إدخال قيمة واحدة على الأقل للخاصية", en: "At least one attribute value is required" }]);
  const uniqueValues = new Set(trimmedValues);
  if (uniqueValues.size !== trimmedValues.length) throw new InvalidProductTemplateError([{ ar: "قيم الخاصية تحتوي على تكرار", en: "The attribute values contain duplicates" }]);

  const attribute: ProductTemplateAttribute = {
    id: cmd.attributeId,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn ?? null,
    values: trimmedValues,
    specificationCode: cmd.specificationCode ?? null,
  };
  const updated: ProductTemplate = { ...template, attributes: [...template.attributes, attribute] };
  await deps.templates.update(updated);
  return updated;
}

export interface AddAttributeValueCommand {
  readonly templateId: string;
  readonly attributeId: string;
  readonly value: string;
}

export async function addAttributeValue(cmd: AddAttributeValueCommand, deps: TemplateDeps): Promise<ProductTemplate> {
  const template = await loadTemplate(cmd.templateId, deps.templates);
  const attribute = findAttribute(template, cmd.attributeId);

  const value = cmd.value.trim();
  if (value === "") throw new InvalidProductTemplateError([{ ar: "قيمة الخاصية مطلوبة", en: "The attribute value is required" }]);
  if (attribute.values.includes(value)) throw new DuplicateAttributeValueError(value);

  const updatedAttribute: ProductTemplateAttribute = { ...attribute, values: [...attribute.values, value] };
  const updated: ProductTemplate = {
    ...template,
    attributes: template.attributes.map((a) => (a.id === attribute.id ? updatedAttribute : a)),
  };
  await deps.templates.update(updated);
  return updated;
}

async function countVariantsUsing(templateId: string, predicate: (values: Readonly<Record<string, string>>) => boolean, deps: TemplateDeps): Promise<number> {
  const variants = await deps.variants.listByTemplate(templateId);
  return variants.filter((v) => predicate(v.values)).length;
}

export interface DeleteTemplateAttributeCommand {
  readonly templateId: string;
  readonly attributeId: string;
}

export async function deleteTemplateAttribute(cmd: DeleteTemplateAttributeCommand, deps: TemplateDeps): Promise<ProductTemplate> {
  const template = await loadTemplate(cmd.templateId, deps.templates);
  findAttribute(template, cmd.attributeId); // throws if unknown

  const inUseCount = await countVariantsUsing(cmd.templateId, (values) => cmd.attributeId in values, deps);
  if (inUseCount > 0) throw new AttributeInUseError(cmd.attributeId, inUseCount);

  const updated: ProductTemplate = { ...template, attributes: template.attributes.filter((a) => a.id !== cmd.attributeId) };
  await deps.templates.update(updated);
  return updated;
}

export interface DeleteAttributeValueCommand {
  readonly templateId: string;
  readonly attributeId: string;
  readonly value: string;
}

export async function deleteAttributeValue(cmd: DeleteAttributeValueCommand, deps: TemplateDeps): Promise<ProductTemplate> {
  const template = await loadTemplate(cmd.templateId, deps.templates);
  const attribute = findAttribute(template, cmd.attributeId);

  const inUseCount = await countVariantsUsing(cmd.templateId, (values) => values[cmd.attributeId] === cmd.value, deps);
  if (inUseCount > 0) throw new AttributeValueInUseError(cmd.attributeId, cmd.value, inUseCount);

  const updatedAttribute: ProductTemplateAttribute = { ...attribute, values: attribute.values.filter((v) => v !== cmd.value) };
  const updated: ProductTemplate = {
    ...template,
    attributes: template.attributes.map((a) => (a.id === attribute.id ? updatedAttribute : a)),
  };
  await deps.templates.update(updated);
  return updated;
}
