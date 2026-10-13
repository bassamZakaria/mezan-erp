import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { AmendVatFilingDTO, RecordVatFilingDTO, VatFilingDTO } from "@mezan/contracts";
import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError } from "./hooks";
import { sessionHolds } from "./session";
import { useAppTranslation } from "../i18n";

const VAT_FILINGS_KEY = "vat-filings";
const VAT_FILINGS_PATH = "/gl/vat-filings";

// INVARIANT: the permissions `/gl/vat-filings` is gated on in packages/api/src/gl-routes.ts — the list on the first, filing and amending on the second.
export const VAT_FILINGS_VIEW_PERMISSION = "accounting.reports.view";
export const VAT_FILINGS_FILE_PERMISSION = "accounting.period.close";

export interface VatFilingAccess {
  readonly mayView: boolean;
  readonly mayFile: boolean;
}

export function useVatFilingAccess(): VatFilingAccess {
  const { session } = useApi();
  const companyWide = useBranchGate().allows(BranchGatedAction.VatFilings);
  const mayView = companyWide && sessionHolds(session, VAT_FILINGS_VIEW_PERMISSION);
  return { mayView, mayFile: mayView && sessionHolds(session, VAT_FILINGS_FILE_PERMISSION) };
}

export function useVatFilings(): UseQueryResult<VatFilingDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const { mayView } = useVatFilingAccess();
  return useQuery<VatFilingDTO[], ApiError>({
    queryKey: [VAT_FILINGS_KEY],
    enabled: mayView,
    queryFn: async () => {
      const res = await request(VAT_FILINGS_PATH);
      if (!res.ok) throw await loaderError(res, t("vatFiling.loadFailed"), t);
      return res.json<VatFilingDTO[]>();
    },
  });
}

export function useRecordVatFiling() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VatFilingDTO, ApiError, RecordVatFilingDTO>({
    mutationFn: async (body) => {
      const res = await request(VAT_FILINGS_PATH, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("vatFiling.fileFailed"), t));
      return res.json<VatFilingDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [VAT_FILINGS_KEY] }),
  });
}

export interface AmendVatFilingInput extends AmendVatFilingDTO {
  readonly id: string;
}

export function useAmendVatFiling() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<VatFilingDTO, ApiError, AmendVatFilingInput>({
    mutationFn: async ({ id, reason }) => {
      const res = await request(`${VAT_FILINGS_PATH}/${encodeURIComponent(id)}/amend`, { method: "POST", body: JSON.stringify({ reason }) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("vatFiling.amendFailed"), t));
      return res.json<VatFilingDTO>();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: [VAT_FILINGS_KEY] }),
  });
}
