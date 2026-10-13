import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATEABLE_ACTION_TYPES, type GateableActionTypeDef } from "@mezan/domain";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, "..", "..");
const PRODUCTION_ROOTS = ["domain/src", "api/src", "backend/src"];
const NOT_A_CONFIRM_PATH = [/\.test\.ts$/, /\/test-helpers\//, /\/demo-seed\//, /\/workflow\/action-types\.ts$/, /\/events\/catalog\.ts$/];
const UNMOUNTED_DOCUMENT_TYPES = [/\/documents\/journal-document\.ts$/];

function sources(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return entry === "node_modules" || entry === "dist" ? [] : sources(full);
      return /\.ts$/.test(entry) ? [full] : [];
    });
}

const production = PRODUCTION_ROOTS.flatMap((root) => sources(join(PACKAGES, root)))
  .filter((path) => ![...NOT_A_CONFIRM_PATH, ...UNMOUNTED_DOCUMENT_TYPES].some((skipped) => skipped.test(path)))
  .map((path) => ({ path: relative(PACKAGES, path), text: readFileSync(path, "utf8") }));

const catalog = GATEABLE_ACTION_TYPES as readonly GateableActionTypeDef[];
const consultedBy = (code: string) => production.filter(({ text }) => text.includes(`"${code}"`)).map(({ path }) => path);

describe("the approval actions the workflow settings offer", () => {
  it("reads the production sources", () => {
    expect(production.length).toBeGreaterThan(500);
  });

  it("offers as enforced only an action some confirm path names, so a chain configured for it holds something", () => {
    const offeredButUnwired = catalog.filter((action) => action.enforced !== false && consultedBy(action.code).length === 0).map((action) => action.code);
    expect(offeredButUnwired).toEqual([]);
  });

  it("marks as not enforced exactly the actions no confirm path names", () => {
    const unenforced = catalog.filter((action) => action.enforced === false).map((action) => action.code).sort();
    expect(unenforced).toEqual([
      "ACCOUNTING_JOURNAL_POST",
      "ACCOUNTING_JOURNAL_VOID",
      "HR_PAYROLL_APPROVE",
      "MANUFACTURING_WORK_ORDER_START",
      "PURCHASE_INVOICE_CONFIRM",
      "PURCHASE_ORDER_CONFIRM",
      "PURCHASE_RECEIPT_CONFIRM",
      "SALES_QUOTE_SEND",
      "TREASURY_CAPITAL_WITHDRAWAL_CONFIRM",
      "TREASURY_TAX_PAYMENT_CONFIRM",
    ]);
  });

  it("the purchase confirms and the journal routes still post without asking the approval engine, which is why their actions are offered as not enforced", () => {
    const routeText = (name: string) => production.find(({ path }) => path === `api/src/${name}`)?.text ?? "";
    expect(routeText("purchases-routes.ts")).not.toBe("");
    expect(routeText("gl-routes.ts")).not.toBe("");
    expect(routeText("purchases-routes.ts")).not.toMatch(/workflowRequestId|ApprovalGate|gateActionType/);
    expect(routeText("gl-routes.ts")).not.toMatch(/workflowRequestId|ApprovalGate|gateActionType/);
  });
});
