import { describe, expect, it } from "vitest";
import { guessColumnIndex, parseCsv } from "./csv-utils";

describe("parseCsv", () => {
  it("parses a simple header + rows CSV", () => {
    const result = parseCsv("name,code\nCoffee,I-1\nTea,I-2");
    expect(result.headers).toEqual(["name", "code"]);
    expect(result.rows).toEqual([
      ["Coffee", "I-1"],
      ["Tea", "I-2"],
    ]);
  });

  it("handles a quoted field with an embedded comma", () => {
    const result = parseCsv('name,note\n"Coffee, Arabic",good');
    expect(result.rows).toEqual([["Coffee, Arabic", "good"]]);
  });

  it("handles a quoted field with an embedded newline", () => {
    const result = parseCsv('name,note\n"line1\nline2",x');
    expect(result.rows).toEqual([["line1\nline2", "x"]]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const result = parseCsv('name\n"He said ""hi"""');
    expect(result.rows).toEqual([['He said "hi"']]);
  });

  it("handles CRLF line endings the same as bare LF", () => {
    const result = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("drops a fully blank row (every field is whitespace-only)", () => {
    const result = parseCsv("a,b\n1,2\n,\n3,4");
    expect(result.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("still captures the last row when the file has no trailing newline", () => {
    const result = parseCsv("a,b\n1,2");
    expect(result.rows).toEqual([["1", "2"]]);
  });

  it("returns empty headers and rows for an empty string", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("returns just the header with no data rows when there's only a header line", () => {
    const result = parseCsv("a,b,c");
    expect(result.headers).toEqual(["a", "b", "c"]);
    expect(result.rows).toEqual([]);
  });
});

describe("guessColumnIndex", () => {
  it("matches case-insensitively", () => {
    expect(guessColumnIndex(["Item Code", "Name"], ["item code"])).toBe(0);
  });

  it("normalizes spaces, underscores and hyphens on both sides", () => {
    expect(guessColumnIndex(["item_code"], ["Item-Code"])).toBe(0);
    expect(guessColumnIndex(["Item Code"], ["item_code"])).toBe(0);
  });

  it("returns -1 when no candidate matches any header", () => {
    expect(guessColumnIndex(["name"], ["code", "sku"])).toBe(-1);
  });

  it("returns the index of the FIRST matching candidate even if a later candidate would also match a different header", () => {
    expect(guessColumnIndex(["sku", "code"], ["code", "sku"])).toBe(1);
  });

  it("trims surrounding whitespace before comparing", () => {
    expect(guessColumnIndex([" Item Code "], ["itemcode"])).toBe(0);
  });
});
