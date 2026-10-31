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
import { useAppTranslation } from "../i18n";
import { readError } from "./hooks";
import { serverMessage, type ServerErrorBody } from "./server-message";

/**
 * Data-migration import wizard hooks (docs/archive/catalog/09 "نقل البيانات") — kept
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

function useImportMutation<TBody>(
  path: string,
  failureMessage: string,
): UseMutationResult<DataMigrationResultDTO, ApiError, TBody> {
  const { request } = useApi();
  return useMutation<DataMigrationResultDTO, ApiError, TBody>({
    mutationFn: async (body) => {
      const res = await request(path, { method: "POST", body: JSON.stringify(body) });
      const payload = await res.json<DataMigrationResultDTO & ServerErrorBody>();
      if (!res.ok && res.status !== 422) throw new ApiError(res.status, serverMessage(payload) ?? failureMessage);
      return payload;
    },
  });
}

export function useCustomerImportPreview() {
  const { t } = useAppTranslation();
  return useImportMutation<CustomerImportBatchDTO>("/data-migration/customers/preview", t("migration.theCustomerImportCouldNot"));
}
export function useCustomerImportCommit() {
  const { t } = useAppTranslation();
  return useImportMutation<CustomerImportBatchDTO>("/data-migration/customers/commit", t("migration.theCustomersCouldNotBe"));
}

export function useSupplierImportPreview() {
  const { t } = useAppTranslation();
  return useImportMutation<SupplierImportBatchDTO>("/data-migration/suppliers/preview", t("migration.theSupplierImportCouldNot"));
}
export function useSupplierImportCommit() {
  const { t } = useAppTranslation();
  return useImportMutation<SupplierImportBatchDTO>("/data-migration/suppliers/commit", t("migration.theSuppliersCouldNotBe"));
}

export function useItemImportPreview() {
  const { t } = useAppTranslation();
  return useImportMutation<ItemImportBatchDTO>("/data-migration/items/preview", t("migration.theItemImportCouldNot"));
}
export function useItemImportCommit() {
  const { t } = useAppTranslation();
  return useImportMutation<ItemImportBatchDTO>("/data-migration/items/commit", t("migration.theItemsCouldNotBe"));
}

export function useOpeningBalanceImportPreview() {
  const { t } = useAppTranslation();
  return useImportMutation<OpeningBalanceImportBatchDTO>(
    "/data-migration/opening-balances/preview",
    t("migration.theOpeningBalanceImportCould"),
  );
}
export function useOpeningBalanceImportCommit() {
  const { t } = useAppTranslation();
  return useImportMutation<OpeningBalanceImportBatchDTO>(
    "/data-migration/opening-balances/commit",
    t("migration.theOpeningBalancesCouldNot"),
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
  const { t } = useAppTranslation();
  return useHistoricalImportMutation("/purchases/historical-import/preview", t("migration.theHistoricalDocumentImportCould"));
}
export function useHistoricalImportCommit() {
  const { t } = useAppTranslation();
  return useHistoricalImportMutation("/purchases/historical-import/commit", t("migration.theHistoricalDocumentsCouldNot"));
}
