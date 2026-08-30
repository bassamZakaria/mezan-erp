import { describe, expect, it } from "vitest";
import { entityName } from "./entity-names";

describe("entityName", () => {
  it("reads nameAr in Arabic", () => {
    expect(entityName({ nameAr: "النقدية", nameEn: "Cash" }, "ar")).toBe("النقدية");
  });

  it("reads nameEn in English", () => {
    expect(entityName({ nameAr: "النقدية", nameEn: "Cash" }, "en")).toBe("Cash");
  });

  it("accepts the plain `name` spelling that branches, warehouses and treasury accounts use", () => {
    expect(entityName({ name: "الفرع الرئيسي" }, "ar")).toBe("الفرع الرئيسي");
    expect(entityName({ name: "الفرع الرئيسي", nameEn: "Main branch" }, "en")).toBe("Main branch");
  });

  it("prefers nameAr over name when a record carries both", () => {
    expect(entityName({ nameAr: "أ", name: "ب" }, "ar")).toBe("أ");
  });

  it("falls back to Arabic rather than showing a blank when nameEn was never filled in", () => {
    expect(entityName({ nameAr: "النقدية", nameEn: null }, "en")).toBe("النقدية");
    expect(entityName({ nameAr: "النقدية", nameEn: "" }, "en")).toBe("النقدية");
    expect(entityName({ nameAr: "النقدية", nameEn: "   " }, "en")).toBe("النقدية");
  });

  it("uses the caller's fallback for a missing record", () => {
    expect(entityName(null, "ar", "ACC-1")).toBe("ACC-1");
    expect(entityName(undefined, "en", "ACC-1")).toBe("ACC-1");
    expect(entityName(null, "ar")).toBe("");
  });

  it("uses the fallback when the record has no name at all", () => {
    expect(entityName({}, "ar", "ACC-1")).toBe("ACC-1");
    expect(entityName({ nameEn: null }, "en", "ACC-1")).toBe("ACC-1");
  });

  it("treats any locale that is not English as Arabic", () => {
    expect(entityName({ nameAr: "النقدية", nameEn: "Cash" }, "fr")).toBe("النقدية");
    expect(entityName({ nameAr: "النقدية", nameEn: "Cash" }, "")).toBe("النقدية");
  });

  it("never leaks Arabic into the English UI when an English name exists", () => {
    const records = [
      { nameAr: "قطعة", nameEn: "Piece" },
      { name: "الخزنة الرئيسية", nameEn: "Main safe" },
    ];
    for (const record of records) {
      expect(/[؀-ۿ]/.test(entityName(record, "en"))).toBe(false);
    }
  });
});
