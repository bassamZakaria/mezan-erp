import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AccountDTO,
  ActivityDTO,
  AllocationSummaryDTO,
  AssetCategoryDTO,
  AssetDTO,
  BankStatementDTO,
  BankStatementStatusDTO,
  BootstrapAdminRequestDTO,
  BootstrapSeedResultDTO,
  BounceChequeDTO,
  BranchDTO,
  ChequeDirectionDTO,
  ChequeDTO,
  ChequeStatusDTO,
  CollectChequeDTO,
  ConfirmVoucherDTO,
  ConvertLeadDTO,
  ConvertSalesQuoteToInvoiceDTO,
  CreateAccountDTO,
  CreateActivityDTO,
  CreateAllocationDTO,
  CreateAssetCategoryDTO,
  CreateAssetDTO,
  CreateChequeDTO,
  CreateCustomerDTO,
  CreateDepreciationRunDTO,
  CreateGlJournalEntryDTO,
  CreateGoodsReceiptDTO,
  CreateItemDTO,
  CreateLeadDTO,
  CreateOpportunityDTO,
  CreatePipelineStageDTO,
  CreatePriceListDTO,
  CreateProjectDTO,
  CreatePromotionDTO,
  CreatePurchaseInvoiceDTO,
  CreatePurchaseOrderDTO,
  CreateRoleDTO,
  CreateSalesInvoiceDTO,
  CreateSalesQuoteDTO,
  CreateSupplierDTO,
  CreateTreasuryAccountDTO,
  CreateUserDTO,
  CreateVoucherDTO,
  CustomerDTO,
  DashboardSummaryDTO,
  DepositChequeDTO,
  DepreciationRunDTO,
  GlJournalListQueryDTO,
  GoodsReceiptDTO,
  ImportBankStatementDTO,
  ItemDTO,
  JournalEntrySourceDTO,
  JournalEntryStatusDTO,
  LeadDTO,
  LoginRequestDTO,
  MatchSummaryDTO,
  MoveOpportunityStageDTO,
  OpenInvoiceDTO,
  OpenVanTripDTO,
  OpportunityDTO,
  PipelineStageDTO,
  PriceListDTO,
  ProjectDTO,
  PromotionDTO,
  PurchaseInvoiceDTO,
  PurchaseOrderDTO,
  RecordVanCashMovementDTO,
  ReplaceChequeDTO,
  ReverseGlJournalEntryDTO,
  ReverseVoucherDTO,
  RoleDTO,
  SalesInvoiceDiscountDTO,
  SalesInvoiceListQueryDTO,
  SessionDTO,
  SettleVanTripDTO,
  StatementColumnMappingDTO,
  StatementLineDTO,
  SupplierDTO,
  TransitionLeadDTO,
  TreasuryAccountDTO,
  UpdateAccountDTO,
  UpdateCustomerDTO,
  UpdateItemDTO,
  UpdateProjectDTO,
  UpdateRoleDTO,
  UpdateSupplierDTO,
  UpdateTreasuryAccountDTO,
  UpdateUserDTO,
  UserDTO,
  VanTripDTO,
  VoucherAllocationDTO,
  VoucherDTO,
  VoucherListQueryDTO,
  WarehouseDTO,
} from "@mezan/contracts";
import { useApi } from "./ApiContext";

/**
 * The `/sales-quotes` responses (create/list/get/send/accept/reject) — the
 * server serializes a quote plus its computed totals; `@mezan/contracts` only
 * ships the request-side schemas for this resource (create/convert), so the
 * response shape is typed locally here, matching `sales-quotes-routes.ts`'s
 * `serialize()`.
 */
export interface SalesQuoteLineRecord {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly qty: string;
  readonly unitPrice: string;
  readonly discountPercent?: number;
  readonly taxRatePercent?: number;
}

export interface SalesQuoteRecord {
  readonly id: string;
  readonly docType: string;
  readonly docNo: string | null;
  readonly status: "draft" | "sent" | "accepted" | "rejected" | "converted" | "cancelled";
  readonly date: string;
  readonly expiryDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly branchId: string;
  readonly currency: string;
  readonly notes: string | null;
  readonly internalNotes: string | null;
  readonly convertedInvoiceId: string | null;
  readonly lines: readonly SalesQuoteLineRecord[];
  readonly totals: {
    readonly subtotal: string;
    readonly taxTotal: string;
    readonly grandTotal: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Real login (docs/plan.md desktop username+PIN). On success the resolved
 * session is stored in the ApiContext, so every subsequent query/mutation
 * sends the permission-gate headers it establishes.
 */
export function useLogin() {
  const { request, setSession } = useApi();
  return useMutation<SessionDTO, ApiError, LoginRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر تسجيل الدخول.");
      }
      return res.json<SessionDTO>();
    },
    onSuccess: (session) => setSession(session),
  });
}

