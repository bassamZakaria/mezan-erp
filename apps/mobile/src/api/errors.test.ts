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
