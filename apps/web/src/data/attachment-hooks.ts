import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { AttachmentContentDTO, AttachmentDTO, AttachmentEntityTypeDTO } from "@mezan/contracts";
import { ApiError, readError } from "./hooks";
import { readServerMessage } from "./server-message";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/**
 * المرفقات (R1.4). Bytes travel as base64 inside JSON in both directions,
 * because the desktop shell reaches the same backend through an IPC bridge that
 * marshals bodies as strings — a binary body would arrive corrupted there.
 */

export function attachmentsKey(entityType: AttachmentEntityTypeDTO, entityId: string) {
  return ["attachments", entityType, entityId] as const;
}

export function useAttachments(
  entityType: AttachmentEntityTypeDTO,
  entityId: string | null,
): UseQueryResult<AttachmentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AttachmentDTO[], ApiError>({
    queryKey: attachmentsKey(entityType, entityId ?? ""),
    enabled: session !== null && Boolean(entityId),
    queryFn: async () => {
      const res = await request(`/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("attachments.couldNotBeLoaded"), t));
      return res.json<AttachmentDTO[]>();
    },
  });
}

export interface UploadAttachmentInput {
  readonly entityType: AttachmentEntityTypeDTO;
  readonly entityId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly notes: string | null;
  readonly contentBase64: string;
}

export function useUploadAttachment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AttachmentDTO, ApiError, UploadAttachmentInput>({
    mutationFn: async (input) => {
      const res = await request("/attachments", { method: "POST", body: JSON.stringify(input) });
      if (!res.ok) {
        throw new ApiError(res.status, await readServerMessage(res, t("attachments.uploadFailed")));
      }
      return res.json<AttachmentDTO>();
    },
    onSuccess: (attachment) =>
      queryClient.invalidateQueries({ queryKey: attachmentsKey(attachment.entityType, attachment.entityId) }),
  });
}

export function useDeleteAttachment(entityType: AttachmentEntityTypeDTO, entityId: string) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        throw new ApiError(res.status, await readServerMessage(res, t("attachments.deleteFailed")));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attachmentsKey(entityType, entityId) }),
  });
}

/** Fetches one attachment's bytes on demand — never as part of the list, which carries metadata only. */
export function useDownloadAttachment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<AttachmentContentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/attachments/${encodeURIComponent(id)}/content`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("attachments.downloadFailed"), t));
      return res.json<AttachmentContentDTO>();
    },
  });
}
