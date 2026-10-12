import { ETA_REQUEUE_MODE, EtaRequeueMode, EtaSubmissionStatusCode, type EtaSubmissionStatus } from "./submission.js";

export enum EtaVoidVerdict {
  Proceed = "proceed",
  Withdraw = "withdraw",
  AwaitingVerdict = "awaiting_verdict",
  Accepted = "accepted",
}

// INVARIANT: the ONE rule for voiding a document whose e-invoice, credit note
// or e-receipt exists. What the authority holds or is judging carries VAT it
// keeps, so the books may not drop it alone; what it never took, or refused,
// is withdrawn with the void.
export function etaVoidVerdictOf(status: EtaSubmissionStatus | null): EtaVoidVerdict {
  if (status === null) return EtaVoidVerdict.Proceed;
  if (status === EtaSubmissionStatusCode.Submitted) return EtaVoidVerdict.AwaitingVerdict;
  if (status === EtaSubmissionStatusCode.Accepted) return EtaVoidVerdict.Accepted;
  return ETA_REQUEUE_MODE[status] === EtaRequeueMode.Automatic ? EtaVoidVerdict.Withdraw : EtaVoidVerdict.Proceed;
}
