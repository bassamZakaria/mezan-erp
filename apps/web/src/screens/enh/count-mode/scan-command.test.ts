import { describe, expect, it } from "vitest";
import { appendKeypadDigit, parseScanInput, ScanCommandKind } from "./scan-command";
import { signedQty, trimQty, varianceDirection, VarianceDirection } from "./format";

describe("parseScanInput", () => {
  it("treats a plain string as a barcode, trimmed", () => {
    expect(parseScanInput("  6221000000011 ")).toEqual({ kind: ScanCommandKind.Barcode, barcode: "6221000000011" });
  });

  it("reads Arabic-Indic digits typed on an Arabic layout as Latin digits", () => {
    expect(parseScanInput("٦٢٢١")).toEqual({ kind: ScanCommandKind.Barcode, barcode: "6221" });
    expect(parseScanInput("*٢٤")).toEqual({ kind: ScanCommandKind.Multiplier, qty: "24" });
  });

  it("reads *N as a multiplier and =N as a set-total, and refuses a zero multiplier", () => {
    expect(parseScanInput("*12")).toEqual({ kind: ScanCommandKind.Multiplier, qty: "12" });
    expect(parseScanInput("=0")).toEqual({ kind: ScanCommandKind.SetTotal, qty: "0" });
    expect(parseScanInput("*0")).toEqual({ kind: ScanCommandKind.Invalid });
    expect(parseScanInput("*abc")).toEqual({ kind: ScanCommandKind.Invalid });
    expect(parseScanInput("=1.1234567")).toEqual({ kind: ScanCommandKind.Invalid });
  });

  it("is empty for whitespace", () => {
    expect(parseScanInput("   ")).toEqual({ kind: ScanCommandKind.Empty });
  });
});

describe("appendKeypadDigit", () => {
  it("builds a decimal quantity without a double point, a leading zero or more than six places", () => {
    expect(appendKeypadDigit("", ".")).toBe("0.");
    expect(appendKeypadDigit("0.", "5")).toBe("0.5");
    expect(appendKeypadDigit("0.5", ".")).toBe("0.5");
    expect(appendKeypadDigit("0", "7")).toBe("7");
    expect(appendKeypadDigit("1.123456", "7")).toBe("1.123456");
  });
});

describe("quantity formatting", () => {
  it("trims trailing zeros and signs a variance", () => {
    expect(trimQty("9.000000")).toBe("9");
    expect(trimQty("2.500000")).toBe("2.5");
    expect(trimQty(null)).toBe("—");
    expect(signedQty("-1.000000")).toBe("-1");
    expect(signedQty("3.000000")).toBe("+3");
    expect(signedQty("0.000000")).toBe("0");
    expect(varianceDirection("-0.500000")).toBe(VarianceDirection.Short);
    expect(varianceDirection("0.000000")).toBe(VarianceDirection.Matched);
  });
});
