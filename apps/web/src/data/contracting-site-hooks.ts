import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ConsumptionByBoqLineRowDTO,
  CreateEquipmentLogDTO,
  CreateMaterialConsumptionDTO,
  CreateSiteIssueDTO,
  CreateSiteReceiptDTO,
  CustodyItemDTO,
  EquipmentHoursRowDTO,
  EquipmentLogDTO,
  IssueCustodyDTO,
  MaterialConsumptionDTO,
  ReturnCustodyDTO,
  SiteIssueDTO,
  SiteIssueStatusDTO,
  SiteReceiptDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { loaderError } from "./hooks";
import { readServerMessage } from "./server-message";
import { useAppTranslation } from "../i18n";

/**
 * مستودعات المواقع — data hooks for slice 4A of المقاولات, kept out of
 * `data/hooks.ts` but following its pattern exactly: one typed TanStack Query
 * hook per endpoint, real loading/error/empty states, mutations invalidating
 * their own key AND the stock balance every one of them moves.
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

function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface SiteIssueFilter {
  readonly projectId?: string;
  readonly status?: SiteIssueStatusDTO | "all";
}

/** An issue plus the remaining quantity per item, derived server-side from confirmed receipts. */
export interface SiteIssueDetailDTO extends SiteIssueDTO {
  readonly outstanding: readonly { readonly itemId: string; readonly qty: string }[];
}

export function useSiteIssues(filter: SiteIssueFilter = {}): UseQueryResult<SiteIssueDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SiteIssueDTO[], ApiError>({
    queryKey: ["site-issues", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/issues${queryString({ projectId: filter.projectId, status: filter.status })}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.issuesLoadFailed"), t);
      return res.json<SiteIssueDTO[]>();
    },
  });
}

export function useSiteIssue(id: string | null): UseQueryResult<SiteIssueDetailDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SiteIssueDetailDTO, ApiError>({
    queryKey: ["site-issues", "one", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/issues/${encodeURIComponent(id as string)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.issuesLoadFailed"), t);
      return res.json<SiteIssueDetailDTO>();
    },
  });
}

export function useCreateSiteIssue() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SiteIssueDTO, ApiError, CreateSiteIssueDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/site/issues", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.issueSaveFailed")));
      return res.json<SiteIssueDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-issues"] }),
  });
}

export function useConfirmSiteIssue() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SiteIssueDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/contracting/site/issues/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.issueConfirmFailed")));
      return res.json<SiteIssueDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-issues"] });
      queryClient.invalidateQueries({ queryKey: ["site-unreceived"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

export function useSiteReceipts(filter: { projectId?: string; issueId?: string } = {}): UseQueryResult<SiteReceiptDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SiteReceiptDTO[], ApiError>({
    queryKey: ["site-receipts", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/receipts${queryString(filter)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.receiptsLoadFailed"), t);
      return res.json<SiteReceiptDTO[]>();
    },
  });
}

export function useCreateSiteReceipt() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SiteReceiptDTO, ApiError, CreateSiteReceiptDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/site/receipts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.receiptSaveFailed")));
      return res.json<SiteReceiptDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-receipts"] }),
  });
}

