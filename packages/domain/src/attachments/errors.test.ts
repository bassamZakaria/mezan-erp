import { describe, it, expect } from "vitest";
import { AttachmentNotFoundError, InvalidAttachmentError } from "./errors.js";

describe("AttachmentNotFoundError", () => {
  it("carries the id in its message", () => {
    const err = new AttachmentNotFoundError("att-1");
    expect(err.code).toBe("ATTACHMENT_NOT_FOUND");
    expect(err.name).toBe("AttachmentNotFoundError");
    expect(err.message).toBe("المرفق 'att-1' غير موجود.");
    expect(err.messageEn).toBe("Attachment 'att-1' was not found.");
  });
});

describe("InvalidAttachmentError", () => {
  it("joins reasons into the message and exposes them on .reasons", () => {
    const err = new InvalidAttachmentError([
      { ar: "لا يمكن إرفاق ملف فارغ", en: "An empty file cannot be attached" },
      { ar: "اسم الملف مطلوب", en: "The file name is required" },
    ]);
    expect(err.code).toBe("INVALID_ATTACHMENT");
    expect(err.reasons).toEqual(["لا يمكن إرفاق ملف فارغ", "اسم الملف مطلوب"]);
    expect(err.message).toBe("تم رفض المرفق: لا يمكن إرفاق ملف فارغ، اسم الملف مطلوب");
    expect(err.messageEn).toBe("Attachment rejected: An empty file cannot be attached; The file name is required");
  });
});
