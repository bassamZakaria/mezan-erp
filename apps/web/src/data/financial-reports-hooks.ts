import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReportGroupResult, ReportReconciliationResult } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";

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

interface ServerValidationError {
  readonly field?: string;
  readonly message?: string;
}

/**
 * The report routes reject a bad parameter with
 * `{ error, errors: [{ field, message }] }`. Discarding that body left the user
 * staring at an unchanged empty report with no idea the server had refused it.
 */
async function readFieldErrors(res: { json<T>(): Promise<T> }): Promise<Record<string, string> | undefined> {
  const body = await res
    .json<{ errors?: readonly ServerValidationError[]; message?: string }>()
    .catch(() => ({}) as { errors?: readonly ServerValidationError[]; message?: string });
  const byField: Record<string, string> = {};
  for (const e of body.errors ?? []) {
    if (!e.message) continue;
    const key = e.field || "_root";
    byField[key] = byField[key] ? `${byField[key]} ${e.message}` : e.message;
  }
  // Routes outside the report engine reject with a bare `message` and no field.
  if (Object.keys(byField).length === 0 && body.message) byField._root = body.message;
  return Object.keys(byField).length > 0 ? byField : undefined;
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
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل القائمة المالية.", await readFieldErrors(res));
      return res.json<FinancialReportResult<Row>>();
    },
  });
}