/** First-run wizard "seed base data" step — idempotently seeds an empty DB and returns what exists. */
export function useBootstrapSeed() {
  const { request } = useApi();
  return useMutation<BootstrapSeedResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/bootstrap/seed", { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, "تعذّرت تهيئة البيانات الأساسية.");
      return res.json<BootstrapSeedResultDTO>();
    },
  });
}

/** First-run wizard "create admin" step — persists the admin, then establishes their session. */
export function useCreateFirstAdmin() {
  const { request, setSession } = useApi();
  return useMutation<SessionDTO, ApiError, BootstrapAdminRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/bootstrap/admin", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر إنشاء حساب المسؤول.");
      }
      return res.json<SessionDTO>();
    },
    onSuccess: (session) => setSession(session),
  });
}

export interface DashboardRange {
  readonly fromDate?: string;
  readonly toDate?: string;
}

/**
 * لوحة التحكم summary — real KPIs/activity computed server-side from persisted
 * data. The `range` becomes `fromDate`/`toDate` query params the server uses to
 * re-scope the P&L figures, so the range control operates on real data. Runs
 * only once a session exists.
 */
export function useDashboardSummary(range: DashboardRange = {}): UseQueryResult<DashboardSummaryDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<DashboardSummaryDTO, ApiError>({
    queryKey: ["dashboard", "summary", range.fromDate ?? null, range.toDate ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (range.fromDate) params.set("fromDate", range.fromDate);
      if (range.toDate) params.set("toDate", range.toDate);
      const qs = params.toString();
      const res = await request(`/dashboard/summary${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل بيانات لوحة التحكم.");
      return res.json<DashboardSummaryDTO>();
    },
  });
}

async function readError(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

/** الأصناف (docs/catalog/03) — list, create, edit. */
export function useItems(): UseQueryResult<ItemDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemDTO[], ApiError>({
    queryKey: ["items"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/items");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الأصناف.");
      return res.json<ItemDTO[]>();
    },
  });
}

export function useCreateItem() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemDTO, ApiError, CreateItemDTO>({
    mutationFn: async (body) => {
      const res = await request("/items", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الصنف."));
      return res.json<ItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useUpdateItem() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemDTO, ApiError, { id: string; patch: UpdateItemDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الصنف."));
      return res.json<ItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}

/** العملاء (docs/catalog/01) — list, create, edit; also used for pickers on other real-data screens (e.g. quotes). */
export function useCustomers(): UseQueryResult<CustomerDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<CustomerDTO[], ApiError>({
    queryKey: ["customers"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/customers");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل العملاء.");
      return res.json<CustomerDTO[]>();
    },
  });
}

export function useCreateCustomer() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustomerDTO, ApiError, CreateCustomerDTO>({
    mutationFn: async (body) => {
      const res = await request("/customers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة العميل."));
      return res.json<CustomerDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustomerDTO, ApiError, { id: string; patch: UpdateCustomerDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل العميل."));
      return res.json<CustomerDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

/** الموردون (docs/catalog/02) — list, create, edit. */
export function useSuppliers(): UseQueryResult<SupplierDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<SupplierDTO[], ApiError>({
    queryKey: ["suppliers"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/suppliers");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الموردين.");
      return res.json<SupplierDTO[]>();
    },
  });
}

export function useCreateSupplier() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SupplierDTO, ApiError, CreateSupplierDTO>({
    mutationFn: async (body) => {
      const res = await request("/suppliers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة المورد."));
      return res.json<SupplierDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useUpdateSupplier() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SupplierDTO, ApiError, { id: string; patch: UpdateSupplierDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل المورد."));
      return res.json<SupplierDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

/** دليل الحسابات (docs/catalog/04) — list, create, edit. */
export function useAccounts(): UseQueryResult<AccountDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<AccountDTO[], ApiError>({
    queryKey: ["accounts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/accounts");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل دليل الحسابات.");
      return res.json<AccountDTO[]>();
    },
  });
}

export function useCreateAccount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountDTO, ApiError, CreateAccountDTO>({
    mutationFn: async (body) => {
      const res = await request("/accounts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الحساب."));
      return res.json<AccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountDTO, ApiError, { id: string; patch: UpdateAccountDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الحساب."));
      return res.json<AccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

/** حسابات الخزينة (docs/catalog/04) — list, create, edit. */
export function useTreasuryAccounts(): UseQueryResult<TreasuryAccountDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<TreasuryAccountDTO[], ApiError>({
    queryKey: ["treasury-accounts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/treasury-accounts");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل حسابات الخزينة.");
      return res.json<TreasuryAccountDTO[]>();
    },
  });
}

export function useCreateTreasuryAccount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TreasuryAccountDTO, ApiError, CreateTreasuryAccountDTO>({
    mutationFn: async (body) => {
      const res = await request("/treasury-accounts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الحساب."));
      return res.json<TreasuryAccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] }),
  });
}

export function useUpdateTreasuryAccount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TreasuryAccountDTO, ApiError, { id: string; patch: UpdateTreasuryAccountDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/treasury-accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الحساب."));
      return res.json<TreasuryAccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] }),
  });
}

/** قوائم الأسعار (docs/catalog/01) — real list off `/price-lists`. */
export function usePriceLists(): UseQueryResult<PriceListDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PriceListDTO[], ApiError>({
    queryKey: ["price-lists"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/price-lists");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قوائم الأسعار.");
      return res.json<PriceListDTO[]>();
    },
  });
}

export function useCreatePriceList() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PriceListDTO, ApiError, CreatePriceListDTO>({
    mutationFn: async (body) => {
      const res = await request("/price-lists", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر إنشاء قائمة الأسعار.");
      }
      return res.json<PriceListDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-lists"] }),
  });
}

/** العروض / promotions (docs/catalog/01) — real list off `/promotions`. */
export function usePromotions(): UseQueryResult<PromotionDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PromotionDTO[], ApiError>({
    queryKey: ["promotions"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/promotions");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل العروض.");
      return res.json<PromotionDTO[]>();
    },
  });
}

export function useCreatePromotion() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PromotionDTO, ApiError, CreatePromotionDTO>({
    mutationFn: async (body) => {
      const res = await request("/promotions", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر إنشاء العرض.");
      }
      return res.json<PromotionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

/** عروض الأسعار / sales quotes (docs/catalog/01) — real list off `/sales-quotes`. */
export function useSalesQuotes(): UseQueryResult<SalesQuoteRecord[], ApiError> {
  const { request, session } = useApi();
  return useQuery<SalesQuoteRecord[], ApiError>({
    queryKey: ["sales-quotes"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/sales-quotes");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عروض الأسعار.");
      return res.json<SalesQuoteRecord[]>();
    },
  });
}

export function useCreateSalesQuote() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesQuoteRecord, ApiError, CreateSalesQuoteDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-quotes", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر إنشاء عرض السعر.");
      }
      return res.json<SalesQuoteRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
  });
}

function useSalesQuoteTransition(action: "send" | "accept" | "reject" | "cancel") {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesQuoteRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-quotes/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر تنفيذ العملية.");
      }
      return res.json<SalesQuoteRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
  });
}

/** إرسال العرض للعميل (مسودة → مرسل). */
export function useSendSalesQuote() {
  return useSalesQuoteTransition("send");
}
/** قبول العميل للعرض (مرسل → مقبول). */
export function useAcceptSalesQuote() {
  return useSalesQuoteTransition("accept");
}
/** رفض العرض (→ مرفوض). */
export function useRejectSalesQuote() {
  return useSalesQuoteTransition("reject");
}

/** "إنشاء من عرض سعر" — converts an accepted quote into a draft sales invoice. */
export function useConvertSalesQuoteToInvoice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    { quote: SalesQuoteRecord; invoiceId: string; invoiceDocNo: string | null },
    ApiError,
    { id: string; body: ConvertSalesQuoteToInvoiceDTO }
  >({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/sales-quotes/${id}/convert-to-invoice`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? "تعذّر تحويل عرض السعر إلى فاتورة.");
      }
      return res.json<{ quote: SalesQuoteRecord; invoiceId: string; invoiceDocNo: string | null }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
  });
}

