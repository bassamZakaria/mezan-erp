import { describe, expect, it } from "vitest";
import { readReportFieldErrors } from "./report-errors";

function fakeRes(body: unknown, failToParse = false) {
  return {
    json: async <T>() => {
      if (failToParse) throw new Error("invalid json");
      return body as T;
    },
  };
}

describe("readReportFieldErrors", () => {
  it("returns undefined when the body carries no errors and no message", async () => {
    await expect(readReportFieldErrors(fakeRes({}))).resolves.toBeUndefined();
  });

  it("keys messages by field", async () => {
    const result = await readReportFieldErrors(
      fakeRes({ errors: [{ field: "fromDate", message: "التاريخ غير صالح" }] }),
    );
    expect(result).toEqual({ fromDate: "التاريخ غير صالح" });
  });

  it("combines multiple messages for the same field with a space", async () => {
    const result = await readReportFieldErrors(
      fakeRes({
        errors: [
          { field: "toDate", message: "مطلوب" },
          { field: "toDate", message: "يجب أن يكون بعد تاريخ البداية" },
        ],
      }),
    );
    expect(result).toEqual({ toDate: "مطلوب يجب أن يكون بعد تاريخ البداية" });
  });

  it("files a field-less error under _root", async () => {
    const result = await readReportFieldErrors(fakeRes({ errors: [{ message: "خطأ عام" }] }));
    expect(result).toEqual({ _root: "خطأ عام" });
  });

  it("skips an error entry with no message", async () => {
    const result = await readReportFieldErrors(fakeRes({ errors: [{ field: "x" }] }));
    expect(result).toBeUndefined();
  });

  it("falls back to the bare message when there are no field errors (routes outside the report engine)", async () => {
    const result = await readReportFieldErrors(fakeRes({ message: "غير مصرح" }));
    expect(result).toEqual({ _root: "غير مصرح" });
  });

  it("prefers field errors over the bare message when both are present", async () => {
    const result = await readReportFieldErrors(
      fakeRes({ message: "فشل عام", errors: [{ field: "q", message: "قيمة غير صالحة" }] }),
    );
    expect(result).toEqual({ q: "قيمة غير صالحة" });
  });

  it("returns undefined (not a rejection) when the response body fails to parse", async () => {
    await expect(readReportFieldErrors(fakeRes({}, true))).resolves.toBeUndefined();
  });
});
