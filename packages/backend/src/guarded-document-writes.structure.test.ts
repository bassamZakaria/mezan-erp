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

const OWNED_SERVICES = [
  "domain/src/documents/service.ts",
  "domain/src/sales-invoices/service.ts",
  "domain/src/sales-quotes/service.ts",
  "domain/src/purchasing/purchase-invoice.ts",
  "domain/src/purchasing/classify-line-tax.ts",
  "domain/src/vouchers/voucher-service.ts",
  "domain/src/tax-rates/return-journal-tax.ts",
  "domain/src/tax-rates/return-tax-carry.ts",
];
const OWNED_ROUTES = [
  "api/src/sales-invoices-routes.ts",
  "api/src/sales-quotes-routes.ts",
  "api/src/sales-returns-routes.ts",
  "api/src/purchase-returns-routes.ts",
  "api/src/purchases-routes.ts",
  "api/src/return-void.ts",
  "api/src/return-journal-tax.ts",
];

const OWNED_STORES = /(?:^|\.)(?:repo|documents|invoices|returns|quotes|salesInvoices|purchaseInvoices)$/;
const STORE_WRITES = new Set(["save", "update", "create", "writeFields", "nameLineTaxRate", "nameSourcedLineTaxRate"]);
const STORE_READS = new Set(["findById", "require", "requireVoucher", "list", "findByDocNo"]);
const TRANSACTION_OPENERS = new Set(["transaction", "atomically"]);
// A private writer that only forwards to the store; every CALL of it is judged as the write it is.
const WRITE_HELPERS = new Set(["write", "writeFields", "writeLine"]);
// A new document has no stored row to read; the store's primary key refuses a duplicate.
const CREATES = new Set(["createDraft", "createPurchaseInvoice", "createVoucher"]);
// INVARIANT: each of these runs only inside the transaction of the operation
// named beside it, which read the document there. A new caller outside one
// breaks the rule this test states and must be added here with its reason.
const RUNS_IN_CALLERS_TRANSACTION: Readonly<Record<string, string>> = {
  applyAllocatedSettlement: "the allocation's transaction (VoucherService.allocate / reverseAllocation)",
  post: "DocumentService.confirm's transaction, which re-read the document",
  stampFxRate: "VoucherService.confirmVoucher's stamping transaction, which re-read the voucher",
  carry: "the invoice classification's transaction (classifyLineTax / classifyPurchaseInvoiceLineTax)",
};
// Owned by branch fix/w1a-period-close (partial invoicing); converges after that merge.
const RESERVED_FOR_ANOTHER_LANE = new Set(["confirmPurchaseInvoice"]);

function enclosing(node: ts.Node, source: ts.SourceFile): { name: string; transaction: ts.Node | null } {
  let transaction: ts.Node | null = null;
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (!transaction && (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isCallExpression(current.parent)) {
      const callee = current.parent.expression;
      const opener = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (TRANSACTION_OPENERS.has(opener)) transaction = current;
    }
    if ((ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) && current.name) return { name: current.name.getText(source), transaction };
  }
  return { name: "<module>", transaction };
}

