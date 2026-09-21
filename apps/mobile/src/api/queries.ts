import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { z } from "zod";
import {
  approvalRequestSchema,
  branchSchema,
  cockpitSchema,
  confirmSalesInvoiceSchema,
  confirmVoucherSchema,
  createAllocationSchema,
  createSalesInvoiceSchema,
  createSalesQuoteSchema,
  createVoucherSchema,
  customerSchema,
  dashboardSummarySchema,
  decideApprovalRequestSchema,
  itemSchema,
  itemStockSchema,
  openInvoiceSchema,
  salesInvoiceSchema,
  salesQuoteSchema,
  selfClockPunchResultSchema,
  selfClockStatusSchema,
  treasuryAccountSchema,
  userSchema,
  voucherAllocationSchema,
  voucherSchema,
  warehouseSchema,
  type ApprovalRequestDTO,
  type BranchDTO,
  type CockpitDTO,
  type ConfirmSalesInvoiceDTO,
  type ConfirmVoucherDTO,
  type CreateAllocationDTO,
  type CreateSalesInvoiceDTO,
  type CreateSalesQuoteDTO,
  type CreateVoucherDTO,
  type CustomerDTO,
  type DashboardSummaryDTO,
  type DecideApprovalRequestDTO,
  type ItemDTO,
  type ItemStockDTO,
  type OpenInvoiceDTO,
  type SalesInvoiceDTO,
  type SalesQuoteDTO,
  type SelfClockPunchDTO,
  type SelfClockPunchResultResponseDTO,
  type SelfClockStatusResponseDTO,
  type TreasuryAccountDTO,
  type UserDTO,
  type VoucherAllocationDTO,
  type VoucherDTO,
  type WarehouseDTO,
} from "@mezan/contracts";
import { AllocationInvoiceKind, SalesInvoiceSort, SortDirection } from "@/domain/enums";
import { useSession } from "@/session/SessionProvider";
import { HttpMethod } from "./client";
import type { ApiError } from "./errors";

export enum QueryKey {
  DashboardSummary = "dashboard-summary",
  Customers = "customers",
  Customer = "customer",
  Branches = "branches",
  Warehouses = "warehouses",
  Items = "items",
  ItemStock = "item-stock",
  TreasuryAccounts = "treasury-accounts",
  OpenInvoices = "open-invoices",
  SelfClockStatus = "self-clock-status",
  PendingApprovals = "pending-approvals",
  Cockpit = "cockpit",
  CustomerAging = "customer-aging",
  CustomerInvoices = "customer-invoices",
  SalesInvoice = "sales-invoice",
  User = "user",
}

const LATEST_INVOICES = 5;

const customerListSchema = z.array(customerSchema);

export function useDashboardSummary(): UseQueryResult<DashboardSummaryDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<DashboardSummaryDTO, ApiError>({
    queryKey: [QueryKey.DashboardSummary],
    enabled: session !== null,
    queryFn: () => request("/dashboard/summary", { schema: dashboardSummarySchema }),
  });
}

export function useCustomers(search: string): UseQueryResult<CustomerDTO[], ApiError> {
  const { request, session } = useSession();
  const trimmed = search.trim();
  return useQuery<CustomerDTO[], ApiError>({
    queryKey: [QueryKey.Customers, trimmed],
    enabled: session !== null,
    queryFn: () => {
      const params = new URLSearchParams();
      if (trimmed !== "") params.set("q", trimmed);
      const query = params.toString();
      return request(`/customers${query === "" ? "" : `?${query}`}`, { schema: customerListSchema });
    },
  });
}

export function useCustomer(id: string): UseQueryResult<CustomerDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<CustomerDTO, ApiError>({
    queryKey: [QueryKey.Customer, id],
    enabled: session !== null && id !== "",
    queryFn: () => request(`/customers/${encodeURIComponent(id)}`, { schema: customerSchema }),
  });
}

const branchListSchema = z.array(branchSchema);
const warehouseListSchema = z.array(warehouseSchema);
const itemListSchema = z.array(itemSchema);
const treasuryAccountListSchema = z.array(treasuryAccountSchema);
const openInvoiceListSchema = z.array(openInvoiceSchema);
const pendingApprovalListSchema = z.array(approvalRequestSchema);

export function useBranches(): UseQueryResult<BranchDTO[], ApiError> {
  const { request, session } = useSession();
  return useQuery<BranchDTO[], ApiError>({
    queryKey: [QueryKey.Branches],
    enabled: session !== null,
    queryFn: () => request("/branches", { schema: branchListSchema }),
  });
}

export function useWarehouses(): UseQueryResult<WarehouseDTO[], ApiError> {
  const { request, session } = useSession();
  return useQuery<WarehouseDTO[], ApiError>({
    queryKey: [QueryKey.Warehouses],
    enabled: session !== null,
    queryFn: () => request("/warehouses", { schema: warehouseListSchema }),
  });
}

