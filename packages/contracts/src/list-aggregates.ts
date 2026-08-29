import { z } from "zod";

/**
 * The two companion endpoints every list resource carries alongside its rows:
 * `<resource>/counts` for the status chips and `<resource>/stats` for the KPI
 * strip (docs/archive/reference-parity/REQUIREMENTS.md R1.1).
 *
 * Both are computed server-side over the WHOLE filtered set. Deriving them
 * from the rows the client happens to hold makes them wrong the moment the
 * list paginates, and summing money in the browser makes them wrong straight
 * away — a JS number cannot hold this ledger's scale without drifting.
 *
 * `counts` deliberately ignores the caller's status filter: a chip states how
 * many rows it WOULD show, so counting the already-filtered set would render
 * every chip except the active one as zero.
 */
export const listCountsSchema = z.record(z.string(), z.number());

/** Money totals arrive as scale-1e-6 decimal strings, like every other figure. */
export const listStatsSchema = z.record(z.string(), z.union([z.number(), z.string()]));

export type ListCountsDTO = z.infer<typeof listCountsSchema>;
export type ListStatsDTO = z.infer<typeof listStatsSchema>;
