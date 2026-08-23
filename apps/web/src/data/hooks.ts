import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  WorkflowConfigDTO,
  CreateWorkflowConfigDTO,
  UpdateWorkflowConfigDTO,
  ApprovalRequestDTO,
  SubmitApprovalRequestDTO,
  DecideApprovalRequestDTO,
  AccountDTO,
  ActivityDTO,
  AddAttributeValueDTO,
  AddTemplateAttributeDTO,
  AllocationSummaryDTO,
  AssetCategoryDTO,
  AssetDTO,
  BankStatementDTO,
  BankStatementStatusDTO,
  BootstrapAdminRequestDTO,
  BootstrapSeedResultDTO,
  CreateItemCategoryDTO,
  CreateItemUnitDTO,
  EntitlementsDTO,
  ItemCategoryDTO,
  ItemUnitDTO,
  UpdateItemCategoryDTO,
  UpdateItemUnitDTO,
  BounceChequeDTO,
  BranchDTO,
  ChequeDirectionDTO,
  ChequeDTO,
  ChequeStatusDTO,
  CollectChequeDTO,
  CollectionFollowUpDTO,
  CompleteFollowUpDTO,
  ConfigInputDTO,
  ConfirmVoucherDTO,
  ConvertLeadDTO,
  ConvertRfqDTO,
  ConvertSalesQuoteToInvoiceDTO,
  CostCenterDTO,
  CostCenterPnLReportDTO,
  CreateAccountDTO,
  CreateActivityDTO,
  CreateAllocationDTO,
  CreateAssetCategoryDTO,
  CreateAssetDTO,
  CreateBomDTO,
  CreateBranchDTO,
  CreateChequeDTO,
  CreateConfigInstanceDTO,
  CreateCostCenterDTO,
  CreateCustomerDTO,
  CreateDepreciationRunDTO,
  CreateExchangeRateDTO,
  CreateFollowUpDTO,
  CreateGlJournalEntryDTO,
  CreateGoodsReceiptDTO,
  CreateInstallmentPlanDTO,
  CreateItemDTO,
  CreateLandedCostDTO,
  CreateLeadDTO,
  CreateOpportunityDTO,
  CreatePipelineStageDTO,
  CreatePriceListDTO,
  CreateProductTemplateDTO,
  CreateProjectDTO,
  CreatePromotionDTO,
  CreatePurchaseInvoiceDTO,
  CreatePurchaseOrderDTO,
  CreatePurchaseReturnDTO,
  CreatePurchaseRfqDTO,
  CreateRfqQuoteDTO,
  CreateRoleDTO,
  CreateSalesInvoiceDTO,
  CreateSalesQuoteDTO,
  CreateSalesReturnDTO,
  CreateStockAdjustmentDTO,
  CreateStockTransferDTO,
  CreateSupplierDTO,
  CreateTaxRateDTO,
  CreateTreasuryAccountDTO,
  CreateUserDTO,
  CreateVoucherDTO,
  CreateWarehouseDTO,
  CreateWorkOrderDTO,
  CreateWritedownRunDTO,
  CustomerDTO,
  DashboardSummaryDTO,
  DepositChequeDTO,
  DepreciationRunDTO,
  DocumentStatusDTO,
  EtaConfigDTO,
  EtaReadinessDTO,
  EtaSubmissionDTO,
  EtaSubmissionStatusDTO,
  ExchangeRateDTO,
  ExcludeEtaSubmissionDTO,
  FiscalPeriodDTO,
  FollowUpStatusDTO,
  FxRevaluationPostResultDTO,
  FxRevaluationPreviewDTO,
  FxRevaluationRequestDTO,
  GenerateAdjustmentFromCountDTO,
  GenerateFiscalYearDTO,
  GenerateVariantsDTO,
  GenerateVariantsResultDTO,
  GlJournalListQueryDTO,
  GoodsReceiptDTO,
  ImportBankStatementDTO,
  InstallmentPlanDocumentDTO,
  ItemDTO,
  ItemPolicyDTO,
  JournalEntrySourceDTO,
  JournalEntryStatusDTO,
  LandedCostDocumentDTO,
  LeadDTO,
  LoginRequestDTO,
  MatchSummaryDTO,
  MaterialFormulaDTO,
  MoveOpportunityStageDTO,
  NotificationDTO,
  NotificationRuleDTO,
  CreateNotificationRuleDTO,
  UpdateNotificationRuleDTO,
  OpenInvoiceDTO,
  OpenVanTripDTO,
  OpportunityDTO,
  PhysicalCountDTO,
  PhysicalCountStatusDTO,
  PipelineStageDTO,
  PreviewConfigInstanceDTO,
  PriceListDTO,
  PricingMethodDTO,
  ProcessOverdueInstallmentsDTO,
  ProcessOverdueInstallmentsResultDTO,
  ProductTemplateDTO,
  ProductTemplateVariantDTO,
  ProjectDTO,
  PromotionDTO,
  PurchaseInvoiceDTO,
  PurchaseOrderDTO,
  PurchaseReturnDocumentDTO,
  PurchaseRfqDTO,
  ReceiveProductDTO,
  ReconciliationReportDTO,
  RecordPhysicalCountEntriesDTO,
  RecordVanCashMovementDTO,
  ReplaceChequeDTO,
  ReverseGlJournalEntryDTO,
  ReverseVoucherDTO,
  RfqQuoteDTO,
  RoleDTO,
  SalesInvoiceDiscountDTO,
  SalesInvoiceListQueryDTO,
  SalesReturnDocumentDTO,
  SessionDTO,
  SettleVanTripDTO,
  StartPhysicalCountDTO,
  StatementColumnMappingDTO,
  StatementLineDTO,
  StockAdjustmentDocumentDTO,
  StockBalanceRowDTO,
  StockTransferDocumentDTO,
  SupplierDTO,
  TaxRateDTO,
  TenantSettingsDTO,
  TransitionLeadDTO,
  TreasuryAccountDTO,
  UpdateAccountDTO,
  UpdateBranchDTO,
  UpdateCostCenterDTO,
  UpdateCustomerDTO,
  UpdateEtaConfigDTO,
  UpdateItemDTO,
  UpdateProjectDTO,
  UpdateRoleDTO,
  UpdateSupplierDTO,
  UpdateTaxRateDTO,
  UpdateTenantSettingsDTO,
  UpdateTreasuryAccountDTO,
  UpdateUserDTO,
  UpdateWarehouseDTO,
  UpsertConfigurableProductDTO,
  UserDTO,
  VanTripDTO,
  VoucherAllocationDTO,
  VoucherDTO,
  VoucherListQueryDTO,
  WarehouseDTO,
  PrintTemplateConfigDTO,
  DepartmentDTO,
  CreateDepartmentDTO,
  UpdateDepartmentDTO,
  JobTitleDTO,
  CreateJobTitleDTO,
  UpdateJobTitleDTO,
  EmployeeDTO,
  CreateEmployeeDTO,
  UpdateEmployeeDTO,
  TransitionEmployeeDTO,
  ContractDTO,
  CreateContractDTO,
  HolidayDTO,
  CreateHolidayDTO,
  UpdateHolidayDTO,
  LeaveRequestDTO,
  CreateLeaveRequestDTO,
  HrDashboardSummaryDTO,
  WritedownRunDTO,
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
  const queryClient = useQueryClient();
  return useMutation<BootstrapSeedResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/bootstrap/seed", { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, "تعذّرت تهيئة البيانات الأساسية.");
      return res.json<BootstrapSeedResultDTO>();
    },
    onSuccess: (counts) => queryClient.setQueryData(["bootstrap", "status"], counts),
  });
}

/** Pre-login tenant identity (ungated) — the name the login screen and first-run wizard show. */
export function useTenantInfo(): UseQueryResult<{ name: string }, ApiError> {
  const { request } = useApi();
  return useQuery<{ name: string }, ApiError>({
    queryKey: ["tenant"],
    queryFn: async () => {
      const res = await request("/tenant");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل بيانات المنشأة.");
      return res.json<{ name: string }>();
    },
  });
}

