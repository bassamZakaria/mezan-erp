import { describe, expect, it } from "vitest";
import {
  ETA_SUBMISSION_STATUSES,
  getEtaDocumentTypeLabel,
  getEtaStatusLabel,
  type EtaSubmissionStatus,
} from "./submission.js";
import {
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
} from "./errors.js";

describe("the submission status vocabulary", () => {
  it("carries all six states the queue can be in, each once", () => {
    const codes = ETA_SUBMISSION_STATUSES.map((s) => s.code);
    expect(codes).toEqual(["ready", "pending_signature", "submitted", "accepted", "error", "excluded"]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("labels every state in Arabic, which is what the queue screen renders", () => {
    for (const status of ETA_SUBMISSION_STATUSES) {
      expect(status.labelAr.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(status.labelAr)).toBe(true);
      expect(getEtaStatusLabel(status.code)).toBe(status.labelAr);
    }
  });

  it("falls back to the raw code for a status it does not know, rather than rendering nothing", () => {
    expect(getEtaStatusLabel("archived" as EtaSubmissionStatus)).toBe("archived");
  });
});

describe("the document-type labels", () => {
  it("names each of the three types in Arabic", () => {
    expect(getEtaDocumentTypeLabel("invoice")).toBe("فاتورة");
    expect(getEtaDocumentTypeLabel("credit_note")).toBe("إشعار خصم");
    expect(getEtaDocumentTypeLabel("debit_note")).toBe("إشعار إضافة");
  });
});

describe("the submission errors", () => {
  it("each carries a stable code the API can map to a status", () => {
    expect(new EtaSubmissionNotFoundError("sub-1").code).toBe("ETA_SUBMISSION_NOT_FOUND");
    expect(new DuplicateEtaSubmissionError("INV-1").code).toBe("ETA_SUBMISSION_DUPLICATE");
    expect(new InvalidEtaTransitionError("accepted", "exclude").code).toBe("ETA_INVALID_TRANSITION");
    expect(new EtaOfflineError().code).toBe("ETA_OFFLINE");
    expect(new EtaExclusionReasonRequiredError().code).toBe("ETA_EXCLUSION_REASON_REQUIRED");
  });

  it("each names itself, so a caught error is identifiable after serialisation", () => {
    expect(new EtaSubmissionNotFoundError("sub-1").name).toBe("EtaSubmissionNotFoundError");
    expect(new DuplicateEtaSubmissionError("INV-1").name).toBe("DuplicateEtaSubmissionError");
    expect(new InvalidEtaTransitionError("ready", "accept").name).toBe("InvalidEtaTransitionError");
    expect(new EtaOfflineError().name).toBe("EtaOfflineError");
    expect(new EtaExclusionReasonRequiredError().name).toBe("EtaExclusionReasonRequiredError");
  });

  it("keeps the subject in the message and on the error, so the screen can name it", () => {
    const notFound = new EtaSubmissionNotFoundError("sub-9");
    expect(notFound.id).toBe("sub-9");
    expect(notFound.message).toContain("sub-9");

    const duplicate = new DuplicateEtaSubmissionError("INV-000014");
    expect(duplicate.internalId).toBe("INV-000014");
    expect(duplicate.message).toContain("INV-000014");

    const transition = new InvalidEtaTransitionError("accepted", "exclude");
    expect(transition.from).toBe("accepted");
    expect(transition.action).toBe("exclude");
    expect(transition.message).toContain("accepted");
    expect(transition.message).toContain("exclude");
  });

  it("all of them are real Errors, so a catch block can rethrow what it does not handle", () => {
    for (const error of [
      new EtaSubmissionNotFoundError("x"),
      new DuplicateEtaSubmissionError("x"),
      new InvalidEtaTransitionError("ready", "send"),
      new EtaOfflineError(),
      new EtaExclusionReasonRequiredError(),
    ]) {
      expect(error).toBeInstanceOf(Error);
      expect(error.stack).toBeTruthy();
    }
  });

  it("the offline error says the document was queued, which is what the user needs to know", () => {
    expect(new EtaOfflineError().message).toContain("queued");
  });
});
