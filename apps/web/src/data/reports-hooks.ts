import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ReportFigure, ReportGroupResult, ReportReconciliationResult, ReportKpiResult } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { ApiError, withSupportCode } from "./hooks";
import { readReportFieldErrors } from "./report-errors";
import { useAppTranslation } from "../i18n";

/**
 * التقارير التشغيلية data hook (docs/archive/catalog/08-reports.md). Every operational-
 * report screen goes through this one query hook: it hits `/reports${path}`
 * over the SAME `useApi().request` transport (with the session's permission
 * headers merged in) that the dashboard uses — so reports read the live seeded
 * backend, never sample data. The server (`@mezan/api` reports-routes) already
 * validated params and ran the report engine; this hook only carries the
 * render-ready outcome back to `<ReportRunner>`.
 */

export interface ReportResult<Row> {
  readonly params?: Readonly<Record<string, unknown>>;
  readonly rows: readonly Row[];
  readonly groups: readonly ReportGroupResult<Row>[];
  readonly grandTotals: Readonly<Record<string, ReportFigure>>;
  readonly reconciliation: ReportReconciliationResult | null;
  /** The summary strip's figures, computed server-side over the whole result (R21.2). */
  readonly kpis?: readonly ReportKpiResult[];
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

export function useReport<Row>(
  reportId: string,
  apiPath: string,
  params: Record<string, string>,
  options: { readonly enabled?: boolean; readonly apiRoot?: string } = {},
): UseQueryResult<ReportResult<Row>, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ReportResult<Row>, ApiError>({
    queryKey: ["reports", options.apiRoot ?? "/reports", reportId, params],
    enabled: session !== null && (options.enabled ?? true),
    queryFn: async () => {
      const res = await request(`${options.apiRoot ?? "/reports"}${apiPath}${toQueryString(params)}`);
      if (!res.ok) {
        const fieldErrors = await readReportFieldErrors(res);
        throw new ApiError(
          res.status,
          fieldErrors?._root ?? withSupportCode(t("reportsApi.theReportCouldNotBe"), res.status, t),
          fieldErrors,
        );
      }
      return res.json<ReportResult<Row>>();
    },
  });
}
