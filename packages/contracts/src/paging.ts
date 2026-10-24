import { z } from "zod";

/**
 * The page every list query carries.
 *
 * WHY THERE IS A DEFAULT. An omitted `pageSize` used to mean "everything", and
 * 58 of 66 route files never mentioned `LIMIT` — `GET /gl/journal-entries`
 * answered with every entry ever posted, and five busy screens fetched the
 * whole table and sliced it in the browser (Q-8/Q-9). A default is what makes
 * the unbounded read impossible to reach by omission rather than merely
 * discouraged.
 *
 * The ceiling is compiled in, never read from the request beyond this cap: a
 * limit the caller supplies is not a limit.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

export const pageQuerySchema = z.object({
  /** 1-based. */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageQueryDTO = z.infer<typeof pageQuerySchema>;

export const reportPageSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalRows: z.number().int().nonnegative(),
});

export type ReportPageDTO = z.infer<typeof reportPageSchema>;

/** `{ limit, offset }` for a repository, from a 1-based page. */
export function pageWindow(page: PageQueryDTO): { limit: number; offset: number } {
  return { limit: page.pageSize, offset: (page.page - 1) * page.pageSize };
}
