import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApproveSubCertificateDTO,
  CreateSubcontractDTO,
  CreateSubCertificateDTO,
  LinkSubcontractAdvanceDTO,
  PreviewSubCertificateDTO,
  ReleaseSubcontractRetentionDTO,
  ReplaceSubcontractLinesDTO,
  SubcontractDTO,
  SubcontractRetentionDTO,
  SubCertificateDTO,
  SubCertificatePreviewDTO,
  UpdateSubcontractDTO,
  UpdateSubCertificateDTO,
} from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* ------------------------------------------------------------------ */
/* عقود الباطن — /contracting/subcontracts                             */
/* ------------------------------------------------------------------ */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string; reasons?: string[] }>().catch(() => ({}))) as {
    message?: string;
    reasons?: string[];
  };
  if (body.reasons && body.reasons.length > 0) return body.reasons.join(" — ");
  return body.message ?? fallback;
}

const SUBCONTRACTS_KEY = ["contracting", "subcontracts"] as const;
const SUB_CERTIFICATES_KEY = ["contracting", "subcontract-certificates"] as const;

function useSubcontractInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: SUBCONTRACTS_KEY });
    void queryClient.invalidateQueries({ queryKey: SUB_CERTIFICATES_KEY });
  };
}

function useSubCertificateInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: SUB_CERTIFICATES_KEY });
    // Approving raises a PURCHASE invoice and moves the subcontract's advance
    // and retention balances, so both are stale the moment it lands.
    void queryClient.invalidateQueries({ queryKey: SUBCONTRACTS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
  };
}

export interface SubcontractFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly supplierId?: string;
  readonly status?: string;
}

export function useSubcontracts(filter: SubcontractFilter = {}): UseQueryResult<SubcontractDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const params = new URLSearchParams();
  if (filter.contractId) params.set("contractId", filter.contractId);
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return useQuery<SubcontractDTO[], ApiError>({
    queryKey: [...SUBCONTRACTS_KEY, "list", suffix],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/subcontracts${suffix}`);
      if (!res.ok) throw new ApiError(res.status, t("subcontracts.loadFailed"));
      return res.json<SubcontractDTO[]>();
    },
  });
}

export function useSubcontract(id: string | null): UseQueryResult<SubcontractDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SubcontractDTO, ApiError>({
    queryKey: [...SUBCONTRACTS_KEY, "one", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, t("subcontracts.loadFailed"));
      return res.json<SubcontractDTO>();
    },
  });
}

export function useSubcontractRetention(id: string | null): UseQueryResult<SubcontractRetentionDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SubcontractRetentionDTO, ApiError>({
    queryKey: [...SUBCONTRACTS_KEY, "retention", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id ?? "")}/retention`);
      if (!res.ok) throw new ApiError(res.status, t("subcontracts.retentionLoadFailed"));
      return res.json<SubcontractRetentionDTO>();
    },
  });
}

export function useCreateSubcontract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<SubcontractDTO, ApiError, CreateSubcontractDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/subcontracts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.saveFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateSubcontract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<SubcontractDTO, ApiError, { id: string; patch: UpdateSubcontractDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.saveFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function usePutSubcontractLines() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<SubcontractDTO, ApiError, { id: string; body: ReplaceSubcontractLinesDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id)}/lines`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.saveFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

export type SubcontractAction = "activate" | "complete" | "terminate";

/** تفعيل / إنهاء / فسخ — one mutation over the three status-transition routes. */
export function useSubcontractTransition() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<
    SubcontractDTO,
    ApiError,
    { id: string; action: SubcontractAction; body: { activatedAt?: string; completedAt?: string; terminatedAt?: string; reason?: string | null } }
  >({
    mutationFn: async ({ id, action, body }) => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.transitionFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useLinkSubcontractAdvance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<SubcontractDTO, ApiError, { id: string; body: LinkSubcontractAdvanceDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id)}/advance`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.advanceLinkFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useReleaseSubcontractRetention() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubcontractInvalidation();
  return useMutation<SubcontractDTO, ApiError, { id: string; body: ReleaseSubcontractRetentionDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/subcontracts/${encodeURIComponent(id)}/release-retention`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subcontracts.retentionReleaseFailed")));
      return res.json<SubcontractDTO>();
    },
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------------ */
/* مستخلصات مقاولي الباطن — /contracting/subcontract-certificates       */
/* ------------------------------------------------------------------ */

export interface SubCertificateFilter {
  readonly subcontractId?: string;
  readonly contractId?: string;
  readonly projectId?: string;
  readonly supplierId?: string;
  readonly status?: string;
}

export function useSubCertificates(filter: SubCertificateFilter = {}): UseQueryResult<SubCertificateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const params = new URLSearchParams();
  if (filter.subcontractId) params.set("subcontractId", filter.subcontractId);
  if (filter.contractId) params.set("contractId", filter.contractId);
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return useQuery<SubCertificateDTO[], ApiError>({
    queryKey: [...SUB_CERTIFICATES_KEY, "list", suffix],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/subcontract-certificates${suffix}`);
      if (!res.ok) throw new ApiError(res.status, t("subCertificates.loadFailed"));
      return res.json<SubCertificateDTO[]>();
    },
  });
}

export function useSubCertificate(id: string | null): UseQueryResult<SubCertificateDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SubCertificateDTO, ApiError>({
    queryKey: [...SUB_CERTIFICATES_KEY, "one", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/subcontract-certificates/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, t("subCertificates.loadFailed"));
      return res.json<SubCertificateDTO>();
    },
  });
}

/**
 * The live block. Nothing is persisted, so this is a QUERY keyed on the draft
 * the surveyor is typing — the refusals and the over-certification ceiling are
 * on screen before the certificate exists.
 */
export function useSubCertificatePreview(
  body: PreviewSubCertificateDTO | null,
): UseQueryResult<SubCertificatePreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SubCertificatePreviewDTO, ApiError>({
    queryKey: [...SUB_CERTIFICATES_KEY, "preview", JSON.stringify(body)],
    enabled: session !== null && body !== null,
    queryFn: async () => {
      const res = await request("/contracting/subcontract-certificates/preview", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subCertificates.previewFailed")));
      return res.json<SubCertificatePreviewDTO>();
    },
  });
}

export function useCreateSubCertificate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubCertificateInvalidation();
  return useMutation<SubCertificateDTO, ApiError, CreateSubCertificateDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/subcontract-certificates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subCertificates.saveFailed")));
      return res.json<SubCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateSubCertificate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubCertificateInvalidation();
  return useMutation<SubCertificateDTO, ApiError, { id: string; patch: UpdateSubCertificateDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/contracting/subcontract-certificates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subCertificates.saveFailed")));
      return res.json<SubCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}

export type SubCertificateAction = "measure" | "certify" | "approve" | "cancel";

/** حصر / اعتماد فني / اعتماد للصرف / إلغاء — one mutation over the four gated routes. */
export function useSubCertificateTransition() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useSubCertificateInvalidation();
  return useMutation<
    SubCertificateDTO,
    ApiError,
    { id: string; action: SubCertificateAction; body?: ApproveSubCertificateDTO }
  >({
    mutationFn: async ({ id, action, body }) => {
      const res = await request(`/contracting/subcontract-certificates/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("subCertificates.transitionFailed")));
      return res.json<SubCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}
