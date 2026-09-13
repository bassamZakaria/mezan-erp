import { z } from "zod";

/**
 * فئة التكلفة — the second contracting dimension beside `projectId`
 * (docs/artifacts/mezan-contracting-designs.html D-01). Mirrors
 * `@mezan/domain`'s `CostCategory`; the contracts package cannot import the
 * domain, so the two lists are kept identical by hand.
 */
export const costCategorySchema = z.enum(["materials", "labour", "equipment", "subcontract", "indirect"]);

export type CostCategoryDTO = z.infer<typeof costCategorySchema>;
