import { useRef, useState, type ChangeEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button, Card, IconButton, useFormat } from "@mezan/ui";
import { ATTACHMENT_ENTITY_PERMISSIONS, ATTACHMENT_MAX_BYTES, AttachmentPermission, SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE, can, createAuthContext } from "@mezan/domain";
import type { AttachmentEntityTypeDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { useEntitlements } from "../data/hooks";
import { useAttachments, useDeleteAttachment, useDownloadAttachment, useUploadAttachment } from "../data/attachment-hooks";
import { useAppTranslation } from "../i18n";

/**
 * المرفقات — the reusable attachments tab. Any DocumentDetail drops this in
 * with the entity it is showing; the permissions come from that entity, so the
 * component needs nothing else to decide whether to offer the upload button.
 */
export interface AttachmentsTabProps {
  readonly entityType: AttachmentEntityTypeDTO;
  readonly entityId: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // A data: URL, so the base64 payload starts after the comma.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function triggerBrowserDownload(fileName: string, mimeType: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function AttachmentsTab({ entityType, entityId }: AttachmentsTabProps) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const { session } = useApi();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const query = useAttachments(entityType, entityId);
  const upload = useUploadAttachment();
  const remove = useDeleteAttachment(entityType, entityId);
  const download = useDownloadAttachment();

  const permissions = ATTACHMENT_ENTITY_PERMISSIONS[entityType];
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const entitlements = useEntitlements();
  const separatePermissions = entitlements.data?.features[SEPARATE_ATTACHMENT_PERMISSIONS_FEATURE] === true;
  const holdsAttachmentRight = (permission: AttachmentPermission) => !separatePermissions || can(authContext, permission);
  const mayManage = can(authContext, permissions.manage);
  const mayView = holdsAttachmentRight(AttachmentPermission.View);
  const mayUpload = mayManage && holdsAttachmentRight(AttachmentPermission.Upload);
  const mayDelete = mayManage && holdsAttachmentRight(AttachmentPermission.Delete);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return t("attachments.sizeBytes", { value: format.number(bytes) });
    if (bytes < 1024 * 1024) return t("attachments.sizeKilobytes", { value: format.number(Math.round((bytes / 1024) * 10) / 10) });
    return t("attachments.sizeMegabytes", { value: format.number(Math.round((bytes / (1024 * 1024)) * 10) / 10) });
  };

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    if (file.size === 0) {
      setError(t("attachments.emptyFileRejected"));
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setError(t("attachments.tooLarge", { limit: formatSize(ATTACHMENT_MAX_BYTES) }));
      return;
    }
    try {
      const contentBase64 = await readAsBase64(file);
      await upload.mutateAsync({
        entityType,
        entityId,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        notes: null,
        contentBase64,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attachments.uploadFailed"));
    }
  }

  async function onDownload(id: string, fileName: string, mimeType: string): Promise<void> {
    if (pendingId) return;
    setError(null);
    setPendingId(id);
    try {
      const content = await download.mutateAsync(id);
      triggerBrowserDownload(fileName, mimeType, content.contentBase64);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attachments.downloadFailed"));
    } finally {
      setPendingId(null);
    }
  }

  async function onDelete(id: string): Promise<void> {
    if (pendingId) return;
    setError(null);
    setPendingId(id);
    try {
      await remove.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("attachments.deleteFailed"));
    } finally {
      setPendingId(null);
    }
  }

  const rows = query.data ?? [];

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="text-[12.5px] text-ink-muted">{t("attachments.storedFilesHint", { limit: formatSize(ATTACHMENT_MAX_BYTES) })}</div>
        {mayUpload ? (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              aria-label={t("attachments.chooseFile")}
              onChange={(event) => void onFileChosen(event)}
            />
            <Button variant="primary" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
              {upload.isPending ? t("attachments.uploading") : t("attachments.upload")}
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      {!mayView ? (
        <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("attachments.noViewPermission")}</div>
      ) : query.isLoading ? (
        <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("common.loading")}</div>
      ) : query.isError ? (
        <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">
          {t("attachments.couldNotBeLoaded")}
          <Button size="sm" className="ms-[10px]" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("attachments.empty")}</div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[15px] py-[9px] text-start">{t("attachments.fileName")}</th>
                <th className="px-[15px] py-[9px] text-end">{t("attachments.size")}</th>
                <th className="px-[15px] py-[9px] text-start">{t("attachments.uploadedBy")}</th>
                <th className="px-[15px] py-[9px] text-start">{t("attachments.uploadedAt")}</th>
                <th className="px-[15px] py-[9px] text-end">{t("attachments.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-[15px] py-[10px] text-ink">
                    <div className="font-semibold">{row.fileName}</div>
                    {row.notes ? <div className="mt-[3px] text-[11.5px] text-ink-muted">{row.notes}</div> : null}
                  </td>
                  <td className="mz-num px-[15px] py-[10px] text-end text-ink">{formatSize(row.byteSize)}</td>
                  <td className="px-[15px] py-[10px] text-ink">{row.uploadedBy}</td>
                  <td className="mz-num px-[15px] py-[10px] text-ink">{format.dateTime(row.uploadedAt)}</td>
                  <td className="px-[15px] py-[10px] text-end">
                    <div className="flex justify-end gap-[6px]">
                      <Button size="sm" disabled={pendingId === row.id} onClick={() => void onDownload(row.id, row.fileName, row.mimeType)}>
                        {t("attachments.download")}
                      </Button>
                      {mayDelete ? (
                        <IconButton
                          aria-label={t("attachments.deleteFile", { name: row.fileName })}
                          disabled={pendingId === row.id}
                          onClick={() => void onDelete(row.id)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </IconButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
