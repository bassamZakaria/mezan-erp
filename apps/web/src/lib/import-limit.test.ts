import { describe, expect, it } from "vitest";
import { IMPORT_ROW_LIMIT, importTooLargeMessage } from "@mezan/contracts";
import { oversizeImportRefusal } from "./import-limit";

describe("an import file checked before it is uploaded", () => {
  it("is let through at the limit and refused one row over, in the server's own sentence for the reader's language", () => {
    expect(oversizeImportRefusal(IMPORT_ROW_LIMIT, "ar")).toBeNull();
    expect(oversizeImportRefusal(IMPORT_ROW_LIMIT + 1, "ar")).toBe(importTooLargeMessage(IMPORT_ROW_LIMIT + 1).ar);
    expect(oversizeImportRefusal(IMPORT_ROW_LIMIT + 1, "en")).toBe(importTooLargeMessage(IMPORT_ROW_LIMIT + 1).en);
    expect(oversizeImportRefusal(IMPORT_ROW_LIMIT + 1, "ar")).toContain("قسّم الملف");
  });
});
