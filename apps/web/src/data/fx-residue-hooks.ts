import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ScreenRequest, type ForeignResidueKind, type FxOpenItemType } from "@mezan/domain";
import type { FxRevaluationRequestDTO } from "@mezan/contracts";
import { useBranchGate } from "../shell/useBranchGate";
import { useApi } from "./ApiContext";
import { ApiError, loaderError, readError, useHoldsScreenRequest } from "./hooks";
import { sessionHolds } from "./session";
import { useAppTranslation } from "../i18n";

const RESIDUE_KEY = "fx-residue";
const RESIDUE_PATH = "/revaluation/residue";
const QUERIES_A_SWEEP_MOVES = [RESIDUE_KEY, "reconciliation", "journal-entries", "gl", "account-ledger", "financial-reports", "reports"];

// INVARIANT: the permission the sweep is gated on in packages/api/src/fx-revaluation-routes.ts; the list's own is `ScreenRequest.FxResidues`.
export const FX_RESIDUE_SWEEP_PERMISSION = "accounting.journal.post";

export interface ForeignResidueDTO {
  readonly kind: ForeignResidueKind;
  readonly ref: string;
  readonly itemType?: FxOpenItemType;
  readonly currency: string;
  readonly base: string;
}

export interface RefusedForeignResidueDTO extends ForeignResidueDTO {
  readonly message: string;
  readonly messageEn?: string;
}

export interface FxResidueSweepResultDTO {
  readonly swept: readonly ForeignResidueDTO[];
  readonly sweptCount: number;
  readonly refused: readonly RefusedForeignResidueDTO[];
  readonly entryId: string | null;
}

export interface FxResidueAccess {
  readonly mayView: boolean;
  readonly maySweep: boolean;
}

export function useFxResidueAccess(): FxResidueAccess {
  const { session } = useApi();
  const companyWide = useBranchGate().allowsApi(RESIDUE_PATH);
  const mayView = useHoldsScreenRequest(ScreenRequest.FxResidues) && companyWide;
  return { mayView, maySweep: mayView && sessionHolds(session, FX_RESIDUE_SWEEP_PERMISSION) };
}

export function useFxResidues(): UseQueryResult<ForeignResidueDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const { mayView } = useFxResidueAccess();
  return useQuery<ForeignResidueDTO[], ApiError>({
    queryKey: [RESIDUE_KEY],
    enabled: mayView,
    queryFn: async () => {
      const res = await request(RESIDUE_PATH);
      if (!res.ok) throw await loaderError(res, t("fxResidue.loadFailed"), t);
      return (await res.json<{ rows: ForeignResidueDTO[] }>()).rows;
    },
  });
}

export function useSweepFxResidues() {
  const { t } = useAppTranslation();
  const { request } = useApi();
  const queryClient = useQueryClient();
  return useMutation<FxResidueSweepResultDTO, ApiError, Pick<FxRevaluationRequestDTO, "date">>({
    mutationFn: async (body) => {
      const res = await request(`${RESIDUE_PATH}/sweep`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new ApiError(res.status, await readError(res, t("fxResidue.sweepFailed"), t));
      return res.json<FxResidueSweepResultDTO>();
    },
    onSettled: () => Promise.all(QUERIES_A_SWEEP_MOVES.map((key) => queryClient.invalidateQueries({ queryKey: [key] }))),
  });
}
