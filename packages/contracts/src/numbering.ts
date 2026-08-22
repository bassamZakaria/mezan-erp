import { z } from "zod";

/** Wire contract for a numbering sequence definition (settings + admin API). */
export const sequenceDefinitionSchema = z.object({
  code: z.string().min(1),
  labelAr: z.string().min(1),
  prefix: z.string(),
  suffix: z.string().optional(),
  padLength: z.number().int().positive(),
  annualReset: z.boolean(),
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
