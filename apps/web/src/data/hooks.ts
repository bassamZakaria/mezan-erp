import { useSyncExternalStore } from "react";
import { loadTenantCode, subscribeTenantCode } from "./session";
import { DocumentReadPermission, sessionMayRead } from "./document-read-permissions";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  AuditEventDTO,
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
  BankStatementListItemDTO,
  BankStatementStatusDTO,
  BootstrapAdminRequestDTO,
  BootstrapSeedResultDTO,
  CreateItemCategoryDTO,
  CreateItemUnitDTO,
  ItemCategoryDTO,
  ItemBrandDTO,
  ItemSeasonDTO,
  ItemUnitDTO,
  UpdateItemCategoryDTO,
  UpdateItemUnitDTO,
  BounceChequeDTO,
  BranchDTO,
  EntitlementsDTO,
  ChequeDirectionDTO,
  ChequeDTO,
  ChequeStatusDTO,
  CloseFiscalYearDTO,
  CloseFiscalYearResultDTO,
  CollectChequeDTO,
  CollectionFollowUpDTO,
  CompleteFollowUpDTO,
  ConfigInputDTO,
  ConfirmSalesInvoiceDTO,
  ConfirmVoucherDTO,
  ConvertLeadDTO,
  ConvertRfqDTO,
  ConvertSalesQuoteToInvoiceDTO,
  CostCenterDTO,
  CostCategoryDTO,
  ImportableDepartmentDTO,
  CreateCostCentersFromDepartmentsDTO,
  PartyCurrencyBalanceReportDTO,
  CostCenterPnLReportDTO,
  ProjectPnLReportDTO,
  CreateAccountDTO,
  CreateActivityDTO,
  CreateAllocationDTO,
  CreateAssetCategoryDTO,
  CreateAssetDTO,
  SalesInvoicePaymentDTO,
  DisposeAssetDTO,
  SetInternalHourlyRateDTO,
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
  UpdateGlJournalEntryDTO,
  CreateGoodsReceiptDTO,
  CreateInstallmentPlanDTO,
  CreateItemDTO,
  CreateLandedCostDTO,
  CreateLeadDTO,
  CreateOpportunityDTO,
  CreatePipelineStageDTO,
  CreatePriceListDTO,
  UpdatePriceListDTO,
  UpdatePromotionDTO,
  ResolvePriceListPriceDTO,
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
  BuildSalesReturnFromInvoiceDTO,
  RefundSalesReturnDTO,
  CreateStockAdjustmentDTO,
  CreateStockTransferDTO,
  CreateSupplierDTO,
  CreateTaxRateDTO,
  CreateTreasuryAccountDTO,
  CreateUserDTO,
  CreateVoucherDTO,
  CreateCollectionDTO,
  CollectionResultDTO,
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
  EtaRejectionsReportDTO,
  BulkRequeueSubmitResultDTO,
  ExchangeRateDTO,
  ExcludeEtaSubmissionDTO,
  EtaActivityCodeDTO,
  EtaUnitCodeDTO,
  EtaTestConnectionResultDTO,
  EtaBranchCodeRowDTO,
  UpdateEtaBranchCodeDTO,
  EtaItemMappingRowDTO,
  UpdateEtaItemMappingDTO,
  EtaUnitMappingRowDTO,
  UpdateEtaUnitMappingDTO,
  ApplyEtaUnitSuggestionsResultDTO,
  EtaTaxSubTypeRowDTO,
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
  JournalSourceModuleDTO,
  LandedCostDocumentDTO,
  LeadDTO,
  LoginRequestDTO,
  MatchCandidateDTO,
  MatchSummaryDTO,
  MaterialFormulaDTO,
  MoveOpportunityStageDTO,
  NotificationDTO,
  NotificationRuleDTO,
  NotificationTriggerCatalogDTO,
  CreateNotificationRuleDTO,
  UpdateNotificationRuleDTO,
  OpenInvoiceDTO,
  OpenVanTripDTO,
  VanDTO,
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
  WorkOrderLineActionDTO,
  WorkStationDTO,
  CreateWorkStationDTO,
  IssueMaterialsDTO,
  LogWasteDTO,
  LogCostDTO,
  ReconciliationReportDTO,
  RecordPhysicalCountEntriesDTO,
  RecordVanCashMovementDTO,
  ReplaceChequeDTO,
  ReverseGlJournalEntryDTO,
  ReverseVoucherDTO,
  RfqQuoteDTO,
  RoleDTO,
  SalesInvoiceDiscountDTO,
  SalesInvoiceDTO,
  SalesInvoiceLineRowDTO,
  SalesInvoiceTotalsDTO,
  AppliedSalesInvoicePromotionDTO,
  PromotionUsageRowDTO,
  SalesInvoiceListQueryDTO,
  SalesInvoiceStatsDTO,
  PurchaseInvoiceListQueryDTO,
  PurchaseInvoiceStatsDTO,
  PurchaseInvoiceFulfilmentDTO,
  PurchaseInvoicePaymentDTO,
  ListCountsDTO,
  ListStatsDTO,
  AccountRoutingDTO,
  TaxGroupDTO,
  UpsertTaxGroupDTO,
  UpdateAccountRoutingDTO,
  SalesReturnDocumentDTO,
  ReturnSourceLinesDTO,
  ClassifyLineTaxDTO,
  NameJournalLineTaxDTO,
  EditSalesInvoiceDraftLineDTO,
  VoidSalesInvoiceDTO,
  LineTaxClassificationDTO,
  EtaReceiptRetryDTO,
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
  UserPreferencesDTO,
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
  TestEmailResultDTO,
  AllowedCurrenciesDTO,
  UpdateTreasuryAccountDTO,
  UpdateUserDTO,
  EraseUserDTO,
  UserErasureResultDTO,
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
  AttendanceEntryDTO,
  AttendanceSummaryDTO,
  RecordAttendanceDTO,
  CorrectAttendanceDTO,
  AttendanceImportRequestDTO,
  AttendanceImportPreviewDTO,
  AttendanceImportCommitResultDTO,
  LeavePolicyDTO,
  CreateLeavePolicyDTO,
  UpdateLeavePolicyDTO,
  LeavePolicyPresetDTO,
  LeaveBalanceDTO,
  UpsertLeaveBalanceDTO,
  LeaveAccrualBatchDTO,
  RunLeaveAccrualDTO,
  HrDashboardSummaryDTO,
  WritedownRunDTO,
  YearEndClosePreviewDTO,
  LanStatusDTO,
  LanSessionsListDTO,
  CreateRecurringJournalTemplateDTO,
  UpdateRecurringJournalTemplateDTO,
  SetRecurringJournalTemplateStatusDTO,
  GenerateDueRecurringJournalsDTO,
  SaveJournalEntryAsTemplateDTO,
  GeneratedRecurringJournalDTO,
  RecurringJournalFrequencyDTO,
  RecurringJournalTemplateStatusDTO,
  SkipRecurringJournalOccurrenceDTO,
} from "@mezan/contracts";
import { ScreenRequest, ShellRequest, type DisplaySettingKey } from "@mezan/domain";
import { TenantResolveMode, type PlatformResolveDTO } from "@mezan/contracts";
import { UserStatusCode } from "@mezan/domain";
import { useApi } from "./ApiContext";
import { sessionMayAsk, sessionMayAskScreen } from "./session";
import type { TransportResponse } from "./transport";
import { useAppTranslation } from "../i18n";

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
  readonly taxRateId?: string | null;
}

export type SalesQuoteDiscountRecord =
  | { readonly type: "percent"; readonly percent: number }
  | { readonly type: "amount"; readonly amount: string };

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
  readonly customerTaxExempt: boolean;
  readonly notes: string | null;
  readonly internalNotes: string | null;
  readonly discount: SalesQuoteDiscountRecord;
  readonly priceListId: string | null;
  readonly couponCode: string | null;
  readonly createdAt: string;
  readonly sentAt: string | null;
  readonly respondedAt: string | null;
  readonly convertedAt: string | null;
  readonly convertedInvoiceId: string | null;
  /** N-9 — the row version the detail read serves; sent back as `expectedVersion` on the next act. */
  readonly version?: number;
  readonly lines: readonly SalesQuoteLineRecord[];
  readonly totals: {
    readonly grossTotal: string;
    readonly lineDiscountTotal: string;
    readonly invoiceDiscountTotal: string;
    readonly subtotal: string;
    readonly taxableTotal: string;
    readonly taxTotal: string;
    readonly grandTotal: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /**
     * Per-field messages from a 400, keyed by the param they belong to, so a
     * form can render each one against its own input. `_root` holds anything
     * the server did not attribute to a field.
     */
    readonly fieldErrors?: Record<string, string>,
    /**
     * Seconds until a 429'd caller may retry.
     *
     * Carried because the login screen has to DISABLE the form for that long,
     * not merely print a sentence: the button stayed enabled under a lockout
     * message, so the natural response to "try again later" was to try again
     * now, and every attempt during a lock re-reads as another failure to the
     * person typing.
     */
    readonly retryAfterSeconds?: number,
    /** The server's machine-readable error code (e.g. `TENANT_NOT_FOUND`), when it sent one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Real login (docs/archive/plan.md desktop username+PIN). On success the resolved
 * session is stored in the ApiContext, so every subsequent query/mutation
 * sends the permission-gate headers it establishes.
 */
export function useLogin() {
  const { t } = useAppTranslation();
  const { request, setSession } = useApi();
  return useMutation<SessionDTO, ApiError, LoginRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        type LoginError = { error?: string; message?: string; retryAfterSeconds?: number; unlockByCode?: boolean };
        const err = await res.json<LoginError>().catch((): LoginError => ({}));
        const message =
          err.error === "TENANT_REQUIRED"
            ? t("login.tenantRequired")
            : err.error === "TENANT_NOT_FOUND"
              ? t("login.tenantNotFound")
              : (err.message ?? t("api.signInFailed"));
        if (err.error === SignInRefusalCode.AccountLocked) throw new AccountLockedError(res.status, message, err.unlockByCode === true);
        throw new ApiError(res.status, message, undefined, err.retryAfterSeconds ?? res.retryAfterSeconds ?? undefined, err.error);
      }
      return res.json<SessionDTO>();
    },
    onSuccess: (session) => setSession(session),
  });
}

export enum SignInRefusalCode {
  AccountLocked = "ACCOUNT_LOCKED",
  TooManyAttempts = "TOO_MANY_ATTEMPTS",
}

export class AccountLockedError extends ApiError {
  constructor(status: number, message: string, readonly unlockByCode: boolean) {
    super(status, message, undefined, undefined, SignInRefusalCode.AccountLocked);
    this.name = "AccountLockedError";
  }
}

export function useUnlockAccount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<void, ApiError, { username: string; code: string }>({
    mutationFn: async (body) => {
      const res = await request("/auth/unlock", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("login.unlock.failed"), t);
    },
  });
}

export function useUnlockAccountByLink() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<void, ApiError, { token: string }>({
    mutationFn: async (body) => {
      const res = await request("/auth/unlock-link", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("login.unlock.failed"), t);
    },
  });
}

/** First-run wizard "seed base data" step — idempotently seeds an empty DB and returns what exists. */
export function useBootstrapSeed() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BootstrapSeedResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/bootstrap/seed", { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw await loaderError(res, t("api.theCoreDataCouldNot"), t);
      return res.json<BootstrapSeedResultDTO>();
    },
    onSuccess: (counts) => queryClient.setQueryData(["bootstrap", "status"], counts),
  });
}

/** Pre-login tenant identity (ungated) — the name the login screen and first-run wizard show. */
export function useTenantInfo(
  code?: string | null,
  options: { enabled?: boolean } = {},
): UseQueryResult<{ name: string }, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useQuery<{ name: string }, ApiError>({
    queryKey: ["tenant", code ?? null],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const res = await request("/tenant");
      if (!res.ok) throw await loaderError(res, t("api.theCompanySDetailsCould"), t);
      return res.json<{ name: string }>();
    },
  });
}

export const PLATFORM_LOOKUP_FIRST_RETRY_MS = 1_000;
export const PLATFORM_LOOKUP_MAX_RETRY_MS = 30_000;
const PLATFORM_LOOKUP_MAX_RETRY_AFTER_MS = 5 * 60_000;
const UNREADABLE_LOOKUP_STATUS = 502;
const TENANT_RESOLVE_MODES: readonly string[] = Object.values(TenantResolveMode);

function retryAfterSecondsOf(res: TransportResponse): number | undefined {
  const seconds = Number(res.header?.("retry-after") ?? "");
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

const PLATFORM_LOOKUP_JITTER = 0.2;
const PERMANENT_LOOKUP_REFUSALS: readonly number[] = [400, 401, 403, 410];

export function platformLookupRetryDelay(failureCount: number, error: unknown, random: () => number = Math.random): number {
  const backoff = PLATFORM_LOOKUP_FIRST_RETRY_MS * 2 ** Math.min(failureCount, 16);
  const spread = 1 + PLATFORM_LOOKUP_JITTER * (2 * random() - 1);
  const jittered = Math.min(PLATFORM_LOOKUP_MAX_RETRY_MS, Math.round(backoff * spread));
  const asked = error instanceof ApiError && error.retryAfterSeconds !== undefined ? error.retryAfterSeconds * 1000 : 0;
  return Math.min(PLATFORM_LOOKUP_MAX_RETRY_AFTER_MS, Math.max(asked, jittered));
}

export function noPlatformInFront(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function platformLookupWorthRetrying(error: unknown): boolean {
  if (noPlatformInFront(error)) return false;
  return !(error instanceof ApiError && PERMANENT_LOOKUP_REFUSALS.includes(error.status));
}

export function usePlatformResolve(options: { enabled?: boolean } = {}): UseQueryResult<PlatformResolveDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useQuery<PlatformResolveDTO, ApiError>({
    queryKey: ["platform", "resolve"],
    enabled: options.enabled ?? true,
    retry: (_failureCount, error) => platformLookupWorthRetrying(error),
    retryDelay: (failureCount, error) => platformLookupRetryDelay(failureCount, error),
    queryFn: async () => {
      const res = await request("/platform/resolve");
      if (!res.ok) {
        const refused = await loaderError(res, t("api.theCompanySDetailsCould"));
        throw new ApiError(res.status, refused.message, undefined, retryAfterSecondsOf(res));
      }
      const body = await res.json<Partial<PlatformResolveDTO> | null>().catch(() => null);
      if (!body || typeof body.exists !== "boolean" || !TENANT_RESOLVE_MODES.includes(String(body.mode))) {
        throw new ApiError(UNREADABLE_LOOKUP_STATUS, t("api.theCompanySDetailsCould"));
      }
      return { mode: body.mode as TenantResolveMode, exists: body.exists };
    },
  });
}

export function platformLookupFailing(resolve: Pick<UseQueryResult<PlatformResolveDTO, ApiError>, "data" | "failureCount" | "failureReason">): boolean {
  return resolve.data === undefined && resolve.failureCount > 0 && !noPlatformInFront(resolve.failureReason);
}

// SECURITY (D-SAAS-06): a tenant-scoped request must never leave before a
// company is known, and a lookup that failed knows nothing. While it fails the
// only company there can be is one the person typed and confirmed.
export function useCompanyKnown(): boolean {
  const { session } = useApi();
  const alreadyKnown = session !== null || isDesktopHost();
  const resolve = usePlatformResolve({ enabled: !alreadyKnown });
  const storedCode = useSyncExternalStore(subscribeTenantCode, loadTenantCode, () => null);
  const companyTyped = storedCode !== null && storedCode !== "";
  if (alreadyKnown) return true;
  if (resolve.isError) return noPlatformInFront(resolve.error);
  if (platformLookupFailing(resolve)) return companyTyped;
  if (!resolve.data) return false;
  if (resolve.data.mode === TenantResolveMode.Subdomain) return resolve.data.exists;
  return companyTyped;
}

/** What base data already exists — drives the wizard's seed checklist without triggering a seed. */
export function useBootstrapStatus(options: { enabled?: boolean } = {}): UseQueryResult<BootstrapSeedResultDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const companyKnown = useCompanyKnown();
  return useQuery<BootstrapSeedResultDTO, ApiError>({
    queryKey: ["bootstrap", "status"],
    enabled: companyKnown && (options.enabled ?? true),
    queryFn: async () => {
      const res = await request("/bootstrap/status");
      if (!res.ok) throw await loaderError(res, t("api.theCoreDataStatusCould"), t);
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  const companyKnown = useCompanyKnown();
  return useQuery<EntitlementsDTO, ApiError>({
    queryKey: ["entitlements"],
    enabled: companyKnown,
    queryFn: async () => {
      const res = await request("/entitlements");
      if (!res.ok) throw await loaderError(res, t("api.licenceDetailsCouldNotBe"), t);
      return res.json<EntitlementsDTO>();
    },
  });
}

// INVARIANT: waits for the licence's first answer — a list asked for while the
// entitlements are still loading is refused on a tenant without its module. A
// licence that cannot be read leaves the permission alone to decide.
export function useMayAskScreen(request: ScreenRequest): boolean {
  const { session } = useApi();
  const entitlements = useEntitlements();
  if (entitlements.isLoading && entitlements.failureCount === 0) return false;
  return sessionMayAskScreen(session, entitlements.data ?? null, request);
}

/** First-run wizard "create admin" step — persists the admin, then establishes their session. */
export function useCreateFirstAdmin() {
  const { t } = useAppTranslation();
  const { request, setSession } = useApi();
  return useMutation<SessionDTO, ApiError, BootstrapAdminRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/bootstrap/admin", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? t("api.theAdministratorAccountCouldNot"));
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
  const { t } = useAppTranslation();
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
      if (!res.ok) throw await loaderError(res, t("api.dashboardDataCouldNotBe"), t);
      return res.json<DashboardSummaryDTO>();
    },
  });
}

/**
 * The failure text a screen shows: the SERVER's own Arabic reason when it sent
 * one, otherwise the screen's fallback sentence with the HTTP status appended
 * as a support code so a phone call has something to quote.
 *
 * Reads the body ONCE — `TransportResponse.json()` is `Response.json()` on the
 * HTTP transport, so a second call on the same response rejects. A caller that
 * already consumed the body (the two report hooks, via
 * `readReportFieldErrors`) must not call this.
 */
export async function readError(
  res: { readonly status: number; json<T>(): Promise<T> },
  fallback: string,
  t?: AppTranslate,
): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  if (body.message !== undefined && body.message !== "") return body.message;
  return withSupportCode(fallback, res.status, t);
}

export async function codedError(
  res: { readonly status: number; json<T>(): Promise<T> },
  fallback: string,
  t?: AppTranslate,
): Promise<ApiError> {
  const body = (await res.json<{ error?: string; message?: string }>().catch(() => ({}))) as { error?: string; message?: string };
  const message = body.message !== undefined && body.message !== "" ? body.message : withSupportCode(fallback, res.status, t);
  return new ApiError(res.status, message, undefined, undefined, body.error);
}

/** `t`, narrowed to what {@link readError} needs, so data files need no i18n types of their own. */
export type AppTranslate = ReturnType<typeof useAppTranslation>["t"];

/**
 * Appends «رمز 502» to a fallback sentence. Support's first question is "what
 * did it say", and «تعذّر تحميل …» is the same sentence for a sleeping host, a
 * permission denial and an expired session.
 */
export function withSupportCode(message: string, status: number, t?: AppTranslate): string {
  if (!t || !Number.isFinite(status) || status <= 0) return message;
  return `${message} ${t("api.supportCode", { code: String(status) })}`;
}

/**
 * The shared error path for every plain GET query below. A 403 whose body
 * carries `error: "MODULE_NOT_LICENSED"` refuses with the server's own
 * Arabic `message` naming the missing module (e.g. «وحدة الموارد البشرية
 * غير مفعّلة في باقتكم») — that must reach the screen, not the generic
 * "تعذّر تحميل…" `fallback` every other failure keeps.
 */
/**
 * The ApiError a loader throws, carrying everything the screen and support both
 * need. Both branches of this merge had grown their own half of this, and each
 * half was load-bearing:
 *
 *   - A 403 `MODULE_NOT_LICENSED` keeps its CODE, not just its text, because the
 *     shell renders an unlicensed module differently from a plain refusal.
 *   - The server's own Arabic reason is preferred over the generic fallback
 *     whatever the status, because the server knows why and the screen does not.
 *   - A fallback picks up «رمز NNN», since support's first question is the code
 *     and the user cannot read one off a sentence that never carried it.
 *
 * Keeping only one half is a silent regression either way: the module refusal
 * loses its code, or every failure loses the server's reason and the support
 * code with it.
 */
export async function loaderError(
  res: { status: number; json<T>(): Promise<T> },
  fallback: string,
  t?: AppTranslate,
): Promise<ApiError> {
  const body = (await res.json<{ error?: string; message?: string }>().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (res.status === 403 && body.error === "MODULE_NOT_LICENSED" && body.message) {
    return new ApiError(res.status, body.message, undefined, undefined, body.error);
  }
  if (body.message !== undefined && body.message !== "") return new ApiError(res.status, body.message);
  return new ApiError(res.status, withSupportCode(fallback, res.status, t));
}

/** الأصناف (docs/archive/catalog/03) — list, create, edit. */
/**
 * Rows per request when a caller needs the WHOLE set, and how many such
 * requests it may make. Both are compiled in — a limit the caller supplies is
 * not a limit.
 */
const WHOLE_SET_PAGE_SIZE = 200;
const WHOLE_SET_MAX_PAGES = 50;

/**
 * Every page of a list route, for the callers that genuinely need the whole
 * set: a picker over the catalogue, a customer statement, a per-branch count.
 *
 * The list routes now answer with ONE page by default (Q-8), so a caller that
 * meant "everything" and sent no page would silently receive the first
 * twenty-five rows — and a truncated figure on a screen is indistinguishable
 * from a wrong one. This walks the pages instead, and stops at a compiled-in
 * ceiling rather than pulling an unbounded set into the renderer.
 */
async function fetchEveryPage<T>(
  request: (path: string, init?: RequestInit) => Promise<TransportResponse>,
  path: string,
  params: URLSearchParams,
  fail: (res: TransportResponse) => Promise<never>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= WHOLE_SET_MAX_PAGES; page += 1) {
    const qs = new URLSearchParams(params);
    qs.set("page", String(page));
    qs.set("pageSize", String(WHOLE_SET_PAGE_SIZE));
    const res = await request(`${path}?${qs.toString()}`);
    if (!res.ok) await fail(res);
    const rows = await res.json<T[]>();
    all.push(...rows);
    if (rows.length < WHOLE_SET_PAGE_SIZE) break;
  }
  return all;
}

export interface ItemListFilter {
  /** A chip key: `all`, `active`, `inactive`, `low_stock`, `out_of_stock`, or an item type. */
  readonly status?: string;
  readonly categoryId?: string;
  readonly brandId?: string;
  readonly seasonId?: string;
  readonly unitCode?: string;
  readonly search?: string;
  /** One page of the catalogue, 1-based. Only the ROWS query sends it (Q-9). */
  readonly page?: number;
  readonly pageSize?: number;
  /** The total order the page is cut from — the server applies it, not the browser. */
  readonly sort?: "code" | "nameAr" | "salePrice" | "costPrice";
  readonly sortDir?: "asc" | "desc";
}

function itemParams(filter: ItemListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.categoryId && filter.categoryId !== "all") params.set("categoryId", filter.categoryId);
  if (filter.brandId) params.set("brandId", filter.brandId);
  if (filter.seasonId) params.set("seasonId", filter.seasonId);
  if (filter.unitCode && filter.unitCode !== "all") params.set("unitCode", filter.unitCode);
  if (filter.search) params.set("search", filter.search);
  if (filter.page) params.set("page", String(filter.page));
  if (filter.pageSize) params.set("pageSize", String(filter.pageSize));
  if (filter.sort) params.set("sort", filter.sort);
  if (filter.sortDir) params.set("sortDir", filter.sortDir);
  return params;
}

export function useItems(filter: ItemListFilter = {}): UseQueryResult<ItemDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemDTO[], ApiError>({
    queryKey: ["items", filter],
    enabled: sessionMayRead(session, DocumentReadPermission.Items),
    queryFn: async () => {
      const fail = async (res: TransportResponse): Promise<never> => {
        throw await loaderError(res, t("api.itemsCouldNotBeLoaded"), t);
      };
      // A caller that named no page means the whole catalogue — every picker
      // and every name lookup on the app does — so the pages are walked
      // rather than silently cut to the route's default (Q-8).
      if (filter.page === undefined) return fetchEveryPage<ItemDTO>(request, "/items", itemParams(filter), fail);
      const qs = itemParams(filter).toString();
      const res = await request(`/items${qs ? `?${qs}` : ""}`);
      if (!res.ok) await fail(res);
      return res.json<ItemDTO[]>();
    },
  });
}

/** One item by id or code, for a form addressed by URL whose item is not on the current page. */
export function useItem(key: string | null): UseQueryResult<ItemDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemDTO, ApiError>({
    queryKey: ["items", "one", key],
    enabled: session !== null && key !== null,
    queryFn: async () => {
      const res = await request(`/items/${encodeURIComponent(key!)}`);
      if (!res.ok) throw await loaderError(res, t("api.itemsCouldNotBeLoaded"), t);
      return res.json<ItemDTO>();
    },
  });
}

/**
 * Chip counts (R1.1). Two axes share one `status` parameter here — active/
 * inactive, the stock states and the item types — so the route answers with a
 * `type:<code>` key for the type axis; the caller reads that prefix.
 */
