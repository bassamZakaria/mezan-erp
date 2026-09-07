import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateStockAdjustmentDTO,
  CreateStockTransferDTO,
  DocumentStatusDTO,
  GenerateAdjustmentFromCountDTO,
  PhysicalCountDTO,
  PhysicalCountStatusDTO,
  RecordPhysicalCountEntriesDTO,
  StartPhysicalCountDTO,
  StockAdjustmentDocumentDTO,
  StockBalanceRowDTO,
  StockTransferDocumentDTO,
} from "@mezan/contracts";
import { ApiError, type JournalEntryDTO } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/* -------------------------------------------------------------------- */
/* أرصدة المخزون — Stock Balance (docs/archive/catalog/03, GET /inventory/stock-balance) */
/* -------------------------------------------------------------------- */

export function useStockBalance(warehouseId?: string): UseQueryResult<StockBalanceRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockBalanceRowDTO[], ApiError>({
    queryKey: ["inventory", "stock-balance", warehouseId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = warehouseId ? `?warehouseId=${encodeURIComponent(warehouseId)}` : "";
      const res = await request(`/inventory/stock-balance${qs}`);
      if (!res.ok) throw new ApiError(res.status, t("stockBalance.loadFailed"));
      const body = await res.json<{ rows: StockBalanceRowDTO[] }>();
      return body.rows;
    },
  });
}

/* -------------------------------------------------------------------- */
/* تسويات المخزون — Stock Adjustments (docs/archive/catalog/03, /inventory/stock-adjustments) */
/* -------------------------------------------------------------------- */

export function useStockAdjustments(status?: DocumentStatusDTO): UseQueryResult<StockAdjustmentDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockAdjustmentDocumentDTO[], ApiError>({
    queryKey: ["inventory", "stock-adjustments", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/inventory/stock-adjustments${qs}`);
      if (!res.ok) throw new ApiError(res.status, t("stockAdj.stockAdjustmentsCouldNotBe"));
      return res.json<StockAdjustmentDocumentDTO[]>();
    },
  });
}

/** Creates the draft, then immediately confirms it (the screens only ever post a fully-formed adjustment). */
export function useCreateStockAdjustment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockAdjustmentDocumentDTO, ApiError, CreateStockAdjustmentDTO>({
    mutationFn: async (body) => {
      const draftRes = await request("/inventory/stock-adjustments/draft", { method: "POST", body: JSON.stringify(body) });
      if (!draftRes.ok) throw new ApiError(draftRes.status, await readMessage(draftRes, t("stockOps.theAdjustmentCouldNotBe")));
      const draft = await draftRes.json<StockAdjustmentDocumentDTO>();
      const confirmRes = await request(`/inventory/stock-adjustments/${draft.id}/confirm`, { method: "POST" });
      if (!confirmRes.ok) throw new ApiError(confirmRes.status, await readMessage(confirmRes, t("stockOps.theAdjustmentCouldNotBe2")));
      const { document } = await confirmRes.json<{ document: StockAdjustmentDocumentDTO; held: boolean }>();
      return document;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-balance"] });
    },
  });
}

/** The GL entry backing a confirmed adjustment shares its own document id (packages/domain/src/inventory/document-hooks.ts). A 404 means no value delta — no entry was posted, not an error. */
export function useAdjustmentJournalEntry(docId: string | null): UseQueryResult<JournalEntryDTO | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO | null, ApiError>({
    queryKey: ["inventory", "stock-adjustments", "journal-entry", docId],
    enabled: session !== null && docId !== null,
    queryFn: async () => {
      const res = await request(`/gl/journal-entries/${docId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new ApiError(res.status, t("stockAdj.theJournalEntryCouldNot"));
      return res.json<JournalEntryDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* تحويلات المخزون — Stock Transfers (docs/archive/catalog/03, /inventory/stock-transfers) */
/* -------------------------------------------------------------------- */

export function useStockTransfers(status?: DocumentStatusDTO): UseQueryResult<StockTransferDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockTransferDocumentDTO[], ApiError>({
    queryKey: ["inventory", "stock-transfers", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/inventory/stock-transfers${qs}`);
      if (!res.ok) throw new ApiError(res.status, t("stockXfer.stockTransfersCouldNotBe"));
      return res.json<StockTransferDocumentDTO[]>();
    },
  });
}

/** Creates the draft, then immediately confirms it (transfers are one-way — there is no separate "confirm later" flow in the UI). */
export function useCreateStockTransfer() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockTransferDocumentDTO, ApiError, CreateStockTransferDTO>({
    mutationFn: async (body) => {
      const draftRes = await request("/inventory/stock-transfers/draft", { method: "POST", body: JSON.stringify(body) });
      if (!draftRes.ok) throw new ApiError(draftRes.status, await readMessage(draftRes, t("stockOps.theTransferCouldNotBe")));
      const draft = await draftRes.json<StockTransferDocumentDTO>();
      const confirmRes = await request(`/inventory/stock-transfers/${draft.id}/confirm`, { method: "POST" });
      if (!confirmRes.ok) throw new ApiError(confirmRes.status, await readMessage(confirmRes, t("stockOps.theTransferCouldNotBe2")));
      const { document } = await confirmRes.json<{ document: StockTransferDocumentDTO; held: boolean }>();
      return document;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-balance"] });
    },
  });
}

/* -------------------------------------------------------------------- */
/* الجرد الفعلي — Physical Counts (docs/archive/catalog/03, /inventory/physical-counts) */
/* -------------------------------------------------------------------- */

export interface PhysicalCountListFilters {
  readonly status?: PhysicalCountStatusDTO;
  readonly warehouseId?: string;
}

function countQueryString(filters: PhysicalCountListFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
  const qs = params.toString();
  return qs === "" ? "" : `?${qs}`;
}

/**
 * The cache key is `["physical-counts", …]` and NOT `["inventory", …]`: the
 * الجرد الفعلي screen reads its list, its chip counts and its KPI strip through
 * `hooks.ts` under that prefix, while these mutations invalidated a prefix
 * nothing read — so starting a count bounced back to an empty list and
 * completing one left the row on قيد التنفيذ (D66). One prefix, or the screen
 * never refreshes.
 */
export function usePhysicalCounts(filters: PhysicalCountListFilters = {}): UseQueryResult<PhysicalCountDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PhysicalCountDTO[], ApiError>({
    queryKey: ["physical-counts", filters],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/inventory/physical-counts${countQueryString(filters)}`);
      if (!res.ok) throw new ApiError(res.status, t("counts.physicalCountsCouldNotBe"));
      return res.json<PhysicalCountDTO[]>();
    },
  });
}

export function useStartPhysicalCount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, StartPhysicalCountDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/physical-counts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theCountCouldNotBe")));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useRecordPhysicalCounts() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, { id: string; body: RecordPhysicalCountEntriesDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/inventory/physical-counts/${id}/counts`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("stockOps.theCountedQuantitiesCouldNot")));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useCompletePhysicalCount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/physical-counts/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theCountCouldNotBe2")));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useCancelPhysicalCount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/physical-counts/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("api.theCountCouldNotBe3")));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useGenerateAdjustmentFromCount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    { count: PhysicalCountDTO; adjustment: StockAdjustmentDocumentDTO | null },
    ApiError,
    { id: string; body: GenerateAdjustmentFromCountDTO }
  >({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/inventory/physical-counts/${id}/generate-adjustment`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("stockOps.theAdjustmentCouldNotBe3")));
      return res.json<{ count: PhysicalCountDTO; adjustment: StockAdjustmentDocumentDTO | null }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["physical-counts"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["inventory", "stock-balance"] });
    },
  });
}
