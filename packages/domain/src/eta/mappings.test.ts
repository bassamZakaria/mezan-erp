import { describe, expect, it } from "vitest";
import { ETA_UNIT_CODES, isEtaUnitCode, suggestEtaUnitCode } from "./mappings.js";

describe("the authority's unit codes", () => {
  it("carries a distinct code and both labels for every unit", () => {
    const codes = ETA_UNIT_CODES.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const unit of ETA_UNIT_CODES) {
      expect(unit.labelAr.trim().length).toBeGreaterThan(0);
      expect(unit.labelEn.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(unit.labelAr)).toBe(true);
    }
  });

  it("recognises its own codes and nothing else", () => {
    for (const unit of ETA_UNIT_CODES) expect(isEtaUnitCode(unit.code)).toBe(true);
    for (const wrong of ["PCS", "ea", "KG", "", "BOX"]) expect(isEtaUnitCode(wrong)).toBe(false);
  });
});

describe("suggestEtaUnitCode — by the tenant's own code", () => {
  it("maps the piece family to EA", () => {
    for (const code of ["PCS", "PC", "PIECE", "EA", "EACH", "UNIT", "NO"]) {
      expect(suggestEtaUnitCode(code, "")).toBe("EA");
    }
  });

  it("maps weight, volume and length families to their codes", () => {
    expect(suggestEtaUnitCode("KG", "")).toBe("KGM");
    expect(suggestEtaUnitCode("G", "")).toBe("GRM");
    expect(suggestEtaUnitCode("TON", "")).toBe("TNE");
    expect(suggestEtaUnitCode("L", "")).toBe("LTR");
    expect(suggestEtaUnitCode("ML", "")).toBe("MLT");
    expect(suggestEtaUnitCode("M", "")).toBe("MTR");
    expect(suggestEtaUnitCode("CM", "")).toBe("CMT");
    expect(suggestEtaUnitCode("M2", "")).toBe("MTK");
    expect(suggestEtaUnitCode("M3", "")).toBe("MTQ");
  });

  it("maps the packaging and time families", () => {
    expect(suggestEtaUnitCode("CARTON", "")).toBe("BX");
    expect(suggestEtaUnitCode("PACK", "")).toBe("PK");
    expect(suggestEtaUnitCode("DOZ", "")).toBe("DZN");
    expect(suggestEtaUnitCode("SET", "")).toBe("SET");
    expect(suggestEtaUnitCode("ROLL", "")).toBe("ROL");
    expect(suggestEtaUnitCode("HR", "")).toBe("HUR");
    expect(suggestEtaUnitCode("DAY", "")).toBe("DAY");
  });

  it("ignores the case and the padding a hand-typed code carries", () => {
    expect(suggestEtaUnitCode("  kg  ", "")).toBe("KGM");
    expect(suggestEtaUnitCode("Pcs", "")).toBe("EA");
  });
});

describe("suggestEtaUnitCode — by the Arabic name", () => {
  it("falls back to the name when the code says nothing", () => {
    expect(suggestEtaUnitCode("U1", "قطعة")).toBe("EA");
    expect(suggestEtaUnitCode("U2", "كيلو جرام")).toBe("KGM");
    expect(suggestEtaUnitCode("U3", "كرتونة")).toBe("BX");
    expect(suggestEtaUnitCode("U4", "دستة")).toBe("DZN");
    expect(suggestEtaUnitCode("U5", "ساعة")).toBe("HUR");
  });

  it("prefers the longer Arabic match, so a square metre is not filed as a metre", () => {
    expect(suggestEtaUnitCode("U6", "متر مربع")).toBe("MTK");
    expect(suggestEtaUnitCode("U7", "متر مكعب")).toBe("MTQ");
    expect(suggestEtaUnitCode("U8", "متر")).toBe("MTR");
  });

  it("matches a name that merely contains the word, taking the first family that appears in the table", () => {
    expect(suggestEtaUnitCode("U9", "علبة كرتون كبيرة")).toBe("BX");
    expect(suggestEtaUnitCode("U10", "علبة صغيرة")).toBe("PK");
  });

  it("lets the code win over the name when both would match", () => {
    expect(suggestEtaUnitCode("KG", "قطعة")).toBe("KGM");
  });

  it("returns nothing rather than guessing when neither matches", () => {
    expect(suggestEtaUnitCode("ZZZ", "شوال")).toBeNull();
    expect(suggestEtaUnitCode("", "")).toBeNull();
  });

  it("only ever suggests a code the authority actually recognises", () => {
    for (const [code, name] of [
      ["PCS", ""],
      ["", "كيلو"],
      ["CTN", ""],
      ["", "لفة"],
    ] as const) {
      const suggestion = suggestEtaUnitCode(code, name);
      expect(suggestion).not.toBeNull();
      expect(isEtaUnitCode(suggestion as string)).toBe(true);
    }
  });
});