export function useItemCounts(filter: ItemListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // Every chip counts the WHOLE filtered set, so neither the active status nor
  // the page may travel (Q-9).
  const { status: _status, page: _page, pageSize: _pageSize, sort: _sort, sortDir: _sortDir, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["items", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = itemParams(rest).toString();
      const res = await request(`/items/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.itemsCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useItemStats(filter: ItemListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // The KPI strip totals the WHOLE filtered set, so the page must not travel.
  const { page: _page, pageSize: _pageSize, sort: _sort, sortDir: _sortDir, ...rest } = filter;
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["items", "stats", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = itemParams(rest).toString();
      const res = await request(`/items/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.itemsCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateItem() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemDTO, ApiError, CreateItemDTO>({
    mutationFn: async (body) => {
      const res = await request("/items", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theItemCouldNotBe"), t));
      return res.json<ItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useUpdateItem() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemDTO, ApiError, { id: string; patch: UpdateItemDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/items/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theItemCouldNotBe2"), t));
      return res.json<ItemDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["items"] }),
  });
}

/** العملاء (docs/archive/catalog/01) — list, create, edit; also used for pickers on other real-data screens (e.g. quotes). */
export interface CustomerListFilter {
  /** `all` / `active` / `inactive` — the list's own chip axis. */
  readonly status?: string;
  readonly q?: string;
  readonly priceListId?: string;
  readonly overLimit?: boolean;
}

/**
 * The one place the customer list's filters become a query string, so the
 * rows, the chip counts and the KPI strip cannot be narrowed differently.
 */
export function customerParams(filter: CustomerListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.q) params.set("q", filter.q);
  if (filter.priceListId) params.set("priceListId", filter.priceListId);
  if (filter.overLimit) params.set("overLimit", "true");
  return params;
}

export function useCustomers(filter: CustomerListFilter = {}): UseQueryResult<CustomerDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CustomerDTO[], ApiError>({
    queryKey: ["customers", filter],
    enabled: sessionMayRead(session, DocumentReadPermission.Customers),
    queryFn: async () => {
      const qs = customerParams(filter).toString();
      const res = await request(`/customers${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.customersCouldNotBeLoaded"), t);
      return res.json<CustomerDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useCustomerCounts(filter: CustomerListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["customers", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = customerParams(rest).toString();
      const res = await request(`/customers/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.customersCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useCustomerStats(filter: CustomerListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["customers", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = customerParams(filter).toString();
      const res = await request(`/customers/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.customersCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateCustomer() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustomerDTO, ApiError, CreateCustomerDTO>({
    mutationFn: async (body) => {
      const res = await request("/customers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCustomerCouldNotBe"), t));
      return res.json<CustomerDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

export function useUpdateCustomer() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CustomerDTO, ApiError, { id: string; patch: UpdateCustomerDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCustomerCouldNotBe2"), t));
      return res.json<CustomerDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  });
}

/** الموردون (docs/archive/catalog/02) — list, create, edit. */
export interface SupplierListFilter {
  readonly status?: string;
  readonly q?: string;
}

function supplierParams(filter: SupplierListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.q) params.set("q", filter.q);
  return params;
}

export function useSuppliers(filter: SupplierListFilter = {}): UseQueryResult<SupplierDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SupplierDTO[], ApiError>({
    queryKey: ["suppliers", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = supplierParams(filter).toString();
      const res = await request(`/suppliers${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.suppliersCouldNotBeLoaded"), t);
      return res.json<SupplierDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useSupplierCounts(filter: SupplierListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["suppliers", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = supplierParams(rest).toString();
      const res = await request(`/suppliers/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.suppliersCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useSupplierStats(filter: SupplierListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["suppliers", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = supplierParams(filter).toString();
      const res = await request(`/suppliers/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.suppliersCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateSupplier() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SupplierDTO, ApiError, CreateSupplierDTO>({
    mutationFn: async (body) => {
      const res = await request("/suppliers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theSupplierCouldNotBe"), t));
      return res.json<SupplierDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

export function useUpdateSupplier() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SupplierDTO, ApiError, { id: string; patch: UpdateSupplierDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theSupplierCouldNotBe2"), t));
      return res.json<SupplierDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });
}

/** دليل الحسابات (docs/archive/catalog/04) — list, create, edit. */
export function useAccounts(): UseQueryResult<AccountDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useMayAskScreen(ScreenRequest.Accounts);
  return useQuery<AccountDTO[], ApiError>({
    queryKey: ["accounts"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/accounts");
      if (!res.ok) throw await loaderError(res, t("api.theChartOfAccountsCould"), t);
      return res.json<AccountDTO[]>();
    },
  });
}

export function useCreateAccount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountDTO, ApiError, CreateAccountDTO>({
    mutationFn: async (body) => {
      const res = await request("/accounts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccountCouldNotBe"), t));
      return res.json<AccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountDTO, ApiError, { id: string; patch: UpdateAccountDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccountCouldNotBe2"), t));
      return res.json<AccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

/** حسابات الخزينة (docs/archive/catalog/04) — list, create, edit. */
export function useTreasuryAccounts(): UseQueryResult<TreasuryAccountDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useMayAskScreen(ScreenRequest.TreasuryAccounts);
  return useQuery<TreasuryAccountDTO[], ApiError>({
    queryKey: ["treasury-accounts"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/treasury-accounts");
      if (!res.ok) throw await loaderError(res, t("api.treasuryAccountsCouldNotBe"), t);
      return res.json<TreasuryAccountDTO[]>();
    },
  });
}

export function useCreateTreasuryAccount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TreasuryAccountDTO, ApiError, CreateTreasuryAccountDTO>({
    mutationFn: async (body) => {
      const res = await request("/treasury-accounts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccountCouldNotBe"), t));
      return res.json<TreasuryAccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] }),
  });
}

export function useUpdateTreasuryAccount() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TreasuryAccountDTO, ApiError, { id: string; patch: UpdateTreasuryAccountDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/treasury-accounts/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccountCouldNotBe2"), t));
      return res.json<TreasuryAccountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] }),
  });
}

/** قوائم الأسعار (docs/archive/catalog/01) — real list off `/price-lists`. */
export function usePriceLists(): UseQueryResult<PriceListDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PriceListDTO[], ApiError>({
    queryKey: ["price-lists"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/price-lists");
      if (!res.ok) throw await loaderError(res, t("api.priceListsCouldNotBe"), t);
      return res.json<PriceListDTO[]>();
    },
  });
}

export function useCreatePriceList() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PriceListDTO, ApiError, CreatePriceListDTO>({
    mutationFn: async (body) => {
      const res = await request("/price-lists", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? t("api.thePriceListCouldNot"));
      }
      return res.json<PriceListDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-lists"] }),
  });
}

/** العروض / promotions (docs/archive/catalog/01) — real list off `/promotions`. */
export function usePromotions(): UseQueryResult<PromotionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PromotionDTO[], ApiError>({
    queryKey: ["promotions"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/promotions");
      if (!res.ok) throw await loaderError(res, t("api.promotionsCouldNotBeLoaded"), t);
      return res.json<PromotionDTO[]>();
    },
  });
}

/** تقرير استخدام العروض (docs/archive/catalog/01) — real usage off confirmed invoices, `/promotions/report`. */
export function usePromotionUsageReport(): UseQueryResult<PromotionUsageRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PromotionUsageRowDTO[], ApiError>({
    queryKey: ["promotions", "report"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/promotions/report");
      if (!res.ok) throw await loaderError(res, t("api.thePromotionUsageReportCould"), t);
      return res.json<PromotionUsageRowDTO[]>();
    },
  });
}

