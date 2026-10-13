import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = dirname(fileURLToPath(import.meta.url));

const DECIMAL_WORDS: ReadonlySet<string> = new Set(["amount", "amounts", "qty", "quantity", "price", "rate"]);
const NAMES_SOMETHING_ELSE: ReadonlySet<string> = new Set(["id", "ids", "at", "date", "formula", "code", "type", "mode", "label", "name", "currency", "method", "column", "source", "basis", "kind", "status", "key", "note", "notes", "list", "unit"]);
const PERCENT_LIKE: ReadonlySet<string> = new Set(["percent", "bps"]);
const NUMBER_BOUNDS: ReadonlySet<string> = new Set(["min", "max", "int", "nonnegative", "positive", "gte", "lte", "gt", "lt", "multipleOf"]);

const NUMERIC_EXCEPTIONS: Readonly<Record<string, string>> = {
  "tax-rate.ts:rate": "a percentage; its 0–100 range is refused by the domain as INVALID_TAX_RATE (422), on purpose",
  "eta.ts:rate": "a percentage read back from the tax-rate registry; response only",
  "financial-reports.ts:amount": "a report row's figure, response only — carried as a number until the report engine carries decimal strings",
  "financial-reports.ts:rate": "a report row's percentage, response only",
  "items.ts:reorderQty": "a whole reorder quantity; a negative one is refused by the domain as INVALID_ITEM (422)",
  "data-migration.ts:reorderQty": "a whole reorder quantity; a negative one is refused by the domain as INVALID_ITEM (422)",
};

const FIELD = /(?:^|[\s{,])([A-Za-z_][A-Za-z0-9_]*)\??:\s*z\s*\.\s*(string|number)\(\)((?:\s*\.\s*[A-Za-z]+\((?:[^()]|\([^()]*\))*\))*)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [full] : [];
    });
}

const wordsOf = (name: string): string[] => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_]+/);

interface DecimalField {
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly kind: string;
  readonly chain: readonly string[];
}

function decimalFields(): DecimalField[] {
  const found: DecimalField[] = [];
  for (const path of sourceFiles(ROOT)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(FIELD)) {
      const words = wordsOf(match[1]!);
      if (!words.some((word) => DECIMAL_WORDS.has(word)) || NAMES_SOMETHING_ELSE.has(words.at(-1)!)) continue;
      found.push({
        file: relative(ROOT, path),
        line: source.slice(0, match.index).split("\n").length + (match[0].startsWith("\n") ? 1 : 0),
        name: match[1]!,
        kind: match[2]!,
        chain: [...match[3]!.matchAll(/\.\s*([A-Za-z]+)\(/g)].map((call) => call[1]!),
      });
    }
  }
  return found;
}

const fields = decimalFields();
const at = (field: DecimalField) => `${field.file}:${field.line} ${field.name}`;

describe("contract fields that carry an amount, a quantity, a price or a rate", () => {
  it("reads the contract sources", () => {
    expect(sourceFiles(ROOT).length).toBeGreaterThan(80);
  });

  it("none is a z.string() of its own — each uses the shared decimal-string schema, so a malformed literal is a 400 and not a 500", () => {
    expect(fields.filter((field) => field.kind === "string").map(at)).toEqual([]);
  });

  it("none is an unbounded z.number() unless it is a percentage by name or a stated exception", () => {
    const unbounded = fields.filter(
      (field) =>
        field.kind === "number" &&
        !PERCENT_LIKE.has(wordsOf(field.name).at(-1)!) &&
        !field.chain.some((call) => NUMBER_BOUNDS.has(call)) &&
        NUMERIC_EXCEPTIONS[`${field.file}:${field.name}`] === undefined,
    );
    expect(unbounded.map(at)).toEqual([]);
  });

  it("names no exception that no longer exists", () => {
    const present = new Set(fields.filter((field) => field.kind === "number").map((field) => `${field.file}:${field.name}`));
    expect(Object.keys(NUMERIC_EXCEPTIONS).filter((key) => !present.has(key))).toEqual([]);
  });

  it("catches a declaration split across lines, and leaves alone a name that only contains one of the words", () => {
    const sample = "x = z.object({\n  unitPrice: z\n    .string()\n    .optional(),\n  governorate: z.string(),\n  priceListId: z.string(),\n  fxRateDate: z.string(),\n})";
    const hits = [...sample.matchAll(FIELD)].map((match) => match[1]).filter((name) => wordsOf(name!).some((word) => DECIMAL_WORDS.has(word)) && !NAMES_SOMETHING_ELSE.has(wordsOf(name!).at(-1)!));
    expect(hits).toEqual(["unitPrice"]);
  });
});
