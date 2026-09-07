import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { BarcodeConfigDTO, UpdateBarcodeConfigDTO } from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";
import { withSupportCode, type AppTranslate } from "./hooks";

/**
 * Barcode configuration hooks (docs' "barcode-config screen") — kept out of
 * `data/hooks.ts` (per file ownership for this task) but following the exact
 * same pattern as `account-hooks.ts`.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function readError(
  res: { readonly status: number; json<T>(): Promise<T> },
  fallback: string,
  separator: string,
  t?: AppTranslate,
): Promise<string> {
  const body = (await res.json<{ message?: string; reasons?: string[] }>().catch(() => ({}))) as {
    message?: string;
    reasons?: string[];
  };
  if (body.reasons && body.reasons.length > 0) return body.reasons.join(separator);
  if (body.message !== undefined && body.message !== "") return body.message;
  return withSupportCode(fallback, res.status, t);
}

export function useBarcodeConfig(): UseQueryResult<BarcodeConfigDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BarcodeConfigDTO, ApiError>({
    queryKey: ["barcode-config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/barcode-config");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("barcode.couldNotLoadTheBarcode"), t("notifRules.channelSeparator"), t));
      return res.json<BarcodeConfigDTO>();
    },
  });
}

export function useUpdateBarcodeConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BarcodeConfigDTO, ApiError, UpdateBarcodeConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/barcode-config", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("barcodeApi.theBarcodeSettingsCouldNot"), t("notifRules.channelSeparator"), t));
      return res.json<BarcodeConfigDTO>();
    },
    onSuccess: (config) => queryClient.setQueryData(["barcode-config"], config),
  });
}

export type ParseBarcodeResult =
  | { readonly matched: true; readonly ruleId: string; readonly itemCode: string; readonly value: number; readonly valueType: "PRICE" | "WEIGHT" }
  | { readonly matched: false };

export function useParseBarcode() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<ParseBarcodeResult, ApiError, string>({
    mutationFn: async (code) => {
      const res = await request("/barcode-config/parse", { method: "POST", body: JSON.stringify({ code }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("barcodeApi.theBarcodeCouldNotBe"), t("notifRules.channelSeparator"), t));
      return res.json<ParseBarcodeResult>();
    },
  });
}
