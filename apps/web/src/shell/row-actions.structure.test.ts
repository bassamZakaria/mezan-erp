import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCES = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
  });
}

function closingIndex(source: string, afterOpen: number, open: string, close: string): number {
  let depth = 1;
  let index = afterOpen;
  while (index < source.length && depth > 0) {
    if (source[index] === open) depth += 1;
    else if (source[index] === close) depth -= 1;
    index += 1;
  }
  return index - 1;
}

function handlerBody(source: string, name: string): string | null {
  const declared = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  if (!declared) return null;
  const paramsEnd = closingIndex(source, declared.index + declared[0].length, "(", ")");
  const bodyStart = source.indexOf("{", paramsEnd);
  return source.slice(bodyStart + 1, closingIndex(source, bodyStart + 1, "{", "}"));
}

function rowActions(source: string): { line: number; expression: string }[] {
  return [...source.matchAll(/onSelect:\s*/g)].map((match) => {
    const start = match.index! + match[0].length;
    let depth = 0;
    let end = start;
    for (; end < source.length; end++) {
      const char = source[end]!;
      if ("([{".includes(char)) depth += 1;
      else if (")]}".includes(char)) {
        if (depth === 0) break;
        depth -= 1;
      } else if (char === "," && depth === 0) break;
    }
    return { line: source.slice(0, start).split("\n").length, expression: source.slice(start, end) };
  });
}

function swallowsItsFailure(body: string): boolean {
  if (!/\bcatch\b/.test(body) || !/mutateAsync|request\(/.test(body)) return false;
  return [...body.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)].some((match) => {
    const start = match.index! + match[0].length;
    const block = body.slice(start, closingIndex(body, start, "{", "}"));
    return !block.includes("RowActionOutcome.Refused") && !/\bthrow\b/.test(block);
  });
}

/*
 * The row menu says «تم تنفيذ» when the action it awaited resolves. A handler
 * that catches its own failure and resolves, or one fired without being
 * returned, makes that a false success beside the screen's own refusal.
 */
describe("every row action tells the menu how it ended", () => {
  const findings = sourceFiles(SOURCES).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    if (!source.includes("onSelect")) return [];
    const file = path.slice(SOURCES.length + 1);
    return rowActions(source).flatMap(({ line, expression }) => {
      const found: string[] = [];
      if (/\.mutate\(/.test(expression)) found.push(`${file}:${line} fires a mutation without awaiting it`);
      if (/\bcatch\b/.test(expression) && !expression.includes("RowActionOutcome.Refused") && !/\bthrow\b/.test(expression)) found.push(`${file}:${line} catches its failure inline and resolves`);
      for (const name of new Set([...expression.matchAll(/\b([a-z][A-Za-z0-9]*)\(/g)].map((call) => call[1]!))) {
        const body = handlerBody(source, name);
        if (body === null) continue;
        if (/\.mutate\(/.test(body)) found.push(`${file}:${line} ${name} fires a mutation without awaiting it`);
        if (swallowsItsFailure(body)) found.push(`${file}:${line} ${name} catches its failure and resolves`);
        const handled = /\bcatch\b/.test(body) && /mutateAsync|request\(/.test(body);
        if (handled && new RegExp(`\\bvoid\\s+${name}\\(`).test(expression)) found.push(`${file}:${line} discards ${name}'s outcome with void`);
        if (handled && /^\s*(?:async\s*)?\(\)\s*=>\s*\{/.test(expression) && !new RegExp(`return\\s+(?:await\\s+)?${name}\\(`).test(expression)) found.push(`${file}:${line} calls ${name} without returning it`);
      }
      return found;
    });
  });

  it("reads the screens' row actions", () => {
    expect(sourceFiles(SOURCES).filter((path) => readFileSync(path, "utf8").includes("onSelect")).length).toBeGreaterThan(50);
  });

  it("no handler resolves after a failure, and none is fired without being returned", () => {
    expect(findings).toEqual([]);
  });
});