/** What base data already exists — drives the wizard's seed checklist without triggering a seed. */
export function useBootstrapStatus(): UseQueryResult<BootstrapSeedResultDTO, ApiError> {
  const { request } = useApi();
  return useQuery<BootstrapSeedResultDTO, ApiError>({
    queryKey: ["bootstrap", "status"],
    queryFn: async () => {
      const res = await request("/bootstrap/status");
      if (!res.ok) throw new ApiError(res.status, "تعذّر قراءة حالة البيانات الأساسية.");
      return res.json<BootstrapSeedResultDTO>();
    },
  });
}

/**
 * The tenant's live entitlements (plan / licensed modules / seats) — the same
 * object `/roles` validates permission grants against, so the role editor
 * offers exactly what the server would accept. Ungated: the login screen
 * reads it before a session exists.
 */
export function useEntitlements(): UseQueryResult<EntitlementsDTO, ApiError> {
  const { request } = useApi();
  return useQuery<EntitlementsDTO, ApiError>({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const res = await request("/entitlements");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل بيانات الترخيص.");
      return res.json<EntitlementsDTO>();
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

/* -------------------------------------------------------------------- */
/* الإعدادات — عام (Tenant Settings) (docs/catalog/09)                    */
/* -------------------------------------------------------------------- */

/** إعدادات المنشأة (docs/catalog/09 §"الإعدادات — عام") — the single tenant config bag. */
export function useSettings(): UseQueryResult<TenantSettingsDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<TenantSettingsDTO, ApiError>({
    queryKey: ["settings"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/settings");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الإعدادات.");
      return res.json<TenantSettingsDTO>();
    },
  });
}

export function useUpdateSettings() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TenantSettingsDTO, ApiError, UpdateTenantSettingsDTO>({
    mutationFn: async (body) => {
      const res = await request("/settings", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ الإعدادات."));
      return res.json<TenantSettingsDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
}

/* -------------------------------------------------------------------- */
/* الفروع (docs/catalog/09)                                              */
/* -------------------------------------------------------------------- */

/** الفروع (docs/catalog/09 §"إدارة الفروع") — list, used by the branch typeahead on real-data forms. */
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

export function useCreateBranch() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BranchDTO, ApiError, CreateBranchDTO>({
    mutationFn: async (body) => {
      const res = await request("/branches", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء الفرع."));
      return res.json<BranchDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useUpdateBranch() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BranchDTO, ApiError, { id: string; patch: UpdateBranchDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/branches/${id}`, { method: "PUT", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تعديل الفرع."));
      return res.json<BranchDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }),
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

/** المستودعات (docs/catalog/09 §"إدارة المستودعات") — list, create, edit; also a picker dependency for other real-data screens (e.g. sales invoices). */
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

export function useCreateWarehouse() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WarehouseDTO, ApiError, CreateWarehouseDTO>({
    mutationFn: async (body) => {
      const res = await request("/warehouses", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء المستودع."));
      return res.json<WarehouseDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
  });
}

export function useUpdateWarehouse() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WarehouseDTO, ApiError, { id: string; patch: UpdateWarehouseDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/warehouses/${id}`, { method: "PUT", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تعديل المستودع."));
      return res.json<WarehouseDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
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
// Inventory aging-based write-down batch (docs/tasks.md Phase 4) — inv/labels-templates-writedown
// ---------------------------------------------------------------------------

export function useWritedownRuns(): UseQueryResult<WritedownRunDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WritedownRunDTO[], ApiError>({
    queryKey: ["writedown-runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/inventory/writedown-runs");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عمليات هبوط قيمة المخزون.");
      return res.json<WritedownRunDTO[]>();
    },
  });
}

export function useCreateWritedownRun() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WritedownRunDTO, ApiError, CreateWritedownRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/writedown-runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء عملية هبوط قيمة المخزون."));
      return res.json<WritedownRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["writedown-runs"] }),
  });
}

export function usePostWritedownRun() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WritedownRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/writedown-runs/${id}/post`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر ترحيل عملية هبوط قيمة المخزون."));
      return res.json<WritedownRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["writedown-runs"] }),
  });
}

// ---------------------------------------------------------------------------
// Product Templates (docs/catalog/03-inventory.md §"قوالب المنتجات") — inv/labels-templates-writedown
// ---------------------------------------------------------------------------

export function useProductTemplates(): UseQueryResult<ProductTemplateDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ProductTemplateDTO[], ApiError>({
    queryKey: ["product-templates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/inventory/product-templates");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قوالب المنتجات.");
      return res.json<ProductTemplateDTO[]>();
    },
  });
}

export function useCreateProductTemplate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, CreateProductTemplateDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/product-templates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء قالب المنتج."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useTemplateVariants(templateId: string | null): UseQueryResult<ProductTemplateVariantDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ProductTemplateVariantDTO[], ApiError>({
    queryKey: ["product-template-variants", templateId],
    enabled: session !== null && templateId !== null,
    queryFn: async () => {
      const res = await request(`/inventory/product-templates/${templateId}/variants`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المتغيرات.");
      return res.json<ProductTemplateVariantDTO[]>();
    },
  });
}

export function useAddTemplateAttribute() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; body: AddTemplateAttributeDTO }>({
    mutationFn: async ({ templateId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الخاصية."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useDeleteTemplateAttribute() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string }>({
    mutationFn: async ({ templateId, attributeId }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حذف الخاصية."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useAddAttributeValue() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string; body: AddAttributeValueDTO }>({
    mutationFn: async ({ templateId, attributeId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}/values`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة القيمة."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useDeleteAttributeValue() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string; value: string }>({
    mutationFn: async ({ templateId, attributeId, value }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}/values/${encodeURIComponent(value)}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حذف القيمة."));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useGenerateVariants() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GenerateVariantsResultDTO, ApiError, { templateId: string; body: GenerateVariantsDTO }>({
    mutationFn: async ({ templateId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/variants/generate`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر توليد المتغيرات."));
      return res.json<GenerateVariantsResultDTO>();
    },
    onSuccess: (_data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: ["product-template-variants", templateId] });
      queryClient.invalidateQueries({ queryKey: ["product-templates"] });
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

/* -------------------------------------------------------------------- */
/* التصنيع — Manufacturing (docs/catalog/07): BOMs, work orders,          */
/* configurable products, custom manufacturing (config instances).       */
/* Mounted under /manufacturing/*; @mezan/contracts only ships the       */
/* create/command schemas for these resources, not the response shape,  */
/* so the read-side records are typed locally here to match             */
/* packages/api/src/manufacturing-routes.ts's `serialize*` functions.    */
/* -------------------------------------------------------------------- */

export interface BomCostEstimateDTO {
  readonly materialCost: string;
  readonly laborCost: string;
  readonly overheadCost: string;
  readonly totalCost: string;
  readonly unitCost: string;
}

export interface BomLineRecord {
  readonly itemId: string;
  readonly qty: string;
  readonly wastePercent: number;
  readonly optional: boolean;
  readonly notes: string | null;
}

export interface BomRecord {
  readonly id: string;
  readonly number: string;
  readonly productItemId: string;
  readonly version: number;
  readonly standardQty: string;
  readonly unit: string;
  readonly laborCost: string;
  readonly overheadCost: string;
  readonly versionNotes: string | null;
  readonly lines: readonly BomLineRecord[];
  readonly status: "active" | "inactive";
  readonly custom: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly estimate?: BomCostEstimateDTO;
}

/** قوائم المواد (docs/catalog/07) — the manufacturing recipe a work order is built from. */
export function useBoms(): UseQueryResult<BomRecord[], ApiError> {
  const { request, session } = useApi();
  return useQuery<BomRecord[], ApiError>({
    queryKey: ["boms"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/boms");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قوائم المواد.");
      return res.json<BomRecord[]>();
    },
  });
}

export function useCreateBom() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BomRecord, ApiError, CreateBomDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/boms", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء قائمة المواد."));
      return res.json<BomRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boms"] }),
  });
}

export function useDeactivateBom() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BomRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/boms/${id}/deactivate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعطيل قائمة المواد."));
      return res.json<BomRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boms"] }),
  });
}

/** Wire shape of a posted cost/waste log entry on a work order (packages/api/src/manufacturing-routes.ts `serializeWorkOrder`). */
export interface WorkOrderCostLogEntry {
  readonly kind: "labor" | "overhead" | "other";
  readonly amount: string;
  readonly notes: string | null;
  readonly at: string;
}
export interface WorkOrderWasteLogEntry {
  readonly itemId: string;
  readonly qty: string;
  readonly notes: string | null;
  readonly at: string;
}

export interface WorkOrderMaterialRecord {
  readonly itemId: string;
  readonly requiredQty: string;
  readonly wastePercent: number;
  readonly optional: boolean;
  readonly issuedQty: string;
  readonly returnedQty: string;
  readonly netQty: string;
  readonly issuedUnitCost: string;
}

export type WorkOrderStatusRecord = "planned" | "in_progress" | "completed" | "cancelled";
export type WorkOrderStageRecord = "not_started" | "started" | "materials_issued" | "product_received" | "completed";

export interface WorkOrderRecord {
  readonly id: string;
  readonly number: string;
  readonly bomId: string;
  readonly bomVersion: number;
  readonly productItemId: string;
  readonly plannedQty: string;
  readonly producedQty: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly priority: "low" | "normal" | "high";
  readonly scheduledStartDate: string;
  readonly scheduledEndDate: string | null;
  readonly notes: string | null;
  readonly status: WorkOrderStatusRecord;
  readonly stage: WorkOrderStageRecord;
  readonly materials: readonly WorkOrderMaterialRecord[];
  readonly materialCost: string;
  readonly laborCost: string;
  readonly overheadCost: string;
  readonly extraCost: string;
  readonly wipTotal: string;
  readonly unitCost: string;
  readonly progress: number;
  readonly costLog: readonly WorkOrderCostLogEntry[];
  readonly wasteLog: readonly WorkOrderWasteLogEntry[];
  readonly configInstanceId: string | null;
  readonly glPosted: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly issuedAt: string | null;
  readonly receivedAt: string | null;
  readonly completedAt: string | null;
}

/** أوامر التصنيع (docs/catalog/07) — a production run against a BOM, tracked through its 4-stage lifecycle. */
export function useWorkOrders(): UseQueryResult<WorkOrderRecord[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WorkOrderRecord[], ApiError>({
    queryKey: ["work-orders"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/work-orders");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أوامر التصنيع.");
      return res.json<WorkOrderRecord[]>();
    },
  });
}

export function useCreateWorkOrder() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, CreateWorkOrderDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/work-orders", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء أمر التصنيع."));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
  });
}

function useWorkOrderAction(action: "start" | "complete" | "cancel", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/work-orders/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, fallbackMessage));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
  });
}

/** بدء العمل (not_started → started). */
export function useStartWorkOrder() {
  return useWorkOrderAction("start", "تعذّر بدء أمر التصنيع.");
}
/** إكمال أمر العمل — رسملة الإنتاج تحت التشغيل (product_received → completed). */
export function useCompleteWorkOrder() {
  return useWorkOrderAction("complete", "تعذّر إكمال أمر التصنيع.");
}
/** إلغاء أمر التصنيع. */
export function useCancelWorkOrder() {
  return useWorkOrderAction("cancel", "تعذّر إلغاء أمر التصنيع.");
}

/** صرف المواد الخام حسب قائمة المواد (started → materials_issued). */
export function useIssueWorkOrderMaterials() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/work-orders/${id}/issue`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر صرف المواد."));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
  });
}

/** استلام المنتج التام (materials_issued → product_received). */
export function useReceiveWorkOrderProduct() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: ReceiveProductDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/receive`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر استلام المنتج."));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-orders"] }),
  });
}

export interface ConfigurableProductRecord {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly outputItemId: string;
  readonly unit: string;
  readonly description: string | null;
  readonly inputs: readonly ConfigInputDTO[];
  readonly materials: readonly MaterialFormulaDTO[];
  readonly pricingMethod: PricingMethodDTO;
  readonly priceFormula: string | null;
  readonly laborFormula: string | null;
  readonly overheadFormula: string | null;
  readonly itemPolicy: ItemPolicyDTO;
  readonly status: "active" | "inactive";
  readonly createdBy: string;
  readonly createdAt: string;
}

/** المنتجات القابلة للتهيئة (docs/catalog/07) — formula-driven master data consumed by التصنيع المخصص orders. */
export function useConfigurableProducts(): UseQueryResult<ConfigurableProductRecord[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ConfigurableProductRecord[], ApiError>({
    queryKey: ["configurable-products"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/configurable-products");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المنتجات القابلة للتهيئة.");
      return res.json<ConfigurableProductRecord[]>();
    },
  });
}

export function useCreateConfigurableProduct() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigurableProductRecord, ApiError, UpsertConfigurableProductDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/configurable-products", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة المنتج القابل للتهيئة."));
      return res.json<ConfigurableProductRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["configurable-products"] }),
  });
}

export function useDeactivateConfigurableProduct() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigurableProductRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/configurable-products/${id}/deactivate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعطيل المنتج."));
      return res.json<ConfigurableProductRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["configurable-products"] }),
  });
}

export interface ConfigInstanceMaterialRecord {
  readonly itemId: string;
  readonly qtyPerUnit: string;
  readonly wastePercent: number;
  readonly lineCost: string;
}

export type ConfigInstanceStatusRecord = "configured" | "in_progress" | "produced" | "closed" | "cancelled";

export interface ConfigInstanceRecord {
  readonly id: string;
  readonly number: string;
  readonly configurableProductId: string;
  readonly productNameAr: string;
  readonly outputItemId: string;
  readonly spec: Record<string, string>;
  readonly qty: string;
  readonly customerId: string | null;
  readonly sellUnitPrice: string | null;
  readonly sellTotal: string;
  readonly notes: string | null;
  readonly status: ConfigInstanceStatusRecord;
  readonly bomId: string;
  readonly workOrderId: string;
  readonly materials: readonly ConfigInstanceMaterialRecord[];
  readonly materialCostPerUnit: string;
  readonly laborCostPerUnit: string;
  readonly overheadCostPerUnit: string;
  readonly estimatedUnitCost: string;
  readonly actualCost: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

/** التصنيع المخصص (docs/catalog/07) — one-off make-to-order production against a configurable product's formulas. */
export function useConfigInstances(): UseQueryResult<ConfigInstanceRecord[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ConfigInstanceRecord[], ApiError>({
    queryKey: ["config-instances"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/config-instances");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أوامر التصنيع المخصص.");
      return res.json<ConfigInstanceRecord[]>();
    },
  });
}

export function useCreateConfigInstance() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigInstanceRecord, ApiError, CreateConfigInstanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/config-instances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء أمر التصنيع المخصص."));
      return res.json<ConfigInstanceRecord>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-instances"] });
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });
}

function useConfigInstanceAction(action: "close" | "cancel", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigInstanceRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/config-instances/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, fallbackMessage));
      return res.json<ConfigInstanceRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config-instances"] }),
  });
}

/** إغلاق الأمر (→ مغلقة) — captures the linked work order's actual cost. */
export function useCloseConfigInstance() {
  return useConfigInstanceAction("close", "تعذّر إغلاق أمر التصنيع المخصص.");
}
/** إلغاء أمر التصنيع المخصص. */
export function useCancelConfigInstance() {
  return useConfigInstanceAction("cancel", "تعذّر إلغاء أمر التصنيع المخصص.");
}

export interface ConfigInstancePreviewMaterial {
  readonly itemId: string;
  readonly qtyPerUnit: string;
  readonly effectiveQtyPerUnit: string;
  readonly wastePercent: number;
  readonly unitCost: string;
  readonly lineCost: string;
}

export interface ConfigInstancePreviewResult {
  readonly materials: readonly ConfigInstancePreviewMaterial[];
  readonly materialCostPerUnit: string;
  readonly laborCostPerUnit: string;
  readonly overheadCostPerUnit: string;
  readonly unitPrice: string | null;
}

/** معاينة الاحتياجات والتكلفة — computes materials/cost/price for a spec with no persistence, as the create form's inputs change. */
export function usePreviewConfigInstance() {
  const { request } = useApi();
  return useMutation<ConfigInstancePreviewResult, ApiError, PreviewConfigInstanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/config-instances/preview", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّرت معاينة الأمر."));
      return res.json<ConfigInstancePreviewResult>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* sweep/finish-and-mount — Cost Centers, Fiscal Periods, Taxes          */
/* -------------------------------------------------------------------- */

/** مراكز التكلفة (docs/catalog/04) — list, create, edit. */
export function useCostCenters(): UseQueryResult<CostCenterDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<CostCenterDTO[], ApiError>({
    queryKey: ["cost-centers"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/cost-centers");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مراكز التكلفة.");
      return res.json<CostCenterDTO[]>();
    },
  });
}

export function useCreateCostCenter() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CostCenterDTO, ApiError, CreateCostCenterDTO>({
    mutationFn: async (body) => {
      const res = await request("/cost-centers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة مركز التكلفة."));
      return res.json<CostCenterDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cost-centers"] }),
  });
}

export function useUpdateCostCenter() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CostCenterDTO, ApiError, { id: string; patch: UpdateCostCenterDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/cost-centers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل مركز التكلفة."));
      return res.json<CostCenterDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cost-centers"] }),
  });
}

/** الفترات المالية (docs/catalog/04) — list, generate a fiscal year, and the three-tier close/reopen/lock lifecycle. */
export function useFiscalPeriods(): UseQueryResult<FiscalPeriodDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<FiscalPeriodDTO[], ApiError>({
    queryKey: ["fiscal-periods"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/fiscal-periods");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الفترات المالية.");
      return res.json<FiscalPeriodDTO[]>();
    },
  });
}

/** إنشاء السنة التالية — generates the 12 monthly periods for a fiscal year. */
export function useGenerateFiscalYear() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FiscalPeriodDTO[], ApiError, GenerateFiscalYearDTO>({
    mutationFn: async (body) => {
      const res = await request("/fiscal-periods/generate-year", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء فترات السنة المالية."));
      return res.json<FiscalPeriodDTO[]>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fiscal-periods"] }),
  });
}

function useFiscalPeriodTransition(action: "close" | "reopen" | "lock", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FiscalPeriodDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/fiscal-periods/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, fallbackMessage));
      return res.json<FiscalPeriodDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fiscal-periods"] }),
  });
}

/** إغلاق الفترة (مفتوحة → مغلقة). */
export function useClosePeriod() {
  return useFiscalPeriodTransition("close", "تعذر إغلاق الفترة.");
}
/** إعادة فتح الفترة (مغلقة → مفتوحة). */
export function useReopenPeriod() {
  return useFiscalPeriodTransition("reopen", "تعذر إعادة فتح الفترة.");
}
/** قفل الفترة (مغلقة → مقفلة، نهائي). */
export function useLockPeriod() {
  return useFiscalPeriodTransition("lock", "تعذر قفل الفترة.");
}

/** الضرائب (docs/catalog/04) — list, create, edit. */
export function useTaxRates(): UseQueryResult<TaxRateDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<TaxRateDTO[], ApiError>({
    queryKey: ["tax-rates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/tax-rates");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الضرائب.");
      return res.json<TaxRateDTO[]>();
    },
  });
}

export function useCreateTaxRate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TaxRateDTO, ApiError, CreateTaxRateDTO>({
    mutationFn: async (body) => {
      const res = await request("/tax-rates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الضريبة."));
      return res.json<TaxRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-rates"] }),
  });
}

export function useUpdateTaxRate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TaxRateDTO, ApiError, { id: string; patch: UpdateTaxRateDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/tax-rates/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الضريبة."));
      return res.json<TaxRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-rates"] }),
  });
}

/* -------------------------------------------------------------------- */
/* أسعار الصرف — Exchange Rates (docs/catalog/04)                        */
/* -------------------------------------------------------------------- */

export function useExchangeRates(): UseQueryResult<ExchangeRateDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ExchangeRateDTO[], ApiError>({
    queryKey: ["exchange-rates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/exchange-rates");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أسعار الصرف.");
      return res.json<ExchangeRateDTO[]>();
    },
  });
}

export function useCreateExchangeRate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, CreateExchangeRateDTO>({
    mutationFn: async (body) => {
      const res = await request("/exchange-rates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة سعر الصرف."));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

export function useApproveExchangeRate() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/exchange-rates/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر اعتماد سعر الصرف."));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

/* -------------------------------------------------------------------- */
/* أرباح مراكز التكلفة — Cost Center P&L (docs/catalog/04)               */
/* -------------------------------------------------------------------- */

/** Groups posted revenue/expense by the cost-center dimension over `[fromDate, toDate]`. */
export function useCostCenterPnL(fromDate: string, toDate: string): UseQueryResult<CostCenterPnLReportDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<CostCenterPnLReportDTO, ApiError>({
    queryKey: ["cost-center-pl", fromDate, toDate],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/cost-center-pl?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أرباح مراكز التكلفة.");
      return res.json<CostCenterPnLReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* إعادة تقييم العملات الأجنبية — FX Revaluation (docs/catalog/04)       */
/* -------------------------------------------------------------------- */

export function useFxRevaluationPreview() {
  const { request } = useApi();
  return useMutation<FxRevaluationPreviewDTO, ApiError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/revaluation/preview", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حساب إعادة التقييم."));
      return res.json<FxRevaluationPreviewDTO>();
    },
  });
}

export function useFxRevaluationPost() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FxRevaluationPostResultDTO, ApiError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/revaluation/post", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر ترحيل إعادة التقييم."));
      return res.json<FxRevaluationPostResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reconciliation"] }),
  });
}

/* -------------------------------------------------------------------- */
/* مطابقة الأرصدة — Balance Reconciliation (docs/catalog/04)             */
/* -------------------------------------------------------------------- */

export function useReconciliation(): UseQueryResult<ReconciliationReportDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<ReconciliationReportDTO, ApiError>({
    queryKey: ["reconciliation"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/reconciliation");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مطابقة الأرصدة.");
      return res.json<ReconciliationReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* الفاتورة الإلكترونية — ETA e-Invoicing (docs/catalog/04)              */
/* -------------------------------------------------------------------- */

export interface EtaConfigResponse {
  readonly config: EtaConfigDTO;
  readonly readiness: EtaReadinessDTO;
}

export function useEtaConfig(): UseQueryResult<EtaConfigResponse, ApiError> {
  const { request, session } = useApi();
  return useQuery<EtaConfigResponse, ApiError>({
    queryKey: ["eta-config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/config");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل إعدادات الفاتورة الإلكترونية.");
      return res.json<EtaConfigResponse>();
    },
  });
}

export function useUpdateEtaConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaConfigResponse, ApiError, UpdateEtaConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/eta/config", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حفظ إعدادات الفاتورة الإلكترونية."));
      return res.json<EtaConfigResponse>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-config"] }),
  });
}

export function useEtaSubmissions(status?: EtaSubmissionStatusDTO): UseQueryResult<EtaSubmissionDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<EtaSubmissionDTO[], ApiError>({
    queryKey: ["eta-submissions", status ?? "all"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/eta/submissions${status ? `?status=${status}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قائمة الإرسال.");
      return res.json<EtaSubmissionDTO[]>();
    },
  });
}

