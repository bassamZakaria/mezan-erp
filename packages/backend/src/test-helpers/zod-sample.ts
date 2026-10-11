export interface SampledSchema {
  readonly _def: Record<string, any>;
  safeParse(value: unknown): { success: boolean };
  isOptional(): boolean;
  readonly shape?: Record<string, SampledSchema>;
}

const STRING_CANDIDATES = ["2026-01-15", "10.00", "1", "EGP", "09:00", "2026-01", "someone@example.com", "2026-01-15T09:00:00.000Z", "01000000000", "قيمة اختبار", "TEST-VALUE", "12345678901234"];
const NUMBER_CANDIDATES = [1, 0, 14, 100, 2026];

/**
 * A value the schema accepts, built from its shape. `hints` supplies the value
 * for a field by name, so references can point at seeded records.
 */
export function sampleOf(schema: SampledSchema, hints: Readonly<Record<string, unknown>> = {}, key?: string): unknown {
  if (key !== undefined && key in hints && schema.safeParse(hints[key]).success) return hints[key];
  const def = schema._def;
  switch (def.typeName as string) {
    case "ZodString":
      return STRING_CANDIDATES.find((candidate) => schema.safeParse(candidate).success) ?? "";
    case "ZodNumber":
      return NUMBER_CANDIDATES.find((candidate) => schema.safeParse(candidate).success) ?? 1;
    case "ZodBoolean":
      return false;
    case "ZodLiteral":
      return def.value;
    case "ZodEnum":
      return def.values[0];
    case "ZodNativeEnum":
      return Object.values(def.values)[0];
    case "ZodArray":
      return Array.from({ length: Math.max(1, def.minLength?.value ?? 1) }, () => sampleOf(def.type, hints));
    case "ZodObject": {
      const built: Record<string, unknown> = {};
      for (const [field, fieldSchema] of Object.entries(schema.shape ?? {})) {
        if (fieldSchema.isOptional() && !(field in hints)) continue;
        built[field] = sampleOf(fieldSchema, hints, field);
      }
      return built;
    }
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodReadonly":
    case "ZodBranded":
      return sampleOf(def.innerType ?? def.type, hints, key);
    case "ZodEffects":
      return sampleOf(def.schema, hints, key);
    case "ZodPipeline":
      return sampleOf(def.in, hints, key);
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options: SampledSchema[] = Array.isArray(def.options) ? def.options : [...def.options.values()];
      return sampleOf(options[0]!, hints, key);
    }
    case "ZodRecord":
      return {};
    case "ZodLazy":
      return sampleOf(def.getter(), hints, key);
    default:
      return null;
  }
}
