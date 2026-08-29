import { z } from "zod";

/** Wire contract for the Cost Center P&L report (docs/archive/catalog/04 "أرباح مراكز التكلفة"). */
export const costCenterPnLRowSchema = z.object({
  costCenterId: z.string().nullable(),
  code: z.string(),
  name: z.string(),
  revenue: z.string(),
  expense: z.string(),
  profit: z.string(),
});

export const costCenterPnLReportSchema = z.object({
  rows: z.array(costCenterPnLRowSchema),
  totals: z.object({
    revenue: z.string(),
    expense: z.string(),
    profit: z.string(),
  }),
});

export type CostCenterPnLRowDTO = z.infer<typeof costCenterPnLRowSchema>;
export type CostCenterPnLReportDTO = z.infer<typeof costCenterPnLReportSchema>;
