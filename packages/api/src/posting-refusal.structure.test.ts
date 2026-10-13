import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const THE_ONE_MAPPING = "posting-refusal.ts";
const MAPPED_ONCE = ["VatPeriodAlreadyFiledError", "DocumentChangedError", "AllocationExceedsError"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function instanceofChecks(file: string, text: string = readFileSync(file, "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && MAPPED_ONCE.includes(node.right.getText(source))) {
      found.push(`${file.split("/packages/")[1] ?? file}: instanceof ${node.right.getText(source)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("a posting refusal has one mapping", () => {
  it("no route decides for itself what a filed VAT month or a moved document answers", () => {
    const elsewhere = sourceFiles(HERE).filter((file) => !file.endsWith(`/${THE_ONE_MAPPING}`)).flatMap((file) => instanceofChecks(file));
    expect(elsewhere).toEqual([]);
  });

  it("the one mapping holds both checks, and a mention in a comment does not count", () => {
    expect(instanceofChecks(join(HERE, THE_ONE_MAPPING)).length).toBe(MAPPED_ONCE.length);
    expect(instanceofChecks("probe.ts", "// if (err instanceof VatPeriodAlreadyFiledError) {}\nconst VatPeriodAlreadyFiledError = 1;")).toEqual([]);
  });
});