/** `submission` is null when the server queued it offline instead of submitting (202 — see `queuedOffline`). */
export interface SubmitEtaSubmissionResult {
  readonly submission: EtaSubmissionDTO | null;
  readonly queuedOffline: boolean;
}

export function useSubmitEtaSubmission() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SubmitEtaSubmissionResult, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/eta/submissions/${id}/submit`, { method: "POST" });
      // 202 (EtaOfflineError — the stubbed online transmit refusing offline) is a
      // non-fatal, still-queued outcome, not an error — its body has no submission.
      if (res.status === 202) return { submission: null, queuedOffline: true };
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إرسال المستند."));
      return { submission: await res.json<EtaSubmissionDTO>(), queuedOffline: false };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export interface SubmitAllReadyEtaResult {
  readonly submitted: readonly EtaSubmissionDTO[];
  readonly queued: readonly string[];
}

export function useSubmitAllReadyEta() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SubmitAllReadyEtaResult, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/submissions/submit-all", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إرسال المستندات الجاهزة."));
      return res.json<SubmitAllReadyEtaResult>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export function useExcludeEtaSubmission() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmissionDTO, ApiError, { id: string; body: ExcludeEtaSubmissionDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/eta/submissions/${id}/exclude`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر استبعاد المستند."));
      return res.json<EtaSubmissionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