function readsBefore(scope: ts.Node, write: ts.Node, source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && node.getStart(source) < write.getStart(source) && ts.isPropertyAccessExpression(node.expression) && STORE_READS.has(node.expression.name.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return found;
}

function unguardedStateChanges(file: string, text: string = readFileSync(join(PACKAGES, file), "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression.getText(source);
      const storeWrite = STORE_WRITES.has(method) && OWNED_STORES.test(receiver);
      const helperCall = receiver === "this" && WRITE_HELPERS.has(method);
      if (storeWrite || helperCall) {
        const { name, transaction } = enclosing(node, source);
        const exempt =
          (storeWrite && WRITE_HELPERS.has(name)) ||
          (CREATES.has(name) && (method === "save" || method === "create")) ||
          name in RUNS_IN_CALLERS_TRANSACTION ||
          RESERVED_FOR_ANOTHER_LANE.has(name);
        if (!exempt && !(transaction && readsBefore(transaction, node, source))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          found.push(`${file}:${line + 1} ${name} → ${receiver}.${method}(…) ${transaction ? "reads nothing in its transaction first" : "is outside a transaction"}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const MUTATING_VERBS = new Set(["post", "patch", "put", "delete"]);
const STATE_FIELDS = /\.(?:status|amountPaid|remainingBalance|invoiced|refundDue)\b/;
const STATE_GUARDS = new Set(["assertRefundable", "assertSalesInvoiceTransition", "assertTransition"]);

function outsideReadGuards(file: string, text: string = readFileSync(join(PACKAGES, file), "utf8")): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const walk = (route: string, node: ts.Node, inTransaction: boolean): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (TRANSACTION_OPENERS.has(name) || name === "withDocument") {
        node.arguments.forEach((argument) => walk(route, argument, true));
        return;
      }
      if (!inTransaction && STATE_GUARDS.has(name)) found.push(`${file}:${at(node)} ${route} → ${name}(…) on a read outside the transaction`);
    }
    if (!inTransaction && (ts.isIfStatement(node) || ts.isConditionalExpression(node))) {
      const test = (ts.isIfStatement(node) ? node.expression : node.condition).getText(source);
      if (STATE_FIELDS.test(test)) found.push(`${file}:${at(node)} ${route} → guards on «${test.slice(0, 80)}» read outside the transaction`);
    }
    ts.forEachChild(node, (child) => walk(route, child, inTransaction));
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && MUTATING_VERBS.has(node.expression.name.text) && node.expression.expression.getText(source) === "app") {
      const handler = node.arguments[node.arguments.length - 1];
      if (handler) walk(`${node.expression.name.text.toUpperCase()} ${node.arguments[0]?.getText(source) ?? ""}`, handler, false);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("a state change judges the document it read inside its own transaction (sales invoices, quotes, returns, purchase invoices, vouchers)", () => {
  it("every store write of these services sits in a transaction that read the document first", () => {
    expect(OWNED_SERVICES.flatMap((file) => unguardedStateChanges(file))).toEqual([]);
  });

  it("no mutating route of these families guards on a status or an amount it read outside the transaction", () => {
    expect(OWNED_ROUTES.flatMap((file) => outsideReadGuards(file))).toEqual([]);
  });

  it("sees a save, a whole-row update and a helper call left outside a transaction, and a write whose transaction read nothing", () => {
    const probe = (body: string) => unguardedStateChanges("probe.ts", `class S { async act(id: string) { ${body} } }`);
    expect(probe("const doc = await this.deps.repo.findById(id); await this.deps.repo.save(doc);")).toHaveLength(1);
    expect(probe("const doc = await this.require(id); await this.deps.repo.update(doc);")).toHaveLength(1);
    expect(probe("const doc = await this.require(id); await this.write(doc, [], doc.status);")).toHaveLength(1);
    expect(probe("await this.deps.repo.transaction(async () => { await this.deps.repo.update(next); });")).toHaveLength(1);
    expect(probe("await this.deps.repo.transaction(async () => { const doc = await this.require(id); await this.deps.repo.update(doc); });")).toEqual([]);
    expect(probe("// await this.deps.repo.save(doc);")).toEqual([]);
  });

  it("sees a status guard and a named state guard left in a route on an outside read, and accepts them inside the transaction", () => {
    const route = (body: string) => outsideReadGuards("probe.ts", `app.post("/:id/act", gate("x"), async (c) => { ${body} });`);
    expect(route('const doc = await service.findById(id); if (doc.status !== "confirmed") return c.json({}, 409);')).toHaveLength(1);
    expect(route("const doc = await service.findById(id); assertRefundable(doc, [], amount);")).toHaveLength(1);
    expect(route('await repo.transaction(async () => { const doc = await repo.findById(id); if (doc.status !== "confirmed") throw new Error(); });')).toEqual([]);
    expect(route("app.get('/x', async () => { if (doc.status) return 1; });")).toHaveLength(1);
  });
});
