import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROOTS = ["packages/persistence/src", "packages/backend/src", "packages/api/src", "apps/server/src", "apps/desktop/src"];

const CREATE_TABLE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s*(?:WITHOUT\s+ROWID\s*)?;/gi;
const CREATE_INDEX = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;`]*?)\)\s*(?:WHERE\s+([^;`]*?))?\s*[;`]/gi;
const TABLE_CONSTRAINT = /^(?:PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i;
const SQL_WORDS = new Set(["asc", "desc", "collate", "nocase", "binary", "is", "not", "null", "and", "or", "in", "lower", "upper", "coalesce", "ifnull", "true", "false", "like", "between"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === "dist" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const identifiers = (sql: string): string[] =>
  (sql.replace(/'[^']*'/g, " ").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((word) => !SQL_WORDS.has(word.toLowerCase()));

describe("every index names only columns its table's CREATE TABLE declares", () => {
  const files = ROOTS.flatMap((root) => sources(join(REPO, root)));
  const declared = new Map<string, Set<string>>();
  for (const file of files) {
    for (const match of readFileSync(file, "utf8").matchAll(CREATE_TABLE)) {
      const columns = declared.get(match[1]!) ?? new Set<string>();
      for (const line of match[2]!.split("\n")) {
        const definition = line.trim().replace(/,$/, "");
        if (!definition || TABLE_CONSTRAINT.test(definition)) continue;
        const name = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(definition)?.[1];
        if (name) columns.add(name);
      }
      declared.set(match[1]!, columns);
    }
  }

  it("finds the stores", () => {
    expect(declared.size).toBeGreaterThan(100);
    expect(declared.get("bank_statement")).toContain("branch_id");
  });

  it("so the schema hook can add the column to an older file before the index is built", () => {
    const undeclared: string[] = [];
    let indexes = 0;
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(CREATE_INDEX)) {
        const [, index, table, columnList, where] = match;
        const columns = declared.get(table!);
        if (!columns) continue;
        indexes += 1;
        for (const column of [...identifiers(columnList!), ...identifiers(where ?? "")]) {
          if (!columns.has(column)) undeclared.push(`${relative(REPO, file)}: ${index} names ${table}.${column}`);
        }
      }
    }
    expect(indexes).toBeGreaterThan(100);
    expect(undeclared).toEqual([]);
  });
});
