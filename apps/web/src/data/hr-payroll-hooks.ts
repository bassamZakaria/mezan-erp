import { ENGLISH_LOCALE } from "@mezan/ui";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateEmployeeAdvanceDTO,
  CreatePayrollComponentDTO,
  CreatePayrollRunDTO,
  PayrollComponentDTO,
  UpdatePayrollComponentDTO,
  EmployeeAdvanceBalanceDTO,
  EmployeeAdvanceDTO,
  PayrollRunDTO,
  PayrollRunDetailDTO,
  PayslipDTO,
  TreasuryDisbursementDTO,
  GarnishmentDTO,
  CreateGarnishmentDTO,
  PayrollStatutoryFlagDTO,
  SetPayrollStatutoryFlagDTO,
  SocialInsuranceYearOverrideDTO,
} from "@mezan/contracts";
import { ScreenRequest } from "@mezan/domain";
import { ApiError, readError, useHoldsScreenRequest } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* -------------------------------------------------------------------- */
/* سلف الموظفين + الرواتب — docs/archive/catalog/06 (/hr/advances, /hr/payroll)  */
/* -------------------------------------------------------------------- */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string, locale?: string): Promise<string> {
  const body = (await res.json<{ message?: string; messageEn?: string }>().catch(() => ({}))) as { message?: string; messageEn?: string };
  if (locale === ENGLISH_LOCALE && body.messageEn) return body.messageEn;
  return body.message ?? fallback;
}

export function useEmployeeAdvances(): UseQueryResult<EmployeeAdvanceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useHoldsScreenRequest(ScreenRequest.EmployeeAdvances);
  return useQuery<EmployeeAdvanceDTO[], ApiError>({
    queryKey: ["hr", "advances"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/hr/advances");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("advances.advancesCouldNotBeLoaded"), t));
      return res.json<EmployeeAdvanceDTO[]>();
    },
  });
}

export function useEmployeeAdvanceBalances(): UseQueryResult<EmployeeAdvanceBalanceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EmployeeAdvanceBalanceDTO[], ApiError>({
    queryKey: ["hr", "advances", "outstanding"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/advances/outstanding");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrApi.advanceBalancesCouldNotBe"), t));
      return res.json<EmployeeAdvanceBalanceDTO[]>();
    },
  });
}

function useAdvanceInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["hr", "advances"] });
  };
}

export function useRequestEmployeeAdvance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, CreateEmployeeAdvanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/advances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("advances.theAdvanceRequestCouldNot")));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDecideEmployeeAdvance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, { id: string; decision: "approve" | "reject" }>({
    mutationFn: async ({ id, decision }) => {
      const res = await request(`/hr/advances/${id}/${decision}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("hrApi.theAdvanceCouldNotBe")));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDisburseEmployeeAdvance() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, { id: string; body: TreasuryDisbursementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/advances/${id}/disburse`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("advances.theAdvanceCouldNotBe")));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function usePayrollRuns(): UseQueryResult<PayrollRunDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PayrollRunDTO[], ApiError>({
    queryKey: ["hr", "payroll", "runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/payroll/runs");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("payroll.payrollRunsCouldNotBe"), t));
      return res.json<PayrollRunDTO[]>();
    },
  });
}

export function usePayrollRun(runId: string | null): UseQueryResult<PayrollRunDetailDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PayrollRunDetailDTO, ApiError>({
    queryKey: ["hr", "payroll", "runs", runId],
    enabled: session !== null && runId !== null,
    queryFn: async () => {
      const res = await request(`/hr/payroll/runs/${runId}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrApi.thePayrollRunCouldNot"), t));
      return res.json<PayrollRunDetailDTO>();
    },
  });
}

function usePayrollInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["hr", "payroll"] });
    void queryClient.invalidateQueries({ queryKey: ["hr", "advances"] });
  };
}

export function useCreatePayrollRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, CreatePayrollRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/payroll/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("payroll.thePayrollRunCouldNot")));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useCalculatePayrollRun() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDetailDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/calculate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("hrApi.payrollCouldNotBeCalculated"), locale));
      return res.json<PayrollRunDetailDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useApprovePayrollRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("hrApi.thePayrollRunCouldNot2")));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDisbursePayrollRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, { id: string; body: TreasuryDisbursementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/payroll/runs/${id}/disburse`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("payroll.payrollCouldNotBePaid")));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useCancelPayrollRun() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("hrApi.thePayrollRunCouldNot3")));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

