import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  BoqOverrunReportDTO,
  ConsumptionVarianceReportDTO,
  ContractingExceptionSummaryDTO,
  CreateRetentionReleaseDTO,
  EarlyRetentionReleaseReportDTO,
  EquipmentExceptionReportDTO,
  LateVariationReportDTO,
  RecordHandoverDTO,
  RetentionCalendarDTO,
  RetentionHeadroomDTO,
  RetentionReleaseDTO,
  RetentionReleaseKindDTO,
  UnreceivedIssuesReportDTO,
  UpdateRetentionReleaseDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * تقارير الاستثناءات والمحتجزات — slice 5B's data hooks (design §06).
 *
 * Releasing retention moves the ledger the calendar and every report are
 * derived from, so a mutation invalidates the whole subtree rather than one
 * list.
 */

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

const REPORTS = "/contracting/reports";
const RETENTION = "/contracting/retention";
const KEY = ["contracting", "controls"] as const;

export interface ExceptionReportParams {
  readonly projectId?: string | null;
  readonly asOfDate?: string | null;
  readonly olderThanDays?: string | null;
  readonly thresholdPercent?: string | null;
}

function searchOf(params: ExceptionReportParams): string {
  const search = new URLSearchParams();
  if (params.projectId) search.set("projectId", params.projectId);
  if (params.asOfDate) search.set("asOfDate", params.asOfDate);
  if (params.olderThanDays) search.set("olderThanDays", params.olderThanDays);
  if (params.thresholdPercent) search.set("thresholdPercent", params.thresholdPercent);
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

/** One exception report. `key` is the route segment AND the react-query key. */
function useExceptionReport<T>(key: string, params: ExceptionReportParams, enabled: boolean): UseQueryResult<T, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<T, ApiError>({
    queryKey: [...KEY, "report", key, params],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request(`${REPORTS}/${key}${searchOf(params)}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("contractingReports.loadFailed")));
      return res.json<T>();
    },
  });
}

export const useBoqOverrunReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<BoqOverrunReportDTO>("boq-overrun", p, enabled);
export const useUnreceivedIssuesReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<UnreceivedIssuesReportDTO>("unreceived-issues", p, enabled);
export const useConsumptionVarianceReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<ConsumptionVarianceReportDTO>("consumption-variance", p, enabled);
export const useEquipmentExceptionReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<EquipmentExceptionReportDTO>("equipment-without-certificate", p, enabled);
export const useLateVariationReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<LateVariationReportDTO>("late-variation-approvals", p, enabled);
export const useEarlyRetentionReleaseReport = (p: ExceptionReportParams, enabled: boolean) =>
  useExceptionReport<EarlyRetentionReleaseReportDTO>("early-retention-release", p, enabled);

/** The dashboard tile's figure: how many exceptions are open right now. */
export function useContractingExceptionSummary(enabled = true): UseQueryResult<ContractingExceptionSummaryDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ContractingExceptionSummaryDTO, ApiError>({
    queryKey: [...KEY, "summary"],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request(`${REPORTS}/summary`);
      if (!res.ok) throw new ApiError(res.status, t("contractingReports.loadFailed"));
      return res.json<ContractingExceptionSummaryDTO>();
    },
  });
}

export function useRetentionCalendar(asOfDate: string | null): UseQueryResult<RetentionCalendarDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RetentionCalendarDTO, ApiError>({
    queryKey: [...KEY, "calendar", asOfDate],
    enabled: session !== null,
    queryFn: async () => {
      const search = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : "";
      const res = await request(`${RETENTION}/calendar${search}`);
      if (!res.ok) throw new ApiError(res.status, t("retention.api.calendarFailed"));
      return res.json<RetentionCalendarDTO>();
    },
  });
}

export function useRetentionReleases(contractId?: string | null): UseQueryResult<RetentionReleaseDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RetentionReleaseDTO[], ApiError>({
    queryKey: [...KEY, "releases", contractId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const search = contractId ? `?contractId=${encodeURIComponent(contractId)}` : "";
      const res = await request(`${RETENTION}/releases${search}`);
      if (!res.ok) throw new ApiError(res.status, t("retention.api.releasesFailed"));
      return res.json<RetentionReleaseDTO[]>();
    },
  });
}

export function useRetentionRelease(idOrDocNo: string | null): UseQueryResult<RetentionReleaseDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RetentionReleaseDTO, ApiError>({
    queryKey: [...KEY, "release", idOrDocNo],
    enabled: session !== null && idOrDocNo !== null,
    queryFn: async () => {
      const res = await request(`${RETENTION}/releases/${encodeURIComponent(idOrDocNo as string)}`);
      if (!res.ok) throw new ApiError(res.status, t("retention.api.releaseFailed"));
      return res.json<RetentionReleaseDTO>();
    },
  });
}

/** What the server says may still be released — the form never computes the cap itself. */
export function useRetentionHeadroom(
  contractId: string | null,
  kind: RetentionReleaseKindDTO,
): UseQueryResult<RetentionHeadroomDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RetentionHeadroomDTO, ApiError>({
    queryKey: [...KEY, "headroom", contractId, kind],
    enabled: session !== null && contractId !== null,
    queryFn: async () => {
      const res = await request(
        `${RETENTION}/headroom?contractId=${encodeURIComponent(contractId as string)}&kind=${kind}`,
      );
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.headroomFailed")));
      return res.json<RetentionHeadroomDTO>();
    },
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useCreateRetentionRelease() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RetentionReleaseDTO, ApiError, CreateRetentionReleaseDTO>({
    mutationFn: async (body) => {
      const res = await request(`${RETENTION}/releases`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.saveFailed")));
      return res.json<RetentionReleaseDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRetentionRelease() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RetentionReleaseDTO, ApiError, { id: string; body: UpdateRetentionReleaseDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`${RETENTION}/releases/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.saveFailed")));
      return res.json<RetentionReleaseDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useReleaseRetention() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RetentionReleaseDTO, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await request(`${RETENTION}/releases/${encodeURIComponent(id)}/release`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.releaseActionFailed")));
      return res.json<RetentionReleaseDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useCancelRetentionRelease() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RetentionReleaseDTO, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await request(`${RETENTION}/releases/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.cancelFailed")));
      return res.json<RetentionReleaseDTO>();
    },
    onSuccess: invalidate,
  });
}

export interface RecordHandoverResultDTO {
  readonly contractId: string;
  readonly contractDocNo: string;
  readonly provisionalHandoverDate: string | null;
  readonly finalHandoverDate: string | null;
  readonly provisionalReleasePercent: string;
  readonly defectsLiabilityMonths: number;
}

export function useRecordHandover() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<RecordHandoverResultDTO, ApiError, { contractId: string; body: RecordHandoverDTO }>({
    mutationFn: async ({ contractId, body }) => {
      const res = await request(`${RETENTION}/contracts/${encodeURIComponent(contractId)}/handover`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("retention.api.handoverFailed")));
      return res.json<RecordHandoverResultDTO>();
    },
    onSuccess: invalidate,
  });
}
