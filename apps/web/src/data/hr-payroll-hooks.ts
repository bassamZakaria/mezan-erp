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
} from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* -------------------------------------------------------------------- */
/* سلف الموظفين + الرواتب — docs/catalog/06 (/hr/advances, /hr/payroll)  */
/* -------------------------------------------------------------------- */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

export function useEmployeeAdvances(): UseQueryResult<EmployeeAdvanceDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EmployeeAdvanceDTO[], ApiError>({
    queryKey: ["hr", "advances"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/advances");
      if (!res.ok) throw new ApiError(res.status, t("advances.advancesCouldNotBeLoaded"));
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
      if (!res.ok) throw new ApiError(res.status, t("hrApi.advanceBalancesCouldNotBe"));
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
      if (!res.ok) throw new ApiError(res.status, t("payroll.payrollRunsCouldNotBe"));
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
      if (!res.ok) throw new ApiError(res.status, t("hrApi.thePayrollRunCouldNot"));
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
  const { t } = useAppTranslation();
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDetailDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/calculate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, t("hrApi.payrollCouldNotBeCalculated")));
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
      if (!res.ok) throw new ApiError(res.status, t("payroll.payrollRunsCouldNotBe"));
      return res.json<PayslipDTO[]>();
    },
  });
}

/* --- مكوّنات الرواتب — the GL-routing registry (R10.7) ----------------- */

export function usePayrollComponents(): UseQueryResult<PayrollComponentDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PayrollComponentDTO[], ApiError>({
    queryKey: ["hr", "payroll", "components"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/payroll/components");
      if (!res.ok) throw new ApiError(res.status, t("payrollComponents.componentsCouldNotBeLoaded"));
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
