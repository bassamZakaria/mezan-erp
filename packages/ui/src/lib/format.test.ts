import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatNumber, toArabicDigits } from "./format";

describe("toArabicDigits", () => {
  it("maps every ASCII digit to Eastern Arabic-Indic", () => {
    expect(toArabicDigits("0123456789")).toBe("٠١٢٣٤٥٦٧٨٩");
  });

  it("leaves non-digit characters untouched", () => {
    expect(toArabicDigits("10/08/2026")).toBe("١٠/٠٨/٢٠٢٦");
  });
});

describe("formatNumber", () => {
  it("groups thousands with western punctuation by default", () => {
    expect(formatNumber(86240)).toBe("86,240");
  });

  it("keeps the negative sign attached to the start of the figure", () => {
    expect(formatNumber(-18087.5, { maximumFractionDigits: 2, minimumFractionDigits: 2 })).toBe("-18,087.50");
  });

  it("never renders a bare negative zero", () => {
    expect(formatNumber(-0)).toBe("0");
  });

  it("renders Eastern Arabic-Indic digits on request, sign included", () => {
    expect(formatNumber(-1234, { numerals: "arabic" })).toBe("-١,٢٣٤");
  });
});

describe("formatMoney", () => {
  it("always shows exactly two fraction digits", () => {
    expect(formatMoney(1150)).toBe("1,150.00");
  });

  it("formats a negative balance correctly", () => {
    expect(formatMoney(-450)).toBe("-450.00");
  });
});

describe("formatDate", () => {
  it("formats the short style as DD/MM/YYYY with western digits", () => {
    expect(formatDate("2026-08-10T00:00:00")).toBe("10/08/2026");
  });

  it("formats the short style with Eastern Arabic-Indic digits on request", () => {
    expect(formatDate("2026-08-10T00:00:00", { numerals: "arabic" })).toBe("١٠/٠٨/٢٠٢٦");
  });

  it("formats the long style with Arabic weekday/month names", () => {
    const result = formatDate("2026-08-21T00:00:00", { style: "long" });
    expect(result).toContain("أغسطس");
    expect(result).toContain("2026");
  });

  it("accepts a Date instance directly", () => {
    expect(formatDate(new Date(2026, 7, 10))).toBe("10/08/2026");
  });
});
