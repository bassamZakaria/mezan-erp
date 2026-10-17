import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { BankFileExportDTO, BankFileLayoutDTO, BankFilePreviewDTO, BankFileRequestDTO, EmployeeDTO, SetSalaryPaymentDTO } from "@mezan/contracts";
import { ApiError, readError } from "./hooks";
import { useApi } from "./ApiContext";
import { useAppTranslation } from "../i18n";

export function useSetSalaryPayment() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<EmployeeDTO, ApiError, { id: string; body: SetSalaryPaymentDTO }>({
    mutationFn: async ({ id, body }) => {
      const res = await request(`/hr/employees/${id}/salary-payment`, { method: "PUT", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrPages.salaryPaymentCouldNotSave"), t));
      return res.json<EmployeeDTO>();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hr-employees"] }),
  });
}

export function useBankFileLayouts(): UseQueryResult<BankFileLayoutDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankFileLayoutDTO[], ApiError>({
    queryKey: ["hr", "payroll", "bank-file", "layouts"],
    enabled: session !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await request("/hr/payroll/bank-file/layouts");
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrPages.bankFileLayoutsCouldNotLoad"), t));
      return res.json<BankFileLayoutDTO[]>();
    },
  });
}

function bankFileQuery(body: BankFileRequestDTO): string {
  const params = new URLSearchParams({ format: body.format });
  if (body.valueDate) params.set("valueDate", body.valueDate);
  if (body.treasuryAccountId) params.set("treasuryAccountId", body.treasuryAccountId);
  return params.toString();
}

export function useBankFilePreview(runId: string | null, body: BankFileRequestDTO, enabled: boolean): UseQueryResult<BankFilePreviewDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<BankFilePreviewDTO, ApiError>({
    queryKey: ["hr", "payroll", "runs", runId, "bank-file", body.format, body.valueDate ?? null, body.treasuryAccountId ?? null],
    enabled: session !== null && runId !== null && enabled,
    retry: false,
    queryFn: async () => {
      const res = await request(`/hr/payroll/runs/${runId}/bank-file/preview?${bankFileQuery(body)}`);
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrPages.bankFileCouldNotPreview"), t));
      return res.json<BankFilePreviewDTO>();
    },
  });
}

export function useExportBankFile() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  return useMutation<BankFileExportDTO, ApiError, { runId: string; body: BankFileRequestDTO }>({
    mutationFn: async ({ runId, body }) => {
      const res = await request(`/hr/payroll/runs/${runId}/bank-file`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("hrPages.bankFileCouldNotExport"), t));
      return res.json<BankFileExportDTO>();
    },
  });
}

/** No-op outside a DOM, so a test can drive the export without a browser download. */
export function downloadTextFile(fileName: string, mimeType: string, content: string): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
