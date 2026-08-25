import { z } from "zod";

/** Wire contract for a numbering sequence definition (settings + admin API). */
export const sequenceDefinitionSchema = z.object({
  code: z.string().min(1),
  labelAr: z.string().min(1),
  prefix: z.string(),
  suffix: z.string().optional(),
  padLength: z.number().int().positive(),
  annualReset: z.boolean(),
  /** Each branch keeps its own counter and carries its code in the number. */
  branchScoped: z.boolean().optional(),
});

/** Request to allocate the next number for a document type. */
export const nextNumberRequestSchema = z.object({
  code: z.string().min(1),
  year: z.number().int().optional(),
});

/** Response carrying the allocated counter value and its formatted number. */
export const nextNumberResponseSchema = z.object({
  code: z.string().min(1),
  value: z.number().int().nonnegative(),
  formatted: z.string().min(1),
});

export type SequenceDefinitionDTO = z.infer<typeof sequenceDefinitionSchema>;
export type NextNumberRequestDTO = z.infer<typeof nextNumberRequestSchema>;
export type NextNumberResponseDTO = z.infer<typeof nextNumberResponseSchema>;

/**
 * Admin-editable subset of a sequence (`PATCH /sequences/:code`) — prefix,
 * pad length, annual-reset flag. The counter value is deliberately absent:
 * it is read-only here, guarded separately by `resetSequenceCounterSchema`.
 */
export const sequenceOverrideSchema = z
  .object({
    prefix: z.string().max(20).optional(),
    padLength: z.number().int().positive().max(12).optional(),
    annualReset: z.boolean().optional(),
    branchScoped: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.prefix !== undefined ||
      v.padLength !== undefined ||
      v.annualReset !== undefined ||
      v.branchScoped !== undefined,
    { message: "At least one field (prefix, padLength, annualReset, branchScoped) must be provided" },
  );

/** One row of `/settings/sequences` — the effective definition plus its live counter state. */
export const sequenceListItemSchema = z.object({
  code: z.string().min(1),
  labelAr: z.string().min(1),
  prefix: z.string(),
  suffix: z.string().optional(),
  padLength: z.number().int().positive(),
  annualReset: z.boolean(),
  /** Whether each branch keeps its own counter and carries its code in the number. */
  branchScoped: z.boolean().optional(),
  /** Current allocated counter value for the active period — read-only, never incremented by this read. */
  currentValue: z.number().int().nonnegative(),
  /** Preview of the NEXT document number, computed from currentValue + 1 without allocating it. */
  nextNumber: z.string().min(1),
  /** Whether an admin override (prefix/padLength/annualReset) is applied on top of the compiled-in default. */
  isOverridden: z.boolean(),
});

export const sequenceListResponseSchema = z.array(sequenceListItemSchema);

/**
 * Explicit, guarded counter adjustment (`POST /sequences/:code/counter`,
 * `admin.sequences.reset`). `confirm: true` is required so the call can never
 * be a stray click; the API additionally refuses any value below the current
 * counter (that direction risks issuing a document number twice).
 */
export const resetSequenceCounterSchema = z.object({
  value: z.number().int().nonnegative(),
  confirm: z.literal(true),
});

export type SequenceOverrideDTO = z.infer<typeof sequenceOverrideSchema>;
export type SequenceListItemDTO = z.infer<typeof sequenceListItemSchema>;
export type ResetSequenceCounterDTO = z.infer<typeof resetSequenceCounterSchema>;
