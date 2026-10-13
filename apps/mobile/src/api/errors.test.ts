import { describe, expect, it } from "vitest";
import { STRINGS, Locale } from "../i18n/strings";
import { ApiError, ApiFailure, describeApiError, describeWriteError } from "./errors";

const strings = STRINGS[Locale.Ar];

describe("describeWriteError", () => {
  it("shows the offline-write sentence for a network failure", () => {
    const error = new ApiError(ApiFailure.Network, null, null, null);
    expect(describeWriteError(error, strings)).toBe(strings.common.offlineWrite);
  });

  it("shows the server's own Arabic refusal when it sent one", () => {
    const error = new ApiError(ApiFailure.Refused, 422, "الحد الائتماني غير كافٍ", null);
    expect(describeWriteError(error, strings)).toBe("الحد الائتماني غير كافٍ");
  });

  it("falls back to describeApiError for every other failure", () => {
    const error = new ApiError(ApiFailure.Forbidden, 403, null, null);
    expect(describeWriteError(error, strings)).toBe(describeApiError(error, strings));
  });

  it("treats a non-ApiError as a server failure, not an offline write", () => {
    expect(describeWriteError(new Error("boom"), strings)).toBe(strings.errors.server);
  });
});

describe("a sign-in the server refused without a sentence of its own", () => {
  it("says, each in its own Arabic words, that the account is locked, that there were too many attempts, that the audit log is unavailable, and that the server is busy", () => {
    const said = [
      describeApiError(new ApiError(ApiFailure.Locked, 423, null, null, "ACCOUNT_LOCKED"), strings),
      describeApiError(new ApiError(ApiFailure.Throttled, 429, null, null, "TOO_MANY_ATTEMPTS"), strings),
      describeApiError(new ApiError(ApiFailure.Unavailable, 503, null, null, "AUDIT_UNAVAILABLE"), strings),
      describeApiError(new ApiError(ApiFailure.Unavailable, 503, null, null, "SIGN_IN_BUSY"), strings),
      strings.errors.server,
      strings.errors.unauthorized,
    ];

    expect(said[0]).toBe("تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. اطلب من مدير النظام فكّ القفل من شاشة المستخدمين.");
    expect(said[1]).toBe("محاولات دخول كثيرة. انتظر قليلاً ثم حاول مرة أخرى.");
    expect(said[2]).toBe("تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.");
    expect(said[3]).toBe("الخادم مشغول الآن، ولم تُحتسب هذه المحاولة. أعد المحاولة بعد قليل.");
    expect(new Set(said).size).toBe(said.length);
  });

  it("still prefers the sentence the server sent", () => {
    expect(describeApiError(new ApiError(ApiFailure.Locked, 423, "تم قفل هذا الحساب. أُرسل رمز.", null, "ACCOUNT_LOCKED"), strings)).toBe("تم قفل هذا الحساب. أُرسل رمز.");
  });
});
