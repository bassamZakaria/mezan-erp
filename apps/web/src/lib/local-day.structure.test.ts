import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CLIENT_SOURCES = ["apps/web/src", "apps/mobile/src", "packages/ui/src"];

const UTC_DAY_OF_AN_INSTANT = /\.toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|substr\(\s*0\s*,\s*10\s*\)|split\(\s*["'`]T["'`]\s*\)\s*\[\s*0\s*\])/g;
const UTC_PART_OF_NOW = /new Date\(\)\s*\.\s*getUTC(?:FullYear|Month|Date|Day)\(\)/g;

interface Allowance {
  readonly file: string;
  readonly occurrences: number;
  readonly why: string;
}

const ALLOWED: readonly Allowance[] = [
  { file: "apps/web/src/lib/dates.ts", occurrences: 1, why: "addDaysIso: UTC arithmetic on a calendar day that was already given, never on the clock" },
  { file: "apps/mobile/src/domain/dates.ts", occurrences: 1, why: "addDaysIso: UTC arithmetic on a calendar day that was already given, never on the clock" },
  { file: "packages/ui/src/lib/data-migration-file.ts", occurrences: 1, why: "a spreadsheet date cell, which ExcelJS hands over as UTC midnight of the day typed" },
  { file: "packages/ui/src/lib/historical-import-file.ts", occurrences: 1, why: "a spreadsheet date cell, which ExcelJS hands over as UTC midnight of the day typed" },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

function occurrencesByFile(pattern: RegExp): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const root of CLIENT_SOURCES) {
    for (const path of sourceFiles(join(REPO, root))) {
      const source = readFileSync(path, "utf8");
      const lines = [...source.matchAll(pattern)].map((match) => source.slice(0, match.index).split("\n").length);
      if (lines.length > 0) found.set(relative(REPO, path).split("\\").join("/"), lines);
    }
  }
  return found;
}

describe("a client reads the day from the local calendar, never from the UTC instant", () => {
  it("no screen slices an ISO instant down to a day outside the date helpers", () => {
    const allowed = new Map(ALLOWED.map((entry) => [entry.file, entry.occurrences]));
    const offenders = [...occurrencesByFile(UTC_DAY_OF_AN_INSTANT)]
      .filter(([file, lines]) => lines.length !== (allowed.get(file) ?? 0))
      .map(([file, lines]) => `${file}:${lines.join(",")} — ${lines.length} found, ${allowed.get(file) ?? 0} allowed`);
    expect(offenders, "use todayIso()/addDaysIso()/localIsoDay() from the date helper: between 00:00 and 03:00 Cairo the UTC day is yesterday").toEqual([]);
  });

  it("every allowance still names a real occurrence and says why", () => {
    const found = occurrencesByFile(UTC_DAY_OF_AN_INSTANT);
    for (const entry of ALLOWED) {
      expect(found.get(entry.file)?.length ?? 0, entry.file).toBe(entry.occurrences);
      expect(entry.why.length, entry.file).toBeGreaterThan(20);
    }
  });

  it("no screen reads the year, month or day of right now in UTC", () => {
    const offenders = [...occurrencesByFile(UTC_PART_OF_NOW)].map(([file, lines]) => `${file}:${lines.join(",")}`);
    expect(offenders).toEqual([]);
  });
});