/** One employee's payslips across every run — the Employee 360 payslips tab (R10.2). */
export function useEmployeePayslips(employeeId: string | null): UseQueryResult<PayslipDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PayslipDTO[], ApiError>({
    queryKey: ["hr", "payroll", "payslips", employeeId],
    enabled: session !== null && employeeId !== null,
    queryFn: async () => {
      const res = await request(`/hr/payroll/payslips?employeeId=${encodeURIComponent(employeeId ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("payroll.payrollRunsCouldNotBe"), t));
      return res.json<PayslipDTO[]>();
    },
  });
}

/* --- مكوّنات الرواتب — the GL-routing registry (R10.7) ----------------- */

export function usePayrollComponents(): UseQueryResult<PayrollComponentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useHoldsScreenRequest(ScreenRequest.PayrollComponents);
  return useQuery<PayrollComponentDTO[], ApiError>({
    queryKey: ["hr", "payroll", "components"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/hr/payroll/components");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("payrollComponents.componentsCouldNotBeLoaded"), t));
      return res.json<PayrollComponentDTO[]>();
    },
  });
}

function useComponentInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["hr", "payroll", "components"] });
    queryClient.invalidateQueries({ queryKey: ["hr-contracts"] });
  };
}

export function useCreatePayrollComponent() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useComponentInvalidation();
  return useMutation<PayrollComponentDTO, ApiError, CreatePayrollComponentDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/payroll/components", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("payrollComponents.theComponentCouldNotBe")));
      return res.json<PayrollComponentDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useUpdatePayrollComponent() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useComponentInvalidation();
  return useMutation<PayrollComponentDTO, ApiError, { id: string; body: UpdatePayrollComponentDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/payroll/components/${id}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("payrollComponents.theComponentCouldNotBe")));
      return res.json<PayrollComponentDTO>();
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------- */
/* الحجز على الأجر — /hr/payroll/garnishments                              */
/* -------------------------------------------------------------------- */

function useGarnishmentInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["hr", "payroll", "garnishments"] });
  };
}

export function useGarnishments(employeeId?: string | null): UseQueryResult<GarnishmentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<GarnishmentDTO[], ApiError>({
    queryKey: ["hr", "payroll", "garnishments", employeeId ?? "all"],
    enabled: session !== null,
    queryFn: async () => {
      const query = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
      const res = await request(`/hr/payroll/garnishments${query}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("garnishments.couldNotLoad"), t));
      return res.json<GarnishmentDTO[]>();
    },
  });
}

export function useCreateGarnishment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useGarnishmentInvalidation();
  return useMutation<GarnishmentDTO, ApiError, CreateGarnishmentDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/payroll/garnishments", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("garnishments.couldNotSave")));
      return res.json<GarnishmentDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useReleaseGarnishment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useGarnishmentInvalidation();
  return useMutation<GarnishmentDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/garnishments/${id}/release`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("garnishments.couldNotRelease")));
      return res.json<GarnishmentDTO>();
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------- */
/* الجداول القانونية — /hr/payroll/statutory-tables                        */
/* -------------------------------------------------------------------- */

interface StatutoryRowDTO {
  code: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  citationAr: string;
  source: string;
  verified: boolean;
}

export interface StatutoryTablesDTO {
  incomeTax: (StatutoryRowDTO & {
    annualPersonalExemption: string;
    disabilityExemptionMultiplierPercent: string;
    brackets: { upToAnnual: string | null; ratePercent: string }[];
    eliminationTiers: { aboveAnnual: string; upToAnnual: string | null; dropsLowestBrackets: number }[];
  })[];
  socialInsurance: (StatutoryRowDTO & {
    monthlyWageFloor: string | null;
    monthlyWageCeiling: string | null;
    employeeTotalPercent: string;
    employerTotalPercent: string;
    employeeShares: { code: string; labelAr: string; ratePercent: string }[];
    employerShares: { code: string; labelAr: string; ratePercent: string }[];
  })[];
  levies: (StatutoryRowDTO & {
    levies: { code: string; labelAr: string; ratePercent: string; base: string; side: string; exemptPayBases: string[] }[];
  })[];
  overtime: (StatutoryRowDTO & {
    dayPremiumPercent: string;
    nightPremiumPercent: string;
    restDayExtraDayWagePercent: string;
    holidayExtraDayWagePercent: string;
    restDayReplacementWithinDays: number;
    holidaySubstituteDayAllowed: boolean;
    standardDailyHours: number;
    standardWeeklyHours: number;
  })[];
  endOfService: (StatutoryRowDTO & {
    minimumAge: number;
    minimumAnnualRaisePercent: string;
    tiers: { throughYears: number | null; monthsPerYear: string }[];
  })[];
  insuranceYearOverrides: { year: number; monthlyWageFloor: string; monthlyWageCeiling: string; note: string | null; enteredBy: string; enteredAt: string }[];
}

export function useStatutoryTables(): UseQueryResult<StatutoryTablesDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<StatutoryTablesDTO, ApiError>({
    queryKey: ["hr", "payroll", "statutory-tables"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/payroll/statutory-tables");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("statutory.couldNotLoad"), t));
      return res.json<StatutoryTablesDTO>();
    },
  });
}

/** Codes of every statutory row nobody has verified — the payslip marks a figure computed from one. */
export function useUnverifiedStatutoryCodes(): ReadonlySet<string> {
  const tables = useStatutoryTables().data;
  if (!tables) return new Set();
  const rows: StatutoryRowDTO[] = [...tables.incomeTax, ...tables.socialInsurance, ...tables.levies, ...tables.overtime, ...tables.endOfService];
  return new Set(rows.filter((r) => !r.verified).map((r) => r.code));
}

function useStatutoryInvalidation() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["hr", "payroll", "statutory-tables"] });
    void client.invalidateQueries({ queryKey: ["hr", "payroll", "statutory-flag"] });
  };
}

export function useSaveInsuranceYear() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useStatutoryInvalidation();
  return useMutation<SocialInsuranceYearOverrideDTO, ApiError, { year: number; monthlyWageFloor: string; monthlyWageCeiling: string; note: string | null }>({
    mutationFn: async ({ year, ...body }) => {
      const res = await request(`/hr/payroll/statutory-tables/insurance-years/${year}`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("statutory.couldNotSaveYear")));
      return res.json<SocialInsuranceYearOverrideDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useRemoveInsuranceYear() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useStatutoryInvalidation();
  return useMutation<void, ApiError, number>({
    mutationFn: async (year) => {
      const res = await request(`/hr/payroll/statutory-tables/insurance-years/${year}`, { method: "DELETE" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("statutory.couldNotRemoveYear")));
    },
    onSuccess: invalidate,
  });
}

export function usePayrollStatutoryFlag(): UseQueryResult<PayrollStatutoryFlagDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const mayAsk = useHoldsScreenRequest(ScreenRequest.PayrollStatutoryFlag);
  return useQuery<PayrollStatutoryFlagDTO, ApiError>({
    queryKey: ["hr", "payroll", "statutory-flag"],
    enabled: mayAsk,
    queryFn: async () => {
      const res = await request("/hr/payroll/statutory-flag");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("statutory.couldNotLoad"), t));
      return res.json<PayrollStatutoryFlagDTO>();
    },
  });
}

export function useSetPayrollStatutoryFlag() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = useStatutoryInvalidation();
  return useMutation<PayrollStatutoryFlagDTO, ApiError, SetPayrollStatutoryFlagDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/payroll/statutory-flag", { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("statutory.couldNotSwitch")));
      return res.json<PayrollStatutoryFlagDTO>();
    },
    onSuccess: invalidate,
  });
}

/* -------------------------------------------------------------------- */
/* ترحيل مخصص الإجازات — /hr/payroll/provisions                            */
/* -------------------------------------------------------------------- */

export type HrProvisionKindDTO = "leave";

export interface HrProvisionPreviewDTO {
  kind: HrProvisionKindDTO;
  asOfDate: string;
  labelAr: string;
  expenseAccountId: string;
  liabilityAccountId: string;
  computedTotal: string;
  postedBalance: string;
  movement: string;
}

export function useProvisionPreview(kind: HrProvisionKindDTO, asOfDate: string, enabled = true): UseQueryResult<HrProvisionPreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<HrProvisionPreviewDTO, ApiError>({
    queryKey: ["hr", "payroll", "provisions", kind, asOfDate],
    enabled: session !== null && enabled,
    queryFn: async () => {
      const res = await request(`/hr/payroll/provisions/${kind}/preview?asOfDate=${asOfDate}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("provisions.couldNotLoad"), t));
      return res.json<HrProvisionPreviewDTO>();
    },
  });
}