/** Wire shape of a posted/reversed GL journal entry (packages/api/src/gl-routes.ts `serialize`) — no dedicated response DTO ships from @mezan/contracts yet. */
export interface JournalEntryDTO {
  readonly id: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly memo: string;
  readonly status: JournalEntryStatusDTO;
  readonly source: JournalEntrySourceDTO;
  readonly createdAt: string | null;
  readonly postedAt: string | null;
  readonly reversesEntryId: string | null;
  readonly reversedByEntryId: string | null;
  readonly lines: ReadonlyArray<{ accountId: string; debit: string; credit: string; memo: string | null }>;
}

/** القيود المحاسبية (docs/catalog/04) — the GL posting engine mounted under /gl. */
export function useJournalEntries(filter: GlJournalListQueryDTO = {}): UseQueryResult<JournalEntryDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO[], ApiError>({
    queryKey: ["journal-entries", filter],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      if (filter.source) params.set("source", filter.source);
      if (filter.fromDate) params.set("fromDate", filter.fromDate);
      if (filter.toDate) params.set("toDate", filter.toDate);
      const qs = params.toString();
      const res = await request(`/gl/journal-entries${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل القيود المحاسبية.");
      return res.json<JournalEntryDTO[]>();
    },
  });
}

/** Creates and posts a balanced journal entry in one step (POST /gl/journal-entries). */
export function useCreateJournalEntry() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JournalEntryDTO, ApiError, CreateGlJournalEntryDTO>({
    mutationFn: async (body) => {
      const res = await request("/gl/journal-entries", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر ترحيل القيد."));
      return res.json<JournalEntryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/** يعكس قيداً مرحّلاً (POST /gl/journal-entries/:id/reverse). */
export function useReverseJournalEntry() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: JournalEntryDTO; reversal: JournalEntryDTO }, ApiError, { id: string; body?: ReverseGlJournalEntryDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/gl/journal-entries/${id}/reverse`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر عكس القيد."));
      return res.json<{ original: JournalEntryDTO; reversal: JournalEntryDTO }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/** المستخدمون (docs/catalog/09) — list, create, edit, activate/deactivate. */
export function useUsers(): UseQueryResult<UserDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<UserDTO[], ApiError>({
    queryKey: ["users"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/users");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المستخدمين.");
      return res.json<UserDTO[]>();
    },
  });
}

export function useCreateUser() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, CreateUserDTO>({
    mutationFn: async (body) => {
      const res = await request("/users", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ المستخدم."));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, { id: string; body: UpdateUserDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ المستخدم."));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useSetUserStatus() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, { id: string; status: "active" | "inactive" }>({
    mutationFn: async ({ id, status }) => {
      const res = await request(`/users/${id}/${status === "active" ? "activate" : "deactivate"}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحديث حالة المستخدم."));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** الأدوار (docs/catalog/09) — list, create, edit, delete. */
export function useRoles(): UseQueryResult<RoleDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<RoleDTO[], ApiError>({
    queryKey: ["roles"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/roles");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الأدوار.");
      return res.json<RoleDTO[]>();
    },
  });
}

export function useCreateRole() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleDTO, ApiError, CreateRoleDTO>({
    mutationFn: async (body) => {
      const res = await request("/roles", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الدور."));
      return res.json<RoleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useUpdateRole() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleDTO, ApiError, { id: string; body: UpdateRoleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/roles/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الدور."));
      return res.json<RoleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useDeleteRole() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/roles/${id}`, { method: "DELETE" });
      // 204 No Content on success — the body is empty, never parse it as JSON.
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حذف الدور."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

/** الفروع (docs/catalog/09) — read-only list, used by the branch typeahead on real-data forms. */
export function useBranches(): UseQueryResult<BranchDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<BranchDTO[], ApiError>({
    queryKey: ["branches"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/branches");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الفروع.");
      return res.json<BranchDTO[]>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* سجل الشيكات — Cheque Register (docs/catalog/04)                       */
/* -------------------------------------------------------------------- */

export interface ChequeListFilters {
  readonly direction?: ChequeDirectionDTO;
  /** The DERIVED 7-state status the register's filter tabs expose. */
  readonly status?: ChequeStatusDTO;
  readonly fromDate?: string;
  readonly toDate?: string;
}

function chequeQueryString(filters: ChequeListFilters): string {
  const params = new URLSearchParams();
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  const qs = params.toString();
  return qs === "" ? "" : `?${qs}`;
}

/**
 * The register list. Filters are part of the `queryKey` and go to the server —
 * the 7-state status (including the date-derived تحت التحصيل/المستحقة اليوم) is
 * resolved server-side against its own "as of" date, never recomputed here.
 */
export function useCheques(filters: ChequeListFilters = {}): UseQueryResult<ChequeDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ChequeDTO[], ApiError>({
    queryKey: ["cheques", filters],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/cheques${chequeQueryString(filters)}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الشيكات.");
      return res.json<ChequeDTO[]>();
    },
  });
}

export function useCreateCheque() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ChequeDTO, ApiError, CreateChequeDTO>({
    mutationFn: async (body) => {
      const res = await request("/cheques", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حفظ الشيك."));
      return res.json<ChequeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });
}

/** إيداع / تحصيل / ارتداد — the three status transitions that take a body. */
function useChequeAction<Body>(action: "deposit" | "collect" | "bounce", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ChequeDTO, ApiError, { id: string; body: Body }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/cheques/${id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, fallbackMessage));
      return res.json<ChequeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });
}

/** تسليم الشيك للبنك للتحصيل (قيد الانتظار → مودع). */
export function useDepositCheque() {
  return useChequeAction<DepositChequeDTO>("deposit", "تعذّر إيداع الشيك.");
}
/** تأكيد البنك للتحصيل (مودع → محصل). */
export function useCollectCheque() {
  return useChequeAction<CollectChequeDTO>("collect", "تعذّر تحصيل الشيك.");
}
/** ارتداد الشيك (مودع → مرتد). */
export function useBounceCheque() {
  return useChequeAction<BounceChequeDTO>("bounce", "تعذّر تسجيل ارتداد الشيك.");
}

/** استبدال شيك مرتد بشيك جديد بنفس القيمة (مرتد → مستبدل + شيك جديد قيد الانتظار). */
export function useReplaceCheque() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: ChequeDTO; replacement: ChequeDTO }, ApiError, { id: string; body: ReplaceChequeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/cheques/${id}/replace`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر استبدال الشيك."));
      return res.json<{ original: ChequeDTO; replacement: ChequeDTO }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });
}

/* -------------------------------------------------------------------- */
/* تسوية كشوف البنك — Bank Statement Reconciliation (docs/catalog/04)     */
/* -------------------------------------------------------------------- */

/** `GET /bank-statements/:id` — the statement plus its lines and match summary. */
export interface BankStatementDetailDTO extends BankStatementDTO {
  readonly lines: readonly StatementLineDTO[];
  readonly matchSummary: MatchSummaryDTO;
}

export interface BankStatementListFilters {
  readonly treasuryAccountId?: string;
  readonly status?: BankStatementStatusDTO;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export function useBankStatements(filters: BankStatementListFilters = {}): UseQueryResult<BankStatementDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<BankStatementDTO[], ApiError>({
    queryKey: ["bank-statements", filters],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.treasuryAccountId) params.set("treasuryAccountId", filters.treasuryAccountId);
      if (filters.status) params.set("status", filters.status);
      if (filters.fromDate) params.set("fromDate", filters.fromDate);
      if (filters.toDate) params.set("toDate", filters.toDate);
      const qs = params.toString();
      const res = await request(`/bank-statements${qs === "" ? "" : `?${qs}`}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل كشوف البنك.");
      return res.json<BankStatementDTO[]>();
    },
  });
}