export function useCreatePromotion() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PromotionDTO, ApiError, CreatePromotionDTO>({
    mutationFn: async (body) => {
      const res = await request("/promotions", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? t("api.thePromotionCouldNotBe"));
      }
      return res.json<PromotionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

export interface SalesQuoteListFilter {
  /** A stored status, or one of the derived axis keys `all` / `expired`. */
  readonly status?: string;
  readonly customerId?: string;
  readonly branchId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
}

/**
 * The one place the quote list's filters become a query string. The rows, the
 * chip counts and the KPI strip all go through it, so a filter can never reach
 * one of the three and not the others.
 */
function salesQuoteParams(filter: SalesQuoteListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.customerId) params.set("customerId", filter.customerId);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** عروض الأسعار / sales quotes (docs/archive/catalog/01) — real list off `/sales-quotes`. */
export function useSalesQuotes(filter: SalesQuoteListFilter = {}): UseQueryResult<SalesQuoteRecord[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SalesQuoteRecord[], ApiError>({
    queryKey: ["sales-quotes", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesQuoteParams(filter).toString();
      const res = await request(`/sales-quotes${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.quotesCouldNotBeLoaded"), t);
      return res.json<SalesQuoteRecord[]>();
    },
  });
}

/**
 * The status-chip counts (R1.1). The status filter is intentionally NOT sent:
 * every chip has to state its own total, not the active one's.
 */
export function useSalesQuoteCounts(filter: SalesQuoteListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["sales-quotes", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesQuoteParams(rest).toString();
      const res = await request(`/sales-quotes/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.quotesCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useSalesQuoteStats(filter: SalesQuoteListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["sales-quotes", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesQuoteParams(filter).toString();
      const res = await request(`/sales-quotes/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.quotesCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateSalesQuote() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesQuoteRecord, ApiError, CreateSalesQuoteDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-quotes", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? t("api.theQuoteCouldNotBe"));
      }
      return res.json<SalesQuoteRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
  });
}

/** N-9 — an act on a document carries the version the screen was served. */
export type DocumentAct = string | { readonly id: string; readonly expectedVersion?: number };

function actOf(input: DocumentAct): { id: string; body: string } {
  if (typeof input === "string") return { id: input, body: JSON.stringify({}) };
  return {
    id: input.id,
    body: JSON.stringify(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  };
}

function useSalesQuoteTransition(action: "send" | "accept" | "reject" | "cancel") {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesQuoteRecord, ApiError, DocumentAct>({
    mutationFn: async (input) => {
      const { id, body } = actOf(input);
      const res = await request(`/sales-quotes/${id}/${action}`, { method: "POST", body });
      if (!res.ok) {
        const err = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
        throw new ApiError(res.status, err.message ?? t("api.thatActionCouldNotBe"));
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
/** إلغاء العرض (→ ملغي) — the route existed with no caller until the quotes screen was rebuilt. */
export function useCancelSalesQuote() {
  return useSalesQuoteTransition("cancel");
}

/** "إنشاء من عرض سعر" — converts an accepted quote into a draft sales invoice. */
export function useConvertSalesQuoteToInvoice() {
  const { t } = useAppTranslation();
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
        throw new ApiError(res.status, err.message ?? t("api.theQuoteCouldNotBe2"));
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
  readonly reversibleFromJournal?: boolean;
  /** The document this entry came from, and the module derived from it (R6.3). */
  readonly sourceDocType: string | null;
  readonly sourceDocId: string | null;
  readonly sourceDocNumber: string | null;
  readonly sourceModule: JournalSourceModuleDTO;
  readonly lines: ReadonlyArray<{
    accountId: string;
    debit: string;
    credit: string;
    memo: string | null;
    costCenterId?: string | null;
    projectId?: string | null;
    costCategory?: CostCategoryDTO | null;
    branchId?: string | null;
    partyId?: string | null;
    taxRatePercent?: number | null;
    taxRateId?: string | null;
  }>;
}

/** An account whose hand-written lines must name a customer or a supplier (D205). */
export interface PartyControlAccountDTO {
  readonly accountId: string;
  readonly partyKind: "customer" | "supplier";
}

export function usePartyControlAccounts(): UseQueryResult<PartyControlAccountDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PartyControlAccountDTO[], ApiError>({
    queryKey: ["gl", "party-control-accounts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/gl/party-control-accounts");
      if (!res.ok) throw await loaderError(res, t("journals.partyControlsCouldNotLoad"), t);
      return res.json<PartyControlAccountDTO[]>();
    },
  });
}

export interface JournalEntryListFilter {
  /** A stored status, or the chip key `all` — the route drops `all` rather than matching it. */
  readonly status?: JournalEntryStatusDTO | "all";
  readonly source?: JournalEntrySourceDTO;
  readonly sourceModule?: JournalSourceModuleDTO;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
  /** One page of the register, 1-based. Only the ROWS query sends it (Q-9). */
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * The one place the register's filters become a query string, so the rows, the
 * chip counts and the debit/credit totals cannot be narrowed differently.
 */
function journalEntryParams(filter: JournalEntryListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.source) params.set("source", filter.source);
  if (filter.sourceModule) params.set("sourceModule", filter.sourceModule);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.search) params.set("search", filter.search);
  if (filter.page) params.set("page", String(filter.page));
  if (filter.pageSize) params.set("pageSize", String(filter.pageSize));
  return params;
}

/** القيود المحاسبية (docs/archive/catalog/04) — the GL posting engine mounted under /gl. */
export function useJournalEntries(filter: JournalEntryListFilter = {}): UseQueryResult<JournalEntryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO[], ApiError>({
    queryKey: ["journal-entries", filter],
    enabled: session !== null,
    queryFn: async () => {
      const fail = async (res: TransportResponse): Promise<never> => {
        throw await loaderError(res, t("api.journalEntriesCouldNotBe"), t);
      };
      // A caller that named no page means the whole filtered set — a statement,
      // a per-branch count, a picker — so the pages are walked rather than
      // silently cut to the route's default (Q-8).
      if (filter.page === undefined) return fetchEveryPage<JournalEntryDTO>(request, "/gl/journal-entries", journalEntryParams(filter), fail);
      const qs = journalEntryParams(filter).toString();
      const res = await request(`/gl/journal-entries${qs ? `?${qs}` : ""}`);
      if (!res.ok) await fail(res);
      return res.json<JournalEntryDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useJournalEntryCounts(filter: JournalEntryListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // Every chip counts the WHOLE filtered set, so neither the active status nor
  // the page may travel (Q-9).
  const { status: _status, page: _page, pageSize: _pageSize, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["journal-entries", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = journalEntryParams(rest).toString();
      const res = await request(`/gl/journal-entries/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.journalEntriesCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useJournalEntryStats(filter: JournalEntryListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // The KPI strip totals the WHOLE filtered set, so the page must not travel.
  const { page: _page, pageSize: _pageSize, ...rest } = filter;
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["journal-entries", "stats", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = journalEntryParams(rest).toString();
      const res = await request(`/gl/journal-entries/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.journalEntriesCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

/** Creates and posts a balanced journal entry in one step (POST /gl/journal-entries). */
export function useCreateJournalEntry() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JournalEntryDTO, ApiError, CreateGlJournalEntryDTO>({
    mutationFn: async (body) => {
      const res = await request("/gl/journal-entries", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theEntryCouldNotBe"), t);
      return res.json<JournalEntryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/** تعديل مسودة قيد قائمة (PUT /gl/journal-entries/:id, D226) — refused 409 on anything not a draft. */
export function useUpdateJournalEntry() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JournalEntryDTO, ApiError, { id: string } & UpdateGlJournalEntryDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/gl/journal-entries/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEntryCouldNotBeUpdated"), t));
      return res.json<JournalEntryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/** حذف مسودة قيد قائمة (DELETE /gl/journal-entries/:id, D226) — refused 409 on anything not a draft. */
export function useDeleteJournalEntry() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await request(`/gl/journal-entries/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEntryCouldNotBeDeleted"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/** يعكس قيداً مرحّلاً (POST /gl/journal-entries/:id/reverse). */
export function useReverseJournalEntry() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: JournalEntryDTO; reversal: JournalEntryDTO }, ApiError, { id: string; body?: ReverseGlJournalEntryDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/gl/journal-entries/${id}/reverse`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEntryCouldNotBe2"), t));
      return res.json<{ original: JournalEntryDTO; reversal: JournalEntryDTO }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-entries"] }),
  });
}

/* -------------------------------------------------------------------- */
/* Recurring & template journal automation (ENH-E2-02, /gl/recurring)   */
/* -------------------------------------------------------------------- */

export interface RecurringJournalTemplateLineDTO {
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string | null;
  readonly costCenterId: string | null;
  readonly branchId: string | null;
  readonly partyId: string | null;
  readonly projectId?: string | null;
  readonly costCategory?: CostCategoryDTO | null;
}

export interface RecurringJournalTemplateDTO {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly memo: string;
  readonly frequency: RecurringJournalFrequencyDTO;
  readonly dayOfPeriod: number;
  readonly yearlyMonth: number | null;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly autoReverseNextPeriod: boolean;
  readonly status: RecurringJournalTemplateStatusDTO;
  readonly lines: readonly RecurringJournalTemplateLineDTO[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export enum RecurringJournalRunEntryStatusDTO {
  Draft = "draft",
  Posted = "posted",
  Reversed = "reversed",
}

export interface RecurringJournalRunDTO {
  readonly id: string;
  readonly templateId: string;
  readonly period: string;
  readonly generation?: number;
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  readonly reversalJournalEntryId: string | null;
  readonly reversalJournalEntryNo: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string;
  readonly entryStatus?: RecurringJournalRunEntryStatusDTO | null;
  readonly current?: boolean;
  readonly reversedByEntryId?: string | null;
  readonly reversedByEntryNo?: string | null;
  readonly reversedOn?: string | null;
}

export interface DueRecurringJournalDTO {
  readonly templateId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly periods: readonly string[];
}

export interface RecurringJournalSkipDTO {
  readonly id: string;
  readonly templateId: string;
  readonly period: string;
  readonly note: string | null;
  readonly skippedAt: string;
  readonly skippedBy: string;
}

export function useRecurringJournalTemplates(): UseQueryResult<RecurringJournalTemplateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecurringJournalTemplateDTO[], ApiError>({
    queryKey: ["recurring-journal-templates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/gl/recurring/templates");
      if (!res.ok) throw await loaderError(res, t("recurringJournals.templatesCouldNotLoad"), t);
      return res.json<RecurringJournalTemplateDTO[]>();
    },
  });
}

export function useRecurringJournalTemplateRuns(templateId: string | null): UseQueryResult<RecurringJournalRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecurringJournalRunDTO[], ApiError>({
    queryKey: ["recurring-journal-templates", templateId, "runs"],
    enabled: session !== null && templateId !== null,
    queryFn: async () => {
      const res = await request(`/gl/recurring/templates/${templateId}/runs`);
      if (!res.ok) throw await loaderError(res, t("recurringJournals.historyCouldNotLoad"), t);
      return res.json<RecurringJournalRunDTO[]>();
    },
  });
}

export function useRecurringJournalRuns(limit = 200): UseQueryResult<RecurringJournalRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecurringJournalRunDTO[], ApiError>({
    queryKey: ["recurring-journal-runs", limit],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/gl/recurring/runs?limit=${limit}`);
      if (!res.ok) throw await loaderError(res, t("recurringJournals.historyCouldNotLoad"), t);
      return res.json<RecurringJournalRunDTO[]>();
    },
  });
}

export function useDueRecurringJournals(): UseQueryResult<{ asOfDate: string; due: DueRecurringJournalDTO[] }, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<{ asOfDate: string; due: DueRecurringJournalDTO[] }, ApiError>({
    queryKey: ["recurring-journal-due"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/gl/recurring/due");
      if (!res.ok) throw await loaderError(res, t("recurringJournals.dueCouldNotLoad"), t);
      return res.json<{ asOfDate: string; due: DueRecurringJournalDTO[] }>();
    },
  });
}

export function useDueDepreciationPeriods(): UseQueryResult<{ periods: string[] }, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<{ periods: string[] }, ApiError>({
    queryKey: ["recurring-journal-depreciation-due"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/gl/recurring/depreciation-due");
      if (!res.ok) throw await loaderError(res, t("recurringJournals.dueCouldNotLoad"), t);
      return res.json<{ periods: string[] }>();
    },
  });
}

export function useRecurringJournalSkips(templateId: string | null): UseQueryResult<RecurringJournalSkipDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecurringJournalSkipDTO[], ApiError>({
    queryKey: ["recurring-journal-templates", templateId, "skips"],
    enabled: session !== null && templateId !== null,
    queryFn: async () => {
      const res = await request(`/gl/recurring/templates/${templateId}/skips`);
      if (!res.ok) throw await loaderError(res, t("recurringJournals.historyCouldNotLoad"), t);
      return res.json<RecurringJournalSkipDTO[]>();
    },
  });
}

export function useAllRecurringJournalSkips(limit = 200): UseQueryResult<RecurringJournalSkipDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RecurringJournalSkipDTO[], ApiError>({
    queryKey: ["recurring-journal-skips", limit],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/gl/recurring/skips?limit=${limit}`);
      if (!res.ok) throw await loaderError(res, t("recurringJournals.historyCouldNotLoad"), t);
      return res.json<RecurringJournalSkipDTO[]>();
    },
  });
}

export function useSkipRecurringJournalOccurrence() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RecurringJournalSkipDTO, ApiError, { templateId: string } & SkipRecurringJournalOccurrenceDTO>({
    mutationFn: async ({ templateId, ...body }) => {
      const res = await request(`/gl/recurring/templates/${templateId}/skip`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.skipFailed"), t));
      return res.json<RecurringJournalSkipDTO>();
    },
    onSuccess: (_data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-due"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-skips"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates", templateId, "skips"] });
    },
  });
}

export function useCreateRecurringJournalTemplate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RecurringJournalTemplateDTO, ApiError, CreateRecurringJournalTemplateDTO>({
    mutationFn: async (body) => {
      const res = await request("/gl/recurring/templates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.templateCouldNotBeSaved"), t));
      return res.json<RecurringJournalTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates"] }),
  });
}

export function useUpdateRecurringJournalTemplate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RecurringJournalTemplateDTO, ApiError, { id: string } & UpdateRecurringJournalTemplateDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/gl/recurring/templates/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.templateCouldNotBeSaved"), t));
      return res.json<RecurringJournalTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates"] }),
  });
}

export function useSetRecurringJournalTemplateStatus() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RecurringJournalTemplateDTO, ApiError, { id: string } & SetRecurringJournalTemplateStatusDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/gl/recurring/templates/${id}/status`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.templateCouldNotBeSaved"), t));
      return res.json<RecurringJournalTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates"] }),
  });
}

/** "Save as template" on JournalsScreen — the lines come off the entry itself; only the schedule is asked for. */
export function useSaveJournalEntryAsRecurringTemplate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RecurringJournalTemplateDTO, ApiError, { entryId: string } & SaveJournalEntryAsTemplateDTO>({
    mutationFn: async ({ entryId, ...body }) => {
      const res = await request(`/gl/recurring/templates/from-entry/${entryId}`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.templateCouldNotBeSaved"), t));
      return res.json<RecurringJournalTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates"] }),
  });
}

export interface FailedRecurringJournalGenerationDTO {
  readonly templateId: string;
  readonly templateNameAr: string;
  readonly period: string;
  readonly message: string;
}

export function useGenerateDueRecurringJournals() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    { asOfDate: string; generated: GeneratedRecurringJournalDTO[]; failed: FailedRecurringJournalGenerationDTO[] },
    ApiError,
    GenerateDueRecurringJournalsDTO
  >({
    mutationFn: async (body) => {
      const res = await request("/gl/recurring/generate-due", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("recurringJournals.generateFailed"), t));
      return res.json<{ asOfDate: string; generated: GeneratedRecurringJournalDTO[]; failed: FailedRecurringJournalGenerationDTO[] }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-due"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-runs"] });
      queryClient.invalidateQueries({ queryKey: ["recurring-journal-templates"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
    },
  });
}

/** المستخدمون (docs/archive/catalog/09) — list, create, edit, activate/deactivate. */
export function useUsers(): UseQueryResult<UserDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<UserDTO[], ApiError>({
    queryKey: ["users"],
    enabled: sessionMayAsk(session, ShellRequest.Users),
    queryFn: async () => {
      const res = await request("/users");
      if (!res.ok) throw await loaderError(res, t("api.usersCouldNotBeLoaded"), t);
      return res.json<UserDTO[]>();
    },
  });
}

export function useCreateUser() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, CreateUserDTO>({
    mutationFn: async (body) => {
      const res = await request("/users", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theUserCouldNotBe"), t));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, { id: string; body: UpdateUserDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/users/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theUserCouldNotBe"), t));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useSetUserStatus() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserDTO, ApiError, { id: string; status: UserStatusCode; newOwnerUserId?: string }>({
    mutationFn: async ({ id, status, newOwnerUserId }) => {
      const res = await request(`/users/${id}/${status === UserStatusCode.Active ? "activate" : "deactivate"}`, {
        method: "POST",
        ...(newOwnerUserId ? { body: JSON.stringify({ newOwnerUserId }) } : {}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theUserSStatusCould"), t));
      return res.json<UserDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

/** الأدوار (docs/archive/catalog/09) — list, create, edit, delete. */
export function useRoles(): UseQueryResult<RoleDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RoleDTO[], ApiError>({
    queryKey: ["roles"],
    enabled: sessionMayAsk(session, ShellRequest.Roles),
    queryFn: async () => {
      const res = await request("/roles");
      if (!res.ok) throw await loaderError(res, t("api.rolesCouldNotBeLoaded"), t);
      return res.json<RoleDTO[]>();
    },
  });
}

export function useCreateRole() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleDTO, ApiError, CreateRoleDTO>({
    mutationFn: async (body) => {
      const res = await request("/roles", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRoleCouldNotBe"), t));
      return res.json<RoleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useUpdateRole() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RoleDTO, ApiError, { id: string; body: UpdateRoleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/roles/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRoleCouldNotBe"), t));
      return res.json<RoleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

export function useDeleteRole() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/roles/${id}`, { method: "DELETE" });
      // 204 No Content on success — the body is empty, never parse it as JSON.
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRoleCouldNotBe2"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });
}

/* -------------------------------------------------------------------- */
/* الإعدادات — عام (Tenant Settings) (docs/archive/catalog/09)                    */
/* -------------------------------------------------------------------- */

/** إعدادات المنشأة (docs/archive/catalog/09 §"الإعدادات — عام") — the single tenant config bag. */
/**
 * This user's own preferences — the dashboard layout among them (§8.5).
 *
 * Returns null rather than throwing when the server has no preferences route
 * mounted: the dashboard falls back to the default arrangement, which is
 * exactly what a user who has never customised it should see anyway.
 */
export function useUserPreferences(): UseQueryResult<UserPreferencesDTO | null, ApiError> {
  const { request, session } = useApi();
  return useQuery<UserPreferencesDTO | null, ApiError>({
    queryKey: ["preferences", session?.userId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/preferences");
      if (!res.ok) return null;
      return res.json<UserPreferencesDTO>();
    },
  });
}

export function useSettings(): UseQueryResult<TenantSettingsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<TenantSettingsDTO, ApiError>({
    queryKey: ["settings"],
    enabled: sessionMayAsk(session, ShellRequest.Settings),
    queryFn: async () => {
      const res = await request("/settings");
      if (!res.ok) throw await loaderError(res, t("api.settingsCouldNotBeLoaded"), t);
      return res.json<TenantSettingsDTO>();
    },
  });
}

export type DisplaySettingsDTO = Pick<TenantSettingsDTO, `${DisplaySettingKey}`>;

export function useDisplaySettings(): UseQueryResult<DisplaySettingsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<DisplaySettingsDTO, ApiError>({
    queryKey: ["settings", "display"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/settings/display");
      if (!res.ok) throw await loaderError(res, t("api.settingsCouldNotBeLoaded"), t);
      return res.json<DisplaySettingsDTO>();
    },
  });
}

export function useUpdateSettings() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TenantSettingsDTO, ApiError, UpdateTenantSettingsDTO>({
    mutationFn: async (body) => {
      const res = await request("/settings", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.settingsCouldNotBeSaved"), t));
      return res.json<TenantSettingsDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
}

/* -------------------------------------------------------------------- */
/* الفروع (docs/archive/catalog/09)                                              */
/* -------------------------------------------------------------------- */

/** الفروع (docs/archive/catalog/09 §"إدارة الفروع") — list, used by the branch typeahead on real-data forms. */
export function useBranches(): UseQueryResult<BranchDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BranchDTO[], ApiError>({
    queryKey: ["branches"],
    enabled: sessionMayAsk(session, ShellRequest.Branches),
    queryFn: async () => {
      const res = await request("/branches");
      if (!res.ok) throw await loaderError(res, t("api.branchesCouldNotBeLoaded"), t);
      return res.json<BranchDTO[]>();
    },
  });
}

export function useCreateBranch() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BranchDTO, ApiError, CreateBranchDTO>({
    mutationFn: async (body) => {
      const res = await request("/branches", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theBranchCouldNotBe"), t));
      return res.json<BranchDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }),
  });
}

export function useUpdateBranch() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BranchDTO, ApiError, { id: string; patch: UpdateBranchDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/branches/${id}`, { method: "PUT", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theBranchCouldNotBe2"), t));
      return res.json<BranchDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branches"] }),
  });
}

/* -------------------------------------------------------------------- */
/* سجل الشيكات — Cheque Register (docs/archive/catalog/04)                       */
/* -------------------------------------------------------------------- */

export interface ChequeListFilters {
  readonly direction?: ChequeDirectionDTO;
  /** The DERIVED 7-state status the register's filter tabs expose. */
  readonly status?: ChequeStatusDTO;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
}

/**
 * The one place the register's filters become a query string, so the rows, the
 * chip counts and the KPI strip cannot be narrowed differently.
 */
function chequeParams(filters: ChequeListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.status) params.set("status", filters.status);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.search) params.set("search", filters.search);
  return params;
}

/**
 * The register list. Filters are part of the `queryKey` and go to the server —
 * the 7-state status (including the date-derived تحت التحصيل/المستحقة اليوم) is
 * resolved server-side against its own "as of" date, never recomputed here.
 */
export function useCheques(filters: ChequeListFilters = {}): UseQueryResult<ChequeDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ChequeDTO[], ApiError>({
    queryKey: ["cheques", filters],
    enabled: session !== null,
    queryFn: async () => {
      const qs = chequeParams(filters).toString();
      const res = await request(`/cheques${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.chequesCouldNotBeLoaded"), t);
      return res.json<ChequeDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useChequeCounts(filter: ChequeListFilters = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["cheques", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = chequeParams(rest).toString();
      const res = await request(`/cheques/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.chequesCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useChequeStats(filter: ChequeListFilters = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["cheques", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = chequeParams(filter).toString();
      const res = await request(`/cheques/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.chequesCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateCheque() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ChequeDTO, ApiError, CreateChequeDTO>({
    mutationFn: async (body) => {
      const res = await request("/cheques", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theChequeCouldNotBe"), t);
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
  const { t } = useAppTranslation();
  return useChequeAction<DepositChequeDTO>("deposit", t("api.theChequeCouldNotBe2"));
}
/** تأكيد البنك للتحصيل (مودع → محصل). */
export function useCollectCheque() {
  const { t } = useAppTranslation();
  return useChequeAction<CollectChequeDTO>("collect", t("api.theChequeCouldNotBe3"));
}
/** ارتداد الشيك (مودع → مرتد). */
export function useBounceCheque() {
  const { t } = useAppTranslation();
  return useChequeAction<BounceChequeDTO>("bounce", t("api.theBouncedChequeCouldNot"));
}

/** استبدال شيك مرتد بشيك جديد بنفس القيمة (مرتد → مستبدل + شيك جديد قيد الانتظار). */
export function useReplaceCheque() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: ChequeDTO; replacement: ChequeDTO }, ApiError, { id: string; body: ReplaceChequeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/cheques/${id}/replace`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theChequeCouldNotBe4"), t));
      return res.json<{ original: ChequeDTO; replacement: ChequeDTO }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cheques"] }),
  });
}

/* -------------------------------------------------------------------- */
/* تسوية كشوف البنك — Bank Statement Reconciliation (docs/archive/catalog/04)     */
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

export function useBankStatements(filters: BankStatementListFilters = {}): UseQueryResult<BankStatementListItemDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankStatementListItemDTO[], ApiError>({
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
      if (!res.ok) throw await loaderError(res, t("api.bankStatementsCouldNotBe"), t);
      return res.json<BankStatementListItemDTO[]>();
    },
  });
}

export function useBankStatement(id: string | null): UseQueryResult<BankStatementDetailDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankStatementDetailDTO, ApiError>({
    queryKey: ["bank-statements", "detail", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/bank-statements/${id}`);
      if (!res.ok) throw await loaderError(res, t("api.theBankStatementCouldNot"), t);
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
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StatementColumnMappingDTO | null, ApiError>({
    queryKey: ["bank-statements", "column-mapping", treasuryAccountId],
    enabled: session !== null && treasuryAccountId !== null && treasuryAccountId !== "",
    queryFn: async () => {
      const res = await request(`/bank-statements/column-mapping/${treasuryAccountId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await loaderError(res, t("api.theColumnMappingCouldNot"), t);
      return res.json<StatementColumnMappingDTO>();
    },
  });
}

/**
 * The treasury movements a statement's lines can be matched to. Manual match
 * picks from these — it never asks the user to type a journal-entry id.
 */
export function useStatementMatchCandidates(statementId: string | null): UseQueryResult<MatchCandidateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<MatchCandidateDTO[], ApiError>({
    queryKey: ["bank-statements", "candidates", statementId],
    enabled: session !== null && statementId !== null,
    queryFn: async () => {
      const res = await request(`/bank-statements/${statementId}/candidates`);
      if (!res.ok) throw await loaderError(res, t("api.theMatchableEntriesCouldNot"), t);
      return res.json<MatchCandidateDTO[]>();
    },
  });
}

/** استيراد كشف بنك — persists the column mapping for the account, then the statement + its parsed lines. */
export function useImportBankStatement() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BankStatementDetailDTO, ApiError, ImportBankStatementDTO>({
    mutationFn: async (body) => {
      const res = await request("/bank-statements/import", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theBankStatementCouldNot2"), t));
      return res.json<BankStatementDetailDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

/** مطابقة تلقائية — applies every exact amount + date-tolerance suggestion against the treasury ledger. */
export function useAutoMatchStatement() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ matchedCount: number }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/bank-statements/${id}/auto-match`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.automaticMatchingFailed"), t));
      return res.json<{ matchedCount: number }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

export function useMatchStatementLine() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StatementLineDTO, ApiError, { statementId: string; lineId: string; entryId: string }>({
    mutationFn: async ({ statementId, lineId, entryId }) => {
      const res = await request(`/bank-statements/${statementId}/lines/${lineId}/match`, {
        method: "POST",
        body: JSON.stringify({ entryId }),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLineCouldNotBe"), t));
      return res.json<StatementLineDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

export function useUnmatchStatementLine() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StatementLineDTO, ApiError, { statementId: string; lineId: string }>({
    mutationFn: async ({ statementId, lineId }) => {
      const res = await request(`/bank-statements/${statementId}/lines/${lineId}/unmatch`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLineCouldNotBe2"), t));
      return res.json<StatementLineDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bank-statements"] }),
  });
}

/** إنهاء التسوية — locks the statement (منتهية); no further matching is possible. */
export function useFinalizeBankStatement() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BankStatementDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/bank-statements/${id}/finalize`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theReconciliationCouldNotBe"), t));
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
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO, ApiError>({
    queryKey: ["journal-entries", "detail", id],
    enabled: sessionMayRead(session, DocumentReadPermission.JournalEntries) && id !== null,
    queryFn: async () => {
      const res = await request(`/gl/journal-entries/${id}`);
      if (!res.ok) throw await loaderError(res, t("api.theJournalEntryCouldNot"), t);
      return res.json<JournalEntryDTO>();
    },
  });
}

/** المستودعات (docs/archive/catalog/09 §"إدارة المستودعات") — list, create, edit; also a picker dependency for other real-data screens (e.g. sales invoices). */
export function useWarehouses(): UseQueryResult<WarehouseDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WarehouseDTO[], ApiError>({
    queryKey: ["warehouses"],
    enabled: sessionMayAsk(session, ShellRequest.Warehouses),
    queryFn: async () => {
      const res = await request("/warehouses");
      if (!res.ok) throw await loaderError(res, t("api.warehousesCouldNotBeLoaded"), t);
      return res.json<WarehouseDTO[]>();
    },
  });
}

export function useCreateWarehouse() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WarehouseDTO, ApiError, CreateWarehouseDTO>({
    mutationFn: async (body) => {
      const res = await request("/warehouses", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWarehouseCouldNotBe"), t));
      return res.json<WarehouseDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
  });
}

export function useUpdateWarehouse() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WarehouseDTO, ApiError, { id: string; patch: UpdateWarehouseDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/warehouses/${id}`, { method: "PUT", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWarehouseCouldNotBe2"), t));
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

/** السندات النقدية (docs/archive/catalog/04) — list, create, confirm, reverse, allocate. */
/** The one place the voucher list's filters become a query string (R8.2). */
function voucherParams(filter: Partial<VoucherListQueryDTO>): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.type) params.set("type", filter.type);
  if (filter.status) params.set("status", filter.status);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.search) params.set("search", filter.search);
  if (filter.needsAllocation) params.set("needsAllocation", filter.needsAllocation);
  return params;
}

/**
 * Chip counts, computed server-side. The WHOLE filter goes to the route: the
 * list has two chip axes (status and type) and only the route knows which one
 * to drop for which count. Withholding both here made the status chips report
 * the whole book while a type was selected.
 */
export function useVoucherCounts(filter: Partial<VoucherListQueryDTO> = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["vouchers", "counts", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = voucherParams(filter).toString();
      const res = await request(`/vouchers/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.vouchersCouldNotBeLoaded"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useVoucherStats(filter: Partial<VoucherListQueryDTO> = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["vouchers", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = voucherParams(filter).toString();
      const res = await request(`/vouchers/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.vouchersCouldNotBeLoaded"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useVouchers(filter: Partial<VoucherListQueryDTO> = {}): UseQueryResult<VoucherRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useMayAskScreen(ScreenRequest.Vouchers);
  return useQuery<VoucherRowDTO[], ApiError>({
    queryKey: ["vouchers", filter],
    enabled: mayAsk,
    queryFn: async () => {
      const fail = async (res: TransportResponse): Promise<never> => {
        throw await loaderError(res, t("api.vouchersCouldNotBeLoaded"), t);
      };
      // A caller that named no page means the whole filtered set — a statement,
      // a per-branch count, a picker — so the pages are walked rather than
      // silently cut to the route's default (Q-8).
      if (filter.page === undefined) return fetchEveryPage<VoucherRowDTO>(request, "/vouchers", voucherParams(filter), fail);
      const qs = voucherParams(filter).toString();
      const res = await request(`/vouchers${qs ? `?${qs}` : ""}`);
      if (!res.ok) await fail(res);
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
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<VoucherDetailDTO, ApiError>({
    queryKey: ["vouchers", "detail", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/vouchers/${id}`);
      if (!res.ok) throw await loaderError(res, t("api.theVoucherCouldNotBe"), t);
      return res.json<VoucherDetailDTO>();
    },
  });
}

function invalidateVouchers(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["vouchers"] });
}

export function useCreateVoucher() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherDTO, ApiError, CreateVoucherDTO>({
    mutationFn: async (body) => {
      const res = await request("/vouchers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theVoucherCouldNotBe2"), t);
      return res.json<VoucherDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useCreateCollection() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionResultDTO, ApiError, CreateCollectionDTO>({
    mutationFn: async (body) => {
      const res = await request("/vouchers/collections", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theVoucherCouldNotBe2"), t);
      return res.json<CollectionResultDTO>();
    },
    onSuccess: () => {
      invalidateVouchers(queryClient);
      queryClient.invalidateQueries({ queryKey: ["open-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] });
    },
  });
}

export function useConfirmVoucher() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherDTO & { held: boolean }, ApiError, { id: string; body?: ConfirmVoucherDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/vouchers/${id}/confirm`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theVoucherCouldNotBe3"), t));
      return res.json<VoucherDTO & { held: boolean }>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

/** إلغاء السند — voids a DRAFT voucher (a confirmed one is reversed, not cancelled). */
export function useCancelVoucher() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/vouchers/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theVoucherCouldNotBe3"), t));
      return res.json<VoucherDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useReverseVoucher() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: VoucherDTO; reversal: VoucherDTO }, ApiError, { id: string; body?: ReverseVoucherDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/vouchers/${id}/reverse`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theVoucherCouldNotBe4"), t));
      return res.json<{ original: VoucherDTO; reversal: VoucherDTO }>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useCreateAllocation() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherAllocationDTO, ApiError, { voucherId: string; body: CreateAllocationDTO }>({
    mutationFn: async ({ voucherId, body }) => {
      const res = await request(`/vouchers/${voucherId}/allocations`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theAmountCouldNotBe"), t);
      return res.json<VoucherAllocationDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useReverseAllocation() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VoucherAllocationDTO, ApiError, string>({
    mutationFn: async (allocationId) => {
      const res = await request(`/allocations/${allocationId}/reverse`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAllocationCouldNotBe"), t));
      return res.json<VoucherAllocationDTO>();
    },
    onSuccess: () => invalidateVouchers(queryClient),
  });
}

export function useOpenInvoices(kind?: "sales" | "purchase", partyId?: string | null): UseQueryResult<OpenInvoiceDTO[], ApiError> {
  const { t } = useAppTranslation();
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
      if (!res.ok) throw await loaderError(res, t("api.openInvoicesCouldNotBe"), t);
      return res.json<OpenInvoiceDTO[]>();
    },
  });
}

export interface PurchaseOrderListFilter {
  /** A stored status, or the chip key `all`. */
  readonly status?: string;
  readonly supplierId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly branchId?: string;
  readonly warehouseId?: string;
  readonly search?: string;
}

/**
 * The one place the order list's filters become a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function purchaseOrderParams(filter: PurchaseOrderListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** أوامر الشراء (docs/archive/catalog/02) — list, create, confirm (draft → sent). */
export function usePurchaseOrders(filter: PurchaseOrderListFilter = {}): UseQueryResult<PurchaseOrderDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseOrderDTO[], ApiError>({
    queryKey: ["purchase-orders", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseOrderParams(filter).toString();
      const res = await request(`/purchases/orders${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseOrdersCouldNotBe"), t);
      return res.json<PurchaseOrderDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function usePurchaseOrderCounts(filter: PurchaseOrderListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["purchase-orders", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseOrderParams(rest).toString();
      const res = await request(`/purchases/orders/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseOrdersCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function usePurchaseOrderStats(filter: PurchaseOrderListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["purchase-orders", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseOrderParams(filter).toString();
      const res = await request(`/purchases/orders/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseOrdersCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreatePurchaseOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseOrderDTO, ApiError, CreatePurchaseOrderDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/orders", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePurchaseOrderCouldNot"), t));
      return res.json<PurchaseOrderDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export function useConfirmPurchaseOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseOrderDTO, ApiError, DocumentAct>({
    mutationFn: async (input) => {
      const { id, body } = actOf(input);
      const res = await request(`/purchases/orders/${id}/confirm`, { method: "POST", body });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePurchaseOrderCouldNot2"), t));
      return res.json<PurchaseOrderDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }),
  });
}

export interface GoodsReceiptListFilter {
  /** A stored status, or the chip key `all`. */
  readonly status?: string;
  readonly supplierId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly warehouseId?: string;
  /** The second chip axis — مفوتر / غير مفوتر. */
  readonly invoiced?: boolean;
  readonly search?: string;
}

/**
 * The one place the receipt list's filters become a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function goodsReceiptParams(filter: GoodsReceiptListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.invoiced !== undefined) params.set("invoiced", filter.invoiced ? "true" : "false");
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** إيصالات الاستلام (docs/archive/catalog/02) — list, create (from a sent/partially-received PO), confirm. */
export function useGoodsReceipts(filter: GoodsReceiptListFilter = {}): UseQueryResult<GoodsReceiptDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GoodsReceiptDTO[], ApiError>({
    queryKey: ["goods-receipts", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = goodsReceiptParams(filter).toString();
      const res = await request(`/purchases/receipts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.goodsReceiptsCouldNotBe"), t);
      return res.json<GoodsReceiptDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useGoodsReceiptCounts(filter: GoodsReceiptListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["goods-receipts", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = goodsReceiptParams(rest).toString();
      const res = await request(`/purchases/receipts/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.goodsReceiptsCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useGoodsReceiptStats(filter: GoodsReceiptListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["goods-receipts", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = goodsReceiptParams(filter).toString();
      const res = await request(`/purchases/receipts/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.goodsReceiptsCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateGoodsReceipt() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GoodsReceiptDTO, ApiError, CreateGoodsReceiptDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/receipts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theGoodsReceiptCouldNot"), t));
      return res.json<GoodsReceiptDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export function useConfirmGoodsReceipt() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GoodsReceiptDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchases/receipts/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theGoodsReceiptCouldNot2"), t));
      return res.json<GoodsReceiptDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

/** فواتير المشتريات (docs/archive/catalog/02) — list, create (manual or from a confirmed receipt), confirm. */
/** The one place the purchase-invoice filters become a query string (R1.1). */
function purchaseInvoiceParams(filter: Partial<PurchaseInvoiceListQueryDTO>): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.search) params.set("search", filter.search);
  return params;
}

export function usePurchaseInvoices(filter: Partial<PurchaseInvoiceListQueryDTO> = {}): UseQueryResult<PurchaseInvoiceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseInvoiceDTO[], ApiError>({
    queryKey: ["purchase-invoices", filter],
    enabled: session !== null,
    queryFn: async () => {
      const fail = async (res: TransportResponse): Promise<never> => {
        throw await loaderError(res, t("api.purchaseInvoicesCouldNotBe"), t);
      };
      // A caller that named no page means the whole filtered set — a statement,
      // a per-branch count, a picker — so the pages are walked rather than
      // silently cut to the route's default (Q-8).
      if (filter.page === undefined) return fetchEveryPage<PurchaseInvoiceDTO>(request, "/purchases/invoices", purchaseInvoiceParams(filter), fail);
      const qs = purchaseInvoiceParams(filter).toString();
      const res = await request(`/purchases/invoices${qs ? `?${qs}` : ""}`);
      if (!res.ok) await fail(res);
      return res.json<PurchaseInvoiceDTO[]>();
    },
  });
}

/** Chip counts; the status filter is withheld so every chip reports its own total. */
export function usePurchaseInvoiceCounts(filter: Partial<PurchaseInvoiceListQueryDTO> = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["purchase-invoices", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseInvoiceParams(rest).toString();
      const res = await request(`/purchases/invoices/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseInvoicesCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

export function usePurchaseInvoiceStats(filter: Partial<PurchaseInvoiceListQueryDTO> = {}): UseQueryResult<PurchaseInvoiceStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseInvoiceStatsDTO, ApiError>({
    queryKey: ["purchase-invoices", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseInvoiceParams(filter).toString();
      const res = await request(`/purchases/invoices/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseInvoicesCouldNotBe"), t);
      return res.json<PurchaseInvoiceStatsDTO>();
    },
  });
}

export function useCreatePurchaseInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseInvoiceDTO, ApiError, CreatePurchaseInvoiceDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchases/invoices", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.thePurchaseInvoiceCouldNot"), t);
      return res.json<PurchaseInvoiceDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] }),
  });
}

export function useConfirmPurchaseInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseInvoiceDTO, ApiError, DocumentAct>({
    mutationFn: async (input) => {
      const { id, body } = actOf(input);
      const res = await request(`/purchases/invoices/${id}/confirm`, { method: "POST", body });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePurchaseInvoiceCouldNot2"), t));
      return res.json<PurchaseInvoiceDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
    },
  });
}

export type { SalesInvoiceLineRowDTO, SalesInvoiceTotalsDTO, SalesInvoiceDTO };

/** فواتير المبيعات (docs/archive/catalog/01) — list, create, confirm, record a payment. */
export function useSalesInvoices(filter: Partial<SalesInvoiceListQueryDTO> = {}): UseQueryResult<SalesInvoiceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SalesInvoiceDTO[], ApiError>({
    queryKey: ["sales-invoices", filter],
    enabled: session !== null,
    queryFn: async () => {
      const fail = async (res: TransportResponse): Promise<never> => {
        throw await loaderError(res, t("api.salesInvoicesCouldNotBe"), t);
      };
      // A caller that named no page means the whole filtered set — a statement,
      // a per-branch count, a picker — so the pages are walked rather than
      // silently cut to the route's default (Q-8).
      if (filter.page === undefined) return fetchEveryPage<SalesInvoiceDTO>(request, "/sales-invoices", salesInvoiceParams(filter), fail);
      const qs = salesInvoiceParams(filter).toString();
      const res = await request(`/sales-invoices${qs ? `?${qs}` : ""}`);
      if (!res.ok) await fail(res);
      return res.json<SalesInvoiceDTO[]>();
    },
  });
}

/**
 * The one place the invoice list's filters become a query string. The rows,
 * the chip counts and the KPI strip all go through it, so a filter can never
 * reach one of the three and not the others.
 */
function salesInvoiceParams(filter: Partial<SalesInvoiceListQueryDTO>): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.customerId) params.set("customerId", filter.customerId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.search) params.set("search", filter.search);
  if (filter.sort) params.set("sort", filter.sort);
  if (filter.sortDir) params.set("sortDir", filter.sortDir);
  if (filter.page) params.set("page", String(filter.page));
  if (filter.pageSize) params.set("pageSize", String(filter.pageSize));
  return params;
}

/**
 * One invoice, by id OR by document number — which is what the URL carries.
 * The list is a server-side page now, so a deep link into a document on any
 * page but the first can no longer be resolved from the rows on screen.
 */
export function useSalesInvoice(idOrDocNo: string | null): UseQueryResult<SalesInvoiceDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SalesInvoiceDTO, ApiError>({
    queryKey: ["sales-invoices", "one", idOrDocNo],
    enabled: session !== null && idOrDocNo !== null,
    queryFn: async () => {
      const res = await request(`/sales-invoices/${encodeURIComponent(idOrDocNo ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("api.salesInvoicesCouldNotBe"), t);
      return res.json<SalesInvoiceDTO>();
    },
  });
}

/**
 * The status-chip counts (R1.1). The status filter is intentionally NOT sent:
 * every chip has to state its own total, not the active one's.
 */
export function useSalesInvoiceCounts(filter: Partial<SalesInvoiceListQueryDTO> = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // Every chip counts the WHOLE filtered set, so neither the active status nor
  // the page may travel.
  const { status: _status, page: _page, pageSize: _pageSize, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["sales-invoices", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesInvoiceParams(rest).toString();
      const res = await request(`/sales-invoices/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.salesInvoicesCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useSalesInvoiceStats(filter: Partial<SalesInvoiceListQueryDTO> = {}): UseQueryResult<SalesInvoiceStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  // The KPI strip totals the WHOLE filtered set, so the page must not travel.
  const { page: _page, pageSize: _pageSize, ...rest } = filter;
  return useQuery<SalesInvoiceStatsDTO, ApiError>({
    queryKey: ["sales-invoices", "stats", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesInvoiceParams(rest).toString();
      const res = await request(`/sales-invoices/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.salesInvoicesCouldNotBe"), t);
      return res.json<SalesInvoiceStatsDTO>();
    },
  });
}

function invalidateSalesInvoices(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["sales-invoices"] });
}

export function useCreateSalesInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, CreateSalesInvoiceDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-invoices", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theInvoiceCouldNotBe"), t);
      return res.json<SalesInvoiceDTO>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

/**
 * B3 — a plain id or `{id, expectedVersion}` still works (every existing
 * caller), and `receiptPaymentMethod` lets a back-office confirm (no till in
 * hand) state the tender for the consumer sale's e-receipt. Left out, the
 * backend derives it honestly on its own (till tender, then the settling
 * collection voucher, then «أخرى»).
 */
export type ConfirmSalesInvoiceAct =
  | string
  | ({ readonly id: string; readonly expectedVersion?: number } & Pick<ConfirmSalesInvoiceDTO, "receiptPaymentMethod" | "acknowledgeTaxRecalculation">);

export class SalesTaxRecalculationPendingError extends ApiError {
  constructor(
    status: number,
    message: string,
    readonly recalculatedGrandTotal: string,
  ) {
    super(status, message);
    this.name = "SalesTaxRecalculationPendingError";
  }
}

export function useConfirmSalesInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfirmedSalesInvoiceDTO, ApiError, ConfirmSalesInvoiceAct>({
    mutationFn: async (input) => {
      const id = typeof input === "string" ? input : input.id;
      const dto: ConfirmSalesInvoiceDTO = typeof input === "string" ? {} : {
        ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
        ...(input.receiptPaymentMethod === undefined ? {} : { receiptPaymentMethod: input.receiptPaymentMethod }),
        ...(input.acknowledgeTaxRecalculation === undefined ? {} : { acknowledgeTaxRecalculation: input.acknowledgeTaxRecalculation }),
      };
      const res = await request(`/sales-invoices/${id}/confirm`, { method: "POST", body: JSON.stringify(dto) });
      if (!res.ok) {
        const body = await res.json<{ message?: string; taxRecalculated?: boolean; totals?: { grandTotal?: string } }>().catch(() => null);
        const message = await readError({ status: res.status, json: async <T,>() => (body ?? {}) as T }, t("api.theInvoiceCouldNotBe2"), t);
        const recalculated = res.status === 409 && body?.taxRecalculated === true ? body.totals?.grandTotal : undefined;
        if (recalculated !== undefined) throw new SalesTaxRecalculationPendingError(res.status, message, recalculated);
        throw new ApiError(res.status, message);
      }
      return res.json<ConfirmedSalesInvoiceDTO>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

export function useVoidSalesInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, { id: string } & VoidSalesInvoiceDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/sales-invoices/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theInvoiceCouldNotBe2"), t));
      return res.json<SalesInvoiceDTO>();
    },
    onSuccess: () => {
      invalidateSalesInvoices(queryClient);
      for (const key of ["journal-entries", "gl", "stock-balance", "eta-submissions", "eta", "dashboard", "financial-reports", "audit"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export type ConfirmedSalesInvoiceDTO = SalesInvoiceDTO & { held: boolean; taxRecalculated?: { message: string } };

export enum ClassifiableDocument {
  SalesInvoice = "sales-invoices",
  PurchaseInvoice = "purchases/invoices",
}

export interface ClassifyLineTaxAct {
  readonly documentId: string;
  readonly lineId: string;
  readonly taxRateId: string;
  readonly withLineIds: readonly string[];
}

export function useClassifyLineTax(document: ClassifiableDocument) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LineTaxClassificationDTO, ApiError, ClassifyLineTaxAct>({
    mutationFn: async ({ documentId, lineId, taxRateId, withLineIds }) => {
      const dto: ClassifyLineTaxDTO = { taxRateId, ...(withLineIds.length > 0 ? { withLineIds: [...withLineIds] } : {}) };
      const res = await request(`/${document}/${encodeURIComponent(documentId)}/lines/${encodeURIComponent(lineId)}/classify-tax`, {
        method: "POST",
        body: JSON.stringify(dto),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.lineTaxCouldNotBeClassified"), t));
      return res.json<LineTaxClassificationDTO>();
    },
    onSuccess: () => invalidateAfterTaxClassification(queryClient, document),
  });
}

export function useRetryEtaReceipt() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaReceiptRetryDTO, ApiError, { documentId: string }>({
    mutationFn: async ({ documentId }) => {
      const res = await request(`/${ClassifiableDocument.SalesInvoice}/${encodeURIComponent(documentId)}/eta-receipt/retry`, { method: "POST", body: "{}" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("classifyTax.outcome.reissueFailed"), t));
      return res.json<EtaReceiptRetryDTO>();
    },
    onSuccess: () => invalidateAfterTaxClassification(queryClient, ClassifiableDocument.SalesInvoice),
  });
}

const QUERIES_A_TAX_CLASSIFICATION_MOVES = ["eta-submissions", "eta", "journal-entries", "gl", "audit", "entity-audit", "financial-reports", "vat-filings"];

function invalidateAfterTaxClassification(queryClient: ReturnType<typeof useQueryClient>, document: ClassifiableDocument | ReturnFamily): void {
  const sales = document === ClassifiableDocument.SalesInvoice || document === ReturnFamily.Sales;
  for (const key of [sales ? "sales-invoices" : "purchase-invoices", sales ? "sales-returns" : "purchase-returns", ...QUERIES_A_TAX_CLASSIFICATION_MOVES]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export interface NameJournalLineTaxAct {
  readonly documentId: string;
  readonly lineId: string;
  readonly journalLineIndexes: readonly number[];
  readonly taxRateId?: string;
  readonly withLineIds: readonly string[];
}

export function useNameJournalLineTax(document: ClassifiableDocument | ReturnFamily) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LineTaxClassificationDTO, ApiError, NameJournalLineTaxAct>({
    mutationFn: async ({ documentId, lineId, journalLineIndexes, taxRateId, withLineIds }) => {
      const dto: NameJournalLineTaxDTO = {
        journalLineIndexes: [...journalLineIndexes],
        ...(taxRateId ? { taxRateId } : {}),
        ...(withLineIds.length > 0 ? { withLineIds: [...withLineIds] } : {}),
      };
      const res = await request(`/${document}/${encodeURIComponent(documentId)}/lines/${encodeURIComponent(lineId)}/journal-tax`, {
        method: "POST",
        body: JSON.stringify(dto),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.lineTaxCouldNotBeClassified"), t));
      return res.json<LineTaxClassificationDTO>();
    },
    onSuccess: () => invalidateAfterTaxClassification(queryClient, document),
  });
}

export interface EditSalesInvoiceDraftLineAct extends EditSalesInvoiceDraftLineDTO {
  readonly invoiceId: string;
  readonly lineId: string;
  readonly expectedVersion?: number;
}

export function useEditSalesInvoiceDraftLine() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, EditSalesInvoiceDraftLineAct>({
    mutationFn: async ({ invoiceId, lineId, ...change }) => {
      const res = await request(`/sales-invoices/${encodeURIComponent(invoiceId)}/lines/${encodeURIComponent(lineId)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theInvoiceCouldNotBe"), t));
      return res.json<SalesInvoiceDTO>();
    },
    onSuccess: () => invalidateSalesInvoices(queryClient),
  });
}

export function useRecordSalesInvoicePayment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesInvoiceDTO, ApiError, { id: string } & SalesInvoicePaymentDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/sales-invoices/${id}/payments`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePaymentCouldNotBe"), t));
      return res.json<SalesInvoiceDTO>();
    },
    // A collection is a real voucher now, so the treasury and the ledger both
    // moved: their views are stale too.
    onSuccess: () => {
      invalidateSalesInvoices(queryClient);
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ---------------------------------------------------------------------------
// CRM (docs/archive/catalog/06 "إدارة علاقات العملاء") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useLeads(): UseQueryResult<LeadDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeadDTO[], ApiError>({
    queryKey: ["crm-leads"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/leads");
      if (!res.ok) throw await loaderError(res, t("api.leadsCouldNotBeLoaded"), t);
      return res.json<LeadDTO[]>();
    },
  });
}

export function useCreateLead() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeadDTO, ApiError, CreateLeadDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/leads", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeadCouldNotBe"), t));
      return res.json<LeadDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-leads"] }),
  });
}

export function useTransitionLead() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeadDTO, ApiError, { id: string; body: TransitionLeadDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/leads/${id}/transition`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeadSStatusCould"), t));
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConvertLeadResultDTO, ApiError, { id: string; body: ConvertLeadDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/leads/${id}/convert`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeadCouldNotBe2"), t));
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
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<OpportunityDTO[], ApiError>({
    queryKey: ["crm-opportunities"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/opportunities");
      if (!res.ok) throw await loaderError(res, t("api.opportunitiesCouldNotBeLoaded"), t);
      return res.json<OpportunityDTO[]>();
    },
  });
}

export function useCreateOpportunity() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpportunityDTO, ApiError, CreateOpportunityDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/opportunities", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theOpportunityCouldNotBe"), t));
      return res.json<OpportunityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] }),
  });
}

export function useMoveOpportunityStage() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpportunityDTO, ApiError, { id: string; body: MoveOpportunityStageDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/crm/opportunities/${id}/move-stage`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theOpportunityCouldNotBe2"), t));
      return res.json<OpportunityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-opportunities"] }),
  });
}

export function usePipelineStages(): UseQueryResult<PipelineStageDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PipelineStageDTO[], ApiError>({
    queryKey: ["crm-pipeline-stages"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/pipeline-stages");
      if (!res.ok) throw await loaderError(res, t("api.pipelineStagesCouldNotBe"), t);
      return res.json<PipelineStageDTO[]>();
    },
  });
}

export function useCreatePipelineStage() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PipelineStageDTO, ApiError, CreatePipelineStageDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/pipeline-stages", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theStageCouldNotBe"), t));
      return res.json<PipelineStageDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-pipeline-stages"] }),
  });
}

export function useMovePipelineStage() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PipelineStageDTO, ApiError, { id: string; direction: "up" | "down" }>({
    mutationFn: async ({ id, direction }) => {
      const res = await request(`/crm/pipeline-stages/${id}/move`, { method: "POST", body: JSON.stringify({ direction }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theStageCouldNotBe2"), t));
      return res.json<PipelineStageDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-pipeline-stages"] }),
  });
}

export function useCrmActivities(): UseQueryResult<ActivityDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ActivityDTO[], ApiError>({
    queryKey: ["crm-activities"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/crm/activities");
      if (!res.ok) throw await loaderError(res, t("api.activitiesCouldNotBeLoaded"), t);
      return res.json<ActivityDTO[]>();
    },
  });
}

export function useCreateActivity() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, CreateActivityDTO>({
    mutationFn: async (body) => {
      const res = await request("/crm/activities", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theActivityCouldNotBe"), t));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

export function useCompleteActivity() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/crm/activities/${id}/complete`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theActivityCouldNotBe2"), t));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

export function useCancelActivity() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ActivityDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/crm/activities/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theActivityCouldNotBe3"), t));
      return res.json<ActivityDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm-activities"] }),
  });
}

// ---------------------------------------------------------------------------
// Projects (docs/archive/catalog/07 "المشاريع والمقاولات") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useProjects(): UseQueryResult<ProjectDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProjectDTO[], ApiError>({
    queryKey: ["projects"],
    enabled: sessionMayRead(session, DocumentReadPermission.Projects),
    queryFn: async () => {
      const res = await request("/projects");
      if (!res.ok) throw await loaderError(res, t("api.projectsCouldNotBeLoaded"), t);
      return res.json<ProjectDTO[]>();
    },
  });
}

export function useProjectPnL(): UseQueryResult<ProjectPnLReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProjectPnLReportDTO, ApiError>({
    queryKey: ["projects", "pnl"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/projects/pnl");
      if (!res.ok) throw new ApiError(res.status, t("api.projectPnlCouldNotBeLoaded"));
      return res.json<ProjectPnLReportDTO>();
    },
  });
}

export function useCreateProject() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, CreateProjectDTO>({
    mutationFn: async (body) => {
      const res = await request("/projects", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProjectCouldNotBe"), t));
      return res.json<ProjectDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useUpdateProject() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, { id: string; patch: UpdateProjectDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProjectCouldNotBe2"), t));
      return res.json<ProjectDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

// ---------------------------------------------------------------------------
// Fixed Assets (docs/archive/catalog/07 "الأصول الثابتة") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useAssetCategories(): UseQueryResult<AssetCategoryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AssetCategoryDTO[], ApiError>({
    queryKey: ["asset-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/assets/categories");
      if (!res.ok) throw await loaderError(res, t("api.assetCategoriesCouldNotBe"), t);
      return res.json<AssetCategoryDTO[]>();
    },
  });
}

export function useCreateAssetCategory() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetCategoryDTO, ApiError, CreateAssetCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets/categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCategoryCouldNotBe"), t));
      return res.json<AssetCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-categories"] }),
  });
}

export interface AssetListFilter {
  /** A stored status, or the chip key `all`. */
  readonly status?: string;
  readonly categoryId?: string;
  readonly branchId?: string;
  readonly search?: string;
}

/**
 * The one place the register's filters become a query string, so the rows, the
 * chip counts and the KPI strip cannot be narrowed differently.
 */
function assetParams(filter: AssetListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.categoryId && filter.categoryId !== "all") params.set("categoryId", filter.categoryId);
  if (filter.branchId && filter.branchId !== "all") params.set("branchId", filter.branchId);
  if (filter.search) params.set("search", filter.search);
  return params;
}

export function useAssets(filter: AssetListFilter = {}): UseQueryResult<AssetDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AssetDTO[], ApiError>({
    queryKey: ["assets", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = assetParams(filter).toString();
      const res = await request(`/assets${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.theAssetRegisterCouldNot"), t);
      return res.json<AssetDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useAssetCounts(filter: AssetListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["assets", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = assetParams(rest).toString();
      const res = await request(`/assets/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.theAssetRegisterCouldNot"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useAssetStats(filter: AssetListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["assets", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = assetParams(filter).toString();
      const res = await request(`/assets/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.theAssetRegisterCouldNot"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateAsset() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetDTO, ApiError, CreateAssetDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAssetCouldNotBe"), t));
      return res.json<AssetDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

/**
 * سعر الساعة الداخلي — a separate, permissioned, audited edit. Every سجل تشغيل
 * معدات charges its project at this rate, so it reaches WIP, cost, the
 * percentage of completion and recognised revenue; the site log has no override.
 */
export function useSetInternalHourlyRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetDTO, ApiError, { id: string } & SetInternalHourlyRateDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/assets/${id}/internal-hourly-rate`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAssetCouldNotBe")));
      return res.json<AssetDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export function useDisposeAsset() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AssetDTO, ApiError, { id: string } & DisposeAssetDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/assets/${id}/dispose`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAssetCouldNotBeDisposed"), t));
      return res.json<AssetDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDepreciationRuns(): UseQueryResult<DepreciationRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<DepreciationRunDTO[], ApiError>({
    queryKey: ["depreciation-runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/assets/depreciation/runs");
      if (!res.ok) throw await loaderError(res, t("api.depreciationRunsCouldNotBe"), t);
      return res.json<DepreciationRunDTO[]>();
    },
  });
}

export function useCreateDepreciationRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, CreateDepreciationRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/assets/depreciation/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepreciationRunCouldNot"), t));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] }),
  });
}

export function useDiscardDepreciationRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/assets/depreciation/runs/${id}/discard`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepreciationDraftCouldNotBeDiscarded"), t));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] }),
  });
}

export function usePostDepreciationRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/assets/depreciation/runs/${id}/post`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepreciationRunCouldNot2"), t));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

/** يعكس تشغيل إهلاك مرحّلاً (POST /assets/depreciation/runs/:id/reverse, D275). No date sent defaults to today on the server; the caller may date it later but never before the run's own posting day. */
export function useReverseDepreciationRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepreciationRunDTO, ApiError, { id: string; date?: string }>({
    mutationFn: async ({ id, date }) => {
      const res = await request(`/assets/depreciation/runs/${id}/reverse`, { method: "POST", body: JSON.stringify(date ? { date } : {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepreciationRunCouldNotBeReversed"), t));
      return res.json<DepreciationRunDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["depreciation-runs"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Inventory aging-based write-down batch (docs/archive/phase-backlog.md Phase 4) — inv/labels-templates-writedown
// ---------------------------------------------------------------------------

export function useWritedownRuns(): UseQueryResult<WritedownRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WritedownRunDTO[], ApiError>({
    queryKey: ["writedown-runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/inventory/writedown-runs");
      if (!res.ok) throw await loaderError(res, t("api.inventoryWriteDownRunsCould"), t);
      return res.json<WritedownRunDTO[]>();
    },
  });
}

export function useCreateWritedownRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WritedownRunDTO, ApiError, CreateWritedownRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/writedown-runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWriteDownRunCould"), t));
      return res.json<WritedownRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["writedown-runs"] }),
  });
}

export function usePostWritedownRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WritedownRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/writedown-runs/${id}/post`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWriteDownRunCould2"), t));
      return res.json<WritedownRunDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["writedown-runs"] }),
  });
}

// ---------------------------------------------------------------------------
// Product Templates (docs/archive/catalog/03-inventory.md §"قوالب المنتجات") — inv/labels-templates-writedown
// ---------------------------------------------------------------------------

export function useProductTemplates(): UseQueryResult<ProductTemplateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProductTemplateDTO[], ApiError>({
    queryKey: ["product-templates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/inventory/product-templates");
      if (!res.ok) throw await loaderError(res, t("api.productTemplatesCouldNotBe"), t);
      return res.json<ProductTemplateDTO[]>();
    },
  });
}

export function useCreateProductTemplate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, CreateProductTemplateDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/product-templates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProductTemplateCouldNot"), t));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useTemplateVariants(templateId: string | null): UseQueryResult<ProductTemplateVariantDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ProductTemplateVariantDTO[], ApiError>({
    queryKey: ["product-template-variants", templateId],
    enabled: session !== null && templateId !== null,
    queryFn: async () => {
      const res = await request(`/inventory/product-templates/${templateId}/variants`);
      if (!res.ok) throw await loaderError(res, t("api.variantsCouldNotBeLoaded"), t);
      return res.json<ProductTemplateVariantDTO[]>();
    },
  });
}

export function useAddTemplateAttribute() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; body: AddTemplateAttributeDTO }>({
    mutationFn: async ({ templateId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAttributeCouldNotBe"), t));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useDeleteTemplateAttribute() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string }>({
    mutationFn: async ({ templateId, attributeId }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAttributeCouldNotBe2"), t));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useAddAttributeValue() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string; body: AddAttributeValueDTO }>({
    mutationFn: async ({ templateId, attributeId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}/values`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theValueCouldNotBe"), t));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useDeleteAttributeValue() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProductTemplateDTO, ApiError, { templateId: string; attributeId: string; value: string }>({
    mutationFn: async ({ templateId, attributeId, value }) => {
      const res = await request(`/inventory/product-templates/${templateId}/attributes/${attributeId}/values/${encodeURIComponent(value)}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theValueCouldNotBe2"), t));
      return res.json<ProductTemplateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["product-templates"] }),
  });
}

export function useGenerateVariants() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<GenerateVariantsResultDTO, ApiError, { templateId: string; body: GenerateVariantsDTO }>({
    mutationFn: async ({ templateId, body }) => {
      const res = await request(`/inventory/product-templates/${templateId}/variants/generate`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.variantsCouldNotBeGenerated"), t));
      return res.json<GenerateVariantsResultDTO>();
    },
    onSuccess: (_data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: ["product-template-variants", templateId] });
      queryClient.invalidateQueries({ queryKey: ["product-templates"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Field/Van Sales (docs/archive/catalog/07 "رحلات المندوبين") — phase11/crm-projects-assets-field
// ---------------------------------------------------------------------------

export function useVanTrips(): UseQueryResult<VanTripDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<VanTripDTO[], ApiError>({
    queryKey: ["van-trips"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/field/van-trips");
      if (!res.ok) throw await loaderError(res, t("api.vanTripsCouldNotBe"), t);
      return res.json<VanTripDTO[]>();
    },
  });
}

export function useOpenVanTrip() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, OpenVanTripDTO>({
    mutationFn: async (body) => {
      const res = await request("/field/van-trips", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theTripCouldNotBe"), t));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}

export function useRecordVanCashMovement() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, { id: string; body: RecordVanCashMovementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/field/van-trips/${id}/cash-movements`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCashMovementCouldNot"), t));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}

export function useSettleVanTrip() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VanTripDTO, ApiError, { id: string; body: SettleVanTripDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/field/van-trips/${id}/settle`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theTripCouldNotBe2"), t));
      return res.json<VanTripDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["van-trips"] }),
  });
}

/* -------------------------------------------------------------------- */
/* التصنيع — Manufacturing (docs/archive/catalog/07): BOMs, work orders,          */
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

/** قوائم المواد (docs/archive/catalog/07) — the manufacturing recipe a work order is built from. */
export function useBoms(): UseQueryResult<BomRecord[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BomRecord[], ApiError>({
    queryKey: ["boms"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/boms");
      if (!res.ok) throw await loaderError(res, t("api.billsOfMaterialsCouldNot"), t);
      return res.json<BomRecord[]>();
    },
  });
}

export function useCreateBom() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BomRecord, ApiError, CreateBomDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/boms", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theBillOfMaterialsCould"), t));
      return res.json<BomRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boms"] }),
  });
}

export function useDeactivateBom() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BomRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/boms/${id}/deactivate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theBillOfMaterialsCould2"), t));
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
  /** False on rows written before scrap moved stock (D64) — they are history, not a movement. */
  readonly stockMoved: boolean;
  readonly normalQty: string;
  readonly abnormalQty: string;
  readonly normalCost: string;
  readonly abnormalCost: string;
}

export interface WorkOrderMaterialRecord {
  readonly itemId: string;
  readonly requiredQty: string;
  readonly wastePercent: number;
  readonly optional: boolean;
  readonly issuedQty: string;
  readonly returnedQty: string;
  readonly netQty: string;
  /** What the source warehouse holds, and what is still missing (R9.2). Null when unknown. */
  readonly availableQty: string | null;
  readonly shortageQty: string | null;
  /** What مستودع التشغيل actually holds — the figure a floor count is held against. */
  readonly wipOnHandQty: string | null;
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
  readonly wipWarehouseId: string;
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
  /** بُعد المشروع — the contracting project this work order belongs to. */
  readonly projectId: string | null;
}

export interface WorkOrderListFilter {
  /** A stored status, or the chip key `all`. */
  readonly status?: string;
  readonly priority?: string;
  readonly stage?: string;
  readonly search?: string;
}

/**
 * The one place the work-order list's filters become a query string, so the
 * rows, the chip counts and the KPI strip cannot be narrowed differently.
 */
function workOrderParams(filter: WorkOrderListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.priority) params.set("priority", filter.priority);
  if (filter.stage) params.set("stage", filter.stage);
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** أوامر التصنيع (docs/archive/catalog/07) — a production run against a BOM, tracked through its 4-stage lifecycle. */
export function useWorkOrders(filter: WorkOrderListFilter = {}): UseQueryResult<WorkOrderRecord[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WorkOrderRecord[], ApiError>({
    queryKey: ["work-orders", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = workOrderParams(filter).toString();
      const res = await request(`/manufacturing/work-orders${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.workOrdersCouldNotBe"), t);
      return res.json<WorkOrderRecord[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useWorkOrderCounts(filter: WorkOrderListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["work-orders", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = workOrderParams(rest).toString();
      const res = await request(`/manufacturing/work-orders/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.workOrdersCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useWorkOrderStats(filter: WorkOrderListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["work-orders", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = workOrderParams(filter).toString();
      const res = await request(`/manufacturing/work-orders/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.workOrdersCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

/** A ledger movement a work order produced, with the محطة العمل and المشغّل behind it (R9.1). */
export interface WorkOrderMovementRecord {
  readonly id: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly direction: string;
  readonly qty: string;
  readonly unitCost: string;
  readonly occurredAt: string;
  readonly stationId: string | null;
  readonly stationName: string | null;
  readonly operatorId: string | null;
  readonly operatorName: string | null;
}

export interface WorkOrderActivity {
  readonly movements: readonly WorkOrderMovementRecord[];
  readonly receipts: readonly WorkOrderMovementRecord[];
  readonly shopFloorLog: readonly { kind: string; stationId: string | null; stationName: string | null; operatorId: string | null; at: string }[];
  readonly journalEntries: readonly { id: string; entryNo: string | null; date: string; memo: string | null; status: string; totalDebit: string; totalCredit: string }[];
  readonly auditEvents: readonly { action: string; actor: string; timestamp: string; severity: string }[];
}

export function useWorkOrderActivity(id: string | null): UseQueryResult<WorkOrderActivity, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WorkOrderActivity, ApiError>({
    queryKey: ["work-order-activity", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/manufacturing/work-orders/${id}/activity`);
      if (!res.ok) throw await loaderError(res, t("api.workOrdersCouldNotBe"), t);
      return res.json<WorkOrderActivity>();
    },
  });
}

export function useCreateWorkOrder() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, CreateWorkOrderDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/work-orders", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkOrderCouldNot"), t));
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
    /**
     * The ACTIVITY cache has to fall too, and `complete` is why: it is the call
     * that posts the work order's journal entry, and without this the movement
     * and journal tabs keep serving the pre-completion snapshot — an order
     * reading «مكتمل» beside «لم يُرحَّل أي قيد بعد» while the entry sits
     * posted in the ledger.
     */
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

/**
 * محطات العمل (R9.1) — the shop-floor stations a work order's issues and
 * receipts are recorded at. A real registry, so what a movement names is an id
 * and not a typed-in label.
 */
export function useWorkStations(): UseQueryResult<WorkStationDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WorkStationDTO[], ApiError>({
    queryKey: ["work-stations"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/work-stations");
      if (!res.ok) throw await loaderError(res, t("api.workStationsCouldNotBe"), t);
      return res.json<WorkStationDTO[]>();
    },
  });
}

export function useCreateWorkStation() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkStationDTO, ApiError, CreateWorkStationDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/work-stations", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkStationCouldNot"), t));
      return res.json<WorkStationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-stations"] }),
  });
}

export function useSetWorkStationStatus() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkStationDTO, ApiError, { id: string; status: "active" | "inactive" }>({
    mutationFn: async ({ id, status }) => {
      const action = status === "active" ? "activate" : "deactivate";
      const res = await request(`/manufacturing/work-stations/${id}/${action}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkStationCouldNot"), t));
      return res.json<WorkStationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-stations"] }),
  });
}

/** بدء العمل (not_started → started). */
export function useStartWorkOrder() {
  const { t } = useAppTranslation();
  return useWorkOrderAction("start", t("api.theWorkOrderCouldNot2"));
}
/** إكمال أمر العمل — رسملة الإنتاج تحت التشغيل (product_received → completed). */
export function useCompleteWorkOrder() {
  const { t } = useAppTranslation();
  return useWorkOrderAction("complete", t("api.theWorkOrderCouldNot3"));
}
/** إلغاء أمر التصنيع. */
export function useCancelWorkOrder() {
  const { t } = useAppTranslation();
  return useWorkOrderAction("cancel", t("api.theWorkOrderCouldNot4"));
}

/** صرف المواد الخام حسب قائمة المواد (started → materials_issued). */
export function useIssueWorkOrderMaterials() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body?: IssueMaterialsDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/issue`, { method: "POST", body: JSON.stringify(body ?? {}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theMaterialsCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

/**
 * The shop-floor actions (R9.1). All five routes existed and none had a hook,
 * so a work order could only be started, issued in full, received and closed —
 * a production run that needed one more sack of sugar, or scrapped a batch,
 * had nowhere to record it.
 */
export function useExtraIssueWorkOrderMaterials() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: WorkOrderLineActionDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/extra-issue`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theMaterialsCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

export function useReturnWorkOrderMaterials() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: WorkOrderLineActionDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/return`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theMaterialsCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

export function useLogWorkOrderWaste() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: LogWasteDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/log-waste`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theMaterialsCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

export function useLogWorkOrderCost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: LogCostDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/log-cost`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProductCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
  });
}

/** استلام المنتج التام (materials_issued → product_received). */
export function useReceiveWorkOrderProduct() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkOrderRecord, ApiError, { id: string; body: ReceiveProductDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/manufacturing/work-orders/${id}/receive`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProductCouldNotBe"), t));
      return res.json<WorkOrderRecord>();
    },
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-activity", id] });
    },
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

/** المنتجات القابلة للتهيئة (docs/archive/catalog/07) — formula-driven master data consumed by التصنيع المخصص orders. */
export function useConfigurableProducts(): UseQueryResult<ConfigurableProductRecord[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ConfigurableProductRecord[], ApiError>({
    queryKey: ["configurable-products"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/configurable-products");
      if (!res.ok) throw await loaderError(res, t("api.configurableProductsCouldNotBe"), t);
      return res.json<ConfigurableProductRecord[]>();
    },
  });
}

export function useCreateConfigurableProduct() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigurableProductRecord, ApiError, UpsertConfigurableProductDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/configurable-products", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theConfigurableProductCouldNot"), t));
      return res.json<ConfigurableProductRecord>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["configurable-products"] }),
  });
}

export function useDeactivateConfigurableProduct() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigurableProductRecord, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/manufacturing/configurable-products/${id}/deactivate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theProductCouldNotBe2"), t));
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

/** التصنيع المخصص (docs/archive/catalog/07) — one-off make-to-order production against a configurable product's formulas. */
export function useConfigInstances(): UseQueryResult<ConfigInstanceRecord[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ConfigInstanceRecord[], ApiError>({
    queryKey: ["config-instances"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/manufacturing/config-instances");
      if (!res.ok) throw await loaderError(res, t("api.customOrdersCouldNotBe"), t);
      return res.json<ConfigInstanceRecord[]>();
    },
  });
}

export function useCreateConfigInstance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ConfigInstanceRecord, ApiError, CreateConfigInstanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/config-instances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCustomOrderCouldNot"), t));
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
  const { t } = useAppTranslation();
  return useConfigInstanceAction("close", t("api.theCustomOrderCouldNot2"));
}
/** إلغاء أمر التصنيع المخصص. */
export function useCancelConfigInstance() {
  const { t } = useAppTranslation();
  return useConfigInstanceAction("cancel", t("api.theCustomOrderCouldNot3"));
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<ConfigInstancePreviewResult, ApiError, PreviewConfigInstanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/manufacturing/config-instances/preview", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theOrderCouldNotBe"), t));
      return res.json<ConfigInstancePreviewResult>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* sweep/finish-and-mount — Cost Centers, Fiscal Periods, Taxes          */
/* -------------------------------------------------------------------- */

/** مراكز التكلفة (docs/archive/catalog/04) — list, create, edit. */
export function useCostCenters(): UseQueryResult<CostCenterDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CostCenterDTO[], ApiError>({
    queryKey: ["cost-centers"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/cost-centers");
      if (!res.ok) throw await loaderError(res, t("api.costCentresCouldNotBe"), t);
      return res.json<CostCenterDTO[]>();
    },
  });
}

export function useCreateCostCenter() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CostCenterDTO, ApiError, CreateCostCenterDTO>({
    mutationFn: async (body) => {
      const res = await request("/cost-centers", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCostCentreCouldNot"), t));
      return res.json<CostCenterDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cost-centers"] }),
  });
}

export function useUpdateCostCenter() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CostCenterDTO, ApiError, { id: string; patch: UpdateCostCenterDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/cost-centers/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCostCentreCouldNot2"), t));
      return res.json<CostCenterDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cost-centers"] }),
  });
}

