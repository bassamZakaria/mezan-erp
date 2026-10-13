import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CostCenterPnLReportDTO,
  CreateExchangeRateDTO,
  EtaConfigDTO,
  EtaReadinessDTO,
  EtaSubmissionDTO,
  EtaSubmissionStatusDTO,
  ExchangeRateDTO,
  FxRevaluationPostResultDTO,
  FxRevaluationPreviewDTO,
  FxRevaluationRequestDTO,
  ReconciliationReportDTO,
} from "@mezan/contracts";
import { ScreenRequest } from "@mezan/domain";
import { ApiError, readError, useMayAskScreen } from "./hooks";
import { useApi } from "./ApiContext";
import type { TransportResponse } from "./transport";
import { useAppTranslation } from "../i18n";

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/* -------------------------------------------------------------------- */
/* أسعار الصرف — Exchange Rates (docs/archive/catalog/04)                        */
/* -------------------------------------------------------------------- */

export function useExchangeRates(): UseQueryResult<ExchangeRateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useMayAskScreen(ScreenRequest.ExchangeRates);
  return useQuery<ExchangeRateDTO[], ApiError>({
    queryKey: ["exchange-rates"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/exchange-rates");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("fxRates.exchangeRatesCouldNotBe"), t));
      return res.json<ExchangeRateDTO[]>();
    },
  });
}

export function useCreateExchangeRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, CreateExchangeRateDTO>({
    mutationFn: async (body) => {
      const res = await request("/exchange-rates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("fxRates.theExchangeRateCouldNot2")));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

function useExchangeRateTransition(action: "approve" | "lock", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/exchange-rates/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, fallbackMessage));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

/** بانتظار الاعتماد → معتمد. */
export function useApproveExchangeRate() {
  const { t } = useAppTranslation();
  return useExchangeRateTransition("approve", t("fxRates.theExchangeRateCouldNot"));
}
/** معتمد → مقفل. */
export function useLockExchangeRate() {
  const { t } = useAppTranslation();
  return useExchangeRateTransition("lock", t("accountingApi.theExchangeRateCouldNot"));
}

/* -------------------------------------------------------------------- */
/* إعادة تقييم العملات الأجنبية — FX Revaluation (docs/archive/catalog/04)        */
/* -------------------------------------------------------------------- */

/** Carries the missing currency (when applicable) so the screen can render the same Arabic message the in-browser domain call used to produce. */
export class FxRevaluationError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly currency: string | null = null,
  ) {
    super(status, message);
    this.name = "FxRevaluationError";
  }
}

async function fxRevaluationRequest(
  request: (path: string, init?: RequestInit) => Promise<TransportResponse>,
  path: string,
  body: FxRevaluationRequestDTO,
  fallback: string,
) {
  const res = await request(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const err = (await res.json<{ message?: string; currency?: string }>().catch(() => ({}))) as {
      message?: string;
      currency?: string;
    };
    throw new FxRevaluationError(res.status, err.message ?? fallback, err.currency ?? null);
  }
  return res;
}

/** معاينة — computes the revaluation without posting. */
export function useFxRevaluationPreview() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<FxRevaluationPreviewDTO, FxRevaluationError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await fxRevaluationRequest(request, "/revaluation/preview", body, t("accountingApi.theOperationCouldNotBe"));
      return res.json<FxRevaluationPreviewDTO>();
    },
  });
}

/** ترحيل التقييم — posts the FX gain/loss entry (+ next-day auto-reversal by default). */
export function useFxRevaluationPost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FxRevaluationPostResultDTO, FxRevaluationError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await fxRevaluationRequest(request, "/revaluation/post", body, t("accountingApi.theOperationCouldNotBe"));
      return res.json<FxRevaluationPostResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/* -------------------------------------------------------------------- */
/* مطابقة الأرصدة — Balance Reconciliation (docs/archive/catalog/04)             */
/* -------------------------------------------------------------------- */

export function useReconciliationReport(): UseQueryResult<ReconciliationReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ReconciliationReportDTO, ApiError>({
    queryKey: ["reconciliation"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/reconciliation");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("accountingApi.theReconciliationReportCouldNot"), t));
      return res.json<ReconciliationReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* أرباح مراكز التكلفة — Cost Center P&L (docs/archive/catalog/04)                */
/* -------------------------------------------------------------------- */

export function useCostCenterPnL(fromDate: string, toDate: string): UseQueryResult<CostCenterPnLReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CostCenterPnLReportDTO, ApiError>({
    queryKey: ["cost-center-pl", fromDate, toDate],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      const qs = params.toString();
      const res = await request(`/cost-center-pl${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.costCentreProfitabilityCouldNot"), t));
      return res.json<CostCenterPnLReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* الفاتورة الإلكترونية — ETA e-Invoicing (docs/archive/catalog/04)               */
/* -------------------------------------------------------------------- */

export interface EtaConfigWithReadinessDTO {
  readonly config: EtaConfigDTO;
  readonly readiness: EtaReadinessDTO;
}

export function useEtaConfig(): UseQueryResult<EtaConfigWithReadinessDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaConfigWithReadinessDTO, ApiError>({
    queryKey: ["eta", "config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/config");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot"), t));
      return res.json<EtaConfigWithReadinessDTO>();
    },
  });
}

export function useEtaSubmissions(status?: EtaSubmissionStatusDTO): UseQueryResult<EtaSubmissionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaSubmissionDTO[], ApiError>({
    queryKey: ["eta", "submissions", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/eta/submissions${qs}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theSubmissionQueueCouldNot"), t));
      return res.json<EtaSubmissionDTO[]>();
    },
  });
}

function invalidateEtaSubmissions(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["eta", "submissions"] });
}

/**
 * The online transmit is STUBBED (online-only): the server answers 202 with no
 * submission body when it refuses offline, leaving the document queued rather
 * than throwing — the screen surfaces `offline`/`message` as a notice instead
 * of an error.
 */
export interface EtaSubmitResultDTO {
  readonly submission: EtaSubmissionDTO | null;
  readonly offline: boolean;
  readonly message: string | null;
}

export function useSubmitEtaSubmission() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmitResultDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/eta/submissions/${id}/submit`, { method: "POST" });
      if (res.status === 202) {
        const message = await readMessage(res, t("accountingApi.reallySubmittingIsPossibleOnly"));
        return { submission: null, offline: true, message };
      }
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theDocumentCouldNotBe")));
      return { submission: await res.json<EtaSubmissionDTO>(), offline: false, message: null };
    },
    onSuccess: () => invalidateEtaSubmissions(queryClient),
  });
}

export interface EtaSubmitAllResultDTO {
  readonly submitted: EtaSubmissionDTO[];
  readonly queued: string[];
}

export function useSubmitAllEtaReady() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmitAllResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/submissions/submit-all", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theReadyDocumentsCouldNot")));
      return res.json<EtaSubmitAllResultDTO>();
    },
    onSuccess: () => invalidateEtaSubmissions(queryClient),
  });
}

export function useExcludeEtaSubmission() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmissionDTO, ApiError, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const res = await request(`/eta/submissions/${id}/exclude`, { method: "POST", body: JSON.stringify({ reason }) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theDocumentCouldNotBe2")));
      return res.json<EtaSubmissionDTO>();
    },
    onSuccess: () => invalidateEtaSubmissions(queryClient),
  });
}