export function useBankStatement(id: string | null): UseQueryResult<BankStatementDetailDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<BankStatementDetailDTO, ApiError>({
    queryKey: ["bank-statements", "detail", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/bank-statements/${id}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل كشف البنك.");
      return res.json<BankStatementDetailDTO>();
    },
  });
}

/**
 * The treasury account's SAVED CSV column mapping ("يحفظ التعيين لكل حساب").
 * 404 means the account has never been imported for — a first-time mapping, not
 * an error, so it resolves to `null` rather than throwing.
 */
export function useStatementColumnMapping(treasuryAccountId: string | null): UseQueryResult<StatementColumnMappingDTO | null, ApiError> {
  const { request, session } = useApi();
  return useQuery<StatementColumnMappingDTO | null, ApiError>({
    queryKey: ["bank-statements", "column-mapping", treasuryAccountId],
    enabled: session !== null && treasuryAccountId !== null && treasuryAccountId !== "",
    queryFn: async () => {
      const res = await request(`/bank-statements/column-mapping/${treasuryAccountId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تعيين الأعمدة.");
      return res.json<StatementColumnMappingDTO>();
    },
  });
}

/** استيراد كشف بنك — persists the column mapping for the account, then the statement + its parsed lines. */
export function useImportBankStatement() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BankStatementDetailDTO, ApiError, ImportBankStatementDTO>({
    mutationFn: async (body) => {
      const res = await request("/bank-statements/import", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر استيراد كشف البنك."));
      return res.json<BankStatementDetailDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

/** مطابقة تلقائية — applies every exact amount + date-tolerance suggestion against the treasury ledger. */
export function useAutoMatchStatement() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ matchedCount: number }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/bank-statements/${id}/auto-match`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّرت المطابقة التلقائية."));
      return res.json<{ matchedCount: number }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

export function useMatchStatementLine() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StatementLineDTO, ApiError, { statementId: string; lineId: string; entryId: string }>({
    mutationFn: async ({ statementId, lineId, entryId }) => {
      const res = await request(`/bank-statements/${statementId}/lines/${lineId}/match`, {
        method: "POST",
        body: JSON.stringify({ entryId }),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّرت مطابقة السطر."));
      return res.json<StatementLineDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

export function useUnmatchStatementLine() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StatementLineDTO, ApiError, { statementId: string; lineId: string }>({
    mutationFn: async ({ statementId, lineId }) => {
      const res = await request(`/bank-statements/${statementId}/lines/${lineId}/unmatch`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إلغاء مطابقة السطر."));
      return res.json<StatementLineDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

/** إنهاء التسوية — locks the statement (منتهية); no further matching is possible. */
export function useFinalizeBankStatement() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BankStatementDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/bank-statements/${id}/finalize`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنهاء التسوية."));
      return res.json<BankStatementDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}


/* -------------------------------------------------------------------- */
/* sweep/real-data-screens — Tier 2 (vouchers, purchase chain, sales     */
/* invoices, and their small dependency hooks)                           */
/* -------------------------------------------------------------------- */

/** One posted journal entry, for a document's "القيود المحاسبية" tab (e.g. a confirmed sales invoice's `journalEntryId`). */
export function useJournalEntry(id: string | null): UseQueryResult<JournalEntryDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO, ApiError>({
    queryKey: ["journal-entries", "detail", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/gl/journal-entries/${id}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل القيد المحاسبي.");
      return res.json<JournalEntryDTO>();
    },
  });
}

/** المستودعات (docs/catalog/09) — read-only here; a picker dependency for other real-data screens (e.g. sales invoices). */
export function useWarehouses(): UseQueryResult<WarehouseDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WarehouseDTO[], ApiError>({
    queryKey: ["warehouses"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/warehouses");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المستودعات.");
      return res.json<WarehouseDTO[]>();
    },
  });
}

/** A voucher list/detail row — the base VoucherDTO plus the row-level allocation summary GET /vouchers adds (packages/api/src/vouchers-routes.ts). */
export interface VoucherRowDTO extends VoucherDTO {
  readonly allocatable: boolean;
  readonly allocationSummary: AllocationSummaryDTO;
}

/** السندات النقدية (docs/catalog/04) — list, create, confirm, reverse, allocate. */
export function useVouchers(filter: VoucherListQueryDTO = {}): UseQueryResult<VoucherRowDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<VoucherRowDTO[], ApiError>({
    queryKey: ["vouchers", filter],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.type) params.set("type", filter.type);
      if (filter.status) params.set("status", filter.status);
      const qs = params.toString();
      const res = await request(`/vouchers${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل السندات.");
      return res.json<VoucherRowDTO[]>();
    },
  });
}

export interface VoucherDetailDTO extends VoucherDTO {
  readonly allocatable: boolean;
  readonly allocationSummary: AllocationSummaryDTO;
  readonly allocations: VoucherAllocationDTO[];
}

export function useVoucherDetail(id: string | null): UseQueryResult<VoucherDetailDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<VoucherDetailDTO, ApiError>({
    queryKey: ["vouchers", "detail", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/vouchers/${id}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل السند.");
      return res.json<VoucherDetailDTO>();
    },
  });
}

function invalidateVouchers(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["vouchers"] });
}

export function useCreateVoucher() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherDTO, ApiError, CreateVoucherDTO>({
    mutationFn: async (body) => {
      const res = await request("/vouchers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء السند."));
      return res.json<VoucherDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useConfirmVoucher() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherDTO & { held: boolean }, ApiError, { id: string; body?: ConfirmVoucherDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/vouchers/${id}/confirm`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد السند."));
      return res.json<VoucherDTO & { held: boolean }>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useReverseVoucher() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: VoucherDTO; reversal: VoucherDTO }, ApiError, { id: string; body?: ReverseVoucherDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/vouchers/${id}/reverse`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر عكس السند."));
      return res.json<{ original: VoucherDTO; reversal: VoucherDTO }>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useCreateAllocation() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherAllocationDTO, ApiError, { voucherId: string; body: CreateAllocationDTO }>({
    mutationFn: async ({ voucherId, body }) => {
      const res = await request(`/vouchers/${voucherId}/allocations`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تخصيص المبلغ."));
      return res.json<VoucherAllocationDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useReverseAllocation() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherAllocationDTO, ApiError, string>({
    mutationFn: async (allocationId) => {
      const res = await request(`/allocations/${allocationId}/reverse`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر عكس التخصيص."));
      return res.json<VoucherAllocationDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useOpenInvoices(kind?: "sales" | "purchase", partyId?: string | null): UseQueryResult<OpenInvoiceDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<OpenInvoiceDTO[], ApiError>({
    queryKey: ["open-invoices", kind ?? null, partyId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (kind) params.set("kind", kind);
      if (partyId) params.set("partyId", partyId);
      const qs = params.toString();
      const res = await request(`/open-invoices${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الفواتير المفتوحة.");
      return res.json<OpenInvoiceDTO[]>();
    },
  });
}

/** أوامر الشراء (docs/catalog/02) — list, create, confirm (draft → sent). */
export function usePurchaseOrders(): UseQueryResult<PurchaseOrderDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PurchaseOrderDTO[], ApiError>({
    queryKey: ["purchase-orders"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/purchases/orders");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أوامر الشراء.");
      return res.json<PurchaseOrderDTO[]>();
    },
  });
}

export function useCreatePurchaseOrder() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseOrderDTO, ApiError, CreatePurchaseOrderDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/orders", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء أمر الشراء."));
      return res.json<PurchaseOrderDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useConfirmPurchaseOrder() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseOrderDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchases/orders/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد أمر الشراء."));
      return res.json<PurchaseOrderDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

/** إيصالات الاستلام (docs/catalog/02) — list, create (from a sent/partially-received PO), confirm. */
export function useGoodsReceipts(): UseQueryResult<GoodsReceiptDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<GoodsReceiptDTO[], ApiError>({
    queryKey: ["goods-receipts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/purchases/receipts");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل إيصالات الاستلام.");
      return res.json<GoodsReceiptDTO[]>();
    },
  });
}

export function useCreateGoodsReceipt() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GoodsReceiptDTO, ApiError, CreateGoodsReceiptDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/receipts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء إيصال الاستلام."));
      return res.json<GoodsReceiptDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useConfirmGoodsReceipt() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GoodsReceiptDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchases/receipts/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد إيصال الاستلام."));
      return res.json<GoodsReceiptDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

/** فواتير المشتريات (docs/catalog/02) — list, create (manual or from a confirmed receipt), confirm. */
export function usePurchaseInvoices(): UseQueryResult<PurchaseInvoiceDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PurchaseInvoiceDTO[], ApiError>({
    queryKey: ["purchase-invoices"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/purchases/invoices");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل فواتير المشتريات.");
      return res.json<PurchaseInvoiceDTO[]>();
    },
  });
}

export function useCreatePurchaseInvoice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseInvoiceDTO, ApiError, CreatePurchaseInvoiceDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/invoices", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء فاتورة المشتريات."));
      return res.json<PurchaseInvoiceDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] }),
  });
}

export function useConfirmPurchaseInvoice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseInvoiceDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchases/invoices/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد فاتورة المشتريات."));
      return res.json<PurchaseInvoiceDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
    },
  });
}

/** Wire shape of a sales invoice with its server-computed totals (packages/api/src/sales-invoices-routes.ts `serialize`) — no dedicated response DTO ships from @mezan/contracts yet. */
export interface SalesInvoiceLineRowDTO {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly isStock: boolean;
  readonly qty: string;
  readonly unitPrice: string;
  readonly discountPercent: number;
  readonly taxRatePercent: number;
  readonly revenueAccountId: string;
  readonly cogsAccountId: string | null;
  readonly inventoryAccountId: string | null;
  readonly unitCost: string | null;
}

export interface SalesInvoiceTotalsDTO {
  readonly grossTotal: string;
  readonly lineDiscountTotal: string;
  readonly invoiceDiscountTotal: string;
  readonly subtotal: string;
  readonly taxableTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
}

export interface SalesInvoiceDTO {
  readonly id: string;
  readonly docType: string;
  readonly docNo: string | null;
  readonly status: "draft" | "pending" | "confirmed" | "partially_paid" | "paid" | "cancelled" | "reversed";
  readonly date: string;
  readonly dueDate: string;
  readonly customerId: string;
  readonly customerNameAr: string;
  readonly customerTaxExempt: boolean;
  readonly warehouseId: string;
  readonly branchId: string;
  readonly currency: string;
  readonly notes: string | null;
  readonly internalNotes: string | null;
  readonly discount: SalesInvoiceDiscountDTO;
  readonly arAccountId: string;
  readonly taxAccountId: string;
  readonly amountPaid: string;
  readonly remainingBalance: string;
  readonly journalEntryId: string | null;
  readonly workflowRequestId: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  readonly lines: readonly SalesInvoiceLineRowDTO[];
  readonly totals: SalesInvoiceTotalsDTO;
}

/** فواتير المبيعات (docs/catalog/01) — list, create, confirm, record a payment. */
export function useSalesInvoices(filter: SalesInvoiceListQueryDTO = {}): UseQueryResult<SalesInvoiceDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<SalesInvoiceDTO[], ApiError>({
    queryKey: ["sales-invoices", filter],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      if (filter.customerId) params.set("customerId", filter.customerId);
      if (filter.fromDate) params.set("fromDate", filter.fromDate);
      if (filter.toDate) params.set("toDate", filter.toDate);
      const qs = params.toString();
      const res = await request(`/sales-invoices${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل فواتير المبيعات.");
      return res.json<SalesInvoiceDTO[]>();
    },
  });
}

function invalidateSalesInvoices(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["sales-invoices"] });
}

export function useCreateSalesInvoice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, CreateSalesInvoiceDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-invoices", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الفاتورة."));
      return res.json<SalesInvoiceDTO>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

export function useConfirmSalesInvoice() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO & { held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-invoices/${id}/confirm`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد الفاتورة."));
      return res.json<SalesInvoiceDTO & { held: boolean }>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

export function useRecordSalesInvoicePayment() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, { id: string; amount: string }>({
    mutationFn: async ({ id, amount }) => {
      const res = await request(`/sales-invoices/${id}/payments`, { method: "POST", body: JSON.stringify({ amount }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تسجيل الدفعة."));
      return res.json<SalesInvoiceDTO>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

// ---------------------------------------------------------------------------
// CRM (docs/catalog/06 "إدارة علاقات العملاء") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useLeads(): UseQueryResult<LeadDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<LeadDTO[], ApiError>({
    queryKey: ["crm-leads"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/leads");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل العملاء المحتملين.");
      return res.json<LeadDTO[]>();
    },
  });
}

export function useCreateLead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeadDTO, ApiError, CreateLeadDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/leads", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة العميل المحتمل."));
      return res.json<LeadDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-leads"] }),
  });
}

export function useTransitionLead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeadDTO, ApiError, { id: string; body: TransitionLeadDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/leads/${id}/transition`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحديث حالة العميل المحتمل."));
      return res.json<LeadDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-leads"] }),
  });
}

export interface ConvertLeadResultDTO {
  readonly lead: LeadDTO;
  readonly customerId: string | null;
  readonly opportunityId: string | null;
}

export function useConvertLead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConvertLeadResultDTO, ApiError, { id: string; body: ConvertLeadDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/leads/${id}/convert`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحويل العميل المحتمل."));
      return res.json<ConvertLeadResultDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useOpportunities(): UseQueryResult<OpportunityDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<OpportunityDTO[], ApiError>({
    queryKey: ["crm-opportunities"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/opportunities");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الفرص.");
      return res.json<OpportunityDTO[]>();
    },
  });
}

export function useCreateOpportunity() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpportunityDTO, ApiError, CreateOpportunityDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/opportunities", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الفرصة."));
      return res.json<OpportunityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] }),
  });
}

export function useMoveOpportunityStage() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpportunityDTO, ApiError, { id: string; body: MoveOpportunityStageDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/opportunities/${id}/move-stage`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر نقل الفرصة."));
      return res.json<OpportunityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] }),
  });
}

export function usePipelineStages(): UseQueryResult<PipelineStageDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PipelineStageDTO[], ApiError>({
    queryKey: ["crm-pipeline-stages"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/pipeline-stages");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مراحل خط المبيعات.");
      return res.json<PipelineStageDTO[]>();
    },
  });
}

export function useCreatePipelineStage() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PipelineStageDTO, ApiError, CreatePipelineStageDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/pipeline-stages", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة المرحلة."));
      return res.json<PipelineStageDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-pipeline-stages"] }),
  });
}

export function useMovePipelineStage() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PipelineStageDTO, ApiError, { id: string; direction: "up" | "down" }>({
    mutationFn: async ({ id, direction }) => {
      const res = await request(`/crm/pipeline-stages/${id}/move`, { method: "POST", body: JSON.stringify({ direction }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إعادة ترتيب المرحلة."));
      return res.json<PipelineStageDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-pipeline-stages"] }),
  });
}

export function useCrmActivities(): UseQueryResult<ActivityDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ActivityDTO[], ApiError>({
    queryKey: ["crm-activities"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/activities");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الأنشطة.");
      return res.json<ActivityDTO[]>();
    },
  });
}

export function useCreateActivity() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, CreateActivityDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/activities", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة النشاط."));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

export function useCompleteActivity() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/crm/activities/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إكمال النشاط."));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

export function useCancelActivity() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/crm/activities/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إلغاء النشاط."));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

// ---------------------------------------------------------------------------
// Projects (docs/catalog/07 "المشاريع والمقاولات") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useProjects(): UseQueryResult<ProjectDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ProjectDTO[], ApiError>({
    queryKey: ["projects"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/projects");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المشاريع.");
      return res.json<ProjectDTO[]>();
    },
  });
}