/* -------------------------------------------------------------------- */
/* تسويات وتحويلات وجرد المخزون — Inventory Ops document layer (docs/catalog/03) */
/* -------------------------------------------------------------------- */

interface DocumentStatusFilter {
  readonly status?: DocumentStatusDTO;
}

export function useStockAdjustments(filter: DocumentStatusFilter = {}): UseQueryResult<StockAdjustmentDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<StockAdjustmentDocumentDTO[], ApiError>({
    queryKey: ["stock-adjustments", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/inventory/stock-adjustments${filter.status ? `?status=${filter.status}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تسويات المخزون.");
      return res.json<StockAdjustmentDocumentDTO[]>();
    },
  });
}

export function useCreateStockAdjustment() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockAdjustmentDocumentDTO, ApiError, CreateStockAdjustmentDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/stock-adjustments/draft", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء تسوية المخزون."));
      return res.json<StockAdjustmentDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] }),
  });
}

export function useConfirmStockAdjustment() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: StockAdjustmentDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/stock-adjustments/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تأكيد تسوية المخزون."));
      return res.json<{ document: StockAdjustmentDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

export function useStockTransfers(filter: DocumentStatusFilter = {}): UseQueryResult<StockTransferDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<StockTransferDocumentDTO[], ApiError>({
    queryKey: ["stock-transfers", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/inventory/stock-transfers${filter.status ? `?status=${filter.status}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تحويلات المخزون.");
      return res.json<StockTransferDocumentDTO[]>();
    },
  });
}

