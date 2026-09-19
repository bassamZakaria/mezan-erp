import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type {
  ClockChallengeDTO,
  ClockChallengePurposeDTO,
  ClockCredentialRegistrationDTO,
  EmployeeAdvanceDTO,
  EmployeeAdvanceRepayableDTO,
  LeaveRequestDTO,
  RepayEmployeeAdvanceDTO,
  SelfAdvancesDTO,
  SelfAttendanceMonthDTO,
  SelfClockPunchDTO,
  SelfClockPunchResultDTO,
  SelfClockStatusDTO,
  SelfCreateAdvanceDTO,
  SelfCreateLeaveRequestDTO,
  SelfPayslipPrintDTO,
  SelfPayslipsDTO,
  SelfProfileDTO,
} from "@mezan/contracts";
import { ApiError, withSupportCode } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

/* -------------------------------------------------------------------- */
/* الخدمة الذاتية للموظف — /hr/self                                      */
/* -------------------------------------------------------------------- */

type Translate = ReturnType<typeof useAppTranslation>["t"];

async function selfError(res: { status: number; json<T>(): Promise<T> }, fallback: string, locale: string, t: Translate): Promise<ApiError> {
  const body = (await res.json<{ error?: string; message?: string; messageEn?: string }>().catch(() => ({}))) as {
    error?: string;
    message?: string;
    messageEn?: string;
  };
  const text = locale === "en" && body.messageEn ? body.messageEn : body.message;
  return new ApiError(res.status, text && text !== "" ? text : withSupportCode(fallback, res.status, t), undefined, undefined, body.error);
}

const SELF_KEY = ["hr", "self"] as const;

export function useSelfProfile(): UseQueryResult<SelfProfileDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfProfileDTO, ApiError>({
    queryKey: [...SELF_KEY, "profile"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/self/profile");
      if (!res.ok) throw await selfError(res, t("self.profileCouldNotLoad"), locale, t);
      return res.json<SelfProfileDTO>();
    },
  });
}

export function useSelfPayslips(): UseQueryResult<SelfPayslipsDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfPayslipsDTO, ApiError>({
    queryKey: [...SELF_KEY, "payslips"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/self/payslips");
      if (!res.ok) throw await selfError(res, t("self.payslipsCouldNotLoad"), locale, t);
      return res.json<SelfPayslipsDTO>();
    },
  });
}

export function useSelfPayslipPrint(id: string | null): UseQueryResult<SelfPayslipPrintDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfPayslipPrintDTO, ApiError>({
    queryKey: [...SELF_KEY, "payslip-print", id],
    enabled: session !== null && id !== null,
    queryFn: async () => {
      const res = await request(`/hr/self/payslips/${encodeURIComponent(id ?? "")}/print`);
      if (!res.ok) throw await selfError(res, t("self.payslipsCouldNotLoad"), locale, t);
      return res.json<SelfPayslipPrintDTO>();
    },
  });
}

export function useSelfAdvances(): UseQueryResult<SelfAdvancesDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfAdvancesDTO, ApiError>({
    queryKey: [...SELF_KEY, "advances"],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request("/hr/self/advances");
      if (!res.ok) throw await selfError(res, t("self.advancesCouldNotLoad"), locale, t);
      return res.json<SelfAdvancesDTO>();
    },
  });
}

export function useRequestSelfAdvance() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<EmployeeAdvanceDTO, ApiError, SelfCreateAdvanceDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/self/advances", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await selfError(res, t("self.advanceCouldNotRequest"), locale, t);
      return res.json<EmployeeAdvanceDTO>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: [...SELF_KEY, "advances"] });
      void client.invalidateQueries({ queryKey: ["hr", "advances"] });
    },
  });
}

export function useSelfAttendance(month: string): UseQueryResult<SelfAttendanceMonthDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfAttendanceMonthDTO, ApiError>({
    queryKey: [...SELF_KEY, "attendance", month],
    enabled: session !== null,
    queryFn: async () => {
      const res = await request(`/hr/self/attendance?month=${encodeURIComponent(month)}`);
      if (!res.ok) throw await selfError(res, t("self.attendanceCouldNotLoad"), locale, t);
      return res.json<SelfAttendanceMonthDTO>();
    },
  });
}

export function useSelfClockStatus(enabled: boolean): UseQueryResult<SelfClockStatusDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<SelfClockStatusDTO, ApiError>({
    queryKey: [...SELF_KEY, "clock"],
    enabled: session !== null && enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await request("/hr/self/clock");
      if (!res.ok) throw await selfError(res, t("self.clockCouldNotLoad"), locale, t);
      return res.json<SelfClockStatusDTO>();
    },
  });
}

