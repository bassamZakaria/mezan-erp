import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ApproveProgressCertificateDTO,
  CancelProgressCertificateDTO,
  CertifyProgressCertificateDTO,
  MeasureProgressCertificateDTO,
  VoidProgressCertificateDTO,
  CreateProgressCertificateDTO,
  InternalCertificateDTO,
  PreviewProgressCertificateDTO,
  ProgressCertificateDTO,
  ProgressCertificatePreviewDTO,
  UpdateProgressCertificateDTO,
} from "@mezan/contracts";
import { ApiError, loaderError } from "./hooks";
import { serverMessage, type ServerErrorBody } from "./server-message";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* ------------------------------------------------------------------ */
/* المستخلصات — /contracting/certificates                              */
/* ------------------------------------------------------------------ */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<ServerErrorBody & { reasons?: string[] }>().catch(() => ({}))) as ServerErrorBody & {
    reasons?: string[];
  };
  if (body.reasons && body.reasons.length > 0) return body.reasons.join(" — ");
  return serverMessage(body) ?? fallback;
}

const CERTIFICATES_KEY = ["contracting", "certificates"] as const;

function useCertificateInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY });
    // Approving a certificate raises an invoice and moves the advance balance,
    // so the contract and invoice lists are stale the moment it lands.
    void queryClient.invalidateQueries({ queryKey: ["contracting", "contracts"] });
    void queryClient.invalidateQueries({ queryKey: ["sales-invoices"] });
  };
}

export interface ProgressCertificateFilter {
  readonly contractId?: string;
  readonly projectId?: string;
  readonly status?: string;
}

export function useProgressCertificates(
  filter: ProgressCertificateFilter = {},
): UseQueryResult<ProgressCertificateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const params = new URLSearchParams();
  if (filter.contractId) params.set("contractId", filter.contractId);
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (filter.status) params.set("status", filter.status);
  const suffix = params.toString() === "" ? "" : `?${params.toString()}`;
  return useQuery<ProgressCertificateDTO[], ApiError>({
    queryKey: [...CERTIFICATES_KEY, "list", suffix],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/certificates${suffix}`);
      if (!res.ok) throw await loaderError(res, t("certificates.loadFailed"), t);
      return res.json<ProgressCertificateDTO[]>();
    },
  });
}

export function useProgressCertificate(id: string | null): UseQueryResult<ProgressCertificateDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProgressCertificateDTO, ApiError>({
    queryKey: [...CERTIFICATES_KEY, "one", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/certificates/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("certificates.loadFailed"), t);
      return res.json<ProgressCertificateDTO>();
    },
  });
}

/**
 * The live block. Nothing is persisted, so this is a QUERY keyed on the draft
 * the surveyor is typing — the deductions the employer will see are on screen
 * before the certificate exists, and so are the refusals.
 */
export function useCertificatePreview(
  body: PreviewProgressCertificateDTO | null,
): UseQueryResult<ProgressCertificatePreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProgressCertificatePreviewDTO, ApiError>({
    queryKey: [...CERTIFICATES_KEY, "preview", JSON.stringify(body)],
    enabled: session !== null && body !== null,
    queryFn: async () => {
      const res = await request("/contracting/certificates/preview", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("certificates.previewFailed")));
      return res.json<ProgressCertificatePreviewDTO>();
    },
  });
}

export function useInternalCertificate(
  contractId: string | null,
): UseQueryResult<InternalCertificateDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<InternalCertificateDTO, ApiError>({
    queryKey: [...CERTIFICATES_KEY, "internal", contractId],
    enabled: session !== null && contractId !== null,
    queryFn: async () => {
      const res = await request(
        `/contracting/certificates/internal?contractId=${encodeURIComponent(contractId ?? "")}`,
      );
      if (!res.ok) throw await loaderError(res, t("internalCertificate.loadFailed"), t);
      return res.json<InternalCertificateDTO>();
    },
  });
}

export function useCreateProgressCertificate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useCertificateInvalidation();
  return useMutation<ProgressCertificateDTO, ApiError, CreateProgressCertificateDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/certificates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("certificates.saveFailed")));
      return res.json<ProgressCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdateProgressCertificate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useCertificateInvalidation();
  return useMutation<ProgressCertificateDTO, ApiError, { id: string; patch: UpdateProgressCertificateDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/contracting/certificates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("certificates.saveFailed")));
      return res.json<ProgressCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}

export type CertificateAction = "measure" | "certify" | "approve" | "cancel" | "void";

export type CertificateTransitionBody =
  | MeasureProgressCertificateDTO
  | CertifyProgressCertificateDTO
  | ApproveProgressCertificateDTO
  | CancelProgressCertificateDTO
  | VoidProgressCertificateDTO;

/** حصر / اعتماد الاستشاري / اعتماد للصرف / إلغاء / عكس — one mutation over the five gated routes. */
export function useProgressCertificateTransition() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useCertificateInvalidation();
  return useMutation<
    ProgressCertificateDTO,
    ApiError,
    { id: string; action: CertificateAction; body?: CertificateTransitionBody }
  >({
    mutationFn: async ({ id, action, body }) => {
      const res = await request(`/contracting/certificates/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("certificates.transitionFailed")));
      return res.json<ProgressCertificateDTO>();
    },
    onSuccess: invalidate,
  });
}