export function useTreasuryAccounts(): UseQueryResult<TreasuryAccountDTO[], ApiError> {
  const { request, session } = useSession();
  return useQuery<TreasuryAccountDTO[], ApiError>({
    queryKey: [QueryKey.TreasuryAccounts],
    enabled: session !== null,
    queryFn: () => request("/treasury-accounts", { schema: treasuryAccountListSchema }),
  });
}

/** The item picker: a live search over the real catalogue, never a locally typed name. */
export function useItemSearch(search: string, enabled = true): UseQueryResult<ItemDTO[], ApiError> {
  const { request, session } = useSession();
  const trimmed = search.trim();
  return useQuery<ItemDTO[], ApiError>({
    queryKey: [QueryKey.Items, trimmed],
    enabled: session !== null && enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      if (trimmed !== "") params.set("search", trimmed);
      const query = params.toString();
      return request(`/items${query === "" ? "" : `?${query}`}`, { schema: itemListSchema });
    },
  });
}

export function useItemStock(itemId: string | null): UseQueryResult<ItemStockDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<ItemStockDTO, ApiError>({
    queryKey: [QueryKey.ItemStock, itemId],
    enabled: session !== null && itemId !== null,
    queryFn: () => request(`/inventory/items/${encodeURIComponent(itemId!)}/stock`, { schema: itemStockSchema }),
  });
}

export function useOpenInvoices(kind: AllocationInvoiceKind, partyId: string | null): UseQueryResult<OpenInvoiceDTO[], ApiError> {
  const { request, session } = useSession();
  return useQuery<OpenInvoiceDTO[], ApiError>({
    queryKey: [QueryKey.OpenInvoices, kind, partyId],
    enabled: session !== null && partyId !== null,
    queryFn: () => {
      const params = new URLSearchParams({ kind });
      if (partyId) params.set("partyId", partyId);
      return request(`/open-invoices?${params.toString()}`, { schema: openInvoiceListSchema });
    },
  });
}

export function useCreateSalesInvoice(): UseMutationResult<SalesInvoiceDTO, ApiError, CreateSalesInvoiceDTO> {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, CreateSalesInvoiceDTO>({
    mutationFn: (body) =>
      request("/sales-invoices", { method: HttpMethod.Post, body, schema: salesInvoiceSchema }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QueryKey.DashboardSummary] }),
  });
}

export function useConfirmSalesInvoice(): UseMutationResult<
  SalesInvoiceDTO,
  ApiError,
  { id: string; body?: ConfirmSalesInvoiceDTO }
> {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, { id: string; body?: ConfirmSalesInvoiceDTO }>({
    mutationFn: ({ id, body }) =>
      request(`/sales-invoices/${encodeURIComponent(id)}/confirm`, {
        method: HttpMethod.Post,
        body: body ?? {},
        schema: salesInvoiceSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QueryKey.DashboardSummary] }),
  });
}

export function useCreateSalesQuote(): UseMutationResult<SalesQuoteDTO, ApiError, CreateSalesQuoteDTO> {
  const { request } = useSession();
  return useMutation<SalesQuoteDTO, ApiError, CreateSalesQuoteDTO>({
    mutationFn: (body) => request("/sales-quotes", { method: HttpMethod.Post, body, schema: salesQuoteSchema }),
  });
}

export function useCreateVoucher(): UseMutationResult<VoucherDTO, ApiError, CreateVoucherDTO> {
  const { request } = useSession();
  return useMutation<VoucherDTO, ApiError, CreateVoucherDTO>({
    mutationFn: (body) => request("/vouchers", { method: HttpMethod.Post, body, schema: voucherSchema }),
  });
}

export function useConfirmVoucher(): UseMutationResult<VoucherDTO, ApiError, { id: string; body?: ConfirmVoucherDTO }> {
  const { request } = useSession();
  return useMutation<VoucherDTO, ApiError, { id: string; body?: ConfirmVoucherDTO }>({
    mutationFn: ({ id, body }) =>
      request(`/vouchers/${encodeURIComponent(id)}/confirm`, { method: HttpMethod.Post, body: body ?? {}, schema: voucherSchema }),
  });
}

export function useCreateAllocation(): UseMutationResult<
  VoucherAllocationDTO,
  ApiError,
  { voucherId: string; body: CreateAllocationDTO }
> {
  const { request } = useSession();
  return useMutation<VoucherAllocationDTO, ApiError, { voucherId: string; body: CreateAllocationDTO }>({
    mutationFn: ({ voucherId, body }) =>
      request(`/vouchers/${encodeURIComponent(voucherId)}/allocations`, {
        method: HttpMethod.Post,
        body,
        schema: voucherAllocationSchema,
      }),
  });
}

export function useSelfClockStatus(enabled: boolean): UseQueryResult<SelfClockStatusResponseDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<SelfClockStatusResponseDTO, ApiError>({
    queryKey: [QueryKey.SelfClockStatus],
    enabled: session !== null && enabled,
    queryFn: () => request("/hr/self/clock", { schema: selfClockStatusSchema }),
  });
}