/** الفترات المالية (docs/archive/catalog/04) — list, generate a fiscal year, and the three-tier close/reopen/lock lifecycle. */
export function useFiscalPeriods(): UseQueryResult<FiscalPeriodDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<FiscalPeriodDTO[], ApiError>({
    queryKey: ["fiscal-periods"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/fiscal-periods");
      if (!res.ok) throw await loaderError(res, t("api.financialPeriodsCouldNotBe"), t);
      return res.json<FiscalPeriodDTO[]>();
    },
  });
}

/** إنشاء السنة التالية — generates the 12 monthly periods for a fiscal year. */
export function useGenerateFiscalYear() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FiscalPeriodDTO[], ApiError, GenerateFiscalYearDTO>({
    mutationFn: async (body) => {
      const res = await request("/fiscal-periods/generate-year", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFinancialYearSPeriods"), t));
      return res.json<FiscalPeriodDTO[]>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fiscal-periods"] }),
  });
}

enum FiscalPeriodTransitionAction {
  Close = "close",
  Reopen = "reopen",
  Lock = "lock",
}

function useFiscalPeriodTransition(action: FiscalPeriodTransitionAction, fallbackMessage: string) {
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FiscalPeriodDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/fiscal-periods/${id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const refusal = (await res.json<{ error?: string; message?: string }>().catch(() => ({}))) as { error?: string; message?: string };
        throw new ApiError(res.status, refusal.message ? refusal.message : fallbackMessage, undefined, undefined, refusal.error);
      }
      return res.json<FiscalPeriodDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fiscal-periods"] }),
  });
}