export function useCreateStockTransfer() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockTransferDocumentDTO, ApiError, CreateStockTransferDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/stock-transfers/draft", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء تحويل المخزون."));
      return res.json<StockTransferDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-transfers"] }),
  });
}

export function useConfirmStockTransfer() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: StockTransferDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/stock-transfers/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تأكيد تحويل المخزون."));
      return res.json<{ document: StockTransferDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

interface PhysicalCountFilter {
  readonly status?: PhysicalCountStatusDTO;
  readonly warehouseId?: string;
}

export function usePhysicalCounts(filter: PhysicalCountFilter = {}): UseQueryResult<PhysicalCountDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PhysicalCountDTO[], ApiError>({
    queryKey: ["physical-counts", filter],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.status) params.set("status", filter.status);
      if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
      const qs = params.toString();
      const res = await request(`/inventory/physical-counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قوائم الجرد.");
      return res.json<PhysicalCountDTO[]>();
    },
  });
}

export function useStartPhysicalCount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, StartPhysicalCountDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/physical-counts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر بدء الجرد."));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useRecordPhysicalCountEntries() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, { id: string; body: RecordPhysicalCountEntriesDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/inventory/physical-counts/${id}/counts`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تسجيل الكميات المجرودة."));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useCompletePhysicalCount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/physical-counts/${id}/complete`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنهاء الجرد."));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useCancelPhysicalCount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/physical-counts/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إلغاء الجرد."));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useGenerateAdjustmentFromCount() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    { count: PhysicalCountDTO; adjustment: StockAdjustmentDocumentDTO | null },
    ApiError,
    { id: string; body: GenerateAdjustmentFromCountDTO }
  >({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/inventory/physical-counts/${id}/generate-adjustment`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء تسوية الجرد."));
      return res.json<{ count: PhysicalCountDTO; adjustment: StockAdjustmentDocumentDTO | null }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["physical-counts"] });
      queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

export interface StockBalanceFilter {
  readonly warehouseId?: string;
}

/** أرصدة المخزون (docs/catalog/03) — cross-warehouse rollup, one row per item (packages/api/src/inventory-routes.ts's `/inventory/stock-balance`). */
export function useStockBalance(filter: StockBalanceFilter = {}): UseQueryResult<StockBalanceRowDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<StockBalanceRowDTO[], ApiError>({
    queryKey: ["stock-balance", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/inventory/stock-balance${filter.warehouseId ? `?warehouseId=${filter.warehouseId}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل رصيد المخزون.");
      const body = await res.json<{ rows: StockBalanceRowDTO[] }>();
      return body.rows;
    },
  });
}

/**
 * The `/rfqs/:id/comparison` per-item/per-supplier price grid (packages/api/src/rfq-routes.ts) —
 * the server-computed equivalent of `@mezan/domain`'s `compareRfqQuotes`, but over the wire
 * DTOs (decimal strings) rather than `Money`/`Qty` instances, so it isn't a shipped DTO.
 */
export interface RfqComparisonRowRecord {
  readonly itemId: string;
  readonly qty: string;
  readonly quotesBySupplier: Record<string, string>;
  readonly cheapestSupplierId: string | null;
}

export interface RfqComparisonRecord {
  readonly rfq: PurchaseRfqDTO;
  readonly supplierIds: readonly string[];
  readonly rows: readonly RfqComparisonRowRecord[];
  readonly totalsBySupplier: Record<string, string>;
}

/** طلبات عروض الأسعار / RFQs (docs/catalog/02) — list, create, and the draft → sent → closed/cancelled lifecycle. */
export function useRfqs(): UseQueryResult<PurchaseRfqDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PurchaseRfqDTO[], ApiError>({
    queryKey: ["rfqs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/rfqs");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل طلبات عروض الأسعار.");
      return res.json<PurchaseRfqDTO[]>();
    },
  });
}

/** عروض الموردين المسجلة على طلب عرض سعر واحد. */
export function useRfqQuotes(rfqId: string | null): UseQueryResult<RfqQuoteDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<RfqQuoteDTO[], ApiError>({
    queryKey: ["rfqs", rfqId, "quotes"],
    enabled: session !== null && rfqId !== null,
    queryFn: async () => {
      const res = await request(`/rfqs/${rfqId}/quotes`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عروض الموردين.");
      return res.json<RfqQuoteDTO[]>();
    },
  });
}

/** شبكة مقارنة العروض (سعر لكل صنف/مورد، وإجمالي السلة الكاملة لكل مورد). */
export function useRfqComparison(rfqId: string | null): UseQueryResult<RfqComparisonRecord, ApiError> {
  const { request, session } = useApi();
  return useQuery<RfqComparisonRecord, ApiError>({
    queryKey: ["rfqs", rfqId, "comparison"],
    enabled: session !== null && rfqId !== null,
    queryFn: async () => {
      const res = await request(`/rfqs/${rfqId}/comparison`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مقارنة العروض.");
      return res.json<RfqComparisonRecord>();
    },
  });
}

export function useCreateRfq() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseRfqDTO, ApiError, CreatePurchaseRfqDTO>({
    mutationFn: async (body) => {
      const res = await request("/rfqs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنشاء طلب عرض السعر."));
      return res.json<PurchaseRfqDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rfqs"] }),
  });
}

function useRfqTransition(action: "send" | "close" | "cancel", fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseRfqDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/rfqs/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, fallbackMessage));
      return res.json<PurchaseRfqDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rfqs"] }),
  });
}

/** إرسال طلب عرض السعر للموردين (مسودة → مرسل). */
export function useSendRfq() {
  return useRfqTransition("send", "تعذّر إرسال طلب عرض السعر.");
}
/** إغلاق طلب عرض السعر بدون تحويل (مرسل → مغلق). */
export function useCloseRfq() {
  return useRfqTransition("close", "تعذّر إغلاق طلب عرض السعر.");
}
/** إلغاء طلب عرض السعر. */
export function useCancelRfq() {
  return useRfqTransition("cancel", "تعذّر إلغاء طلب عرض السعر.");
}

/** تسجيل عرض سعر مورد جديد على طلب عرض سعر مرسل. */
export function useCreateRfqQuote() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RfqQuoteDTO, ApiError, { rfqId: string; body: CreateRfqQuoteDTO }>({
    mutationFn: async ({ rfqId, body }) => {
      const res = await request(`/rfqs/${rfqId}/quotes`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تسجيل عرض السعر."));
      return res.json<RfqQuoteDTO>();
    },
    onSuccess: (_data, { rfqId }) => {
      queryClient.invalidateQueries({ queryKey: ["rfqs", rfqId, "quotes"] });
      queryClient.invalidateQueries({ queryKey: ["rfqs", rfqId, "comparison"] });
    },
  });
}

