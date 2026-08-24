import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReportGroupResult, ReportReconciliationResult } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
import { readReportFieldErrors } from "./report-errors";

/**
 * القوائم المالية data hook (docs/catalog/08-reports.md) — the seven
 * financial-statement screens' counterpart to `./reports-hooks.ts`. Same
 * shape, different server mount: it hits `/financial-reports${path}`, which
 * computes each statement over the live posted general ledger (never a
 * fixture) and returns the report engine's `RunReportOutcome` envelope
 * verbatim (see `packages/api/src/financial-reports-routes.ts`).
 */

export interface FinancialReportResult<Row> {
  readonly rows: readonly Row[];
  readonly groups: readonly ReportGroupResult<Row>[];
  readonly grandTotals: Readonly<Record<string, number>>;
  readonly reconciliation: ReportReconciliationResult | null;
}

/** Blank param values are dropped so the server falls back to the report's own defaults. */
function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function useFinancialReport<Row>(
  reportId: string,
  apiPath: string,
  params: Record<string, string>,
  options: { readonly enabled?: boolean } = {},
): UseQueryResult<FinancialReportResult<Row>, ApiError> {
  const { request, session } = useApi();
  return useQuery<FinancialReportResult<Row>, ApiError>({
    queryKey: ["financial-reports", reportId, params],
    enabled: session !== null && (options.enabled ?? true),
    queryFn: async () => {
      const res = await request(`/financial-reports${apiPath}${toQueryString(params)}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل القائمة المالية.", await readReportFieldErrors(res));
      return res.json<FinancialReportResult<Row>>();
    },
  });
}