/** إغلاق الفترة (مفتوحة → مغلقة). */
export function useClosePeriod() {
  const { t } = useAppTranslation();
  return useFiscalPeriodTransition(FiscalPeriodTransitionAction.Close, t("api.thePeriodCouldNotBe"));
}
/** إعادة فتح الفترة (مغلقة → مفتوحة). */
export function useReopenPeriod() {
  const { t } = useAppTranslation();
  return useFiscalPeriodTransition(FiscalPeriodTransitionAction.Reopen, t("api.thePeriodCouldNotBe2"));
}
/** قفل الفترة (مغلقة → مقفلة، نهائي). */
export function useLockPeriod() {
  const { t } = useAppTranslation();
  return useFiscalPeriodTransition(FiscalPeriodTransitionAction.Lock, t("api.thePeriodCouldNotBe3"));
}

/**
 * ما سيُرحَّل عند إقفال السنة — the closing entry the year WOULD post.
 *
 * A year that is already closed answers 409, and a year with nothing to close
 * answers 422; both are states the screen renders rather than errors, so they
 * resolve to `null` with the server's own Arabic message carried alongside.
 */
export function useYearEndClosePreview(
  year: number | null,
  enabled = true,
): UseQueryResult<YearEndClosePreviewDTO | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<YearEndClosePreviewDTO | null, ApiError>({
    queryKey: ["gl", "year-end-close", year],
    enabled: session !== null && year !== null && enabled,
    queryFn: async () => {
      const res = await request(`/gl/year-end-close/${year}/preview`);
      if (res.status === 409 || res.status === 422) return null;
      if (!res.ok) throw await loaderError(res, t("api.theYearEndCloseCouldNot"), t);
      return res.json<YearEndClosePreviewDTO>();
    },
  });
}

/**
 * قيد إقفال السنة، إن كان قد رُحِّل — the posted closing entry for a year, or
 * `null` when the year has not been closed. The close is idempotent by this id
 * (`YEAR-CLOSE:<year>`), so its presence IS the "closed" flag; there is no
 * separate status field that could disagree with the ledger.
 */
export function useYearEndCloseEntry(year: number | null): UseQueryResult<JournalEntryDTO | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<JournalEntryDTO | null, ApiError>({
    queryKey: ["gl", "year-end-close", "entry", year],
    enabled: session !== null && year !== null,
    queryFn: async () => {
      const res = await request(`/gl/year-end-close/${year}`);
      if (!res.ok) throw await loaderError(res, t("api.theJournalEntryCouldNot"), t);
      return (await res.json<{ entry: JournalEntryDTO | null }>()).entry;
    },
  });
}

/**
 * إقفال السنة المالية — posts the closing entry that sweeps every revenue and
 * expense balance into retained earnings, dated the last day of the year.
 *
 * It is an ordinary journal entry, so it invalidates the ledger-derived queries
 * too: the trial balance, the financial statements and the journal all change
 * the moment it posts.
 */
export function useCloseFiscalYear() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CloseFiscalYearResultDTO, ApiError, CloseFiscalYearDTO>({
    mutationFn: async (body) => {
      const res = await request("/gl/year-end-close", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFinancialYearCouldNot"), t));
      return res.json<CloseFiscalYearResultDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gl", "year-end-close"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["financial-reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

/** الضرائب (docs/archive/catalog/04) — list, create, edit. */
export function useTaxRates(): UseQueryResult<TaxRateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<TaxRateDTO[], ApiError>({
    queryKey: ["tax-rates"],
    enabled: sessionMayRead(session, DocumentReadPermission.TaxRates),
    queryFn: async () => {
      const res = await request("/tax-rates");
      if (!res.ok) throw await loaderError(res, t("api.taxesCouldNotBeLoaded"), t);
      return res.json<TaxRateDTO[]>();
    },
  });
}

export function useVatEnabled(): boolean | null {
  const { request, session } = useApi();
  const query = useQuery<{ vatEnabled: boolean }, ApiError>({
    queryKey: ["tax-rates", "policy"],
    enabled: sessionMayRead(session, DocumentReadPermission.TaxRates),
    queryFn: async () => {
      const res = await request("/tax-rates/policy");
      if (!res.ok) throw new ApiError(res.status, "");
      return res.json<{ vatEnabled: boolean }>();
    },
  });
  return query.data?.vatEnabled ?? null;
}

export function useCreateTaxRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TaxRateDTO, ApiError, CreateTaxRateDTO>({
    mutationFn: async (body) => {
      const res = await request("/tax-rates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theTaxCouldNotBe"), t));
      return res.json<TaxRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-rates"] }),
  });
}

export function useUpdateTaxRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TaxRateDTO, ApiError, { id: string; patch: UpdateTaxRateDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/tax-rates/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theTaxCouldNotBe2"), t));
      return res.json<TaxRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tax-rates"] }),
  });
}

/* -------------------------------------------------------------------- */
/* أسعار الصرف — Exchange Rates (docs/archive/catalog/04)                        */
/* -------------------------------------------------------------------- */

export function useExchangeRates(): UseQueryResult<ExchangeRateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ExchangeRateDTO[], ApiError>({
    queryKey: ["exchange-rates"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/exchange-rates");
      if (!res.ok) throw await loaderError(res, t("api.exchangeRatesCouldNotBe"), t);
      return res.json<ExchangeRateDTO[]>();
    },
  });
}

export function useCreateExchangeRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, CreateExchangeRateDTO>({
    mutationFn: async (body) => {
      const res = await request("/exchange-rates", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theExchangeRateCouldNot"), t));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

export function useApproveExchangeRate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ExchangeRateDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/exchange-rates/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theExchangeRateCouldNot2"), t));
      return res.json<ExchangeRateDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exchange-rates"] }),
  });
}

/* -------------------------------------------------------------------- */
/* أرباح مراكز التكلفة — Cost Center P&L (docs/archive/catalog/04)               */
/* -------------------------------------------------------------------- */

/** Groups posted revenue/expense by the cost-center dimension over `[fromDate, toDate]`. */
export function useCostCenterPnL(fromDate: string, toDate: string): UseQueryResult<CostCenterPnLReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CostCenterPnLReportDTO, ApiError>({
    queryKey: ["cost-center-pl", fromDate, toDate],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/cost-center-pl?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`);
      if (!res.ok) throw await loaderError(res, t("api.costCentreProfitabilityCouldNot"), t);
      return res.json<CostCenterPnLReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* إعادة تقييم العملات الأجنبية — FX Revaluation (docs/archive/catalog/04)       */
/* -------------------------------------------------------------------- */

export function useFxRevaluationPreview() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<FxRevaluationPreviewDTO, ApiError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/revaluation/preview", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRevaluationCouldNotBe"), t));
      return res.json<FxRevaluationPreviewDTO>();
    },
  });
}

export function useFxRevaluationPost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FxRevaluationPostResultDTO, ApiError, FxRevaluationRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/revaluation/post", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRevaluationCouldNotBe2"), t));
      return res.json<FxRevaluationPostResultDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
      void queryClient.invalidateQueries({ queryKey: ["revaluation"] });
    },
  });
}

/* -------------------------------------------------------------------- */
/* مطابقة الأرصدة — Balance Reconciliation (docs/archive/catalog/04)             */
/* -------------------------------------------------------------------- */

export function useReconciliation(): UseQueryResult<ReconciliationReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ReconciliationReportDTO, ApiError>({
    queryKey: ["reconciliation"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/reconciliation");
      if (!res.ok) throw await loaderError(res, t("api.theReconciliationCouldNotBe2"), t);
      return res.json<ReconciliationReportDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* الفاتورة الإلكترونية — ETA e-Invoicing (docs/archive/catalog/04)              */
/* -------------------------------------------------------------------- */

export interface EtaConfigResponse {
  readonly config: EtaConfigDTO;
  readonly readiness: EtaReadinessDTO;
}

export function useEtaConfig(): UseQueryResult<EtaConfigResponse, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaConfigResponse, ApiError>({
    queryKey: ["eta-config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/config");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaConfigResponse>();
    },
  });
}

export function useUpdateEtaConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaConfigResponse, ApiError, UpdateEtaConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/eta/config", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<EtaConfigResponse>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-config"] }),
  });
}

export function useEtaSubmissions(status?: EtaSubmissionStatusDTO): UseQueryResult<EtaSubmissionDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaSubmissionDTO[], ApiError>({
    queryKey: ["eta-submissions", status ?? "all"],
    enabled: sessionMayRead(session, DocumentReadPermission.EtaQueue),
    queryFn: async () => {
      const res = await request(`/eta/submissions${status ? `?status=${status}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.theSubmissionQueueCouldNot"), t);
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SubmitEtaSubmissionResult, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/eta/submissions/${id}/submit`, { method: "POST" });
      // 202 (EtaOfflineError — the stubbed online transmit refusing offline) is a
      // non-fatal, still-queued outcome, not an error — its body has no submission.
      if (res.status === 202) return { submission: null, queuedOffline: true };
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDocumentCouldNotBe"), t));
      return { submission: await res.json<EtaSubmissionDTO>(), queuedOffline: false };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export interface SubmitAllReadyEtaResult {
  readonly submitted: readonly EtaSubmissionDTO[];
  readonly queued: readonly string[];
  readonly blocked?: readonly string[];
}

export function useSubmitAllReadyEta() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SubmitAllReadyEtaResult, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/submissions/submit-all", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theReadyDocumentsCouldNot"), t));
      return res.json<SubmitAllReadyEtaResult>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export interface ProcessEtaQueueResult {
  readonly submitted: EtaSubmissionDTO[];
  readonly accepted: EtaSubmissionDTO[];
  readonly rejected: EtaSubmissionDTO[];
  readonly queued: string[];
  readonly unsigned: string[];
  readonly blocked?: string[];
}

export function useProcessEtaQueue() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProcessEtaQueueResult, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/submissions/process", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theReadyDocumentsCouldNot"), t));
      return res.json<ProcessEtaQueueResult>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export function useExcludeEtaSubmission() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmissionDTO, ApiError, { id: string; body: ExcludeEtaSubmissionDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/eta/submissions/${id}/exclude`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDocumentCouldNotBe2"), t));
      return res.json<EtaSubmissionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

/** إصلاح وإعادة الطابور (ENH-011b, WF-04 step 4) — rebuild one submission's payload and pre-validation. */
export function useRequeueEtaSubmission() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmissionDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/eta/submissions/${id}/requeue`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDocumentCouldNotBe"), t));
      return res.json<EtaSubmissionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export function useRecordEtaSubmissionUuid() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaSubmissionDTO, ApiError, { id: string; etaUuid: string }>({
    mutationFn: async ({ id, etaUuid }) => {
      const res = await request(`/eta/submissions/${id}/accept`, { method: "POST", body: JSON.stringify({ etaUuid }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thatActionCouldNotBe"), t));
      return res.json<EtaSubmissionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

/** إصلاح وإعادة الطابور جماعياً — requeue then submit every selected row. */
export function useBulkRequeueSubmitEta() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<BulkRequeueSubmitResultDTO, ApiError, readonly string[]>({
    mutationFn: async (ids) => {
      const res = await request("/eta/submissions/bulk-requeue-submit", { method: "POST", body: JSON.stringify({ ids }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theReadyDocumentsCouldNot"), t));
      return res.json<BulkRequeueSubmitResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["eta-submissions"] }),
  });
}

export function useEtaRejectionsReport(): UseQueryResult<EtaRejectionsReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaRejectionsReportDTO, ApiError>({
    queryKey: ["eta-rejections-report"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/reports/rejections");
      if (!res.ok) throw await loaderError(res, t("api.theSubmissionQueueCouldNot"), t);
      return res.json<EtaRejectionsReportDTO>();
    },
  });
}


export function useEtaActivityCodes(): UseQueryResult<EtaActivityCodeDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaActivityCodeDTO[], ApiError>({
    queryKey: ["eta-activity-codes"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/activity-codes");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaActivityCodeDTO[]>();
    },
  });
}

export function useEtaUnitCodes(): UseQueryResult<EtaUnitCodeDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaUnitCodeDTO[], ApiError>({
    queryKey: ["eta-unit-codes"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/unit-codes");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaUnitCodeDTO[]>();
    },
  });
}

export function useTestEtaConnection() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<EtaTestConnectionResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/test-connection", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<EtaTestConnectionResultDTO>();
    },
  });
}

export function useEtaBranchCodes(): UseQueryResult<EtaBranchCodeRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaBranchCodeRowDTO[], ApiError>({
    queryKey: ["eta-branch-codes"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/branch-codes");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaBranchCodeRowDTO[]>();
    },
  });
}

