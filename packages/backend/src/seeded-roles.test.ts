import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const FINANCE_ROLES = ["ACCOUNTANT", "FINANCE_MANAGER"];

let kit: BackendKit;
let permissionsOf: ReadonlyMap<string, readonly string[]>;
let invoiceId = "";

beforeAll(async () => {
  kit = await bootBackendKit();
  const roles = rowsOf((await kit.call("GET", "/roles")).body);
  permissionsOf = new Map(roles.map((role) => [role.code as string, (role.permissions ?? role.permissionCodes ?? []) as string[]]));
  const invoice = rowsOf((await kit.call("GET", "/sales-invoices?pageSize=1&status=confirmed")).body)[0];
  invoiceId = invoice.id;
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe.each(FINANCE_ROLES)("the seeded %s role", (code) => {
  const as = (method: string, path: string) => kit.call(method, path, undefined, permissionsOf.get(code));

  it("reads the e-invoice queue it is asked to clear", async () => {
    expect(permissionsOf.get(code)).toContain("accounting.eta.view");
    expect((await as("GET", "/eta/submissions?pageSize=5")).status).toBe(200);
  });

  it("reads everything the invoice print page asks for, and nothing of the settings it may not edit", async () => {
    const config = await as("GET", "/print-template-config");
    const letterhead = await as("GET", "/print-template-config/letterhead");
    const context = await as("GET", `/sales-invoices/${invoiceId}/print-context`);
    expect([config.status, letterhead.status, context.status]).toEqual([200, 200, 200]);
    expect(Object.keys(letterhead.body).sort()).toEqual(["address", "commercialRegistrationNumber", "companyName", "email", "phone", "taxRegistrationNumber"]);
    expect(Object.keys(context.body).sort()).toEqual(["branchName", "customer", "etaQrValue", "etaUuid", "warehouseName"]);
    expect(typeof context.body.branchName).toBe("string");
    expect((await as("PUT", "/print-template-config")).status).toBe(403);
    expect((await as("GET", "/settings")).status).toBe(403);
  });
});

describe("the print lookups stay closed to a caller who may view no document", () => {
  it("refuses the template, the letterhead and an invoice's print context", async () => {
    const stranger = ["hr.self.clock"];
    expect((await kit.call("GET", "/print-template-config", undefined, stranger)).status).toBe(403);
    expect((await kit.call("GET", "/print-template-config/letterhead", undefined, stranger)).status).toBe(403);
    expect((await kit.call("GET", `/sales-invoices/${invoiceId}/print-context`, undefined, stranger)).status).toBe(403);
  });

  it("hides another seller's invoice from an own-records caller", async () => {
    const reply = await kit.call("GET", `/sales-invoices/${invoiceId}/print-context`, undefined, ["sales.invoice.view_own"]);
    expect(reply.status).toBe(404);
  });
});
