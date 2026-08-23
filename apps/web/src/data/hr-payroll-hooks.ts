import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  CreateEmployeeAdvanceDTO,
  CreatePayrollRunDTO,
  EmployeeAdvanceBalanceDTO,
  EmployeeAdvanceDTO,
  PayrollRunDTO,
  PayrollRunDetailDTO,
  TreasuryDisbursementDTO,
} from "@mezan/contracts";
import { ApiError } from "./hooks";
import { useApi } from "./ApiContext";

/* -------------------------------------------------------------------- */
/* سلف الموظفين + الرواتب — docs/catalog/06 (/hr/advances, /hr/payroll)  */
/* -------------------------------------------------------------------- */

async function readMessage(res: { json<T>(): Promise<T> }, fallback: string): Promise<string> {
  const body = (await res.json<{ message?: string }>().catch(() => ({}))) as { message?: string };
  return body.message ?? fallback;
}

export function useEmployeeAdvances(): UseQueryResult<EmployeeAdvanceDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<EmployeeAdvanceDTO[], ApiError>({
    queryKey: ["hr", "advances"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/advances");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل السلف.");
      return res.json<EmployeeAdvanceDTO[]>();
    },
  });
}

export function useEmployeeAdvanceBalances(): UseQueryResult<EmployeeAdvanceBalanceDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<EmployeeAdvanceBalanceDTO[], ApiError>({
    queryKey: ["hr", "advances", "outstanding"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/advances/outstanding");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل أرصدة السلف.");
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
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, CreateEmployeeAdvanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/advances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر تسجيل طلب السلفة."));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDecideEmployeeAdvance() {
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, { id: string; decision: "approve" | "reject" }>({
    mutationFn: async ({ id, decision }) => {
      const res = await request(`/hr/advances/${id}/${decision}`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر اعتماد السلفة."));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDisburseEmployeeAdvance() {
  const { request } = useApi();
  const invalidate = useAdvanceInvalidation();
  return useMutation<EmployeeAdvanceDTO, ApiError, { id: string; body: TreasuryDisbursementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/advances/${id}/disburse`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر صرف السلفة."));
      return res.json<EmployeeAdvanceDTO>();
    },
    onSuccess: invalidate,
  });
}

export function usePayrollRuns(): UseQueryResult<PayrollRunDTO[], ApiError> {
  const { request, session } = useApi();
  return useQuery<PayrollRunDTO[], ApiError>({
    queryKey: ["hr", "payroll", "runs"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/payroll/runs");
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل دورات الرواتب.");
      return res.json<PayrollRunDTO[]>();
    },
  });
}

export function usePayrollRun(runId: string | null): UseQueryResult<PayrollRunDetailDTO, ApiError> {
  const { request, session } = useApi();
  return useQuery<PayrollRunDetailDTO, ApiError>({
    queryKey: ["hr", "payroll", "runs", runId],
    enabled: session !== null && runId !== null,
    queryFn: async () => {
      const res = await request(`/hr/payroll/runs/${runId}`);
      if (!res.ok) throw new ApiError(res.status, "تعذّر تحميل دورة الرواتب.");
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
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, CreatePayrollRunDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/payroll/runs", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إنشاء دورة الرواتب."));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useCalculatePayrollRun() {
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDetailDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/calculate`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر احتساب الرواتب."));
      return res.json<PayrollRunDetailDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useApprovePayrollRun() {
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر اعتماد دورة الرواتب."));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useDisbursePayrollRun() {
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, { id: string; body: TreasuryDisbursementDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/payroll/runs/${id}/disburse`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر صرف الرواتب."));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}

export function useCancelPayrollRun() {
  const { request } = useApi();
  const invalidate = usePayrollInvalidation();
  return useMutation<PayrollRunDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/payroll/runs/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new ApiError(res.status, await readMessage(res, "تعذّر إلغاء دورة الرواتب."));
      return res.json<PayrollRunDTO>();
    },
    onSuccess: invalidate,
  });
}
