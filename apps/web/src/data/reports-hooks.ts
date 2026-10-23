import { keepPreviousData, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { BranchCaveatDTO, StockLevelsSummaryDTO } from "@mezan/contracts";
import type { ReportChartPoint, ReportFigure, ReportGroupResult, ReportKpiResult, ReportPage, ReportReconciliationResult } from "@mezan/domain";
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
  readonly branchCaveat?: BranchCaveatDTO | null;
  /** Present only when a `pageSize` was asked for and the route pages: `rows` is then one page. */
  readonly page?: ReportPage;
  /** Over every row, sent with a page so the chart is not drawn from the page alone. */
  readonly chartPoints?: readonly ReportChartPoint[] | null;
}

export const REPORT_PAGE_SIZE = 50;

/** Blank param values are dropped so the server falls back to the report's own defaults. */
function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function useReportQuery<Body>(
  queryKey: readonly unknown[],
  path: string,
  enabled: boolean,
): UseQueryResult<Body, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<Body, ApiError>({
    queryKey,
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request(path);
      if (!res.ok) {
        const fieldErrors = await readReportFieldErrors(res);
        throw new ApiError(
          res.status,
          fieldErrors?._root ?? withSupportCode(t("reportsApi.theReportCouldNotBe"), res.status, t),
          fieldErrors,
        );
      }
      return res.json<Body>();
    },
  });
}

function useReportFetcher<Row>(apiRoot: string, apiPath: string) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return async (params: Record<string, string>): Promise<ReportResult<Row>> => {
    const res = await request(`${apiRoot}${apiPath}${toQueryString(params)}`);
    if (!res.ok) {
      const fieldErrors = await readReportFieldErrors(res);
      throw new ApiError(
        res.status,
        fieldErrors?._root ?? withSupportCode(t("reportsApi.theReportCouldNotBe"), res.status, t),
        fieldErrors,
      );
    }
    return res.json<ReportResult<Row>>();
  };
}

export function useReport<Row>(
  reportId: string,
  apiPath: string,
  params: Record<string, string>,
  options: { readonly enabled?: boolean; readonly apiRoot?: string; readonly keepPrevious?: boolean } = {},
): UseQueryResult<ReportResult<Row>, ApiError> {
  const { session } = useApi();
  const apiRoot = options.apiRoot ?? "/reports";
  const fetchReport = useReportFetcher<Row>(apiRoot, apiPath);
  return useQuery<ReportResult<Row>, ApiError>({
    queryKey: ["reports", apiRoot, reportId, params],
    enabled: session !== null && (options.enabled ?? true),
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    queryFn: () => fetchReport(params),
  });
}

/**
 * Every row of a report the screen shows one page of — for export. Same cache
 * entry as an unpaged `useReport` with these params.
 */
export function useReportAllRows<Row>(reportId: string, apiPath: string, apiRoot = "/reports") {
  const queryClient = useQueryClient();
  const fetchReport = useReportFetcher<Row>(apiRoot, apiPath);
  return async (params: Record<string, string>): Promise<readonly Row[]> => {
    const result = await queryClient.fetchQuery<ReportResult<Row>, ApiError>({
      queryKey: ["reports", apiRoot, reportId, params],
      queryFn: () => fetchReport(params),
    });
    return result.rows;
  };
}

export function useStockLevelsSummary(options: { readonly enabled?: boolean } = {}): UseQueryResult<StockLevelsSummaryDTO, ApiError> {
  return useReportQuery<StockLevelsSummaryDTO>(
    ["reports", "/reports", "inventory.stock-levels.summary"],
    "/reports/inventory/stock-levels/summary",
    options.enabled ?? true,
  );
}
