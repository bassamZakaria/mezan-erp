import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AccountDTO,
  BankStatementDTO,
  BankStatementStatusDTO,
  BootstrapAdminRequestDTO,
  BounceChequeDTO,
  BranchDTO,
  ChequeDTO,
  ChequeDirectionDTO,
  ChequeStatusDTO,
  CollectChequeDTO,
  BootstrapSeedResultDTO,
  ConvertSalesQuoteToInvoiceDTO,
  CreateAccountDTO,
  CreateChequeDTO,
  CreateCustomerDTO,
  CreateGlJournalEntryDTO,
  CreateItemDTO,
  CreatePriceListDTO,
  CreatePromotionDTO,
  CreateRoleDTO,
  CreateSalesQuoteDTO,
  CreateSupplierDTO,
  CreateTreasuryAccountDTO,
  CreateUserDTO,
  CustomerDTO,
  DashboardSummaryDTO,
  DepositChequeDTO,
  GlJournalListQueryDTO,
  ImportBankStatementDTO,
  ItemDTO,
  JournalEntrySourceDTO,
  JournalEntryStatusDTO,
  LoginRequestDTO,
  MatchSummaryDTO,
  PriceListDTO,
  PromotionDTO,
  ReplaceChequeDTO,
  ReverseGlJournalEntryDTO,
  RoleDTO,
  SessionDTO,
  StatementColumnMappingDTO,
  StatementLineDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  UpdateAccountDTO,
  UpdateCustomerDTO,
  UpdateItemDTO,
  UpdateRoleDTO,
  UpdateSupplierDTO,
  UpdateTreasuryAccountDTO,
  UpdateUserDTO,
  UserDTO,
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
