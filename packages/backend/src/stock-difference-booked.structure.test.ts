import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCANNED = ["domain/src", "api/src", "backend/src"];

const RETURNS_A_DIFFERENCE_TO_BOOK = new Set([
  "applyDocumentStockPlan",
  "postReceipt",
  "reverseReceipt",
  "applyReceiptCostVariance",
  "applyLandedCostRevaluation",
  "reverseLandedCostRevaluation",
]);

function sourcesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "dist" ? [] : sourcesUnder(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

function discardedResults(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && RETURNS_A_DIFFERENCE_TO_BOOK.has(node.expression.name.text)) {
      let outer: ts.Node = node;
      while (ts.isAwaitExpression(outer.parent) || ts.isParenthesizedExpression(outer.parent) || ts.isNonNullExpression(outer.parent)) outer = outer.parent;
      if (ts.isExpressionStatement(outer.parent) || ts.isVoidExpression(outer.parent)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${file}:${line + 1} ${node.expression.name.text}(…)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("what a stock change did not take at the document's stated value is never dropped", () => {
  it("no caller discards the result of a stock change that hands back a difference to book", () => {
    const found = SCANNED.flatMap((root) => sourcesUnder(join(PACKAGES, root))).flatMap((path) => discardedResults(relative(PACKAGES, path), readFileSync(path, "utf8")));
    expect(found).toEqual([]);
  });

  it("recognises a discarded result, and a result that is bound or returned", () => {
    expect(discardedResults("probe.ts", "async function f() { await this.deps.stockLedger.applyDocumentStockPlan(plan); }")).toHaveLength(1);
    expect(discardedResults("probe.ts", "async function f() { void stock.reverseReceipt(command); }")).toHaveLength(1);
    expect(discardedResults("probe.ts", "async function f() { const taken = await stock.reverseReceipt(command); return service.applyDocumentStockPlan(plan); }")).toEqual([]);
  });
});
