import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), "../..");

const LIFECYCLE_SOURCES = [
  "domain/src/documents/service.ts",
  "domain/src/sales-invoices/service.ts",
  "domain/src/purchasing/purchase-invoice.ts",
  "domain/src/purchasing/goods-receipt.ts",
  "domain/src/vouchers/voucher-service.ts",
  "api/src/sales-invoices-routes.ts",
];

const DOCUMENT_STORES = /(?:^|\.)(?:repo|documents|invoices|receipts|salesInvoices|purchaseInvoices|goodsReceipts)$/;
const WHOLE_DOCUMENT_WRITES = new Set(["update"]);

function wholeDocumentWrites(file: string, text: string = readFileSync(join(PACKAGES, file), "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(source);
      if (WHOLE_DOCUMENT_WRITES.has(node.expression.name.text) && DOCUMENT_STORES.test(receiver)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${file}:${line + 1} ${receiver}.${node.expression.name.text}(…)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("a state change never saves a whole stored document", () => {
  it("no lifecycle source calls a document store's whole-row update", () => {
    expect(LIFECYCLE_SOURCES.flatMap((file) => wholeDocumentWrites(file))).toEqual([]);
  });

  it("recognises a whole-row update when one is written, and ignores the word in a comment", () => {
    expect(wholeDocumentWrites("probe.ts", "async function f() { await this.deps.repo.update(next); }")).toHaveLength(1);
    expect(wholeDocumentWrites("probe.ts", "// await this.deps.repo.update(next);\nconst update = 1;")).toEqual([]);
  });
});