export function useSelfClockPunch(): UseMutationResult<SelfClockPunchResultResponseDTO, ApiError, SelfClockPunchDTO> {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation<SelfClockPunchResultResponseDTO, ApiError, SelfClockPunchDTO>({
    mutationFn: (body) =>
      request("/hr/self/clock", { method: HttpMethod.Post, body, schema: selfClockPunchResultSchema }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [QueryKey.SelfClockStatus] }),
  });
}

export function usePendingApprovals(enabled = true): UseQueryResult<ApprovalRequestDTO[], ApiError> {
  const { request, session } = useSession();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: [QueryKey.PendingApprovals],
    enabled: session !== null && enabled,
    queryFn: () => request("/workflow/requests/pending", { schema: pendingApprovalListSchema }),
  });
}

export function useDecideApproval(): UseMutationResult<ApprovalRequestDTO, ApiError, { id: string; body: DecideApprovalRequestDTO }> {
  const { request } = useSession();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, { id: string; body: DecideApprovalRequestDTO }>({
    mutationFn: ({ id, body }) =>
      request(`/workflow/requests/${encodeURIComponent(id)}/decide`, {
        method: HttpMethod.Post,
        body,
        schema: approvalRequestSchema,
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: [QueryKey.PendingApprovals] }),
  });
}

/** The owner cockpit: its `cash` section carries each treasury account's ledger balance, `null` when the caller may not see treasury. */
export function useCockpit(enabled: boolean): UseQueryResult<CockpitDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<CockpitDTO, ApiError>({
    queryKey: [QueryKey.Cockpit],
    enabled: session !== null && enabled,
    queryFn: () => request("/dashboard/cockpit", { schema: cockpitSchema }),
  });
}

/**
 * The customer aging ladder's rows. The route answers with JSON NUMBERS for
 * its buckets, not decimal strings; `decimalFromWireNumber` turns them back
 * before anything formats them.
 */
const customerAgingRowSchema = z.object({
  customerId: z.string(),
  current: z.number(),
  d31to60: z.number(),
  d61to90: z.number(),
  d91to120: z.number(),
  over120: z.number(),
  total: z.number(),
});
const customerAgingReportSchema = z.object({ rows: z.array(customerAgingRowSchema) });
export type CustomerAgingRow = z.infer<typeof customerAgingRowSchema>;

export function useCustomerAging(customerId: string, enabled: boolean): UseQueryResult<CustomerAgingRow | null, ApiError> {
  const { request, session } = useSession();
  return useQuery<CustomerAgingRow | null, ApiError>({
    queryKey: [QueryKey.CustomerAging, customerId],
    enabled: session !== null && enabled && customerId !== "",
    queryFn: async () => {
      const report = await request("/reports/aging/customers", { schema: customerAgingReportSchema });
      return report.rows.find((row) => row.customerId === customerId) ?? null;
    },
  });
}

/**
 * The list route serialises its lines without `costCenterId`, which the full
 * contract requires, so the whole row fails to parse. The 360 shows only the
 * header, so it parses only the header — still against the shared contract.
 */
const invoiceHeaderSchema = salesInvoiceSchema.pick({
  id: true,
  docNo: true,
  date: true,
  currency: true,
  baseGrandTotal: true,
  remainingBalance: true,
});
export type InvoiceHeader = z.infer<typeof invoiceHeaderSchema>;
const invoiceHeaderListSchema = z.array(invoiceHeaderSchema);

export function useCustomerInvoices(customerId: string, enabled: boolean): UseQueryResult<InvoiceHeader[], ApiError> {
  const { request, session } = useSession();
  return useQuery<InvoiceHeader[], ApiError>({
    queryKey: [QueryKey.CustomerInvoices, customerId],
    enabled: session !== null && enabled && customerId !== "",
    queryFn: () => {
      const params = new URLSearchParams({
        customerId,
        pageSize: String(LATEST_INVOICES),
        sort: SalesInvoiceSort.DocNo,
        sortDir: SortDirection.Desc,
      });
      return request(`/sales-invoices?${params.toString()}`, { schema: invoiceHeaderListSchema });
    },
  });
}

export function useSalesInvoice(id: string | null): UseQueryResult<SalesInvoiceDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<SalesInvoiceDTO, ApiError>({
    queryKey: [QueryKey.SalesInvoice, id],
    enabled: session !== null && id !== null,
    queryFn: () => request(`/sales-invoices/${encodeURIComponent(id!)}`, { schema: salesInvoiceSchema }),
  });
}

/** `GET /users/:id` is gated on `admin.users.view`; a caller without it gets no name, never a guessed one. */
export function useUser(id: string, enabled: boolean): UseQueryResult<UserDTO, ApiError> {
  const { request, session } = useSession();
  return useQuery<UserDTO, ApiError>({
    queryKey: [QueryKey.User, id],
    enabled: session !== null && enabled && id !== "",
    retry: false,
    queryFn: () => request(`/users/${encodeURIComponent(id)}`, { schema: userSchema }),
  });
}
