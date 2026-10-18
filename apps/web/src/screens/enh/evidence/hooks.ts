import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  EVIDENCE_PACK_ENCODING_PARAM,
  EvidencePackEncoding,
  type EvidencePackInlineDTO,
  type EvidencePackRecordDTO,
  type EvidencePeriodDTO,
  type EvidencePublicKeyDTO,
  type SequenceGapReportDTO,
} from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { SAVE_TO_FILE_UNSUPPORTED_STATUS, canSaveToFile, type SaveToFileInit } from "../../../data/transport";
import { ApiError, loaderError, readError } from "../../../data/hooks";
import { useAppTranslation } from "../../../i18n";

const PACKS_KEY = ["evidence-packs"] as const;
const KEY_KEY = ["evidence-packs", "public-key"] as const;
const GAPS_KEY = "sequence-gaps";
const ZIP_TYPE = "application/zip";
const MANIFEST_HEADER = "x-evidence-manifest-sha256";

export interface BuiltPack {
  readonly manifestSha256: string;
  readonly cancelled?: boolean;
}

function usesBridge(): boolean {
  return (globalThis as { mezan?: unknown }).mezan !== undefined;
}

function saveBlob(fileName: string, blob: Blob): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function base64Blob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function saveTextFile(fileName: string, content: string, type: string): void {
  saveBlob(fileName, new Blob([content], { type }));
}

export function useEvidencePacks(): UseQueryResult<EvidencePackRecordDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EvidencePackRecordDTO[], ApiError>({
    queryKey: PACKS_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/audit/evidence-packs");
      if (!res.ok) throw await loaderError(res, t("evidence.historyFailed"), t);
      return res.json<EvidencePackRecordDTO[]>();
    },
  });
}

export function useEvidencePublicKey(): UseQueryResult<EvidencePublicKeyDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EvidencePublicKeyDTO, ApiError>({
    queryKey: KEY_KEY,
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/audit/evidence-packs/public-key");
      if (!res.ok) throw await loaderError(res, t("evidence.key.failed"), t);
      return res.json<EvidencePublicKeyDTO>();
    },
  });
}

export function useBuildEvidencePack() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BuiltPack, ApiError, EvidencePeriodDTO>({
    gcTime: 0,
    mutationFn: async (period) => {
      const fileName = `mezan-evidence-${period.from}_${period.to}.zip`;
      if (canSaveToFile()) {
        const toDisk: SaveToFileInit = { method: "POST", body: JSON.stringify(period), saveAs: fileName };
        const saved = await request("/audit/evidence-packs", toDisk);
        if (saved.cancelled) return { manifestSha256: "", cancelled: true };
        if (saved.status !== SAVE_TO_FILE_UNSUPPORTED_STATUS) {
          if (!saved.ok) throw new ApiError(saved.status, await readError(saved, t("evidence.buildFailed"), t));
          return { manifestSha256: saved.header?.(MANIFEST_HEADER) ?? "" };
        }
      }
      const inline = usesBridge();
      const path = inline ? `/audit/evidence-packs?${EVIDENCE_PACK_ENCODING_PARAM}=${EvidencePackEncoding.Base64}` : "/audit/evidence-packs";
      const res = await request(path, { method: "POST", body: JSON.stringify(period) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("evidence.buildFailed"), t));
      if (inline || !res.blob) {
        const body = await res.json<EvidencePackInlineDTO>();
        saveBlob(body.fileName, base64Blob(body.zipBase64, ZIP_TYPE));
        return { manifestSha256: body.manifestSha256 };
      }
      saveBlob(fileName, await res.blob());
      return { manifestSha256: res.header?.(MANIFEST_HEADER) ?? "" };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PACKS_KEY }),
  });
}

export function useSequenceGaps(period: EvidencePeriodDTO | null): UseQueryResult<SequenceGapReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SequenceGapReportDTO, ApiError>({
    queryKey: [GAPS_KEY, period?.from, period?.to],
    enabled: session !== null && period !== null,
    queryFn: async () => {
      const query = new URLSearchParams({ from: period!.from, to: period!.to });
      const res = await request(`/audit/sequence-gaps?${query.toString()}`);
      if (!res.ok) throw await loaderError(res, t("sequenceGaps.failed"), t);
      return res.json<SequenceGapReportDTO>();
    },
  });
}