export function useCreateProject() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, CreateProjectDTO>({
    mutationFn: async (body) => {
      const res = await request("/projects", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة المشروع."));
      return res.json<ProjectDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, { id: string; patch: UpdateProjectDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل المشروع."));
      return res.json<ProjectDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// ---------------------------------------------------------------------------
// Fixed Assets (docs/catalog/07 "الأصول الثابتة") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useAssetCategories(): UseQueryResult<AssetCategoryDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<AssetCategoryDTO[], ApiError>({
    queryKey: ["asset-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/assets/categories");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تصنيفات الأصول.");
      return res.json<AssetCategoryDTO[]>();
    },
  });
}

export function useCreateAssetCategory() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetCategoryDTO, ApiError, CreateAssetCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets/categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة التصنيف."));
      return res.json<AssetCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-categories"] }),
  });
}

export function useAssets(): UseQueryResult<AssetDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<AssetDTO[], ApiError>({
    queryKey: ["assets"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/assets");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل سجل الأصول.");
      return res.json<AssetDTO[]>();
    },
  });
}

export function useCreateAsset() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetDTO, ApiError, CreateAssetDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تسجيل الأصل."));
      return res.json<AssetDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDepreciationRuns(): UseQueryResult<DepreciationRunDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<DepreciationRunDTO[], ApiError>({
    queryKey: ["depreciation-runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/assets/depreciation/runs");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عمليات الإهلاك.");
      return res.json<DepreciationRunDTO[]>();
    },
  });
}

export function useCreateDepreciationRun() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, CreateDepreciationRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets/depreciation/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء عملية الإهلاك."));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] }),
  });
}

export function usePostDepreciationRun() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/assets/depreciation/runs/${id}/post`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر ترحيل عملية الإهلاك."));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Field/Van Sales (docs/catalog/07 "رحلات المندوبين") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useVanTrips(): UseQueryResult<VanTripDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<VanTripDTO[], ApiError>({
    queryKey: ["van-trips"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/field/van-trips");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل رحلات المندوبين.");
      return res.json<VanTripDTO[]>();
    },
  });
}

export function useOpenVanTrip() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, OpenVanTripDTO>({
    mutationFn: async (body) => {
      const res = await request("/field/van-trips", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر فتح الرحلة."));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}

export function useRecordVanCashMovement() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, { id: string; body: RecordVanCashMovementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/field/van-trips/${id}/cash-movements`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تسجيل الحركة النقدية."));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}

export function useSettleVanTrip() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, { id: string; body: SettleVanTripDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/field/van-trips/${id}/settle`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تسوية الرحلة."));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}