export function useSaveEtaBranchCode() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaBranchCodeRowDTO, ApiError, { branchId: string; body: UpdateEtaBranchCodeDTO }>({
    mutationFn: async ({ branchId, body }) => {
      const res = await request(`/eta/branch-codes/${branchId}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<EtaBranchCodeRowDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["eta-branch-codes"] });
      void queryClient.invalidateQueries({ queryKey: ["eta-config"] });
    },
  });
}

export interface EtaItemMappingsResponse {
  readonly rows: EtaItemMappingRowDTO[];
  readonly total: number;
  readonly unmapped: number;
}

export function useEtaItemMappings(filter: { q?: string; unmappedOnly?: boolean } = {}): UseQueryResult<EtaItemMappingsResponse, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaItemMappingsResponse, ApiError>({
    queryKey: ["eta-item-mappings", filter.q ?? "", filter.unmappedOnly ?? false],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      if (filter.unmappedOnly) params.set("unmapped", "1");
      const suffix = params.toString();
      const res = await request(`/eta/item-mappings${suffix ? `?${suffix}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaItemMappingsResponse>();
    },
  });
}

export function useSaveEtaItemMapping() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaItemMappingRowDTO, ApiError, { itemId: string; body: UpdateEtaItemMappingDTO }>({
    mutationFn: async ({ itemId, body }) => {
      const res = await request(`/eta/item-mappings/${itemId}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<EtaItemMappingRowDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["eta-item-mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["eta-config"] });
    },
  });
}

export function useEtaUnitMappings(): UseQueryResult<EtaUnitMappingRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaUnitMappingRowDTO[], ApiError>({
    queryKey: ["eta-unit-mappings"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/unit-mappings");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaUnitMappingRowDTO[]>();
    },
  });
}

export function useSaveEtaUnitMapping() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EtaUnitMappingRowDTO, ApiError, { unitCode: string; body: UpdateEtaUnitMappingDTO }>({
    mutationFn: async ({ unitCode, body }) => {
      const res = await request(`/eta/unit-mappings/${unitCode}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<EtaUnitMappingRowDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["eta-unit-mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["eta-config"] });
    },
  });
}

export function useApplyEtaUnitSuggestions() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApplyEtaUnitSuggestionsResultDTO, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/eta/unit-mappings/apply-suggestions", { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.eInvoicingSettingsCouldNot2"), t));
      return res.json<ApplyEtaUnitSuggestionsResultDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["eta-unit-mappings"] });
      void queryClient.invalidateQueries({ queryKey: ["eta-config"] });
    },
  });
}

export function useEtaTaxSubTypes(): UseQueryResult<EtaTaxSubTypeRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EtaTaxSubTypeRowDTO[], ApiError>({
    queryKey: ["eta-tax-subtypes"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/eta/tax-subtypes");
      if (!res.ok) throw await loaderError(res, t("api.eInvoicingSettingsCouldNot"), t);
      return res.json<EtaTaxSubTypeRowDTO[]>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* تسويات وتحويلات وجرد المخزون — Inventory Ops document layer (docs/archive/catalog/03) */
/* -------------------------------------------------------------------- */

export interface StockDocumentListFilter {
  /** A stored document status, or the chip key `all`. */
  readonly status?: DocumentStatusDTO | "all";
  readonly warehouseId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
}

export interface StockAdjustmentFilter extends StockDocumentListFilter {
  /** The 8 adjustment reasons — the list filters by the one on its lines (R5.9). */
  readonly reason?: string;
}

/**
 * The one place the adjustment/transfer lists' filters become a query string,
 * so the rows, the chip counts and the KPI strip cannot be narrowed
 * differently.
 */
function stockDocumentParams(filter: StockDocumentListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.search) params.set("search", filter.search);
  return params;
}

function stockAdjustmentParams(filter: StockAdjustmentFilter): URLSearchParams {
  const params = stockDocumentParams(filter);
  if (filter.reason) params.set("reason", filter.reason);
  return params;
}

/**
 * One adjustment by id or document number, straight from the server.
 *
 * A deep link (`#/inventory/stock-adjustments/<id>`) used to be resolved against
 * whatever rows the list query happened to hold, and the list is scoped and
 * paged — so a link to a real document rendered the list instead (D54).
 */
export function useStockAdjustment(id: string | null): UseQueryResult<StockAdjustmentDocumentDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockAdjustmentDocumentDTO, ApiError>({
    queryKey: ["stock-adjustment", id],
    enabled: session !== null && id !== null,
    retry: false,
    queryFn: async () => {
      const res = await request(`/inventory/stock-adjustments/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("api.stockAdjustmentsCouldNotBe"), t);
      return res.json<StockAdjustmentDocumentDTO>();
    },
  });
}

export function useStockAdjustments(filter: StockAdjustmentFilter = {}): UseQueryResult<StockAdjustmentDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockAdjustmentDocumentDTO[], ApiError>({
    queryKey: ["stock-adjustments", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockAdjustmentParams(filter).toString();
      const res = await request(`/inventory/stock-adjustments${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockAdjustmentsCouldNotBe"), t);
      return res.json<StockAdjustmentDocumentDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useStockAdjustmentCounts(filter: StockAdjustmentFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["stock-adjustments", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockAdjustmentParams(rest).toString();
      const res = await request(`/inventory/stock-adjustments/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockAdjustmentsCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useStockAdjustmentStats(filter: StockAdjustmentFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["stock-adjustments", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockAdjustmentParams(filter).toString();
      const res = await request(`/inventory/stock-adjustments/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockAdjustmentsCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateStockAdjustment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockAdjustmentDocumentDTO, ApiError, CreateStockAdjustmentDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/stock-adjustments/draft", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theStockAdjustmentCouldNot"), t);
      return res.json<StockAdjustmentDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] }),
  });
}

export function useConfirmStockAdjustment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: StockAdjustmentDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/stock-adjustments/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theStockAdjustmentCouldNot2"), t));
      return res.json<{ document: StockAdjustmentDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

/** One transfer by id or document number — the deep-link sibling of `useStockAdjustment` (D54). */
export function useStockTransfer(id: string | null): UseQueryResult<StockTransferDocumentDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockTransferDocumentDTO, ApiError>({
    queryKey: ["stock-transfer", id],
    enabled: session !== null && id !== null,
    retry: false,
    queryFn: async () => {
      const res = await request(`/inventory/stock-transfers/${encodeURIComponent(id ?? "")}`);
      if (!res.ok) throw await loaderError(res, t("api.stockTransfersCouldNotBe"), t);
      return res.json<StockTransferDocumentDTO>();
    },
  });
}

export function useStockTransfers(filter: StockDocumentListFilter = {}): UseQueryResult<StockTransferDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockTransferDocumentDTO[], ApiError>({
    queryKey: ["stock-transfers", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockDocumentParams(filter).toString();
      const res = await request(`/inventory/stock-transfers${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockTransfersCouldNotBe"), t);
      return res.json<StockTransferDocumentDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useStockTransferCounts(filter: StockDocumentListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["stock-transfers", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockDocumentParams(rest).toString();
      const res = await request(`/inventory/stock-transfers/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockTransfersCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useStockTransferStats(filter: StockDocumentListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["stock-transfers", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = stockDocumentParams(filter).toString();
      const res = await request(`/inventory/stock-transfers/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.stockTransfersCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateStockTransfer() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<StockTransferDocumentDTO, ApiError, CreateStockTransferDTO>({
    mutationFn: async (body) => {
      const res = await request("/inventory/stock-transfers/draft", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theStockTransferCouldNot"), t);
      return res.json<StockTransferDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["stock-transfers"] }),
  });
}

export function useConfirmStockTransfer() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: StockTransferDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/inventory/stock-transfers/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theStockTransferCouldNot2"), t));
      return res.json<{ document: StockTransferDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["stock-balance"] });
    },
  });
}

export interface PhysicalCountFilter {
  /** A stored count status, or the chip key `all`. */
  readonly status?: PhysicalCountStatusDTO | "all";
  readonly warehouseId?: string;
  readonly search?: string;
}

/**
 * The one place the count list's filters become a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function physicalCountParams(filter: PhysicalCountFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.search) params.set("search", filter.search);
  return params;
}

export function usePhysicalCounts(filter: PhysicalCountFilter = {}): UseQueryResult<PhysicalCountDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PhysicalCountDTO[], ApiError>({
    queryKey: ["physical-counts", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = physicalCountParams(filter).toString();
      const res = await request(`/inventory/physical-counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.physicalCountsCouldNotBe"), t);
      return res.json<PhysicalCountDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function usePhysicalCountCounts(filter: PhysicalCountFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["physical-counts", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = physicalCountParams(rest).toString();
      const res = await request(`/inventory/physical-counts/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.physicalCountsCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function usePhysicalCountStats(filter: PhysicalCountFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["physical-counts", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = physicalCountParams(filter).toString();
      const res = await request(`/inventory/physical-counts/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.physicalCountsCouldNotBe"), t);
      return res.json<ListStatsDTO>();
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
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCountCouldNotBe"), t));
      return res.json<PhysicalCountDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["physical-counts"] }),
  });
}

export function useRecordPhysicalCountEntries() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PhysicalCountDTO, ApiError, { id: string; body: RecordPhysicalCountEntriesDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/inventory/physical-counts/${id}/counts`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCountedQuantitiesCouldNot"), t));
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
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCountCouldNotBe2"), t));
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
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCountCouldNotBe3"), t));
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
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCountAdjustmentCouldNot"), t));
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

/** أرصدة المخزون (docs/archive/catalog/03) — cross-warehouse rollup, one row per item (packages/api/src/inventory-routes.ts's `/inventory/stock-balance`). */
export function useStockBalance(filter: StockBalanceFilter = {}): UseQueryResult<StockBalanceRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockBalanceRowDTO[], ApiError>({
    queryKey: ["stock-balance", filter],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/inventory/stock-balance${filter.warehouseId ? `?warehouseId=${filter.warehouseId}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.theStockBalanceCouldNot"), t);
      const body = await res.json<{ rows: StockBalanceRowDTO[] }>();
      return body.rows;
    },
  });
}

export interface AccountLedgerLineRecord {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly memo: string | null;
  readonly debit: string;
  readonly credit: string;
}

export interface AccountLedgerRecord {
  readonly balance: { accountId: string; debit: string; credit: string; balance: string };
  readonly lines: AccountLedgerLineRecord[];
}

/**
 * One GL account's movements and balance (`GET /gl/accounts/:id/ledger`). The
 * route already existed and nothing called it, so the chart-of-accounts detail
 * printed a "(المرحلة الثانية)" placeholder over live data (D43).
 */
export function useAccountLedger(accountId: string | null): UseQueryResult<AccountLedgerRecord, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AccountLedgerRecord, ApiError>({
    queryKey: ["account-ledger", accountId],
    enabled: session !== null && accountId !== null,
    queryFn: async () => {
      const res = await request(`/gl/accounts/${encodeURIComponent(accountId!)}/ledger`);
      if (!res.ok) throw await loaderError(res, t("api.theAccountLedgerCouldNot"), t);
      return res.json<AccountLedgerRecord>();
    },
  });
}

export interface ItemStockPositionRecord {
  readonly warehouseId: string;
  readonly onHand: string;
  /** Committed by an open document but not yet moved (R5.6). */
  readonly reserved: string;
  /** onHand − reserved, floored at zero. What the sales desk can actually promise. */
  readonly available: string;
  readonly totalValue: string;
  readonly averageCost: string;
}

export interface ItemCostLayerRecord {
  readonly id: string;
  readonly warehouseId: string;
  readonly unitCost: string;
  readonly originalQty: string;
  readonly remainingQty: string;
  readonly sourceDocType: string;
  readonly sourceDocNumber: string | null;
  readonly createdAt: string;
}

/**
 * One item's stock across warehouses and its open cost layers
 * (`GET /inventory/items/:id/stock`). The item card used to print a
 * "(المرحلة الثانية)" placeholder over data that already existed (D43).
 */
export function useItemStock(itemId: string | null): UseQueryResult<
  { positions: ItemStockPositionRecord[]; layers: ItemCostLayerRecord[] },
  ApiError
> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<{ positions: ItemStockPositionRecord[]; layers: ItemCostLayerRecord[] }, ApiError>({
    queryKey: ["item-stock", itemId],
    enabled: session !== null && itemId !== null,
    queryFn: async () => {
      const res = await request(`/inventory/items/${encodeURIComponent(itemId!)}/stock`);
      if (!res.ok) throw await loaderError(res, t("api.theStockBalanceCouldNot"), t);
      return res.json<{ positions: ItemStockPositionRecord[]; layers: ItemCostLayerRecord[] }>();
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

export interface RfqListFilter {
  /** A stored status, or the chip key `all`. */
  readonly status?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly branchId?: string;
  readonly warehouseId?: string;
  readonly search?: string;
}

/**
 * The one place the RFQ list's filters become a query string, so the rows, the
 * chip counts and the KPI strip cannot be narrowed differently.
 */
function rfqParams(filter: RfqListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.branchId) params.set("branchId", filter.branchId);
  if (filter.warehouseId) params.set("warehouseId", filter.warehouseId);
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** طلبات عروض الأسعار / RFQs (docs/archive/catalog/02) — list, create, and the draft → sent → closed/cancelled lifecycle. */
export function useRfqs(filter: RfqListFilter = {}): UseQueryResult<PurchaseRfqDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseRfqDTO[], ApiError>({
    queryKey: ["rfqs", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = rfqParams(filter).toString();
      const res = await request(`/rfqs${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.requestsForQuotationCouldNot"), t);
      return res.json<PurchaseRfqDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useRfqCounts(filter: RfqListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["rfqs", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = rfqParams(rest).toString();
      const res = await request(`/rfqs/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.requestsForQuotationCouldNot"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, computed on the server over the whole filtered set. */
export function useRfqStats(filter: RfqListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["rfqs", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = rfqParams(filter).toString();
      const res = await request(`/rfqs/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.requestsForQuotationCouldNot"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

/** عروض الموردين المسجلة على طلب عرض سعر واحد. */
export function useRfqQuotes(rfqId: string | null): UseQueryResult<RfqQuoteDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RfqQuoteDTO[], ApiError>({
    queryKey: ["rfqs", rfqId, "quotes"],
    enabled: session !== null && rfqId !== null,
    queryFn: async () => {
      const res = await request(`/rfqs/${rfqId}/quotes`);
      if (!res.ok) throw await loaderError(res, t("api.supplierQuotesCouldNotBe"), t);
      return res.json<RfqQuoteDTO[]>();
    },
  });
}

/** شبكة مقارنة العروض (سعر لكل صنف/مورد، وإجمالي السلة الكاملة لكل مورد). */
export function useRfqComparison(rfqId: string | null): UseQueryResult<RfqComparisonRecord, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<RfqComparisonRecord, ApiError>({
    queryKey: ["rfqs", rfqId, "comparison"],
    enabled: session !== null && rfqId !== null,
    queryFn: async () => {
      const res = await request(`/rfqs/${rfqId}/comparison`);
      if (!res.ok) throw await loaderError(res, t("api.theQuoteComparisonCouldNot"), t);
      return res.json<RfqComparisonRecord>();
    },
  });
}

export function useCreateRfq() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseRfqDTO, ApiError, CreatePurchaseRfqDTO>({
    mutationFn: async (body) => {
      const res = await request("/rfqs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRequestForQuotationCould"), t));
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
  const { t } = useAppTranslation();
  return useRfqTransition("send", t("api.theRequestForQuotationCould2"));
}
/** إغلاق طلب عرض السعر بدون تحويل (مرسل → مغلق). */
export function useCloseRfq() {
  const { t } = useAppTranslation();
  return useRfqTransition("close", t("api.theRequestForQuotationCould3"));
}
/** إلغاء طلب عرض السعر. */
export function useCancelRfq() {
  const { t } = useAppTranslation();
  return useRfqTransition("cancel", t("api.theRequestForQuotationCould4"));
}

/** تسجيل عرض سعر مورد جديد على طلب عرض سعر مرسل. */
export function useCreateRfqQuote() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RfqQuoteDTO, ApiError, { rfqId: string; body: CreateRfqQuoteDTO }>({
    mutationFn: async ({ rfqId, body }) => {
      const res = await request(`/rfqs/${rfqId}/quotes`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theQuoteCouldNotBe3"), t));
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ rfq: PurchaseRfqDTO; purchaseOrderId: string }, ApiError, { rfqId: string; body: ConvertRfqDTO }>({
    mutationFn: async ({ rfqId, body }) => {
      const res = await request(`/rfqs/${rfqId}/convert`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRequestForQuotationCould5"), t));
      return res.json<{ rfq: PurchaseRfqDTO; purchaseOrderId: string }>();
    },
    onSuccess: (_data, { rfqId }) => {
      queryClient.invalidateQueries({ queryKey: ["rfqs"] });
      queryClient.invalidateQueries({ queryKey: ["rfqs", rfqId, "comparison"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
}

export interface SalesReturnListFilter {
  /** A stored document status, or the chip key `all`. */
  readonly status?: DocumentStatusDTO | "all";
  readonly customerId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  /** The second chip axis — بانتظار دفع المبلغ. */
  readonly awaitingRefund?: boolean;
  readonly search?: string;
}

/**
 * The one place the return list's filters become a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function salesReturnParams(filter: SalesReturnListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.customerId) params.set("customerId", filter.customerId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.awaitingRefund) params.set("awaitingRefund", "true");
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** مرتجعات المبيعات (docs/archive/catalog/01) — list, create draft (against a confirmed sales invoice), confirm, cancel/void. */
export function useSalesReturns(filter: SalesReturnListFilter = {}): UseQueryResult<SalesReturnDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SalesReturnDocumentDTO[], ApiError>({
    queryKey: ["sales-returns", filter],
    enabled: sessionMayRead(session, DocumentReadPermission.SalesReturns, DocumentReadPermission.SalesReturnsOwn),
    queryFn: async () => {
      const qs = salesReturnParams(filter).toString();
      const res = await request(`/sales-returns${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.salesReturnsCouldNotBe"), t);
      return res.json<SalesReturnDocumentDTO[]>();
    },
  });
}

export enum ReturnKind {
  Sales = "sales-returns",
  Purchase = "purchase-returns",
}

export function useReturnSourceLines(kind: ReturnKind, invoiceId: string): UseQueryResult<ReturnSourceLinesDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ReturnSourceLinesDTO, ApiError>({
    queryKey: [kind, "source-lines", invoiceId],
    enabled: session !== null && invoiceId !== "",
    queryFn: async () => {
      const res = await request(`/${kind}/source-lines/${encodeURIComponent(invoiceId)}`);
      if (!res.ok) throw await loaderError(res, t(kind === ReturnKind.Sales ? "api.salesReturnsCouldNotBe" : "api.purchaseReturnsCouldNotBe"), t);
      return res.json<ReturnSourceLinesDTO>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useSalesReturnCounts(filter: SalesReturnListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["sales-returns", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesReturnParams(rest).toString();
      const res = await request(`/sales-returns/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.salesReturnsCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useSalesReturnStats(filter: SalesReturnListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["sales-returns", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = salesReturnParams(filter).toString();
      const res = await request(`/sales-returns/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.salesReturnsCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateSalesReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesReturnDocumentDTO, ApiError, CreateSalesReturnDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-returns", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theSalesReturnCouldNot"), t);
      return res.json<SalesReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

export function useConfirmSalesReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: SalesReturnDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-returns/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theSalesReturnCouldNot2"), t));
      return res.json<{ document: SalesReturnDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

export function useCancelSalesReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesReturnDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/sales-returns/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theSalesReturnCouldNot3"), t));
      return res.json<SalesReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

export enum ReturnFamily {
  Sales = "sales-returns",
  Purchases = "purchase-returns",
}

// INVARIANT: the lists of both return families leave out the document that
// reversed another; its own address is the only way to it, so a screen opened
// at an address its list does not hold asks for the one document here.
export function useReturnDocument<Document>(family: ReturnFamily, id: string): UseQueryResult<Document | null, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<Document | null, ApiError>({
    queryKey: [family, "document", id],
    enabled: session !== null && id !== "",
    queryFn: async () => {
      const res = await request(`/${family}/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await loaderError(res, t(family === ReturnFamily.Sales ? "api.salesReturnsCouldNotBe" : "api.purchaseReturnsCouldNotBe"), t);
      return res.json<Document>();
    },
  });
}

const RETURN_VOID_INVALIDATIONS = ["sales-returns", "purchase-returns", "sales-invoices", "purchase-invoices", "purchases", "journal-entries", "gl", "stock-balance", "eta-submissions", "eta", "dashboard", "financial-reports", "audit"];

export function useVoidReturn(family: ReturnFamily) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ id: string; status: string; voidReason?: string | null }, ApiError, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const res = await request(`/${family}/${encodeURIComponent(id)}/void`, { method: "POST", body: JSON.stringify({ reason }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("voidReturn.failed"), t));
      return res.json();
    },
    onSuccess: () => {
      for (const key of RETURN_VOID_INVALIDATIONS) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export interface PurchaseReturnListFilter {
  /** A stored document status, or the chip key `all`. */
  readonly status?: DocumentStatusDTO | "all";
  readonly supplierId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly search?: string;
}

/**
 * The one place the return list's filters become a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function purchaseReturnParams(filter: PurchaseReturnListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  if (filter.supplierId) params.set("supplierId", filter.supplierId);
  if (filter.fromDate) params.set("fromDate", filter.fromDate);
  if (filter.toDate) params.set("toDate", filter.toDate);
  if (filter.search) params.set("search", filter.search);
  return params;
}

/** مرتجعات المشتريات (docs/archive/catalog/02) — list, create draft (against a confirmed purchase invoice), confirm, cancel/void. */
export function usePurchaseReturns(filter: PurchaseReturnListFilter = {}): UseQueryResult<PurchaseReturnDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseReturnDocumentDTO[], ApiError>({
    queryKey: ["purchase-returns", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseReturnParams(filter).toString();
      const res = await request(`/purchase-returns${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseReturnsCouldNotBe"), t);
      return res.json<PurchaseReturnDocumentDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function usePurchaseReturnCounts(filter: PurchaseReturnListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["purchase-returns", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseReturnParams(rest).toString();
      const res = await request(`/purchase-returns/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseReturnsCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function usePurchaseReturnStats(filter: PurchaseReturnListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["purchase-returns", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = purchaseReturnParams(filter).toString();
      const res = await request(`/purchase-returns/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseReturnsCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreatePurchaseReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseReturnDocumentDTO, ApiError, CreatePurchaseReturnDTO>({
    mutationFn: async (body) => {
      const res = await request("/purchase-returns", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.thePurchaseReturnCouldNot"), t);
      return res.json<PurchaseReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

export function useConfirmPurchaseReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: PurchaseReturnDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchase-returns/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePurchaseReturnCouldNot2"), t));
      return res.json<{ document: PurchaseReturnDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

export function useCancelPurchaseReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseReturnDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/purchase-returns/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePurchaseReturnCouldNot3"), t));
      return res.json<PurchaseReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["purchase-returns"] }),
  });
}

/** التكاليف الإضافية (docs/archive/catalog/02) — list, create draft (server runs distributeLandedCost and persists the allocated lines), confirm (runs the cost-layer revaluation), cancel/void. */
export function useLandedCosts(status?: DocumentStatusDTO): UseQueryResult<LandedCostDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LandedCostDocumentDTO[], ApiError>({
    queryKey: ["landed-costs", status ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = status ? `?status=${status}` : "";
      const res = await request(`/landed-costs${qs}`);
      if (!res.ok) throw await loaderError(res, t("api.landedCostDocumentsCouldNot"), t);
      return res.json<LandedCostDocumentDTO[]>();
    },
  });
}

export function useCreateLandedCost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LandedCostDocumentDTO, ApiError, CreateLandedCostDTO>({
    mutationFn: async (body) => {
      const res = await request("/landed-costs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theLandedCostDocumentCould"), t);
      return res.json<LandedCostDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-costs"] }),
  });
}

export function useConfirmLandedCost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: LandedCostDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/landed-costs/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLandedCostDocumentCould2"), t));
      return res.json<{ document: LandedCostDocumentDTO; held: boolean }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landed-costs"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

export function useCancelLandedCost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LandedCostDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/landed-costs/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLandedCostDocumentCould3"), t));
      return res.json<LandedCostDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["landed-costs"] }),
  });
}

export function useReverseLandedCost() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ original: LandedCostDocumentDTO; reversal: LandedCostDocumentDTO }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/landed-costs/${id}/reverse`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLandedCostDocumentCould3"), t));
      return res.json<{ original: LandedCostDocumentDTO; reversal: LandedCostDocumentDTO }>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["landed-costs"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-levels"] });
    },
  });
}

export interface InstallmentPlanListFilter {
  /** A stored document status, or one of the derived axis keys `all` / `overdue`. */
  readonly status?: DocumentStatusDTO | "all" | "overdue";
}

/**
 * The one place the plan list's filter becomes a query string, so the rows,
 * the chip counts and the KPI strip cannot be narrowed differently.
 */
function installmentPlanParams(filter: InstallmentPlanListFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status && filter.status !== "all") params.set("status", filter.status);
  return params;
}

/** خطط الأقساط (docs/archive/catalog/05) — list, create (server builds the payment schedule), confirm, cancel/void, and the معالجة المتأخرات overdue batch. */
export function useInstallmentPlans(filter: InstallmentPlanListFilter = {}): UseQueryResult<InstallmentPlanDocumentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<InstallmentPlanDocumentDTO[], ApiError>({
    queryKey: ["installment-plans", filter],
    enabled: sessionMayRead(session, DocumentReadPermission.InstallmentPlans),
    queryFn: async () => {
      const qs = installmentPlanParams(filter).toString();
      const res = await request(`/installments/plans${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.instalmentPlansCouldNotBe"), t);
      return res.json<InstallmentPlanDocumentDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useInstallmentPlanCounts(filter: InstallmentPlanListFilter = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["installment-plans", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = installmentPlanParams(rest).toString();
      const res = await request(`/installments/plans/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.instalmentPlansCouldNotBe"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, summed in `Money` on the server over the whole filtered set. */
export function useInstallmentPlanStats(filter: InstallmentPlanListFilter = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["installment-plans", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = installmentPlanParams(filter).toString();
      const res = await request(`/installments/plans/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.instalmentPlansCouldNotBe"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateInstallmentPlan() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<InstallmentPlanDocumentDTO, ApiError, CreateInstallmentPlanDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/plans", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theInstalmentPlanCouldNot"), t));
      return res.json<InstallmentPlanDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useConfirmInstallmentPlan() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ document: InstallmentPlanDocumentDTO; held: boolean }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/plans/${id}/confirm`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theInstalmentPlanCouldNot2"), t));
      return res.json<{ document: InstallmentPlanDocumentDTO; held: boolean }>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useCancelInstallmentPlan() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<InstallmentPlanDocumentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/plans/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theInstalmentPlanCouldNot3"), t));
      return res.json<InstallmentPlanDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export function useProcessOverdueInstallments() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ProcessOverdueInstallmentsResultDTO, ApiError, ProcessOverdueInstallmentsDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/plans/overdue/process", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theOverdueInstalmentsCouldNot"), t));
      return res.json<ProcessOverdueInstallmentsResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["installment-plans"] }),
  });
}

export interface FollowUpListFilters {
  /** A stored status, or the chip key `all`. */
  readonly status?: FollowUpStatusDTO | "all";
  readonly customerId?: string;
}

/**
 * The one place the worklist's filters become a query string, so the rows, the
 * chip counts and the KPI strip cannot be narrowed differently.
 */
function followUpParams(filters: FollowUpListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.customerId) params.set("customerId", filters.customerId);
  return params;
}

/** متابعة التحصيل (docs/archive/catalog/05) — list (filterable by status/customer), create, complete (records an outcome), cancel. */
export function useFollowUps(filters: FollowUpListFilters = {}): UseQueryResult<CollectionFollowUpDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<CollectionFollowUpDTO[], ApiError>({
    queryKey: ["follow-ups", filters.status ?? null, filters.customerId ?? null],
    enabled: session !== null,
    queryFn: async () => {
      const qs = followUpParams(filters).toString();
      const res = await request(`/installments/follow-ups${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.collectionFollowUpsCouldNot"), t);
      return res.json<CollectionFollowUpDTO[]>();
    },
  });
}

/** Chip counts (R1.1); the status axis is withheld so every chip reports its own total. */
export function useFollowUpCounts(filter: FollowUpListFilters = {}): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const { status: _status, ...rest } = filter;
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["follow-ups", "counts", rest],
    enabled: session !== null,
    queryFn: async () => {
      const qs = followUpParams(rest).toString();
      const res = await request(`/installments/follow-ups/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.collectionFollowUpsCouldNot"), t);
      return res.json<ListCountsDTO>();
    },
  });
}

/** The KPI strip, counted on the server over the whole filtered set — a follow-up carries no money. */
export function useFollowUpStats(filter: FollowUpListFilters = {}): UseQueryResult<ListStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListStatsDTO, ApiError>({
    queryKey: ["follow-ups", "stats", filter],
    enabled: session !== null,
    queryFn: async () => {
      const qs = followUpParams(filter).toString();
      const res = await request(`/installments/follow-ups/stats${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.collectionFollowUpsCouldNot"), t);
      return res.json<ListStatsDTO>();
    },
  });
}

export function useCreateFollowUp() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, CreateFollowUpDTO>({
    mutationFn: async (body) => {
      const res = await request("/installments/follow-ups", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFollowUpCouldNot"), t));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

export function useCompleteFollowUp() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, { id: string; outcome: string }>({
    mutationFn: async ({ id, outcome }) => {
      const res = await request(`/installments/follow-ups/${id}/complete`, { method: "POST", body: JSON.stringify({ outcome }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFollowUpCouldNot2"), t));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

export function useCancelFollowUp() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<CollectionFollowUpDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/installments/follow-ups/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFollowUpCouldNot3"), t));
      return res.json<CollectionFollowUpDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["follow-ups"] }),
  });
}

// ---------------------------------------------------------------------------
// HR master data (docs/archive/catalog/06 "الموارد البشرية") — hr/master-data
// ---------------------------------------------------------------------------

export function useDepartments(): UseQueryResult<DepartmentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<DepartmentDTO[], ApiError>({
    queryKey: ["hr-departments"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/departments");
      if (!res.ok) throw await loaderError(res, t("api.departmentsCouldNotBeLoaded"), t);
      return res.json<DepartmentDTO[]>();
    },
  });
}

export function useCreateDepartment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepartmentDTO, ApiError, CreateDepartmentDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/departments", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepartmentCouldNotBe"), t));
      return res.json<DepartmentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-departments"] }),
  });
}

export function useUpdateDepartment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DepartmentDTO, ApiError, { id: string; body: UpdateDepartmentDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/departments/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDepartmentCouldNotBe2"), t));
      return res.json<DepartmentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-departments"] }),
  });
}

export function useJobTitles(enabled = true): UseQueryResult<JobTitleDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<JobTitleDTO[], ApiError>({
    queryKey: ["hr-job-titles"],
    enabled: sessionMayAsk(session, ShellRequest.JobTitles) && enabled,
    queryFn: async () => {
      const res = await request("/hr/job-titles");
      if (!res.ok) throw await loaderError(res, t("api.jobTitlesCouldNotBe"), t);
      return res.json<JobTitleDTO[]>();
    },
  });
}

export function useCreateJobTitle() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JobTitleDTO, ApiError, CreateJobTitleDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/job-titles", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theJobTitleCouldNot"), t));
      return res.json<JobTitleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-job-titles"] }),
  });
}

export function useUpdateJobTitle() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<JobTitleDTO, ApiError, { id: string; body: UpdateJobTitleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/job-titles/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theJobTitleCouldNot2"), t));
      return res.json<JobTitleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-job-titles"] }),
  });
}

export function useEmployees(enabled = true): UseQueryResult<EmployeeDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EmployeeDTO[], ApiError>({
    queryKey: ["hr-employees"],
    enabled: sessionMayAsk(session, ShellRequest.Employees) && enabled,
    queryFn: async () => {
      const res = await request("/hr/employees");
      if (!res.ok) throw await loaderError(res, t("api.employeesCouldNotBeLoaded"), t);
      return res.json<EmployeeDTO[]>();
    },
  });
}

export function useEmployeeContracts(employeeId: string | null): UseQueryResult<ContractDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ContractDTO[], ApiError>({
    queryKey: ["hr-employee-contracts", employeeId],
    enabled: session !== null && employeeId !== null,
    queryFn: async () => {
      const res = await request(`/hr/employees/${employeeId}/contracts`);
      if (!res.ok) throw await loaderError(res, t("api.theEmployeeSContractsCould"), t);
      return res.json<ContractDTO[]>();
    },
  });
}

export function useCreateEmployee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, CreateEmployeeDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/employees", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEmployeeCouldNotBe"), t));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useUpdateEmployee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; body: UpdateEmployeeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/employees/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEmployeeCouldNotBe2"), t));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useTransitionEmployee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; body: TransitionEmployeeDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/employees/${id}/transition`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEmployeeSStatusCould"), t));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export interface TerminationPayRecoveryDTO {
  readonly advanceId: string | null;
  readonly advanceNumber: string | null;
  readonly days: number;
  readonly gross: string;
  readonly amount: string;
  readonly payableReduced: string;
  readonly taxRelief: string;
  readonly journalEntryId: string;
  readonly paidThrough: string;
}