export function usePostProvision() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<{ movement: string; journalEntryId: string }, ApiError, { kind: HrProvisionKindDTO; asOfDate: string }>({
    mutationFn: async ({ kind, asOfDate }) => {
      const res = await request(`/hr/payroll/provisions/${kind}`, { method: "POST", body: JSON.stringify({ asOfDate }) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("provisions.couldNotPost")));
      return res.json<{ movement: string; journalEntryId: string }>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["hr", "payroll", "provisions"] });
      void client.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

/* -------------------------------------------------------------------- */
/* مستحقات نهاية الخدمة — /hr/employees/:id/end-of-service                  */
/* -------------------------------------------------------------------- */

export interface EndOfServiceSettlementDTO {
  employeeId: string;
  lastWorkingDay: string;
  currency: string;
  serviceYears: number;
  priorServiceYears: number;
  settlementWage: string;
  allowancesIncluded: boolean;
  gratuity: string;
  monthsEarned: string;
  gratuityBreakdown: { labelAr: string; years: number; monthsPerYear: string; amount: string }[];
  gratuityEligible: boolean;
  gratuityIneligibleReasonAr: string | null;
  leavePayoutDays: string;
  leavePayout: string;
  outstandingAdvances: string;
  netSettlement: string;
  advanceShortfall: string;
  statutoryTableCode: string;
  citationAr: string;
  verified: boolean;
}

export function useEndOfServiceSettlement(employeeId: string | null, enabled: boolean): UseQueryResult<EndOfServiceSettlementDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EndOfServiceSettlementDTO, ApiError>({
    queryKey: ["hr", "end-of-service", employeeId],
    enabled: session !== null && enabled && employeeId !== null,
    queryFn: async () => {
      const res = await request(`/hr/employees/${employeeId}/end-of-service`);
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("endOfService.couldNotLoad")));
      return res.json<EndOfServiceSettlementDTO>();
    },
  });
}