export function useConfirmSiteReceipt() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SiteReceiptDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/contracting/site/receipts/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.receiptConfirmFailed")));
      return res.json<SiteReceiptDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["site-issues"] });
      queryClient.invalidateQueries({ queryKey: ["site-unreceived"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

export interface UnreceivedFilter {
  readonly projectId?: string;
  readonly olderThanDays?: number;
}

export function useSiteUnreceived(filter: UnreceivedFilter = {}) {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery({
    queryKey: ["site-unreceived", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = queryString({
        projectId: filter.projectId,
        olderThanDays: filter.olderThanDays ? String(filter.olderThanDays) : undefined,
      });
      const res = await request(`/contracting/site/unreceived${qs}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.unreceivedLoadFailed"), t);
      return res.json<
        {
          issueId: string;
          docNo: string | null;
          date: string;
          projectId: string;
          itemId: string;
          qtyIssued: string;
          qtyReceived: string;
          qtyOutstanding: string;
          ageDays: number;
        }[]
      >();
    },
  });
}

export function useMaterialConsumptions(filter: { projectId?: string; warehouseId?: string } = {}): UseQueryResult<MaterialConsumptionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<MaterialConsumptionDTO[], ApiError>({
    queryKey: ["material-consumptions", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/consumptions${queryString(filter)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.consumptionsLoadFailed"), t);
      return res.json<MaterialConsumptionDTO[]>();
    },
  });
}

export function useCreateMaterialConsumption() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<MaterialConsumptionDTO, ApiError, CreateMaterialConsumptionDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/site/consumptions", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.consumptionSaveFailed")));
      return res.json<MaterialConsumptionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["material-consumptions"] }),
  });
}

export function useConfirmMaterialConsumption() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<MaterialConsumptionDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/contracting/site/consumptions/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.consumptionConfirmFailed")));
      return res.json<MaterialConsumptionDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["material-consumptions"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    },
  });
}

export function useConsumptionByBoqLine(projectId: string | null): UseQueryResult<ConsumptionByBoqLineRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ConsumptionByBoqLineRowDTO[], ApiError>({
    queryKey: ["consumption-by-boq-line", projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/consumption-by-boq-line?projectId=${encodeURIComponent(projectId as string)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.consumptionsLoadFailed"), t);
      return res.json<ConsumptionByBoqLineRowDTO[]>();
    },
  });
}

export function useCustodyItems(filter: { projectId?: string; warehouseId?: string } = {}): UseQueryResult<CustodyItemDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CustodyItemDTO[], ApiError>({
    queryKey: ["site-custody", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/custody${queryString(filter)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.custodyLoadFailed"), t);
      return res.json<CustodyItemDTO[]>();
    },
  });
}

export function useIssueCustody() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustodyItemDTO, ApiError, IssueCustodyDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/site/custody", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.custodySaveFailed")));
      return res.json<CustodyItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-custody"] }),
  });
}

export function useReturnCustody() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustodyItemDTO, ApiError, { id: string; body: ReturnCustodyDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/contracting/site/custody/${encodeURIComponent(id)}/return`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.custodyReturnFailed")));
      return res.json<CustodyItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-custody"] }),
  });
}

export function useEquipmentLogs(filter: { projectId?: string; assetId?: string } = {}): UseQueryResult<EquipmentLogDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EquipmentLogDTO[], ApiError>({
    queryKey: ["equipment-logs", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/equipment-logs${queryString(filter)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.equipmentLogsLoadFailed"), t);
      return res.json<EquipmentLogDTO[]>();
    },
  });
}

export function useCreateEquipmentLog() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EquipmentLogDTO, ApiError, CreateEquipmentLogDTO>({
    mutationFn: async (body) => {
      const res = await request("/contracting/site/equipment-logs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.equipmentLogSaveFailed")));
      return res.json<EquipmentLogDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["equipment-logs"] }),
  });
}

export function useConfirmEquipmentLog() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EquipmentLogDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/contracting/site/equipment-logs/${encodeURIComponent(id)}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readServerMessage(res, t("siteApi.equipmentLogConfirmFailed")));
      return res.json<EquipmentLogDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equipment-logs"] });
      queryClient.invalidateQueries({ queryKey: ["equipment-hours"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    },
  });
}

export function useEquipmentHours(projectId: string | null): UseQueryResult<EquipmentHoursRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EquipmentHoursRowDTO[], ApiError>({
    queryKey: ["equipment-hours", projectId],
    enabled: session !== null && projectId !== null,
    queryFn: async () => {
      const res = await request(`/contracting/site/equipment-hours?projectId=${encodeURIComponent(projectId as string)}`);
      if (!res.ok) throw await loaderError(res, t("siteApi.equipmentLogsLoadFailed"), t);
      return res.json<EquipmentHoursRowDTO[]>();
    },
  });
}