export function useClockChallenge() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  return useMutation<ClockChallengeDTO, ApiError, ClockChallengePurposeDTO>({
    mutationFn: async (purpose) => {
      const res = await request("/hr/self/clock/challenge", { method: "POST", body: JSON.stringify({ purpose }) });
      if (!res.ok) throw await selfError(res, t("self.biometricFailed"), locale, t);
      return res.json<ClockChallengeDTO>();
    },
  });
}

export function useRegisterClockCredential() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<{ registered: boolean }, ApiError, ClockCredentialRegistrationDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/self/clock/credential", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await selfError(res, t("self.biometricFailed"), locale, t);
      return res.json<{ registered: boolean }>();
    },
    onSettled: () => void client.invalidateQueries({ queryKey: [...SELF_KEY, "clock"] }),
  });
}

export function useSelfClockPunch() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<SelfClockPunchResultDTO, ApiError, SelfClockPunchDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/self/clock", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await selfError(res, t("self.clockCouldNotRecord"), locale, t);
      return res.json<SelfClockPunchResultDTO>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: [...SELF_KEY, "clock"] });
      void client.invalidateQueries({ queryKey: [...SELF_KEY, "attendance"] });
      void client.invalidateQueries({ queryKey: ["hr-attendance"] });
    },
  });
}

export function useCreateSelfLeaveRequest() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, SelfCreateLeaveRequestDTO>({
    mutationFn: async (body) => {
      const res = await request("/hr/self/leave-requests", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await selfError(res, t("myLeave.theLeaveRequestCouldNot"), locale, t);
      return res.json<LeaveRequestDTO>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["hr-my-leave"] });
      void client.invalidateQueries({ queryKey: ["hr-leave-requests"] });
      void client.invalidateQueries({ queryKey: ["hr-leave-request-counts"] });
    },
  });
}

export function useCancelSelfLeaveRequest() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<LeaveRequestDTO, ApiError, string>({
    mutationFn: async (id) => {
      const res = await request(`/hr/self/leave-requests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      if (!res.ok) throw await selfError(res, t("myLeave.theLeaveRequestCouldNot2"), locale, t);
      return res.json<LeaveRequestDTO>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["hr-my-leave"] });
      void client.invalidateQueries({ queryKey: ["hr-leave-requests"] });
      void client.invalidateQueries({ queryKey: ["hr-leave-request-counts"] });
    },
  });
}

export function useAdvanceRepayable(advanceId: string | null): UseQueryResult<EmployeeAdvanceRepayableDTO, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<EmployeeAdvanceRepayableDTO, ApiError>({
    queryKey: ["hr", "advances", "repayable", advanceId],
    enabled: session !== null && advanceId !== null,
    queryFn: async () => {
      const res = await request(`/hr/advances/${encodeURIComponent(advanceId ?? "")}/repayable`);
      if (!res.ok) throw await selfError(res, t("advances.repayCouldNotLoad"), locale, t);
      return res.json<EmployeeAdvanceRepayableDTO>();
    },
  });
}

export function useRepayEmployeeAdvance() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<EmployeeAdvanceDTO, ApiError, { id: string; body: RepayEmployeeAdvanceDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/advances/${encodeURIComponent(id)}/repay`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw await selfError(res, t("advances.repayCouldNotRecord"), locale, t);
      return res.json<EmployeeAdvanceDTO>();
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["hr", "advances"] });
      void client.invalidateQueries({ queryKey: [...SELF_KEY, "advances"] });
      void client.invalidateQueries({ queryKey: ["vouchers"] });
    },
  });
}

export function useResetClockCredential() {
  const { t, locale } = useAppTranslation();
  const { request } = useApi();
  const client = useQueryClient();
  return useMutation<{ registered: boolean; removed: number }, ApiError, string>({
    mutationFn: async (employeeId) => {
      const res = await request(`/hr/employees/${encodeURIComponent(employeeId)}/clock-credential/reset`, { method: "POST" });
      if (!res.ok) throw await selfError(res, t("self.resetDeviceFailed"), locale, t);
      return res.json<{ registered: boolean; removed: number }>();
    },
    onSettled: (_data, _err, employeeId) => void client.invalidateQueries({ queryKey: ["hr", "clock-credential", employeeId] }),
  });
}

export function useClockCredentialStatus(employeeId: string | null): UseQueryResult<{ registered: boolean; createdAt: string | null; lastUsedAt: string | null }, ApiError> {
  const { t, locale } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<{ registered: boolean; createdAt: string | null; lastUsedAt: string | null }, ApiError>({
    queryKey: ["hr", "clock-credential", employeeId],
    enabled: session !== null && employeeId !== null,
    queryFn: async () => {
      const res = await request(`/hr/employees/${encodeURIComponent(employeeId ?? "")}/clock-credential`);
      if (!res.ok) throw await selfError(res, t("self.clockCouldNotLoad"), locale, t);
      return res.json<{ registered: boolean; createdAt: string | null; lastUsedAt: string | null }>();
    },
  });
}
