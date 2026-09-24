import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  AfterHoursQueryDTO,
  AfterHoursReportDTO,
  NewAccountsQueryDTO,
  NewAccountsReportDTO,
  PostPostingChangesQueryDTO,
  PostPostingChangesReportDTO,
  SecurityExceptionsQueryDTO,
  SecurityExceptionsReportDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * تقارير الرقابة والأمان — the four exception reports served by
 * `packages/api/src/security-reports-routes.ts` at `/security-reports/*`.
 *
 * Every one of them is a READ over the append-only audit trail. There is no
 * `limit` on any query on purpose: the server recomputes each bound and
 * declares what it could not read in `coverage`, so a caller cannot ask for a
 * count over "however many rows the browser wanted" and render it as a fact.
 */

type QueryValue = string | number | undefined | null;

function toQueryString(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function useSecurityReport<Result>(
  reportKey: string,
  path: string,
  params: Record<string, QueryValue>,
): UseQueryResult<Result, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<Result, ApiError>({
    queryKey: ["security-reports", reportKey, params],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/security-reports${path}${toQueryString(params)}`);
      if (!res.ok) throw new ApiError(res.status, t("securityReports.loadFailed"));
      return res.json<Result>();
    },
  });
}

export function useSecurityExceptionsReport(
  params: SecurityExceptionsQueryDTO,
): UseQueryResult<SecurityExceptionsReportDTO, ApiError> {
  return useSecurityReport<SecurityExceptionsReportDTO>("exceptions", "/exceptions", { ...params });
}

export function usePostPostingChangesReport(
  params: PostPostingChangesQueryDTO,
): UseQueryResult<PostPostingChangesReportDTO, ApiError> {
  return useSecurityReport<PostPostingChangesReportDTO>("post-posting-changes", "/post-posting-changes", { ...params });
}

export function useAfterHoursReport(params: AfterHoursQueryDTO): UseQueryResult<AfterHoursReportDTO, ApiError> {
  return useSecurityReport<AfterHoursReportDTO>("after-hours", "/after-hours", { ...params });
}

export function useNewAccountsReport(params: NewAccountsQueryDTO): UseQueryResult<NewAccountsReportDTO, ApiError> {
  return useSecurityReport<NewAccountsReportDTO>("new-accounts", "/new-accounts", { ...params });
}
