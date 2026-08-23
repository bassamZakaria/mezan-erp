import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type {
  CustomerImportBatchDTO,
  SupplierImportBatchDTO,
  ItemImportBatchDTO,
  OpeningBalanceImportBatchDTO,
  DataMigrationResultDTO,
  HistoricalImportBatchDTO,
  HistoricalImportResultDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";

/**
 * Data-migration import wizard hooks (docs/catalog/09 "نقل البيانات") — kept
 * out of `data/hooks.ts` (per file ownership for this task) but following the
 * exact same pattern as `account-hooks.ts`: a typed TanStack Query hook per
 * endpoint, real backend calls, no sample data. Historical purchase-document
 * import reuses the EXISTING `/purchases/historical-import` routes.
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

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

function useImportMutation<TBody>(
  path: string,
  failureMessage: string,
): UseMutationResult<DataMigrationResultDTO, ApiError, TBody> {
  const { request } = useApi();
  return useMutation<DataMigrationResultDTO, ApiError, TBody>({
    mutationFn: async (body) => {
      const res = await request(path, { method: "POST", body: JSON.stringify(body) });
      const payload = await res.json<DataMigrationResultDTO & { error?: string; message?: string }>();
      if (!res.ok && res.status !== 422) throw new ApiError(res.status, payload.message ?? failureMessage);
      return payload;
    },
  });
}

export function useCustomerImportPreview() {
  return useImportMutation<CustomerImportBatchDTO>("/data-migration/customers/preview", "تعذّر معاينة استيراد العملاء.");
}
export function useCustomerImportCommit() {
  return useImportMutation<CustomerImportBatchDTO>("/data-migration/customers/commit", "تعذّر استيراد العملاء.");
}

export function useSupplierImportPreview() {
  return useImportMutation<SupplierImportBatchDTO>("/data-migration/suppliers/preview", "تعذّر معاينة استيراد الموردين.");
}
export function useSupplierImportCommit() {
  return useImportMutation<SupplierImportBatchDTO>("/data-migration/suppliers/commit", "تعذّر استيراد الموردين.");
}

export function useItemImportPreview() {
  return useImportMutation<ItemImportBatchDTO>("/data-migration/items/preview", "تعذّر معاينة استيراد الأصناف.");
}
export function useItemImportCommit() {
  return useImportMutation<ItemImportBatchDTO>("/data-migration/items/commit", "تعذّر استيراد الأصناف.");
}

export function useOpeningBalanceImportPreview() {
  return useImportMutation<OpeningBalanceImportBatchDTO>(
    "/data-migration/opening-balances/preview",
    "تعذّر معاينة استيراد الأرصدة الافتتاحية.",
  );
}
export function useOpeningBalanceImportCommit() {
  return useImportMutation<OpeningBalanceImportBatchDTO>(
    "/data-migration/opening-balances/commit",
    "تعذّر استيراد الأرصدة الافتتاحية.",
  );
}

function useHistoricalImportMutation(path: string, failureMessage: string) {
  const { request } = useApi();
  return useMutation<HistoricalImportResultDTO, ApiError, HistoricalImportBatchDTO>({
    mutationFn: async (body) => {
      const res = await request(path, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok && res.status !== 422) throw new ApiError(res.status, await readError(res, failureMessage));
      return res.json<HistoricalImportResultDTO>();
    },
  });
}

export function useHistoricalImportPreview() {
  return useHistoricalImportMutation("/purchases/historical-import/preview", "تعذّر معاينة استيراد المستندات السابقة.");
}
export function useHistoricalImportCommit() {
  return useHistoricalImportMutation("/purchases/historical-import/commit", "تعذّر استيراد المستندات السابقة.");
}
