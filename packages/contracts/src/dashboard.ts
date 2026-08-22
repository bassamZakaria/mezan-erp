import { z } from "zod";

/**
 * لوحة التحكم (Dashboard) over-the-wire shapes — the response of
 * `GET /dashboard/summary`, computed server-side from real persisted data
 * (posted GL journal entries + the account/customer/supplier/item repos).
 * Money figures travel as decimal strings (byte-stable, same convention as
 * the GL routes); counts are plain integers. An empty tenant yields zeros and
 * empty arrays — never fabricated numbers.
 */

/** One entity-count tile source (accounts, customers, suppliers, items, users, journal entries). */
export const dashboardCountsSchema = z.object({
  accounts: z.number().int().nonnegative(),
  customers: z.number().int().nonnegative(),
  suppliers: z.number().int().nonnegative(),
  items: z.number().int().nonnegative(),
  users: z.number().int().nonnegative(),
  journalEntries: z.number().int().nonnegative(),
});

/** GL-derived money figures (decimal strings). All zero on a tenant with no posted entries. */
export const dashboardGlSchema = z.object({
  revenue: z.string(),
  expenses: z.string(),
  netProfit: z.string(),
  cash: z.string(),
  receivables: z.string(),
  payables: z.string(),
  inventoryValue: z.string(),
});

/** One recent-activity row, derived from the latest posted journal entries. */
export const dashboardActivitySchema = z.object({
  id: z.string(),
  entryNo: z.string().nullable(),
  date: z.string(),
  memo: z.string(),
});

export const dashboardSummarySchema = z.object({
  generatedAt: z.string(),
  counts: dashboardCountsSchema,
  gl: dashboardGlSchema,
  recentActivity: z.array(dashboardActivitySchema),
});

export type DashboardCountsDTO = z.infer<typeof dashboardCountsSchema>;
export type DashboardGlDTO = z.infer<typeof dashboardGlSchema>;
export type DashboardActivityDTO = z.infer<typeof dashboardActivitySchema>;
export type DashboardSummaryDTO = z.infer<typeof dashboardSummarySchema>;