/** تحويل عرض مختار إلى أمر شراء حقيقي — يغلق طلب عرض السعر ويربطه بالأمر الجديد. */
export function useConvertRfq() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ rfq: PurchaseRfqDTO; purchaseOrderId: string }, ApiError, { rfqId: string; body: ConvertRfqDTO }>({
    mutationFn: async ({ rfqId, body }) => {
      const res = await request(`/rfqs/${rfqId}/convert`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحويل طلب عرض السعر إلى أمر شراء."));
      return res.json<{ rfq: PurchaseRfqDTO; purchaseOrderId: string }>();
    },
    onSuccess: (_data, { rfqId }) => {
      queryClient.invalidateQueries({ queryKey: ["rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["rfqs", rfqId, "comparison"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

/** مرتجعات المبيعات (docs/catalog/01) — list, create draft (against a confirmed sales invoice), confirm, cancel/void. */
export function useSalesReturns(status?: DocumentStatusDTO): UseQueryResult<SalesReturnDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<SalesReturnDocumentDTO[], ApiError>({
    queryKey: ["sales-returns", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/sales-returns${qs}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مرتجعات المبيعات.");
      return res.json<SalesReturnDocumentDTO[]>();
    },
  });
}

export function useCreateSalesReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesReturnDocumentDTO, ApiError, CreateSalesReturnDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-returns", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء مرتجع المبيعات."));
      return res.json<SalesReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

export function useConfirmSalesReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: SalesReturnDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-returns/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد مرتجع المبيعات."));
      return res.json<{ document: SalesReturnDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

export function useCancelSalesReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesReturnDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-returns/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء مرتجع المبيعات."));
      return res.json<SalesReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

/** مرتجعات المشتريات (docs/catalog/02) — list, create draft (against a confirmed purchase invoice), confirm, cancel/void. */
export function usePurchaseReturns(status?: DocumentStatusDTO): UseQueryResult<PurchaseReturnDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PurchaseReturnDocumentDTO[], ApiError>({
    queryKey: ["purchase-returns", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/purchase-returns${qs}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مرتجعات المشتريات.");
      return res.json<PurchaseReturnDocumentDTO[]>();
    },
  });
}

export function useCreatePurchaseReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseReturnDocumentDTO, ApiError, CreatePurchaseReturnDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchase-returns", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء مرتجع المشتريات."));
      return res.json<PurchaseReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

export function useConfirmPurchaseReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: PurchaseReturnDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchase-returns/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد مرتجع المشتريات."));
      return res.json<{ document: PurchaseReturnDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

export function useCancelPurchaseReturn() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseReturnDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchase-returns/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء مرتجع المشتريات."));
      return res.json<PurchaseReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

/** التكاليف الإضافية (docs/catalog/02) — list, create draft (server runs distributeLandedCost and persists the allocated lines), confirm (runs the cost-layer revaluation), cancel/void. */
export function useLandedCosts(status?: DocumentStatusDTO): UseQueryResult<LandedCostDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<LandedCostDocumentDTO[], ApiError>({
    queryKey: ["landed-costs", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/landed-costs${qs}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل مستندات التكاليف الإضافية.");
      return res.json<LandedCostDocumentDTO[]>();
    },
  });
}

export function useCreateLandedCost() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LandedCostDocumentDTO, ApiError, CreateLandedCostDTO>({
    mutationFn: async (body) => {
      const res = await request("/landed-costs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء مستند التكلفة الإضافية."));
      return res.json<LandedCostDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-costs"] }),
  });
}

export function useConfirmLandedCost() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: LandedCostDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/landed-costs/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد مستند التكلفة الإضافية."));
      return res.json<{ document: LandedCostDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landed-costs"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useCancelLandedCost() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LandedCostDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/landed-costs/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء مستند التكلفة الإضافية."));
      return res.json<LandedCostDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-costs"] }),
  });
}

/** خطط الأقساط (docs/catalog/05) — list, create (server builds the payment schedule), confirm, cancel/void, and the معالجة المتأخرات overdue batch. */
export function useInstallmentPlans(status?: DocumentStatusDTO): UseQueryResult<InstallmentPlanDocumentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<InstallmentPlanDocumentDTO[], ApiError>({
    queryKey: ["installment-plans", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/installments/plans${qs}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل خطط الأقساط.");
      return res.json<InstallmentPlanDocumentDTO[]>();
    },
  });
}

export function useCreateInstallmentPlan() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<InstallmentPlanDocumentDTO, ApiError, CreateInstallmentPlanDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/plans", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء خطة الأقساط."));
      return res.json<InstallmentPlanDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useConfirmInstallmentPlan() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: InstallmentPlanDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/plans/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تأكيد خطة الأقساط."));
      return res.json<{ document: InstallmentPlanDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useCancelInstallmentPlan() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<InstallmentPlanDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/plans/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء خطة الأقساط."));
      return res.json<InstallmentPlanDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useProcessOverdueInstallments() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProcessOverdueInstallmentsResultDTO, ApiError, ProcessOverdueInstallmentsDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/plans/overdue/process", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر معالجة الأقساط المتأخرة."));
      return res.json<ProcessOverdueInstallmentsResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export interface FollowUpListFilters {
  readonly status?: FollowUpStatusDTO;
  readonly customerId?: string;
}

/** متابعة التحصيل (docs/catalog/05) — list (filterable by status/customer), create, complete (records an outcome), cancel. */
export function useFollowUps(filters: FollowUpListFilters = {}): UseQueryResult<CollectionFollowUpDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<CollectionFollowUpDTO[], ApiError>({
    queryKey: ["follow-ups", filters.status ?? null, filters.customerId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.customerId) params.set("customerId", filters.customerId);
      const qs = params.toString();
      const res = await request(`/installments/follow-ups${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل متابعات التحصيل.");
      return res.json<CollectionFollowUpDTO[]>();
    },
  });
}

export function useCreateFollowUp() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, CreateFollowUpDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/follow-ups", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إضافة متابعة."));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

export function useCompleteFollowUp() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, { id: string; outcome: string }>({
    mutationFn: async ({ id, outcome }) => {
      const res = await request(`/installments/follow-ups/${id}/complete`, { method: "POST", body: JSON.stringify({ outcome }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إكمال المتابعة."));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

export function useCancelFollowUp() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/follow-ups/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إلغاء المتابعة."));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

// ---------------------------------------------------------------------------
// HR master data (docs/catalog/06 "الموارد البشرية") — hr/master-data
// ---------------------------------------------------------------------------

export function useDepartments(): UseQueryResult<DepartmentDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<DepartmentDTO[], ApiError>({
    queryKey: ["hr-departments"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/departments");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الأقسام.");
      return res.json<DepartmentDTO[]>();
    },
  });
}

export function useCreateDepartment() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepartmentDTO, ApiError, CreateDepartmentDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/departments", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة القسم."));
      return res.json<DepartmentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-departments"] }),
  });
}

export function useUpdateDepartment() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepartmentDTO, ApiError, { id: string; body: UpdateDepartmentDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/departments/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل القسم."));
      return res.json<DepartmentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-departments"] }),
  });
}

export function useJobTitles(): UseQueryResult<JobTitleDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<JobTitleDTO[], ApiError>({
    queryKey: ["hr-job-titles"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/job-titles");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل المسميات الوظيفية.");
      return res.json<JobTitleDTO[]>();
    },
  });
}

export function useCreateJobTitle() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JobTitleDTO, ApiError, CreateJobTitleDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/job-titles", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة المسمى الوظيفي."));
      return res.json<JobTitleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-job-titles"] }),
  });
}

export function useUpdateJobTitle() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JobTitleDTO, ApiError, { id: string; body: UpdateJobTitleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/job-titles/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل المسمى الوظيفي."));
      return res.json<JobTitleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-job-titles"] }),
  });
}

export function useEmployees(): UseQueryResult<EmployeeDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<EmployeeDTO[], ApiError>({
    queryKey: ["hr-employees"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/employees");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الموظفين.");
      return res.json<EmployeeDTO[]>();
    },
  });
}

export function useEmployeeContracts(employeeId: string | null): UseQueryResult<ContractDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ContractDTO[], ApiError>({
    queryKey: ["hr-employee-contracts", employeeId],
    enabled: session !== null && employeeId !== null,
    queryFn: async () => {
      const res = await request(`/hr/employees/${employeeId}/contracts`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عقود الموظف.");
      return res.json<ContractDTO[]>();
    },
  });
}

export function useCreateEmployee() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, CreateEmployeeDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/employees", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الموظف."));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useUpdateEmployee() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; body: UpdateEmployeeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/employees/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الموظف."));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useTransitionEmployee() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; body: TransitionEmployeeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/employees/${id}/transition`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تحديث حالة الموظف."));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useTerminateEmployee() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/employees/${id}/terminate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنهاء خدمة الموظف."));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useContracts(): UseQueryResult<ContractDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ContractDTO[], ApiError>({
    queryKey: ["hr-contracts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/contracts");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل العقود.");
      return res.json<ContractDTO[]>();
    },
  });
}