export type TerminatedEmployeeDTO = EmployeeDTO & { readonly payRecovery?: TerminationPayRecoveryDTO | null };

export function useTerminateEmployee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TerminatedEmployeeDTO, ApiError, { id: string; effectiveDate: string }>({
    mutationFn: async ({ id, effectiveDate }) => {
      const res = await request(`/hr/employees/${id}/terminate`, { method: "POST", body: JSON.stringify({ effectiveDate }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theEmployeeSServiceCould"), t));
      return res.json<TerminatedEmployeeDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
      void queryClient.invalidateQueries({ queryKey: ["hr-advances"] });
    },
  });
}

export function useCorrectTerminationDate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TerminatedEmployeeDTO, ApiError, { id: string; effectiveDate: string }>({
    mutationFn: async ({ id, effectiveDate }) => {
      const res = await request(`/hr/employees/${id}/correct-termination-date`, { method: "POST", body: JSON.stringify({ effectiveDate }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("employees.couldnTCorrectTheTerminationDate"), t));
      return res.json<TerminatedEmployeeDTO>();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
      void queryClient.invalidateQueries({ queryKey: ["hr-advances"] });
      void queryClient.invalidateQueries({ queryKey: ["hr-payroll-runs"] });
    },
  });
}

export function useRehireEmployee() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; hireDate: string }>({
    mutationFn: async ({ id, hireDate }) => {
      const res = await request(`/hr/employees/${id}/rehire`, { method: "POST", body: JSON.stringify({ hireDate }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("employees.theEmployeeCouldNotBe"), t));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-employees"] });
      queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
    },
  });
}

export function useContracts(): UseQueryResult<ContractDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ContractDTO[], ApiError>({
    queryKey: ["hr-contracts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/contracts");
      if (!res.ok) throw await loaderError(res, t("api.contractsCouldNotBeLoaded"), t);
      return res.json<ContractDTO[]>();
    },
  });
}

export function useCreateContract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ContractDTO, ApiError, CreateContractDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/contracts", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theContractCouldNotBe"), t));
      return res.json<ContractDTO>();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee-contracts", variables.employeeId] });
    },
  });
}

export function useTerminateContract() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ContractDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/contracts/${id}/terminate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theContractCouldNotBe2"), t));
      return res.json<ContractDTO>();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-employee-contracts", data.employeeId] });
    },
  });
}

export function useHolidays(year: number): UseQueryResult<HolidayDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<HolidayDTO[], ApiError>({
    queryKey: ["hr-holidays", year],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/holidays?year=${year}`);
      if (!res.ok) throw await loaderError(res, t("api.publicHolidaysCouldNotBe"), t);
      return res.json<HolidayDTO[]>();
    },
  });
}

export function useCreateHoliday() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HolidayDTO, ApiError, CreateHolidayDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/holidays", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theHolidayCouldNotBe"), t));
      return res.json<HolidayDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export function useUpdateHoliday() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HolidayDTO, ApiError, { id: string; body: UpdateHolidayDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/holidays/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theHolidayCouldNotBe2"), t));
      return res.json<HolidayDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export function useDeleteHoliday() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theHolidayCouldNotBe3"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-holidays"] }),
  });
}

export interface MyLeaveDTO {
  readonly employeeId: string | null;
  readonly requests: LeaveRequestDTO[];
}

export function useMyLeave(): UseQueryResult<MyLeaveDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<MyLeaveDTO, ApiError>({
    queryKey: ["hr-my-leave"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/leave-requests/me");
      if (!res.ok) throw await loaderError(res, t("api.yourLeaveCouldNotBe"), t);
      return res.json<MyLeaveDTO>();
    },
  });
}

export function useCreateLeaveRequest() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, CreateLeaveRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/leave-requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeaveRequestCouldNot"), t));
      return res.json<LeaveRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-my-leave"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-request-counts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
    },
  });
}

export function useCancelLeaveRequest() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/leave-requests/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeaveRequestCouldNot2"), t));
      return res.json<LeaveRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-my-leave"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-request-counts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["hr-dashboard"] });
    },
  });
}

export function useHrDashboard(): UseQueryResult<HrDashboardSummaryDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<HrDashboardSummaryDTO, ApiError>({
    queryKey: ["hr-dashboard"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/dashboard");
      if (!res.ok) throw await loaderError(res, t("api.theHrDashboardCouldNot"), t);
      return res.json<HrDashboardSummaryDTO>();
    },
  });
}

/* ------------------------------------------------------------------ */
/* قواعد الإشعارات / Notification rules (docs/archive/catalog/09) + top-bar panel */
/* ------------------------------------------------------------------ */

/**
 * The honest trigger catalog behind the rule builder: which event codes this
 * build actually publishes, and which channels actually send.
 */
export function useNotificationTriggers(): UseQueryResult<NotificationTriggerCatalogDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<NotificationTriggerCatalogDTO, ApiError>({
    queryKey: ["notification-triggers"],
    enabled: session !== null,
    retry: false,
    queryFn: async () => {
      const res = await request("/notification-rules/triggers");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.notificationEventsCouldNotBe"), t));
      return res.json<NotificationTriggerCatalogDTO>();
    },
  });
}

/**
 * LAN multi-till: seat occupancy, the connected devices, and freeing a seat.
 *
 * These went through a BARE `fetch` with no `Authorization` header, which was
 * invisible until every `/lan` route started requiring a session. After that
 * `GET /lan/status` answered 401, the panel parsed the error body as a status
 * DTO, read `licensed` as `undefined`, and rendered "multi-till is not
 * licensed" — telling a licensed shop its licence was missing, with no error
 * shown anywhere. And `handleDisconnect` never checked `res.ok`, so a 403
 * rendered as a successful disconnect that silently did nothing.
 */
export function useLanStatus(): UseQueryResult<LanStatusDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LanStatusDTO, ApiError>({
    queryKey: ["lan", "status"],
    enabled: session !== null,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await request("/lan/status");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("devices.couldNotLoadTheConnected"), t));
      return res.json<LanStatusDTO>();
    },
  });
}

export function useLanSessions(enabled: boolean): UseQueryResult<LanSessionsListDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LanSessionsListDTO, ApiError>({
    queryKey: ["lan", "sessions"],
    enabled: session !== null && enabled,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await request("/lan/sessions");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("devices.couldNotLoadTheConnected"), t));
      return res.json<LanSessionsListDTO>();
    },
  });
}

export function useDisconnectLanSession() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (sessionId) => {
      const res = await request(`/lan/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      // A 403 used to render as a successful disconnect that did nothing.
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("devices.couldNotDisconnectTheDevice"), t));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["lan"] });
    },
  });
}

/**
 * LICENCE HEALTH AND THE LAN ADDRESS — desktop only, over the IPC bridge.
 *
 * Neither is reachable over `request()`: the licence diagnosis is made in the
 * Electron main process before the backend exists (and `GET /entitlements`
 * reports the API's own default capability set, not the desktop licence), and
 * the LAN socket's bound address lives on the handle the main process holds.
 * So both were invisible to every screen — an unlicensed or expired install
 * said nothing at all, and the address a till must be pointed at went only to a
 * console.
 *
 * The shapes are declared HERE rather than imported from apps/desktop, the same
 * way `transport.ts` and `settings/BackupRestorePage.tsx` declare theirs: the
 * web build must compile with no desktop package present.
 */
export type DesktopLicenceCode =
  | "LIC-OK"
  | "LIC-GRACE"
  | "LIC-MISSING"
  | "LIC-MALFORMED"
  | "LIC-INVALID"
  | "LIC-EXPIRED"
  | "LIC-CHECKIN"
  | "LIC-REVOKED"
  | "LIC-NOKEY"
  | "LIC-MACHINE"
  | "LIC-CLOCK"
  | "LIC-NOTYET";

export type DesktopLicenceStateDTO =
  | "ACTIVE"
  | "GRACE"
  | "READ_ONLY"
  | "INVALID"
  | "TAMPERED"
  | "NOT_YET_VALID"
  | "FINGERPRINT_MISMATCH"
  | "REVOKED"
  | "UNLICENSED";

export interface DesktopLicenceStatusDTO {
  readonly ok: true;
  readonly code: DesktopLicenceCode;
  /** Arabic, ready to render. */
  readonly messageAr: string;
  readonly plan: string;
  readonly seats: number;
  readonly expiresAt: string | null;
  /**
   * OPTIONAL, all of them, because a renderer must survive an older main
   * process: this bundle is served from disk by whatever desktop build is
   * installed, and a screen that assumed a field a previous build never sent
   * would render `undefined` into Arabic prose. Every consumer branches on
   * absence rather than defaulting.
   */
  /** The VERIFIED state the write gate runs under — the same reading, not a second one. */
  readonly state?: DesktopLicenceStateDTO;
  /** `CHECKIN_OVERDUE`, `MACHINE_NOT_BOUND`, `REVOKED`, … or null. */
  readonly reason?: string | null;
  readonly canWrite?: boolean;
  readonly seatsUsed?: number;
  readonly modules?: readonly string[];
  /**
   * The raw machine fingerprint, LTR and copyable. It is what support needs to
   * reissue a licence for a replacement machine, and there was no way to read
   * it anywhere in the product.
   */
  readonly fingerprint?: string | null;
  readonly daysSinceCheckin?: number | null;
  readonly licenceFilePath?: string;
  readonly appVersion?: string;
  readonly role?: "host" | "client";
  readonly databasePath?: string | null;
  readonly backupsDir?: string | null;
  /** Plaintext copies of the keys to the books, while they are still on disk. */
  readonly keyCardPath?: string | null;
  readonly plaintextArchivePath?: string | null;
  readonly lan: {
    readonly listening: boolean;
    /** `https://…`; null when the host has no address to give. Never a guess — say unknown. */
    readonly url: string | null;
    /**
     * `AB:CD:…` SHA-256 of the certificate the LAN socket presents. It is
     * self-signed and chain-validated by nothing, so a till pins THIS value;
     * comparing it once, in the shop, is the whole defence against a laptop
     * answering on the host's address. Null when unknown — never a filler.
     */
    readonly fingerprintSha256: string | null;
  };
}

export interface DesktopLicenceFailureDTO {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type DesktopLicenceResultDTO = DesktopLicenceStatusDTO | DesktopLicenceFailureDTO;

interface DesktopLicenceBridge {
  status(sessionToken: string): Promise<DesktopLicenceResultDTO>;
}

function desktopLicenceBridge(): DesktopLicenceBridge | undefined {
  return (globalThis as { mezan?: { licence?: DesktopLicenceBridge } }).mezan?.licence;
}

/**
 * True on the desktop edition, which is the only one that holds a licence file
 * or binds a LAN socket. A screen must branch on this BEFORE it says anything
 * about either: on the browser build the honest answer is "only the host
 * machine knows", not a rendering of an absent fact.
 */
export function isDesktopHost(): boolean {
  return desktopLicenceBridge() !== undefined;
}

export function useDesktopLicence(): UseQueryResult<DesktopLicenceResultDTO, ApiError> {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const token = session?.token ?? null;
  return useQuery<DesktopLicenceResultDTO, ApiError>({
    queryKey: ["licence", "status"],
    enabled: token !== null && isDesktopHost(),
    // The LAN bind is asynchronous (main/lan-host.ts), so a screen opened
    // during startup is legitimately told "no address yet". Without a refetch
    // that honest answer would stay on screen after the socket came up.
    refetchInterval: 15_000,
    queryFn: async () => {
      const bridge = desktopLicenceBridge();
      // Unreachable while `enabled` holds; a thrown ApiError renders as the
      // error it is rather than resolving to a shape the screen would read as
      // an answer.
      if (!bridge || !token) throw new ApiError(0, t("licence.couldNotBeRead"));
      return bridge.status(token);
    },
  });
}

/**
 * Clears a failed-login lockout.
 *
 * The lockout had no way out inside the product: an account was locked for up
 * to fifteen minutes with no admin recourse, and the only workaround — that
 * restarting the desktop app drops the in-memory throttle — was an accident of
 * the implementation, undocumented, and took the whole shop offline to use.
 */
export function useUnlockUser() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean; userId: string }, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/users/${encodeURIComponent(id)}/unlock`, { method: "POST", body: JSON.stringify({}) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccountCouldNotBeUnlocked"), t));
      return res.json<{ ok: boolean; userId: string }>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/**
 * «محو البيانات الشخصية» (D348) — the erasure the store listings promise.
 *
 * The response says what was kept and why, so the screen can tell the person
 * who asked rather than implying the account vanished.
 */
export function useEraseUser() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<UserErasureResultDTO, ApiError, { id: string; body: EraseUserDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/users/${encodeURIComponent(id)}/erase`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("users.erase.failed"), t));
      return res.json<UserErasureResultDTO>();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      void queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useNotificationRules(): UseQueryResult<NotificationRuleDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<NotificationRuleDTO[], ApiError>({
    queryKey: ["notification-rules"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/notification-rules");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.notificationRulesCouldNotBe"), t));
      return res.json<NotificationRuleDTO[]>();
    },
  });
}

export function useCreateNotificationRule() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, CreateNotificationRuleDTO>({
    mutationFn: async (body) => {
      const res = await request("/notification-rules", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRuleCouldNotBe"), t));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useUpdateNotificationRule() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, { id: string; body: UpdateNotificationRuleDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/notification-rules/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRuleCouldNotBe2"), t));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useSetNotificationRuleActive() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationRuleDTO, ApiError, { id: string; active: boolean }>({
    mutationFn: async ({ id, active }) => {
      const res = await request(`/notification-rules/${id}/${active ? "activate" : "deactivate"}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRuleSStatusCould"), t));
      return res.json<NotificationRuleDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

export function useDeleteNotificationRule() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notification-rules/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new ApiError(res.status, await readError(res, t("api.theRuleCouldNotBe3"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-rules"] }),
  });
}

/** The current user's own notifications (top-bar bell panel) — real data off `/notifications`. */
export function useNotifications(status?: "unread" | "read"): UseQueryResult<NotificationDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<NotificationDTO[], ApiError>({
    queryKey: ["notifications", status ?? "all"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const qs = status ? `?status=${status}&limit=50` : "?limit=50";
      const res = await request(`/notifications${qs}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.notificationsCouldNotBeLoaded"), t));
      return res.json<NotificationDTO[]>();
    },
  });
}

export function useUnreadNotificationCount(): UseQueryResult<number, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<number, ApiError>({
    queryKey: ["notifications", "unread-count"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/notifications/unread-count");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theNotificationCountCouldNot"), t));
      const body = await res.json<{ count: number }>();
      return body.count;
    },
  });
}

export function useMarkNotificationRead() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<NotificationDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/notifications/${id}/read`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theNotificationCouldNotBe"), t));
      return res.json<NotificationDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      const res = await request("/notifications/read-all", { method: "POST" });
      if (!res.ok && res.status !== 204) throw new ApiError(res.status, await readError(res, t("api.theyCouldNotAllBe"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/* ------------------------------------------------------------------ */
/* قوالب الطباعة (Print Templates) — docs/archive/catalog/09 §"قوالب الطباعة"    */
/* ------------------------------------------------------------------ */

/** The tenant's saved print-template config, or the shared default if none was saved yet. */
export function usePrintTemplateConfig(): UseQueryResult<PrintTemplateConfigDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PrintTemplateConfigDTO, ApiError>({
    queryKey: ["print-template-config"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/print-template-config");
      if (!res.ok) throw await loaderError(res, t("api.thePrintTemplateCouldNot"), t);
      return res.json<PrintTemplateConfigDTO>();
    },
  });
}

export interface SalesInvoicePrintContextDTO {
  readonly branchName: string | null;
  readonly warehouseName: string | null;
  readonly customer: { readonly code: string; readonly taxNumber: string | null; readonly address: string | null; readonly phone: string | null } | null;
  readonly etaUuid: string | null;
  readonly etaQrValue: string | null;
}

export function useSalesInvoicePrintContext(invoiceId: string): UseQueryResult<SalesInvoicePrintContextDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SalesInvoicePrintContextDTO, ApiError>({
    queryKey: ["sales-invoices", "print-context", invoiceId],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/sales-invoices/${encodeURIComponent(invoiceId)}/print-context`);
      if (!res.ok) throw await loaderError(res, t("api.thePrintTemplateCouldNot"), t);
      return res.json<SalesInvoicePrintContextDTO>();
    },
  });
}

export function useSavePrintTemplateConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PrintTemplateConfigDTO, ApiError, PrintTemplateConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/print-template-config", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePrintTemplateCouldNot2"), t));
      return res.json<PrintTemplateConfigDTO>();
    },
    onSuccess: (config) => queryClient.setQueryData(["print-template-config"], config),
  });
}

/* ------------------------------------------------------------------ */
/* نقل البيانات (Data Migration wizard) — docs/archive/catalog/09 §"نقل البيانات" */
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
  /** P-5 — how many accounts the chart already holds. */
  readonly accounts: number;
  readonly salesInvoices: number;
  readonly salesReturns: number;
  readonly purchaseInvoices: number;
  readonly purchaseReturns: number;
}

/**
 * The step ids `createDataMigrationRoutes` (packages/api) exposes preview/commit
 * for. The last four are P-5: the chart, the opening trial balance, and the
 * open AR/AP a migrating shop is actually owed and actually owes.
 */
export type DataMigrationMasterStep =
  | "departments"
  | "employees"
  | "treasury-accounts"
  | "suppliers"
  | "customers"
  | "items"
  | "item-units"
  | "asset-categories"
  | "assets"
  | "chart-of-accounts"
  | "opening-trial-balance"
  | "open-customer-invoices"
  | "open-supplier-invoices";

export function useDataMigrationStatus(): UseQueryResult<DataMigrationStatusDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<DataMigrationStatusDTO, ApiError>({
    queryKey: ["data-migration", "status"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/data-migration/status");
      if (!res.ok) throw await loaderError(res, t("api.theDataMigrationStatusCould"), t);
      return res.json<DataMigrationStatusDTO>();
    },
  });
}

/** Dry-run (no persistence) validation for one master-data step's parsed rows. */
export function useDataMigrationPreview(step: DataMigrationMasterStep) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<DataMigrationStepResultDTO, ApiError, readonly Record<string, string>[]>({
    mutationFn: async (rows) => {
      const res = await request(`/data-migration/${step}/preview`, { method: "POST", body: JSON.stringify({ rows }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFileCouldNotBe"), t));
      return res.json<DataMigrationStepResultDTO>();
    },
  });
}

/** All-or-nothing commit for one master-data step's parsed rows — nothing persists unless every row validates. */
export function useDataMigrationCommit(step: DataMigrationMasterStep) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DataMigrationStepResultDTO, ApiError, readonly Record<string, string>[]>({
    mutationFn: async (rows) => {
      const res = await request(`/data-migration/${step}/commit`, { method: "POST", body: JSON.stringify({ rows }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theImportCouldNotBe"), t));
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<HistoricalImportResultDTO, ApiError, readonly HistoricalImportRowDTO[]>({
    mutationFn: async (rows) => {
      const res = await request(`/${kind}/historical-import/preview`, {
        method: "POST",
        body: JSON.stringify(toHistoricalImportWireBody(kind, rows)),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theFileCouldNotBe"), t));
      return res.json<HistoricalImportResultDTO>();
    },
  });
}

export function useHistoricalImportCommit(kind: HistoricalImportKind) {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<HistoricalImportResultDTO, ApiError, readonly HistoricalImportRowDTO[]>({
    mutationFn: async (rows) => {
      const res = await request(`/${kind}/historical-import/commit`, {
        method: "POST",
        body: JSON.stringify(toHistoricalImportWireBody(kind, rows)),
      });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theImportCouldNotBe"), t));
      return res.json<HistoricalImportResultDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["data-migration", "status"] }),
  });
}

/* -------------------------------------------------------------------- */
/* w8/workflow-ui — إعدادات الموافقات chain-builder + الموافقات inbox    */
/* (docs/archive/catalog/09 §سير العمل), off the real /workflow API.             */
/* -------------------------------------------------------------------- */

/** إعدادات الموافقات — the persisted approval-chain config per action type. */
export function useWorkflowConfigs(): UseQueryResult<WorkflowConfigDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<WorkflowConfigDTO[], ApiError>({
    queryKey: ["workflow-configs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/workflow/configs");
      if (!res.ok) throw await loaderError(res, t("api.workflowSettingsCouldNotBe"), t);
      return res.json<WorkflowConfigDTO[]>();
    },
  });
}

export function useCreateWorkflowConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDTO, ApiError, CreateWorkflowConfigDTO>({
    mutationFn: async (body) => {
      const res = await request("/workflow/configs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkflowCouldNotBe"), t));
      return res.json<WorkflowConfigDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-configs"] }),
  });
}

export function useUpdateWorkflowConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<WorkflowConfigDTO, ApiError, { id: string; body: UpdateWorkflowConfigDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/workflow/configs/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkflowCouldNotBe"), t));
      return res.json<WorkflowConfigDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workflow-configs"] }),
  });
}

export function useDeleteWorkflowConfig() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/workflow/configs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theWorkflowCouldNotBe2"), t));
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
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: ["workflow-requests", "pending"],
    enabled: session !== null,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/workflow/requests/pending");
      if (!res.ok) throw await loaderError(res, t("api.pendingApprovalsCouldNotBe"), t);
      return res.json<ApprovalRequestDTO[]>();
    },
  });
}

/** طلباتي — approval requests this user submitted, whatever their state. */
export function useMyApprovalRequests(): UseQueryResult<ApprovalRequestDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: ["workflow-requests", "mine"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/workflow/requests/mine");
      if (!res.ok) throw await loaderError(res, t("api.pendingApprovalsCouldNotBe"), t);
      return res.json<ApprovalRequestDTO[]>();
    },
  });
}

/** إجراءاتي — requests this user has already approved, rejected or sent back. */
export function useMyApprovalDecisions(): UseQueryResult<ApprovalRequestDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ApprovalRequestDTO[], ApiError>({
    queryKey: ["workflow-requests", "acted"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/workflow/requests/acted");
      if (!res.ok) throw await loaderError(res, t("api.pendingApprovalsCouldNotBe"), t);
      return res.json<ApprovalRequestDTO[]>();
    },
  });
}

