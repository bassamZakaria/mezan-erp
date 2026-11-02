import { pickLocalized } from "../data/server-message";
import { useState } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { ApprovalStatusCode, type ApprovalStandingDTO } from "@mezan/contracts";
import { Button } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { useAppTranslation } from "../i18n";

export const APPROVAL_STANDING_KEY = "approval-standing";

export function useApprovalStanding(requestId: string | null): UseQueryResult<ApprovalStandingDTO | null> {
  const { request, session } = useApi();
  return useQuery<ApprovalStandingDTO | null>({
    queryKey: [APPROVAL_STANDING_KEY, requestId],
    enabled: session !== null && requestId !== null,
    queryFn: async () => {
      const res = await request(`/workflow/requests/${encodeURIComponent(requestId ?? "")}/standing`);
      return res.ok ? res.json<ApprovalStandingDTO>() : null;
    },
  });
}

/** The held document's own explanation of an approval that can no longer post it, with the way forward. */
export function ReapprovalNotice({
  requestId,
  pending,
  onRequestAgain,
}: {
  readonly requestId: string | null;
  readonly pending: boolean;
  readonly onRequestAgain: () => void;
}) {
  const { t, locale } = useAppTranslation();
  const standing = useApprovalStanding(requestId).data;
  if (!standing || standing.status !== ApprovalStatusCode.ReapprovalRequired) return null;
  return (
    <div data-testid="reapproval-notice" role="alert" className="mt-[8px] flex flex-wrap items-center justify-between gap-[10px] rounded-md border border-warning bg-warning-soft px-[14px] py-[10px] text-start text-[12.5px] text-warning-ink">
      <span className="min-w-0 flex-1 font-semibold">{pickLocalized(standing.reason, standing.reasonEn, locale) ?? t("approvals.reapproval.reason")}</span>
      <Button variant="primary" size="sm" disabled={pending} onClick={onRequestAgain}>
        {t("approvals.reapproval.requestAgain")}
      </Button>
    </div>
  );
}

const HELD_STATUS = "pending";

export interface HeldDocument {
  readonly id: string;
  readonly status: string;
  readonly workflowRequestId?: string | null;
}

/** The notice for any document the approval gate holds: asking again is the document's own confirm. */
export function HeldDocumentReapproval({
  document,
  pending,
  confirm,
}: {
  readonly document: HeldDocument;
  readonly pending: boolean;
  readonly confirm: (id: string) => Promise<unknown>;
}) {
  const { t } = useAppTranslation();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const requestId = document.status === HELD_STATUS ? (document.workflowRequestId ?? null) : null;

  async function requestAgain() {
    setRefusal(null);
    try {
      await confirm(document.id);
      await queryClient.invalidateQueries({ queryKey: [APPROVAL_STANDING_KEY] });
    } catch (err) {
      setRefusal(err instanceof Error && err.message !== "" ? err.message : t("common.failed"));
    }
  }

  return (
    <>
      <ReapprovalNotice requestId={requestId} pending={pending} onRequestAgain={requestAgain} />
      {refusal ? (
        <span role="alert" className="mt-[6px] block text-start text-[12.5px] font-semibold text-danger-ink">
          {refusal}
        </span>
      ) : null}
    </>
  );
}
