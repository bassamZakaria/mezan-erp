import { describe, expect, it } from "vitest";
import { ApiError } from "../data/hooks";
import { errorMessage } from "./error-message";

const FALLBACK = "تعذر حفظ الفاتورة.";

describe("errorMessage", () => {
  it("shows the server's own Arabic refusal verbatim", () => {
    expect(errorMessage(new ApiError(409, "الفترة مقفلة"), FALLBACK)).toBe("الفترة مقفلة");
    expect(errorMessage(new ApiError(400, "الكمية تتجاوز المتاح"), FALLBACK)).toBe("الكمية تتجاوز المتاح");
  });

  it("hides an internal failure behind the caller's Arabic fallback", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new Error("Cannot read properties of undefined"), FALLBACK)).toBe(FALLBACK);
  });

  it("never renders an object, a string or a null as if it were a message", () => {
    expect(errorMessage({ error: "BOOM" }, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage("PERMISSION_DENIED", FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(500, FALLBACK)).toBe(FALLBACK);
  });

  it("uses the fallback when the ApiError carries no text to read", () => {
    expect(errorMessage(new ApiError(500, ""), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new ApiError(500, "   "), FALLBACK)).toBe(FALLBACK);
  });

  it("keeps the whole message, including one that names an amount", () => {
    const message = "تجاوز الحد الائتماني بمبلغ 1250.500000 — الحد 1000.000000.";
    expect(errorMessage(new ApiError(422, message), FALLBACK)).toBe(message);
  });

  it("shows no English to an Arabic-first user, whatever the failure was", () => {
    const internal = [new TypeError("Failed to fetch"), new Error("[object Object]"), "boom", { x: 1 }];
    for (const err of internal) {
      expect(/[A-Za-z]{4,}/.test(errorMessage(err, FALLBACK))).toBe(false);
    }
  });
});
