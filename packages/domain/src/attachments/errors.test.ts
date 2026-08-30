import { describe, it, expect } from "vitest";
import { AttachmentNotFoundError, DuplicateAttachmentIdError, InvalidAttachmentError } from "./errors.js";

describe("AttachmentNotFoundError", () => {
  it("carries the id in its message", () => {
    const err = new AttachmentNotFoundError("att-1");
    expect(err.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(err.name).toBe("AttachmentNotFoundError");
    expect(err.message).toBe("Attachment 'att-1' was not found.");
  });
});

describe("DuplicateAttachmentIdError", () => {
  it("carries the id in its message", () => {
    const err = new DuplicateAttachmentIdError("att-1");
    expect(err.code).toBe("DUPLICATE_ATTACHMENT_ID");
    expect(err.message).toBe("Attachment 'att-1' already exists.");
  });
});

describe("InvalidAttachmentError", () => {
  it("joins reasons into the message and exposes them on .reasons", () => {
    const err = new InvalidAttachmentError(["an empty file cannot be attached", "fileName is required"]);
    expect(err.code).toBe("INVALID_ATTACHMENT");
    expect(err.reasons).toEqual(["an empty file cannot be attached", "fileName is required"]);
    expect(err.message).toBe("Attachment rejected: an empty file cannot be attached; fileName is required");
  });
});
