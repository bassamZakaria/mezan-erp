import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * D79 round 5: a quote's conversion built its invoice service with no VAT
 * policy, so a tenant with VAT switched off posted 14%. Every place that
 * builds a sales invoice or quote service outside a test must hand it the
 * tenant's policy — this reads the sources so a new caller cannot forget.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [HERE, join(HERE, "../../backend/src")];
const SERVICES = ["SalesInvoiceService", "SalesQuoteService"];
const POLICY = "taxPolicy";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function declarationOf(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const isUndefined = (expression: ts.Expression): boolean =>
  (ts.isIdentifier(expression) && expression.text === "undefined") || ts.isVoidExpression(expression);

function handsOverPolicy(source: ts.SourceFile, argument: ts.Expression | undefined, depth = 0): boolean {
  if (!argument || depth > 4) return false;
  if (ts.isIdentifier(argument)) return handsOverPolicy(source, declarationOf(source, argument.text), depth + 1);
  if (ts.isAsExpression(argument) || ts.isSatisfiesExpression(argument) || ts.isParenthesizedExpression(argument)) {
    return handsOverPolicy(source, argument.expression, depth + 1);
  }
  if (!ts.isObjectLiteralExpression(argument)) return false;
  return argument.properties.some((property) => {
    if (ts.isPropertyAssignment(property) && property.name.getText(source) === POLICY) return !isUndefined(property.initializer);
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === POLICY;
    if (ts.isSpreadAssignment(property)) return handsOverPolicy(source, property.expression, depth + 1);
    return false;
  });
}

function constructionsIn(file: string, text: string): { readonly where: string; readonly withPolicy: boolean }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: { where: string; withPolicy: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && SERVICES.includes(node.expression.text)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push({ where: `${file.split("/packages/")[1] ?? file}:${line + 1}`, withPolicy: handsOverPolicy(source, node.arguments?.[0]) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("every sales invoice and quote service is built with the tenant's VAT policy", () => {
  const constructions = ROOTS.flatMap(sourceFiles).flatMap((file) => constructionsIn(file, readFileSync(file, "utf8")));

  it("finds the constructions it is meant to guard", () => {
    expect(constructions.length).toBeGreaterThanOrEqual(8);
  });

  it("none is built without `taxPolicy`", () => {
    expect(constructions.filter((construction) => !construction.withPolicy).map((construction) => construction.where)).toEqual([]);
  });

  it("is not satisfied by the word alone: an undefined policy, a comment or another property's name all fail", () => {
    const built = (argument: string) => constructionsIn("probe.ts", `const svc = new SalesInvoiceService(${argument});`)[0]?.withPolicy;
    expect(built("{ repo, taxPolicy: undefined }")).toBe(false);
    expect(built("{ repo /* taxPolicy: source */ }")).toBe(false);
    expect(built("{ repo, notTheTaxPolicy: source }")).toBe(false);
    expect(built("{ repo, memo: 'taxPolicy' }")).toBe(false);
    expect(built("{ repo, taxPolicy: source }")).toBe(true);
    expect(built("{ repo, taxPolicy }")).toBe(true);
    expect(constructionsIn("probe.ts", "const deps = { repo, taxPolicy: source };\nnew SalesQuoteService({ ...deps });")[0]?.withPolicy).toBe(true);
    expect(constructionsIn("probe.ts", "const deps = { repo };\nnew SalesQuoteService(deps);")[0]?.withPolicy).toBe(false);
  });
});