export function useCreateContract() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ContractDTO, ApiError, CreateContractDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/contracts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة العقد."));
      return res.json<ContractDTO>();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee-contracts", variables.employeeId] });
    },
  });
}

export function useTerminateContract() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ContractDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/contracts/${id}/terminate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إنهاء العقد."));
      return res.json<ContractDTO>();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee-contracts", data.employeeId] });
    },
  });
}

export function useHolidays(year: number): UseQueryResult<HolidayDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<HolidayDTO[], ApiError>({
    queryKey: ["hr-holidays", year],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/holidays?year=${year}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الإجازات الرسمية.");
      return res.json<HolidayDTO[]>();
    },
  });
}

export function useCreateHoliday() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HolidayDTO, ApiError, CreateHolidayDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/holidays", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة الإجازة."));
      return res.json<HolidayDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export function useUpdateHoliday() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HolidayDTO, ApiError, { id: string; body: UpdateHolidayDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/holidays/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل الإجازة."));
      return res.json<HolidayDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export function useDeleteHoliday() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر حذف الإجازة."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export interface MyLeaveDTO {
  readonly employeeId: string | null;
  readonly requests: LeaveRequestDTO[];
}

export function useMyLeave(): UseQueryResult<MyLeaveDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<MyLeaveDTO, ApiError>({
    queryKey: ["hr-my-leave"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/leave-requests/me");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل إجازاتي.");
      return res.json<MyLeaveDTO>();
    },
  });
}

export function useCreateLeaveRequest() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, CreateLeaveRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/leave-requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إرسال طلب الإجازة."));
      return res.json<LeaveRequestDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-my-leave"] }),
  });
}

export function useCancelLeaveRequest() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/leave-requests/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إلغاء طلب الإجازة."));
      return res.json<LeaveRequestDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-my-leave"] }),
  });
}

export function useHrDashboard(): UseQueryResult<HrDashboardSummaryDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<HrDashboardSummaryDTO, ApiError>({
    queryKey: ["hr-dashboard"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/dashboard");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل لوحة الموارد البشرية.");
      return res.json<HrDashboardSummaryDTO>();
    },
  });
}

/* ------------------------------------------------------------------ */
/* قواعد الإشعارات / Notification rules (docs/catalog/09) + top-bar panel */
/* ------------------------------------------------------------------ */

export function useNotificationRules(): UseQueryResult<NotificationRuleDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<NotificationRuleDTO[], ApiError>({
    queryKey: ["notification-rules"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/notification-rules");
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحميل قواعد الإشعارات."));
      return res.json<NotificationRuleDTO[]>();
    },
  });
}

export function useCreateNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, CreateNotificationRuleDTO>({
    mutationFn: async (body) => {
      const res = await request("/notification-rules", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إنشاء القاعدة."));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useUpdateNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, { id: string; body: UpdateNotificationRuleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/notification-rules/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحديث القاعدة."));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useSetNotificationRuleActive() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, { id: string; active: boolean }>({
    mutationFn: async ({ id, active }) => {
      const res = await request(`/notification-rules/${id}/${active ? "activate" : "deactivate"}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحديث حالة القاعدة."));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useDeleteNotificationRule() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notification-rules/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new ApiError(res.status, await readError(res, "تعذر حذف القاعدة."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

/** The current user's own notifications (top-bar bell panel) — real data off `/notifications`. */
export function useNotifications(status?: "unread" | "read"): UseQueryResult<NotificationDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<NotificationDTO[], ApiError>({
    queryKey: ["notifications", status ?? "all"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const qs = status ? `?status=${status}&limit=50` : "?limit=50";
      const res = await request(`/notifications${qs}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحميل الإشعارات."));
      return res.json<NotificationDTO[]>();
    },
  });
}

export function useUnreadNotificationCount(): UseQueryResult<number, ApiError> {
  const { request, session } = useApi();
  return useQuery<number, ApiError>({
    queryKey: ["notifications", "unread-count"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/notifications/unread-count");
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحميل عدد الإشعارات."));
      const body = await res.json<{ count: number }>();
      return body.count;
    },
  });
}

export function useMarkNotificationRead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تحديث الإشعار."));
      return res.json<NotificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/notifications/read-all", { method: "POST" });
      if (!res.ok && res.status !== 204) throw new ApiError(res.status, await readError(res, "تعذر تحديد الكل كمقروء."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/* ------------------------------------------------------------------ */
/* قوالب الطباعة (Print Templates) — docs/catalog/09 §"قوالب الطباعة"    */
/* ------------------------------------------------------------------ */

/** The tenant's saved print-template config, or the shared default if none was saved yet. */
export function usePrintTemplateConfig(): UseQueryResult<PrintTemplateConfigDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<PrintTemplateConfigDTO, ApiError>({
    queryKey: ["print-template-config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/print-template-config");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل قالب الطباعة.");
      return res.json<PrintTemplateConfigDTO>();
    },
  });
}

export function useSavePrintTemplateConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PrintTemplateConfigDTO, ApiError, PrintTemplateConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/print-template-config", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ قالب الطباعة."));
      return res.json<PrintTemplateConfigDTO>();
    },
    onSuccess: (config) => queryClient.setQueryData(["print-template-config"], config),
  });
}

/* ------------------------------------------------------------------ */
/* نقل البيانات (Data Migration wizard) — docs/catalog/09 §"نقل البيانات" */
/* ------------------------------------------------------------------ */

export interface DataMigrationRowErrorDTO {
  readonly rowNumber: number;
  readonly reasons: readonly string[];
}

export interface DataMigrationStepResultDTO {
  readonly validCount: number;
  readonly errors: readonly DataMigrationRowErrorDTO[];
  readonly createdIds?: readonly string[];
}

/** Registered-record counts for every one of the 13 wizard steps, driving each step's badge/checkmark. */
export interface DataMigrationStatusDTO {
  readonly departments: number;
  readonly employees: number;
  readonly treasuryAccounts: number;
  readonly suppliers: number;
  readonly customers: number;
  readonly items: number;
  readonly itemUnits: number;
  readonly assetCategories: number;
  readonly assets: number;
  readonly salesInvoices: number;
  readonly salesReturns: number;
  readonly purchaseInvoices: number;
  readonly purchaseReturns: number;
}

/** The 9 master-data step ids `createDataMigrationRoutes` (packages/api) exposes preview/commit for. */
export type DataMigrationMasterStep =
  | "departments"
  | "employees"
  | "treasury-accounts"
  | "suppliers"
  | "customers"
  | "items"
  | "item-units"
  | "asset-categories"
  | "assets";

export function useDataMigrationStatus(): UseQueryResult<DataMigrationStatusDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<DataMigrationStatusDTO, ApiError>({
    queryKey: ["data-migration", "status"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/data-migration/status");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل حالة نقل البيانات.");
      return res.json<DataMigrationStatusDTO>();
    },
  });
}

