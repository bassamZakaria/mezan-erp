import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError } from "./hooks";
import { sessionHolds } from "./session";
import { useAppTranslation } from "../i18n";

const DUPLICATES_KEY = "opening-balance-duplicates";
const DUPLICATES_PATH = "/gl/opening-balance-duplicates";
const QUERIES_A_REPAIR_MOVES = [DUPLICATES_KEY, "reconciliation", "journal-entries", "gl", "account-ledger", "financial-reports", "reports", "audit"];

// INVARIANT: the permissions `/gl/opening-balance-duplicates` is gated on in packages/api/src/opening-balance-duplicates-routes.ts — the list on the first, the repair on the second.
export const OPENING_BALANCE_DUPLICATES_VIEW_PERMISSION = "accounting.reports.view";
export const OPENING_BALANCE_REPAIR_PERMISSION = "accounting.journal.post";

export enum OpeningBalancePartyKind {
  Customer = "customer",
  Supplier = "supplier",
}

export interface OpeningBalanceDuplicateDTO {
  readonly key: string;
  readonly kind: OpeningBalancePartyKind;
  readonly partyId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly wanted: number;
  readonly totalPosted: number;
  readonly excess: number;
  readonly entryIds: readonly string[];
  readonly entryCount: number;
}

export interface OpeningBalanceRepairResultDTO {
  readonly kind: OpeningBalancePartyKind;
  readonly partyId: string;
  readonly repaired: boolean;
}

export interface OpeningBalanceDuplicatesAccess {
  readonly mayView: boolean;
  readonly mayRepair: boolean;
}

export function useOpeningBalanceDuplicatesAccess(): OpeningBalanceDuplicatesAccess {
  const { session } = useApi();
  const companyWide = useBranchGate().allows(BranchGatedAction.OpeningBalanceDuplicates);
  const mayView = companyWide && sessionHolds(session, OPENING_BALANCE_DUPLICATES_VIEW_PERMISSION);
  return { mayView, mayRepair: mayView && sessionHolds(session, OPENING_BALANCE_REPAIR_PERMISSION) };
}

export function useOpeningBalanceDuplicates(): UseQueryResult<OpeningBalanceDuplicateDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const { mayView } = useOpeningBalanceDuplicatesAccess();
  return useQuery<OpeningBalanceDuplicateDTO[], ApiError>({
    queryKey: [DUPLICATES_KEY],
    enabled: mayView,
    queryFn: async () => {
      const res = await request(DUPLICATES_PATH);
      if (!res.ok) throw await loaderError(res, t("openingDuplicates.loadFailed"), t);
      return (await res.json<{ rows: OpeningBalanceDuplicateDTO[] }>()).rows;
    },
  });
}

export function useRepairOpeningBalanceDuplicate() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<OpeningBalanceRepairResultDTO, ApiError, Pick<OpeningBalanceDuplicateDTO, "kind" | "partyId">>({
    mutationFn: async ({ kind, partyId }) => {
      const res = await request(`${DUPLICATES_PATH}/${kind}/${encodeURIComponent(partyId)}/repair`, { method: "POST", body: "{}" });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("openingDuplicates.repairFailed"), t));
      return res.json<OpeningBalanceRepairResultDTO>();
    },
    onSettled: () => Promise.all(QUERIES_A_REPAIR_MOVES.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  });
}
