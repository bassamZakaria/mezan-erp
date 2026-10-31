import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApproveVariationOrderDTO,
  BoqImportDTO,
  BoqImportReviewDTO,
  BoqLineDTO,
  ContractedQtyRowDTO,
  CreateVariationOrderDTO,
  CreateWorksContractDTO,
  PutBoqDTO,
  RejectVariationOrderDTO,
  UpdateVariationOrderDTO,
  UpdateWorksContractDTO,
  VariationOrderDTO,
  WorksContractDTO,
} from "@mezan/contracts";
import { ApiError, loaderError, useHoldsScreenRequest, serverMessage, type ServerErrorBody } from "./hooks";
import { ScreenRequest } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* ------------------------------------------------------------------ */
/* العقود وجداول الكميات وأوامر التغيير — /contracting/contracts        */
/* ------------------------------------------------------------------ */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<ServerErrorBody>().catch(() => ({}))) as ServerErrorBody;
  return serverMessage(body) ?? fallback;
}

const CONTRACTS_KEY = ["contracting", "contracts"] as const;
const VARIATIONS_KEY = ["contracting", "variation-orders"] as const;

function useContractingInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CONTRACTS_KEY });
    void queryClient.invalidateQueries({ queryKey: VARIATIONS_KEY });
  };
}

export interface WorksContractFilter {
  readonly projectId?: string;
  readonly status?: string;
}

export function useWorksContracts(filter: WorksContractFilter = {}): UseQueryResult<WorksContractDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useHoldsScreenRequest(ScreenRequest.WorksContracts);
  const params = new URLSearchParams();
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return useQuery<WorksContractDTO[], ApiError>({
    queryKey: [...CONTRACTS_KEY, "list", suffix],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request(`/contracting/contracts${suffix}`);
      if (!res.ok) throw await loaderError(res, t("worksContracts.loadFailed"), t);
      return res.json<WorksContractDTO[]>();
    },
  });
}

export function useWorksContract(id: string | null): UseQueryResult<WorksContractDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WorksContractDTO, ApiError>({
    queryKey: [...CONTRACTS_KEY, "one", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("worksContracts.loadFailed"), t);
      return res.json<WorksContractDTO>();
    },
  });
}

export interface BoqResponse {
  readonly lines: BoqLineDTO[];
  readonly total: string;
}

export function useContractBoq(id: string | null): UseQueryResult<BoqResponse, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BoqResponse, ApiError>({
    queryKey: [...CONTRACTS_KEY, "boq", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id ?? "")}/boq`);
      if (!res.ok) throw await loaderError(res, t("boq.loadFailed"), t);
      return res.json<BoqResponse>();
    },
  });
}

export interface ContractedQtyResponse {
  readonly asOfDate: string | null;
  readonly rows: ContractedQtyRowDTO[];
}

export function useContractedQuantities(
  id: string | null,
  asOfDate: string,
): UseQueryResult<ContractedQtyResponse, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ContractedQtyResponse, ApiError>({
    queryKey: [...CONTRACTS_KEY, "contracted-qty", id, asOfDate],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const suffix = asOfDate === "" ? "" : `?asOfDate=${encodeURIComponent(asOfDate)}`;
      const res = await request(`/contracting/contracts/${encodeURIComponent(id ?? "")}/boq/contracted-qty${suffix}`);
      if (!res.ok) throw await loaderError(res, t("boq.loadFailed"), t);
      return res.json<ContractedQtyResponse>();
    },
  });
}

export function useCreateWorksContract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<WorksContractDTO, ApiError, CreateWorksContractDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/contracts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("worksContracts.saveFailed")));
      return res.json<WorksContractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateWorksContract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<WorksContractDTO, ApiError, { id: string; patch: UpdateWorksContractDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("worksContracts.saveFailed")));
      return res.json<WorksContractDTO>();
    },
    onSuccess: invalidate,
  });
}

type ContractTransition = { id: string; action: "activate"; date: string } | { id: string; action: "complete"; date: string } | { id: string; action: "terminate"; date: string; reason?: string | null };

/** تفعيل / إنهاء / فسخ — one mutation over the three lifecycle routes, each with its own dated body. */
export function useWorksContractTransition() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<WorksContractDTO, ApiError, ContractTransition>({
    mutationFn: async (input) => {
      const body =
        input.action === "activate"
          ? { activatedAt: input.date }
          : input.action === "complete"
            ? { completedAt: input.date }
            : { terminatedAt: input.date, reason: input.reason ?? null };
      const res = await request(`/contracting/contracts/${encodeURIComponent(input.id)}/${input.action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("worksContracts.saveFailed")));
      return res.json<WorksContractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function usePutContractBoq() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<BoqResponse, ApiError, { id: string; body: PutBoqDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id)}/boq`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("boq.saveFailed")));
      return res.json<BoqResponse>();
    },
    onSuccess: invalidate,
  });
}

/** استيراد جدول الكميات — the review pass. Persists nothing; it answers with the per-row problems. */
export function useReviewBoqImport() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<BoqImportReviewDTO, ApiError, { id: string; body: BoqImportDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id)}/boq/import`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("boq.importFailed")));
      return res.json<BoqImportReviewDTO>();
    },
  });
}

export function useCommitBoqImport() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<{ review: BoqImportReviewDTO; lines: BoqLineDTO[] }, ApiError, { id: string; body: BoqImportDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/contracts/${encodeURIComponent(id)}/boq/import/commit`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("boq.importFailed")));
      return res.json<{ review: BoqImportReviewDTO; lines: BoqLineDTO[] }>();
    },
    onSuccess: invalidate,
  });
}

export interface VariationOrderFilter {
  readonly contractId?: string;
  readonly status?: string;
}

export function useVariationOrders(filter: VariationOrderFilter = {}): UseQueryResult<VariationOrderDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const params = new URLSearchParams();
  if (filter.contractId) params.set("contractId", filter.contractId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return useQuery<VariationOrderDTO[], ApiError>({
    queryKey: [...VARIATIONS_KEY, "list", suffix],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/variation-orders${suffix}`);
      if (!res.ok) throw await loaderError(res, t("variationOrders.loadFailed"), t);
      return res.json<VariationOrderDTO[]>();
    },
  });
}

export function useCreateVariationOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<VariationOrderDTO, ApiError, CreateVariationOrderDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/variation-orders", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("variationOrders.saveFailed")));
      return res.json<VariationOrderDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateVariationOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<VariationOrderDTO, ApiError, { id: string; patch: UpdateVariationOrderDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/contracting/variation-orders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("variationOrders.saveFailed")));
      return res.json<VariationOrderDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useApproveVariationOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<VariationOrderDTO, ApiError, { id: string; body: ApproveVariationOrderDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/variation-orders/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("variationOrders.approveFailed")));
      return res.json<VariationOrderDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useRejectVariationOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useContractingInvalidation();
  return useMutation<VariationOrderDTO, ApiError, { id: string; body: RejectVariationOrderDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/variation-orders/${encodeURIComponent(id)}/reject`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("variationOrders.approveFailed")));
      return res.json<VariationOrderDTO>();
    },
    onSuccess: invalidate,
  });
}
