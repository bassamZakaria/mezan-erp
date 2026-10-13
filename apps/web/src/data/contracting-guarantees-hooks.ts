import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CallGuaranteeDTO,
  CreateGuaranteeDTO,
  GuaranteeDTO,
  GuaranteeSummaryDTO,
  ReduceGuaranteeDTO,
  ReleaseGuaranteeDTO,
  UpdateGuaranteeDTO,
} from "@mezan/contracts";
import { ScreenRequest } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, useHoldsScreenRequest } from "./hooks";
import { useAppTranslation } from "../i18n";

/**
 * خطابات الضمان — the register's data hooks (design §05). Its own file rather
 * than more weight on `./hooks.ts`, and every mutation invalidates the SUMMARY
 * as well as the list: the four tiles are derived from posted documents, so a
 * letter that moves must re-derive them.
 */

/** The Arabic refusal the domain sent, or the generic fallback when it sent none. */
async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

const ROOT = "/contracting/guarantees";
const KEY = ["contracting", "guarantees"] as const;

export interface GuaranteeListQuery {
  readonly projectId?: string;
  readonly status?: string;
  readonly expiringWithinDays?: number;
}

function toQueryString(query: GuaranteeListQuery): string {
  const search = new URLSearchParams();
  if (query.projectId) search.set("projectId", query.projectId);
  if (query.status && query.status !== "all") search.set("status", query.status);
  if (query.expiringWithinDays !== undefined) search.set("expiringWithinDays", String(query.expiringWithinDays));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function useGuarantees(query: GuaranteeListQuery = {}): UseQueryResult<GuaranteeDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GuaranteeDTO[], ApiError>({
    queryKey: [...KEY, "list", query],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`${ROOT}${toQueryString(query)}`);
      if (!res.ok) throw await loaderError(res, t("guarantees.api.listFailed"), t);
      return res.json<GuaranteeDTO[]>();
    },
  });
}

export function useGuaranteeSummary(): UseQueryResult<GuaranteeSummaryDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GuaranteeSummaryDTO, ApiError>({
    queryKey: [...KEY, "summary"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`${ROOT}/summary`);
      if (!res.ok) throw await loaderError(res, t("guarantees.api.summaryFailed"), t);
      return res.json<GuaranteeSummaryDTO>();
    },
  });
}

/** One letter, addressed by its `LG-…` number or its id. */
export function useGuarantee(idOrDocNo: string | null): UseQueryResult<GuaranteeDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GuaranteeDTO, ApiError>({
    queryKey: [...KEY, "one", idOrDocNo],
    enabled: session !== null && idOrDocNo !== null,
    queryFn: async () => {
      const res = await request(`${ROOT}/${encodeURIComponent(idOrDocNo as string)}`);
      if (!res.ok) throw await loaderError(res, t("guarantees.api.oneFailed"), t);
      return res.json<GuaranteeDTO>();
    },
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: KEY });
}

export function useCreateGuarantee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<GuaranteeDTO, ApiError, CreateGuaranteeDTO>({
    mutationFn: async (body) => {
      const res = await request(ROOT, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("guarantees.api.saveFailed")));
      return res.json<GuaranteeDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateGuarantee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<GuaranteeDTO, ApiError, { id: string; patch: UpdateGuaranteeDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`${ROOT}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("guarantees.api.saveFailed")));
      return res.json<GuaranteeDTO>();
    },
    onSuccess: invalidate,
  });
}

function useGuaranteeAction<Body>(action: string) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useInvalidate();
  return useMutation<GuaranteeDTO, ApiError, { id: string; body: Body }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`${ROOT}/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("guarantees.api.actionFailed")));
      return res.json<GuaranteeDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useIssueGuarantee() {
  return useGuaranteeAction<Record<string, never>>("issue");
}

export function useReduceGuarantee() {
  return useGuaranteeAction<ReduceGuaranteeDTO>("reduce");
}

export function useReleaseGuarantee() {
  return useGuaranteeAction<ReleaseGuaranteeDTO>("release");
}

export function useCallGuarantee() {
  return useGuaranteeAction<CallGuaranteeDTO>("call");
}

export interface ContractOption {
  readonly id: string;
  readonly docNo: string | null;
  readonly titleAr?: string;
  readonly nameAr?: string;
}

/**
 * The contracts a letter can be attached to. The contracts slice mounts its own
 * router; until a deployment carries it the endpoint 404s, and the picker is
 * then hidden rather than shown empty — `available` says which.
 */
export function useGuaranteeContractOptions(): { options: ContractOption[]; available: boolean; isLoading: boolean } {
  const { request } = useApi();
  const mayAsk = useHoldsScreenRequest(ScreenRequest.WorksContracts);
  const query = useQuery<{ available: boolean; rows: ContractOption[] }, ApiError>({
    queryKey: [...KEY, "contract-options"],
    enabled: mayAsk,
    retry: false,
    queryFn: async () => {
      const res = await request("/contracting/contracts");
      if (res.status === 404) return { available: false, rows: [] };
      if (!res.ok) return { available: false, rows: [] };
      const body = await res.json<unknown>();
      const rows = Array.isArray(body) ? (body as ContractOption[]) : [];
      return { available: true, rows };
    },
  });
  return {
    options: query.data?.rows ?? [],
    available: query.data?.available === true,
    isLoading: query.isLoading,
  };
}
