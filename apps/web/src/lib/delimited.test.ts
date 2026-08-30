import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeNumeral, parseDelimited } from "./delimited";

describe("parseDelimited", () => {
  it("reads a comma file, the shape Excel's CSV export writes", () => {
    expect(parseDelimited("code,name,qty\nIT-1,قلم,5")).toEqual([
      ["code", "name", "qty"],
      ["IT-1", "قلم", "5"],
    ]);
  });

  it("reads a tab file, the shape a clipboard paste from Excel writes", () => {
    expect(parseDelimited("code\tname\nIT-1\tقلم")).toEqual([
      ["code", "name"],
      ["IT-1", "قلم"],
    ]);
  });

  it("reads a semicolon file, which an Arabic-locale Excel writes", () => {
    expect(parseDelimited("code;name\nIT-1;قلم")).toEqual([
      ["code", "name"],
      ["IT-1", "قلم"],
    ]);
  });

  it("keeps a comma that belongs to an Arabic item name", () => {
    expect(parseDelimited('code,name\nIT-1,"قلم أزرق, رفيع"')).toEqual([
      ["code", "name"],
      ["IT-1", "قلم أزرق, رفيع"],
    ]);
  });

  it("reads a doubled quote inside a quoted field as one quote", () => {
    expect(parseDelimited('name\n"مقاس ""كبير"""')).toEqual([["name"], ['مقاس "كبير"']]);
  });

  it("survives a quoted field that spans a line break", () => {
    expect(parseDelimited('name,note\nIT-1,"سطر\nآخر"')).toEqual([
      ["name", "note"],
      ["IT-1", "سطر\nآخر"],
    ]);
  });

  it("strips the byte-order mark a Windows export leaves at the front", () => {
    expect(parseDelimited("﻿code,name\nIT-1,قلم")[0]).toEqual(["code", "name"]);
  });

  it("normalises CRLF and lone CR line endings", () => {
    expect(parseDelimited("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseDelimited("a,b\rc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops blank rows rather than importing empty lines", () => {
    expect(parseDelimited("a,b\n\n,\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("   \n\t\n")).toEqual([]);
  });

  it("trims the padding a hand-typed sheet leaves around a cell", () => {
    expect(parseDelimited("  a  ,  b  ")).toEqual([["a", "b"]]);
  });

  it("falls back to comma when the first line carries no delimiter at all", () => {
    expect(parseDelimited("singlecolumn\nvalue")).toEqual([["singlecolumn"], ["value"]]);
  });
});

describe("normalizeNumeral", () => {
  it("converts Arabic-Indic digits, which an Arabic keyboard produces", () => {
    expect(normalizeNumeral("١٢٣")).toBe("123");
    expect(normalizeNumeral("٠")).toBe("0");
  });

  it("converts extended Arabic-Indic (Persian) digits too", () => {
    expect(normalizeNumeral("۱۲۳")).toBe("123");
  });

  it("converts the Arabic decimal separator to a dot", () => {
    expect(normalizeNumeral("١٢٫٥")).toBe("12.5");
  });

  it("removes both thousands separators", () => {
    expect(normalizeNumeral("1,250.50")).toBe("1250.50");
    expect(normalizeNumeral("١٬٢٥٠")).toBe("1250");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeNumeral("  ٤٢  ")).toBe("42");
  });

  it("leaves an already-plain number untouched", () => {
    expect(normalizeNumeral("1250.500000")).toBe("1250.500000");
  });

  it("produces something Number() can parse for every digit form", () => {
    for (const raw of ["١٢٣", "۱۲۳", "١٢٫٥", "1,250.50"]) {
      expect(Number.isNaN(Number(normalizeNumeral(raw)))).toBe(false);
    }
  });
});

describe("delimited parsing — fuzz", () => {
  const cellArb = fc.string({ maxLength: 12 }).filter((s) => !/["\n\r\t,;]/.test(s) && s.trim() === s && s !== "");

  it("fuzz: a grid written with any supported delimiter reads back unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(cellArb, { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 }),
        fc.constantFrom(",", "\t", ";"),
        (grid, delimiter) => {
          const width = (grid[0] as string[]).length;
          const rectangular = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "x"));
          const text = rectangular.map((row) => row.join(delimiter)).join("\n");
          expect(parseDelimited(text)).toEqual(rectangular);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fuzz: parsing is idempotent — re-joining and re-parsing gives the same grid", () => {
    fc.assert(
      fc.property(fc.array(fc.array(cellArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }), (grid) => {
        const width = (grid[0] as string[]).length;
        const rectangular = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "x"));
        const once = parseDelimited(rectangular.map((r) => r.join(",")).join("\n"));
        const twice = parseDelimited(once.map((r) => r.join(",")).join("\n"));
        expect(twice).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: normalising a numeral never introduces a non-numeric character", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 9 }), (value) => {
        const arabic = String(value).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
        expect(normalizeNumeral(arabic)).toBe(String(value));
      }),
      { numRuns: 400 },
    );
  });
});
