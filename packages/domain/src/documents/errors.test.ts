import { describe, it, expect } from "vitest";
import {
  InvalidDocumentTransitionError,
  DocumentNotFoundError,
  MissingHookError,
  InvalidDocumentError,
} from "./errors.js";

describe("InvalidDocumentTransitionError", () => {
  it("names the document, the illegal move, and both statuses in Arabic", () => {
    const err = new InvalidDocumentTransitionError("SALES_INVOICE", "inv-1", "posted", "draft");
    expect(err.code).toBe("INVALID_DOCUMENT_TRANSITION");
    expect(err.name).toBe("InvalidDocumentTransitionError");
    expect(err.docType).toBe("SALES_INVOICE");
    expect(err.docId).toBe("inv-1");
    expect(err.from).toBe("posted");
    expect(err.to).toBe("draft");
    expect(err.message).toContain("inv-1");
    expect(err.message).toContain("مرحّل");
    expect(err.message).toContain("مسودة");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("DocumentNotFoundError", () => {
  it("carries the doc type/id and an Arabic message", () => {
    const err = new DocumentNotFoundError("JOURNAL_ENTRY", "j-404");
    expect(err.code).toBe("DOCUMENT_NOT_FOUND");
    expect(err.docType).toBe("JOURNAL_ENTRY");
    expect(err.docId).toBe("j-404");
    expect(err.message).toBe("المستند j-404 غير موجود.");
  });
});

describe("MissingHookError", () => {
  it("names the missing hook kind", () => {
    const err = new MissingHookError("JOURNAL_ENTRY", "gl");
    expect(err.code).toBe("MISSING_DOCUMENT_HOOK");
    expect(err.hook).toBe("gl");
    expect(err.message).toContain("gl");
    expect(err.messageEn).toContain("gl hook");
  });
});

describe("InvalidDocumentError", () => {
  it("carries the caller's own message", () => {
    const err = new InvalidDocumentError("JOURNAL_ENTRY", "j-1", "القيد يتطلب سطرين على الأقل.");
    expect(err.code).toBe("INVALID_DOCUMENT");
    expect(err.docType).toBe("JOURNAL_ENTRY");
    expect(err.docId).toBe("j-1");
    expect(err.message).toBe("القيد يتطلب سطرين على الأقل.");
  });
});
