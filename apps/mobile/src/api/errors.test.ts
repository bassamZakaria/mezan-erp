import { describe, expect, it } from "vitest";
import { STRINGS, Locale } from "../i18n/strings";
import { afterEach, vi } from "vitest";
import { apiRequest } from "./client";
import { ApiError, ApiFailure, describeApiError, describeWriteError, rerateNoticeOf } from "./errors";

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
describe("a confirm the server refuses because posting would re-rate the draft", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const refusedWith = (body: unknown) =>
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 409, headers: { "content-type": "application/json" } }));
  const confirm = () =>
    apiRequest({ baseUrl: "http://local", token: "t" } as never, "/sales-invoices/INV-1/confirm", { method: "POST" as never, body: {} }).then(
      () => null,
      (error: unknown) => error,
    );

  it("carries the total that would post, so the screen can show it beside the one it showed", async () => {
    refusedWith({ error: "SALES_TAX_RECALCULATION_UNACKNOWLEDGED", taxRecalculated: true, message: "تغيّر إعداد الضريبة.", totals: { taxableTotal: "100.000000", taxTotal: "0.000000", grandTotal: "100.000000" } });
    const error = await confirm();
    expect(error).toBeInstanceOf(ApiError);
    expect(rerateNoticeOf(error, "114.000000")).toEqual({ message: "تغيّر إعداد الضريبة.", shownTotal: "114.000000", recalculatedTotal: "100.000000" });
  });

  it("is an ordinary refusal when the server names no recalculated total", async () => {
    refusedWith({ error: "PERIOD_NOT_OPEN_FOR_POSTING", message: "الفترة مقفلة." });
    const error = await confirm();
    expect(rerateNoticeOf(error, "114.000000")).toBeNull();
    expect(describeWriteError(error, strings)).toBe("الفترة مقفلة.");
    expect(rerateNoticeOf(new Error("boom"), "1")).toBeNull();
  });
});