/** Dry-run (no persistence) validation for one master-data step's parsed rows. */
export function useDataMigrationPreview(step: DataMigrationMasterStep) {
  const { request } = useApi();
  return useMutation<DataMigrationStepResultDTO, ApiError, readonly Record<string, string>[]>({
    mutationFn: async (rows) => {
      const res = await request(`/data-migration/${step}/preview`, { method: "POST", body: JSON.stringify({ rows }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر التحقق من الملف."));
      return res.json<DataMigrationStepResultDTO>();
    },
  });
}

/** All-or-nothing commit for one master-data step's parsed rows — nothing persists unless every row validates. */
export function useDataMigrationCommit(step: DataMigrationMasterStep) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DataMigrationStepResultDTO, ApiError, readonly Record<string, string>[]>({
    mutationFn: async (rows) => {
      const res = await request(`/data-migration/${step}/commit`, { method: "POST", body: JSON.stringify({ rows }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تنفيذ الاستيراد."));
      return res.json<DataMigrationStepResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data-migration", "status"] }),
  });
}

/** The 4 historical-document steps (10-13) reuse `/sales/historical-import` and `/purchases/historical-import` directly. */
export type HistoricalImportKind = "sales" | "purchases";
export type HistoricalImportDocType = "SALES_INVOICE" | "SALES_RETURN" | "PURCHASE_INVOICE" | "PURCHASE_RETURN";

export interface HistoricalImportRowDTO {
  readonly rowNumber: number;
  readonly docType: HistoricalImportDocType;
  readonly documentNumber: string;
  readonly partyId: string;
  readonly date: string;
  readonly dueDate?: string | null;
  readonly itemId?: string | null;
  readonly description?: string | null;
  readonly qty: string;
  readonly unitCost: string;
  readonly amountPaid: string;
}

interface HistoricalImportBatchWire {
  readonly rows: {
    rowNumber: number;
    docType: HistoricalImportDocType;
    documentNumber: string;
    supplierId?: string;
    customerId?: string;
    date: string;
    dueDate?: string | null;
    itemId?: string | null;
    description?: string | null;
    qty: string;
    unitCost: string;
    amountPaid: string;
  }[];
}

function toHistoricalImportWireBody(kind: HistoricalImportKind, rows: readonly HistoricalImportRowDTO[]): HistoricalImportBatchWire {
  return {
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      docType: r.docType,
      documentNumber: r.documentNumber,
      ...(kind === "sales" ? { customerId: r.partyId } : { supplierId: r.partyId }),
      date: r.date,
      dueDate: r.dueDate,
      itemId: r.itemId,
      description: r.description,
      qty: r.qty,
      unitCost: r.unitCost,
      amountPaid: r.amountPaid,
    })),
  };
}

export interface HistoricalImportGroupDTO {
  readonly documentNumber: string;
  readonly docType: HistoricalImportDocType;
  readonly lineCount: number;
  readonly total: string;
  readonly amountPaid: string;
  readonly remainingBalance: string;
  readonly settled: boolean;
}

export interface HistoricalImportResultDTO {
  readonly groups: readonly HistoricalImportGroupDTO[];
  readonly errors: readonly DataMigrationRowErrorDTO[];
  readonly archivedIds?: readonly string[];
}

export function useHistoricalImportPreview(kind: HistoricalImportKind) {
  const { request } = useApi();
  return useMutation<HistoricalImportResultDTO, ApiError, readonly HistoricalImportRowDTO[]>({
    mutationFn: async (rows) => {
      const res = await request(`/${kind}/historical-import/preview`, {
        method: "POST",
        body: JSON.stringify(toHistoricalImportWireBody(kind, rows)),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر التحقق من الملف."));
      return res.json<HistoricalImportResultDTO>();
    },
  });
}

export function useHistoricalImportCommit(kind: HistoricalImportKind) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HistoricalImportResultDTO, ApiError, readonly HistoricalImportRowDTO[]>({
    mutationFn: async (rows) => {
      const res = await request(`/${kind}/historical-import/commit`, {
        method: "POST",
        body: JSON.stringify(toHistoricalImportWireBody(kind, rows)),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تنفيذ الاستيراد."));
      return res.json<HistoricalImportResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data-migration", "status"] }),
  });
}

/* -------------------------------------------------------------------- */
/* w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox    */
/* (docs/catalog/09 §سير العمل), off the real /workflow API.             */
/* -------------------------------------------------------------------- */

/** إعدادات الموافقات — the persisted approval-chain config per action type. */
export function useWorkflowConfigs(): UseQueryResult<WorkflowConfigDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<WorkflowConfigDTO[], ApiError>({
    queryKey: ["workflow-configs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/workflow/configs");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل إعدادات سير العمل.");
      return res.json<WorkflowConfigDTO[]>();
    },
  });
}

export function useCreateWorkflowConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDTO, ApiError, CreateWorkflowConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/workflow/configs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ سير العمل."));
      return res.json<WorkflowConfigDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-configs"] }),
  });
}

export function useUpdateWorkflowConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDTO, ApiError, { id: string; body: UpdateWorkflowConfigDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/workflow/configs/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حفظ سير العمل."));
      return res.json<WorkflowConfigDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-configs"] }),
  });
}

export function useDeleteWorkflowConfig() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/workflow/configs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر حذف سير العمل."));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-configs"] }),
  });
}

/**
 * الموافقات inbox — pending approvals whose CURRENT step's role the signed-in
 * user holds (server-side filter off `x-role-code`; a tenant admin sees
 * every pending request). Polled every 30s so the shell's pending-count
 * badge and the inbox list itself stay live without a manual refresh.
 */
export function usePendingApprovals(): UseQueryResult<ApprovalRequestDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: ["workflow-requests", "pending"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/workflow/requests/pending");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل الموافقات المعلّقة.");
      return res.json<ApprovalRequestDTO[]>();
    },
  });
}

/** The shell's global pending-count badge on the الموافقات nav item. */
export function usePendingApprovalCount(): UseQueryResult<number, ApiError> {
  const { request, session } = useApi();
  return useQuery<number, ApiError>({
    queryKey: ["workflow-requests", "pending-count"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/workflow/requests/pending-count");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل عدد الموافقات المعلّقة.");
      const body = await res.json<{ count: number }>();
      return body.count;
    },
  });
}

/** Submits a new approval request for a gateable action type (POST /workflow/requests). */
export function useSubmitApproval() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, SubmitApprovalRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/workflow/requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر إرسال طلب الموافقة."));
      return res.json<ApprovalRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-requests"] });
    },
  });
}

/** موافقة / رفض / طلب تعديل — the inbox's three per-row actions (POST /workflow/requests/:id/decide). */
export function useDecideApproval() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, { id: string; body: DecideApprovalRequestDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/workflow/requests/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذر تنفيذ القرار."));
      return res.json<ApprovalRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-requests"] });
    },
  });
}


/* -------------------------------------------------------------------- */
/* كتالوجات الأصناف — units + categories (docs/catalog/03)               */
/* -------------------------------------------------------------------- */

/** وحدات القياس — the unit records an item's `baseUnitCode` resolves against. */
export function useItemUnits(): UseQueryResult<ItemUnitDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemUnitDTO[], ApiError>({
    queryKey: ["item-units"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-units");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل وحدات القياس.");
      return res.json<ItemUnitDTO[]>();
    },
  });
}

export function useCreateItemUnit() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, CreateItemUnitDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-units", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة وحدة القياس."));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

export function useUpdateItemUnit() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, { code: string; patch: UpdateItemUnitDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/item-units/${code}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل وحدة القياس."));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

/** تصنيفات الأصناف — the category records an item's `categoryId` resolves against. */
export function useItemCategories(): UseQueryResult<ItemCategoryDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<ItemCategoryDTO[], ApiError>({
    queryKey: ["item-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-categories");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل تصنيفات الأصناف.");
      return res.json<ItemCategoryDTO[]>();
    },
  });
}

export function useCreateItemCategory() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, CreateItemCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر إضافة التصنيف."));
      return res.json<ItemCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-categories"] }),
  });
}

export function useUpdateItemCategory() {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, { id: string; patch: UpdateItemCategoryDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/item-categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, "تعذّر تعديل التصنيف."));
      return res.json<ItemCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-categories"] }),
  });
}
