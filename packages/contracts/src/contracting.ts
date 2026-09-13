import { z } from "zod";

/**
 * فئة التكلفة — the second contracting dimension beside `projectId`
 * (docs/artifacts/mezan-contracting-designs.html D-01). Mirrors
 * `@mezan/domain`'s `CostCategory`; the contracts package cannot import the
 * domain, so the two lists are kept identical by hand.
 */
export const costCategorySchema = z.enum(["materials", "labour", "equipment", "subcontract", "indirect"]);

export type CostCategoryDTO = z.infer<typeof costCategorySchema>;

/** ربحية المشاريع — one row of the project P&L, grouped by project and cost category. */
export const projectPnLRowSchema = z.object({
  projectId: z.string().min(1),
  code: z.string(),
  name: z.string(),
  budget: z.string(),
  revenue: z.string(),
  cost: z.string(),
  costByCategory: z.object({
    materials: z.string(),
    labour: z.string(),
    equipment: z.string(),
    subcontract: z.string(),
    indirect: z.string(),
    uncategorised: z.string(),
  }),
  margin: z.string(),
  budgetRemaining: z.string(),
});

export const projectPnLReportSchema = z.object({
  rows: z.array(projectPnLRowSchema),
  totals: z.object({
    revenue: z.string(),
    cost: z.string(),
    margin: z.string(),
  }),
});

export type ProjectPnLRowDTO = z.infer<typeof projectPnLRowSchema>;
export type ProjectPnLReportDTO = z.infer<typeof projectPnLReportSchema>;
