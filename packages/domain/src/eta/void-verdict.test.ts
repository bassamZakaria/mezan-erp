import { describe, expect, it } from "vitest";
import { EtaSubmissionStatusCode } from "./submission.js";
import { EtaVoidVerdict, etaVoidVerdictOf } from "./void-verdict.js";

describe("what a void may do to the e-document of the sale or return it voids", () => {
  it.each([
    [null, EtaVoidVerdict.Proceed],
    [EtaSubmissionStatusCode.Ready, EtaVoidVerdict.Withdraw],
    [EtaSubmissionStatusCode.PendingSignature, EtaVoidVerdict.Withdraw],
    [EtaSubmissionStatusCode.Error, EtaVoidVerdict.Withdraw],
    [EtaSubmissionStatusCode.Excluded, EtaVoidVerdict.Proceed],
    [EtaSubmissionStatusCode.Submitted, EtaVoidVerdict.AwaitingVerdict],
    [EtaSubmissionStatusCode.Accepted, EtaVoidVerdict.Accepted],
  ])("%s → %s", (status, verdict) => {
    expect(etaVoidVerdictOf(status)).toBe(verdict);
  });

  it("answers for every status the queue knows", () => {
    for (const status of Object.values(EtaSubmissionStatusCode)) {
      expect(Object.values(EtaVoidVerdict)).toContain(etaVoidVerdictOf(status));
    }
  });
});