/** The shell's global pending-count badge on the الموافقات nav item. */
export function usePendingApprovalCount(): UseQueryResult<number, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<number, ApiError>({
    queryKey: ["workflow-requests", "pending-count"],
    enabled: sessionMayAsk(session, ShellRequest.PendingApprovals),
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await request("/workflow/requests/pending-count");
      if (!res.ok) throw await loaderError(res, t("api.thePendingApprovalCountCould"), t);
      const body = await res.json<{ count: number }>();
      return body.count;
    },
  });
}

/** Submits a new approval request for a gateable action type (POST /workflow/requests). */
export function useSubmitApproval() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, SubmitApprovalRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/workflow/requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theApprovalRequestCouldNot"), t));
      return res.json<ApprovalRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-requests"] });
    },
  });
}

/** موافقة / رفض / طلب تعديل — the inbox's three per-row actions (POST /workflow/requests/:id/decide). */
export function useDecideApproval() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ApprovalRequestDTO, ApiError, { id: string; body: DecideApprovalRequestDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/workflow/requests/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDecisionCouldNotBe"), t));
      return res.json<ApprovalRequestDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-requests"] });
    },
  });
}


/* -------------------------------------------------------------------- */
/* كتالوجات الأصناف — units + categories (docs/archive/catalog/03)               */
/* -------------------------------------------------------------------- */

/** وحدات القياس — the unit records an item's `baseUnitCode` resolves against. */
export function useItemUnits(): UseQueryResult<ItemUnitDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemUnitDTO[], ApiError>({
    queryKey: ["item-units"],
    enabled: sessionMayRead(session, DocumentReadPermission.Items),
    queryFn: async () => {
      const res = await request("/item-units");
      if (!res.ok) throw await loaderError(res, t("api.unitsOfMeasureCouldNot"), t);
      return res.json<ItemUnitDTO[]>();
    },
  });
}

export function useCreateItemUnit() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, CreateItemUnitDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-units", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theUnitOfMeasureCould"), t));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

export function useUpdateItemUnit() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemUnitDTO, ApiError, { code: string; patch: UpdateItemUnitDTO }>({
    mutationFn: async ({ code, patch }) => {
      const res = await request(`/item-units/${code}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theUnitOfMeasureCould2"), t));
      return res.json<ItemUnitDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-units"] }),
  });
}

/** تصنيفات الأصناف — the category records an item's `categoryId` resolves against. */
export function useItemCategories(): UseQueryResult<ItemCategoryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemCategoryDTO[], ApiError>({
    queryKey: ["item-categories"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-categories");
      if (!res.ok) throw await loaderError(res, t("api.itemCategoriesCouldNotBe"), t);
      return res.json<ItemCategoryDTO[]>();
    },
  });
}

/** العلامات التجارية (R5.10) — the brand an item points at, by id. */
export function useItemBrands(): UseQueryResult<ItemBrandDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemBrandDTO[], ApiError>({
    queryKey: ["item-brands"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-brands");
      if (!res.ok) throw await loaderError(res, t("api.itemCategoriesCouldNotBe"), t);
      return res.json<ItemBrandDTO[]>();
    },
  });
}

/** المواسم (R5.10). */
export function useItemSeasons(): UseQueryResult<ItemSeasonDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemSeasonDTO[], ApiError>({
    queryKey: ["item-seasons"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/item-seasons");
      if (!res.ok) throw await loaderError(res, t("api.itemCategoriesCouldNotBe"), t);
      return res.json<ItemSeasonDTO[]>();
    },
  });
}

export function useCreateItemCategory() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, CreateItemCategoryDTO>({
    mutationFn: async (body) => {
      const res = await request("/item-categories", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCategoryCouldNotBe"), t));
      return res.json<ItemCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-categories"] }),
  });
}

export function useUpdateItemCategory() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<ItemCategoryDTO, ApiError, { id: string; patch: UpdateItemCategoryDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/item-categories/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCategoryCouldNotBe2"), t));
      return res.json<ItemCategoryDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["item-categories"] }),
  });
}

/* ------------------------------------------------------------------ */
/* الحضور والانصراف / الإجازات — attendance, policies, balances, accrual */
/* ------------------------------------------------------------------ */

export interface AttendanceFilters {
  readonly employeeId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly status?: string | null;
}

function attendanceQueryString(filters: AttendanceFilters): string {
  const params = new URLSearchParams();
  if (filters.employeeId) params.set("employeeId", filters.employeeId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function useAttendance(filters: AttendanceFilters): UseQueryResult<AttendanceEntryDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AttendanceEntryDTO[], ApiError>({
    queryKey: ["hr-attendance", filters],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/attendance${attendanceQueryString(filters)}`);
      if (!res.ok) throw await loaderError(res, t("api.theAttendanceRecordCouldNot"), t);
      return res.json<AttendanceEntryDTO[]>();
    },
  });
}

export function useAttendanceSummary(employeeId: string | null, from: string, to: string): UseQueryResult<AttendanceSummaryDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AttendanceSummaryDTO, ApiError>({
    queryKey: ["hr-attendance-summary", employeeId, from, to],
    enabled: session !== null,
    queryFn: async () => {
      const scope = employeeId === null ? "" : `employeeId=${encodeURIComponent(employeeId)}&`;
      const res = await request(`/hr/attendance/summary?${scope}from=${from}&to=${to}`);
      if (!res.ok) throw await loaderError(res, t("api.theAttendanceSummaryCouldNot"), t);
      return res.json<AttendanceSummaryDTO>();
    },
  });
}

export function useRecordAttendance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AttendanceEntryDTO, ApiError, RecordAttendanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/attendance", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.attendanceCouldNotBeRecorded"), t));
      return res.json<AttendanceEntryDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["hr-attendance-summary"] });
    },
  });
}

export function useCorrectAttendance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AttendanceEntryDTO, ApiError, { id: string; body: CorrectAttendanceDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/attendance/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAttendanceRecordCouldNot2"), t));
      return res.json<AttendanceEntryDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["hr-attendance-summary"] });
    },
  });
}

/** Pure dry-run over an uploaded attendance-device CSV — no persistence at all. */
export function useAttendanceImportPreview() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<AttendanceImportPreviewDTO, ApiError, AttendanceImportRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/attendance/import/preview", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("attendance.import.previewFailed"), t));
      return res.json<AttendanceImportPreviewDTO>();
    },
  });
}

/** Commits every ready group from the last preview — idempotent per (employee, date). */
export function useAttendanceImportCommit() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AttendanceImportCommitResultDTO, ApiError, AttendanceImportRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/attendance/import/commit", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("attendance.import.commitFailed"), t));
      return res.json<AttendanceImportCommitResultDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["hr-attendance-summary"] });
    },
  });
}

export function useLeavePolicies(): UseQueryResult<LeavePolicyDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeavePolicyDTO[], ApiError>({
    queryKey: ["hr-leave-policies"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/leave-policies");
      if (!res.ok) throw await loaderError(res, t("api.leavePoliciesCouldNotBe"), t);
      return res.json<LeavePolicyDTO[]>();
    },
  });
}

export function useLeavePolicyPresets(): UseQueryResult<LeavePolicyPresetDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeavePolicyPresetDTO[], ApiError>({
    queryKey: ["hr-leave-policy-presets"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/leave-policies/presets");
      if (!res.ok) throw await loaderError(res, t("api.thePresetsCouldNotBe"), t);
      return res.json<LeavePolicyPresetDTO[]>();
    },
  });
}

export function useCreateLeavePolicy() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeavePolicyDTO, ApiError, CreateLeavePolicyDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/leave-policies", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeavePolicyCouldNot"), t));
      return res.json<LeavePolicyDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-leave-policies"] }),
  });
}

export function useUpdateLeavePolicy() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeavePolicyDTO, ApiError, { id: string; body: UpdateLeavePolicyDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/leave-policies/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeavePolicyCouldNot2"), t));
      return res.json<LeavePolicyDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-leave-policies"] }),
  });
}

export function useDeleteLeavePolicy() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/leave-policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeavePolicyCouldNot3"), t));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-leave-policies"] }),
  });
}

export function useApplyLeavePolicyPreset() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeavePolicyDTO[], ApiError, string>({
    mutationFn: async (presetCode) => {
      const res = await request("/hr/leave-policies/apply-preset", { method: "POST", body: JSON.stringify({ presetCode }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePresetCouldNotBe"), t));
      return res.json<LeavePolicyDTO[]>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-leave-policies"] }),
  });
}

export function useLeaveBalances(employeeId: string | null, year: number): UseQueryResult<LeaveBalanceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeaveBalanceDTO[], ApiError>({
    queryKey: ["hr-leave-balances", employeeId, year],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(year) });
      if (employeeId) params.set("employeeId", employeeId);
      const res = await request(`/hr/leave-balances?${params.toString()}`);
      if (!res.ok) throw await loaderError(res, t("api.leaveBalancesCouldNotBe"), t);
      return res.json<LeaveBalanceDTO[]>();
    },
  });
}

export function useUpsertLeaveBalance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<LeaveBalanceDTO, ApiError, UpsertLeaveBalanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/leave-balances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theLeaveBalanceCouldNot"), t));
      return res.json<LeaveBalanceDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-leave-balances"] }),
  });
}

export function useLeaveAccrualBatches(runType: string | null): UseQueryResult<LeaveAccrualBatchDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeaveAccrualBatchDTO[], ApiError>({
    queryKey: ["hr-leave-accrual-batches", runType],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/leave-accrual-batches${runType ? `?runType=${runType}` : ""}`);
      if (!res.ok) throw await loaderError(res, t("api.accrualBatchesCouldNotBe"), t);
      return res.json<LeaveAccrualBatchDTO[]>();
    },
  });
}

export interface RunLeaveAccrualResultDTO {
  readonly batch: LeaveAccrualBatchDTO;
  readonly created: boolean;
}

export function useRunLeaveAccrual() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<RunLeaveAccrualResultDTO, ApiError, RunLeaveAccrualDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/leave-accrual-batches/run", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theAccrualBatchCouldNot"), t));
      return res.json<RunLeaveAccrualResultDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leave-accrual-batches"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-balances"] });
    },
  });
}

export interface LeaveRequestFilters {
  readonly employeeId?: string | null;
  readonly status?: string | null;
  readonly leaveType?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
}

export function useLeaveRequests(filters: LeaveRequestFilters): UseQueryResult<LeaveRequestDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeaveRequestDTO[], ApiError>({
    queryKey: ["hr-leave-requests", filters],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.employeeId) params.set("employeeId", filters.employeeId);
      if (filters.status) params.set("status", filters.status);
      if (filters.leaveType) params.set("leaveType", filters.leaveType);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      const query = params.toString();
      const res = await request(`/hr/leave-requests${query === "" ? "" : `?${query}`}`);
      if (!res.ok) throw await loaderError(res, t("api.leaveRequestsCouldNotBe"), t);
      return res.json<LeaveRequestDTO[]>();
    },
  });
}

export interface LeaveRequestCountsDTO {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
  readonly cancelled: number;
}

export function useLeaveRequestCounts(): UseQueryResult<LeaveRequestCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<LeaveRequestCountsDTO, ApiError>({
    queryKey: ["hr-leave-request-counts"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/leave-requests/counts");
      if (!res.ok) throw await loaderError(res, t("api.theLeaveRequestSummaryCould"), t);
      return res.json<LeaveRequestCountsDTO>();
    },
  });
}

export interface DecideLeaveRequestResultDTO {
  readonly held: boolean;
  readonly workflowRequestId: string | null;
  readonly requiredRole?: string | null;
  readonly request: LeaveRequestDTO;
}

export function useDecideLeaveRequest() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<DecideLeaveRequestResultDTO, ApiError, { id: string; decision: "approved" | "rejected"; comment?: string | null }>({
    mutationFn: async ({ id, decision, comment }) => {
      const path = decision === "approved" ? "approve" : "reject";
      const res = await request(`/hr/leave-requests/${id}/${path}`, { method: "POST", body: JSON.stringify({ decision, comment: comment ?? null }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theDecisionOnThisLeave"), t));
      return res.json<DecideLeaveRequestResultDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hr-leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-request-counts"] });
      queryClient.invalidateQueries({ queryKey: ["hr-leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["hr-my-leave"] });
    },
  });
}

/**
 * توجيه الحسابات (R6.1) — where each kind of posting lands. Always returns
 * every slot resolved, so the screen can show where things currently post
 * rather than only what a tenant has already changed.
 */
export function useAccountRouting(): UseQueryResult<AccountRoutingDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AccountRoutingDTO, ApiError>({
    queryKey: ["account-routing"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/accounting/account-routing");
      if (!res.ok) throw await loaderError(res, t("api.theChartOfAccountsCould"), t);
      return res.json<AccountRoutingDTO>();
    },
  });
}

export function useUpdateAccountRouting() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<AccountRoutingDTO, ApiError, UpdateAccountRoutingDTO>({
    mutationFn: async (body) => {
      const res = await request("/accounting/account-routing", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theChartOfAccountsCould"), t));
      return res.json<AccountRoutingDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-routing"] });
    },
  });
}

/** مجموعات الضرائب (R6.4) — carries the per-member breakdown, never one melted total. */
export function useTaxGroups(): UseQueryResult<TaxGroupDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<TaxGroupDTO[], ApiError>({
    queryKey: ["tax-groups"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/tax-groups");
      if (!res.ok) throw await loaderError(res, t("api.taxesCouldNotBeLoaded"), t);
      return res.json<TaxGroupDTO[]>();
    },
  });
}

export function useCreateTaxGroup() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<TaxGroupDTO, ApiError, UpsertTaxGroupDTO>({
    mutationFn: async (body) => {
      const res = await request("/tax-groups", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.taxesCouldNotBeLoaded"), t));
      return res.json<TaxGroupDTO>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-groups"] });
    },
  });
}

/* -------------------------------------------------------------------- */
/* الإعدادات — البريد الإلكتروني (R11.6)                                   */
/* -------------------------------------------------------------------- */

/** Sends a REAL test message through the configured SMTP server and reports what it said. */
export function useSendTestEmail() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<TestEmailResultDTO, ApiError, { to: string }>({
    mutationFn: async (body) => {
      const res = await request("/settings/email/test", { method: "POST", body: JSON.stringify(body) });
      const payload = await res.json<TestEmailResultDTO>();
      if (payload?.message === undefined) throw new ApiError(res.status, withSupportCode(t("api.settingsCouldNotBeSaved"), res.status, t));
      return payload;
    },
  });
}

export interface ItemAvailabilityDTO {
  readonly itemId: string;
  readonly warehouseId: string;
  readonly onHand: string;
  readonly showOtherWarehouseStock: boolean;
  readonly otherWarehouses: readonly { readonly warehouseId: string; readonly onHand: string }[];
}

/**
 * On-hand for one item in the document's warehouse, plus what the OTHER
 * warehouses hold — the latter only when the tenant's عرض المخزون في المستودعات
 * الأخرى is on, which the server decides, not the screen.
 */
export function useItemAvailability(itemId: string, warehouseId: string): UseQueryResult<ItemAvailabilityDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ItemAvailabilityDTO, ApiError>({
    queryKey: ["inventory-availability", itemId, warehouseId],
    enabled: session !== null && itemId !== "" && warehouseId !== "",
    queryFn: async () => {
      const res = await request(`/inventory/availability?itemId=${encodeURIComponent(itemId)}&warehouseId=${encodeURIComponent(warehouseId)}`);
      if (!res.ok) throw await loaderError(res, t("api.itemAvailabilityCouldNotBe"), t);
      return res.json<ItemAvailabilityDTO>();
    },
  });
}

/** The currencies a document is allowed to carry — the read side of تفعيل تعدد العملات. */
export function useAllowedCurrencies(): UseQueryResult<AllowedCurrenciesDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AllowedCurrenciesDTO, ApiError>({
    queryKey: ["settings", "currencies"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/settings/currencies");
      if (!res.ok) throw await loaderError(res, t("api.settingsCouldNotBeLoaded"), t);
      return res.json<AllowedCurrenciesDTO>();
    },
  });
}

/* -------------------------------------------------------------------- */
/* سجل التدقيق لكيان واحد                                                 */
/* -------------------------------------------------------------------- */

/**
 * One entity's own audit trail. Selectable at all only because the audit event
 * now carries `entityId`; before that the trail could be filtered by TYPE but
 * never down to a single customer, item or document.
 */
export function useEntityAudit(entityType: string, entityId: string): UseQueryResult<AuditEventDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<AuditEventDTO[], ApiError>({
    queryKey: ["entity-audit", entityType, entityId],
    enabled: session !== null && entityId !== "",
    queryFn: async () => {
      const res = await request(
        `/audit?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&limit=100`,
      );
      if (!res.ok) throw await loaderError(res, t("api.auditCouldNotBeLoaded"), t);
      const body = await res.json<{ events?: AuditEventDTO[] } | AuditEventDTO[]>();
      return Array.isArray(body) ? body : (body.events ?? []);
    },
  });
}

/**
 * Per-line delivery for one purchase invoice (R4.4) — invoiced, received,
 * consumed and still-in-stock, derived server-side from the cost layers the
 * funding document created.
 */
export function usePurchaseInvoiceFulfilment(invoiceId: string | null): UseQueryResult<PurchaseInvoiceFulfilmentDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PurchaseInvoiceFulfilmentDTO, ApiError>({
    queryKey: ["purchase-invoices", "fulfilment", invoiceId],
    enabled: session !== null && invoiceId !== null,
    queryFn: async () => {
      const res = await request(`/purchases/invoices/${encodeURIComponent(invoiceId ?? "")}/fulfilment`);
      if (!res.ok) throw await loaderError(res, t("api.purchaseInvoicesCouldNotBe"), t);
      return res.json<PurchaseInvoiceFulfilmentDTO>();
    },
  });
}

/** سداد للمورد straight off the invoice — a real سند صرف, so the treasury and the ledger moved too. */
export function usePayPurchaseInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PurchaseInvoiceDTO & { voucherId: string; voucherNo: string | null }, ApiError, { id: string } & PurchaseInvoicePaymentDTO>({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/purchases/invoices/${id}/payments`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePaymentCouldNotBe"), t));
      return res.json<PurchaseInvoiceDTO & { voucherId: string; voucherNo: string | null }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["open-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface StockMovementRowDTO {
  readonly id: string;
  readonly itemId: string;
  readonly warehouseId: string;
  readonly direction: string;
  readonly qty: string;
  readonly unitCost: string;
  readonly sourceDocType: string | null;
  readonly sourceDocId: string | null;
  readonly sourceDocNumber: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
}

/**
 * Every movement of one item across every warehouse it sits in. The endpoint is
 * per (item, warehouse), so the warehouses come from the item's own positions
 * and the results are merged here — asking for a warehouse the item has never
 * been in would only return an empty list.
 */
export function useItemMovements(
  itemId: string | null,
  warehouseIds: readonly string[],
): UseQueryResult<StockMovementRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StockMovementRowDTO[], ApiError>({
    queryKey: ["item-movements", itemId, [...warehouseIds].sort()],
    enabled: session !== null && itemId !== null && warehouseIds.length > 0,
    queryFn: async () => {
      const pages = await Promise.all(
        warehouseIds.map(async (warehouseId) => {
          const res = await request(
            `/inventory/movements?itemId=${encodeURIComponent(itemId ?? "")}&warehouseId=${encodeURIComponent(warehouseId)}`,
          );
          if (!res.ok) throw await loaderError(res, t("api.stockMovementsCouldNotBe"), t);
          return res.json<StockMovementRowDTO[]>();
        }),
      );
      return pages
        .flat()
        .sort((a, b) => (a.occurredAt === b.occurredAt ? a.id.localeCompare(b.id) : b.occurredAt.localeCompare(a.occurredAt)));
    },
  });
}

/** الأقسام التي لم يُنشأ لها مركز تكلفة بعد — the "create from departments" candidates (R6.7). */
export function useImportableDepartments(): UseQueryResult<ImportableDepartmentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ImportableDepartmentDTO[], ApiError>({
    queryKey: ["cost-centers", "importable-departments"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/cost-centers/importable-departments");
      if (!res.ok) throw await loaderError(res, t("api.costCentresCouldNotBe"), t);
      return res.json<ImportableDepartmentDTO[]>();
    },
  });
}

/** إنشاء مراكز تكلفة من الأقسام — one cost centre per selected department. */
export function useCreateCostCentersFromDepartments() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<{ created: CostCenterDTO[]; skipped: string[] }, ApiError, CreateCostCentersFromDepartmentsDTO>({
    mutationFn: async (body) => {
      const res = await request("/cost-centers/from-departments", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theCostCentreCouldNot"), t));
      return res.json<{ created: CostCenterDTO[]; skipped: string[] }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-centers"] });
      queryClient.invalidateQueries({ queryKey: ["cost-center-pl"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Sales parity — R3.8 / R3.9 / R3.11 / R3.12 / R3.13
// ---------------------------------------------------------------------------

/** Rewrites a price list, including its minimum-quantity tier grid (R3.11). */
export function useUpdatePriceList() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PriceListDTO, ApiError, { id: string; patch: UpdatePriceListDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/price-lists/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePriceListCouldNot"), t));
      return res.json<PriceListDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["price-lists"] }),
  });
}

export interface ResolvedPriceListPrice {
  readonly price: string;
  readonly priceListId: string | null;
  readonly tierMinQty: string | null;
  readonly fromPriceList: boolean;
}

/**
 * Asks the SERVER which minimum-quantity tier a line lands on. The tier an
 * invoice is measured against on confirm is resolved server-side, so a screen
 * that worked it out in the browser could disagree with the books.
 */
export function useResolvePriceListPrice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<ResolvedPriceListPrice, ApiError, ResolvePriceListPriceDTO>({
    mutationFn: async (body) => {
      const res = await request("/price-lists/resolve-price", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.priceListsCouldNotBe"), t));
      return res.json<ResolvedPriceListPrice>();
    },
  });
}

/** أرصدة العملاء والموردين حسب العملة (R1.16) — per-currency AR/AP, base and transaction. */
export function usePartyBalancesByCurrency(): UseQueryResult<PartyCurrencyBalanceReportDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PartyCurrencyBalanceReportDTO, ApiError>({
    queryKey: ["gl", "balances-by-currency"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/gl/balances-by-currency");
      if (!res.ok) throw await loaderError(res, t("api.balancesByCurrencyCouldNot"), t);
      return res.json<PartyCurrencyBalanceReportDTO>();
    },
  });
}

/**
 * «مرتجع من فاتورة» — the server reads every price, cost, tax share and
 * returnable quantity off the source invoice, so this sends only the invoice
 * and a quantity (and a reason) per item.
 */
export function useCreateSalesReturnFromInvoice() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<SalesReturnDocumentDTO, ApiError, BuildSalesReturnFromInvoiceDTO>({
    mutationFn: async (body) => {
      const res = await request("/sales-returns/from-invoice", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await codedError(res, t("api.theSalesReturnCouldNot"), t);
      return res.json<SalesReturnDocumentDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales-returns"] }),
  });
}

/**
 * «استرداد للعميل» — a real سند صرف, so the treasury and the ledger both moved
 * and their views are stale too.
 */
export function useRefundSalesReturn() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<
    SalesReturnDocumentDTO & { voucherId: string; voucherNo: string | null },
    ApiError,
    { id: string } & RefundSalesReturnDTO
  >({
    mutationFn: async ({ id, ...body }) => {
      const res = await request(`/sales-returns/${id}/refund`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theRefundCouldNotBe"), t));
      return res.json<SalesReturnDocumentDTO & { voucherId: string; voucherNo: string | null }>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-returns"] });
      queryClient.invalidateQueries({ queryKey: ["vouchers"] });
      queryClient.invalidateQueries({ queryKey: ["treasury-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * المركبات (R3.13) — the van registry. Every van names the warehouse its stock
 * sits in and the till its cash sits in, which is what the trip form cascades
 * from; the server resolves the same pair from this registry, so the browser
 * can never open a trip on a combination the registry does not hold.
 */
export function useVans(): UseQueryResult<VanDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<VanDTO[], ApiError>({
    queryKey: ["field-vans"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/field/vans");
      if (!res.ok) throw await loaderError(res, t("api.vansCouldNotBeLoaded"), t);
      return res.json<VanDTO[]>();
    },
  });
}

/** Edits a promotion — cap, priority, minimum quantity, bundle components (R3.12). */
export function useUpdatePromotion() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<PromotionDTO, ApiError, { id: string; patch: UpdatePromotionDTO }>({
    mutationFn: async ({ id, patch }) => {
      const res = await request(`/promotions/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.thePromotionCouldNotBe"), t));
      return res.json<PromotionDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["promotions"] }),
  });
}

export interface TreasuryAccountStatsDTO {
  readonly count: number;
  readonly active: number;
  readonly inactive: number;
  readonly openingTotal: string;
  readonly openingCash: string;
  readonly openingBank: string;
  /** Absent when no ledger is wired — "not measured", never zero. */
  readonly liveTotal?: string;
  readonly liveCash?: string;
  readonly liveBank?: string;
}

/**
 * The treasury strip's figures, computed over the whole filtered set (R1.1).
 * The live figures come from the GL, because a treasury account's balance IS
 * its control account's balance.
 */
export function useTreasuryAccountStats(): UseQueryResult<TreasuryAccountStatsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<TreasuryAccountStatsDTO, ApiError>({
    queryKey: ["treasury-accounts", "stats"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/treasury-accounts/stats");
      if (!res.ok) throw await loaderError(res, t("api.treasuryAccountsCouldNotBe"), t);
      return res.json<TreasuryAccountStatsDTO>();
    },
  });
}
