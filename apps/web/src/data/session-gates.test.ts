import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DocumentReadPermission, sessionMayRead } from "./document-read-permissions";
import { sessionHolds, type Session } from "./session";

const session = (...permissions: string[]): Session => ({ permissions }) as unknown as Session;

const CASES: readonly [grant: string, permission: DocumentReadPermission, held: boolean][] = [
  ["sales.return.create", DocumentReadPermission.SalesReturnsOwn, true],
  ["sales.invoice.classify_tax", DocumentReadPermission.TaxRates, true],
  ["sales.return.view_own", DocumentReadPermission.SalesReturns, false],
  ["sales.return.void", DocumentReadPermission.SalesReturnVoid, true],
  ["*", DocumentReadPermission.AuditLog, true],
  ["accounting.journal.view", DocumentReadPermission.SalesInvoiceVoid, false],
];

describe("the two shell gates state one rule", () => {
  it.each(CASES)("a session granted %s and asked for %s answers %s in both modes", (grant, permission, held) => {
    expect(sessionHolds(session(grant), permission)).toBe(held);
    expect(sessionMayRead(session(grant), permission)).toBe(held);
  });

  it("the any-of mode holds when any one of the permissions is held, and never for a signed-out caller", () => {
    expect(sessionMayRead(session("sales.return.view_own"), DocumentReadPermission.SalesReturns, DocumentReadPermission.SalesReturnsOwn)).toBe(true);
    expect(sessionMayRead(session("sales.return.view_own"), DocumentReadPermission.SalesReturns, DocumentReadPermission.AuditLog)).toBe(false);
    expect(sessionMayRead(null, DocumentReadPermission.SalesReturns)).toBe(false);
    expect(sessionHolds(null, DocumentReadPermission.SalesReturns)).toBe(false);
  });

  it("the any-of gate resolves nothing itself: it asks the one helper", () => {
    const source = readFileSync(fileURLToPath(new URL("./document-read-permissions.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/resolvePermissions|EVERY_PERMISSION|permissions\.includes/);
    expect(source).toMatch(/sessionHolds\(/);
  });
});
