import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODULE_CATALOG, createEntitlements, type Entitlements } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

// Termination is the free staff list's (hr.people); the pay recovery it can book is payroll's.
// A plan without payroll must not post to the GL or rewrite payslips through it.

let world: SeededWorld;
let plan: Entitlements = createEntitlements({ plan: "DEMO", activeModules: [...MODULE_CATALOG], features: {}, seats: 50, expiresAt: null });

beforeAll(async () => {
  world = await seededWorld({ resolveEntitlements: () => plan });
  // Seeded with every module (the seed pays EMP-DEMO-2 for June); then the tenant drops HR.
  plan = createEntitlements({ plan: "SALES", activeModules: ["sales", "inventory", "accounting", "treasury"], readOnlyModules: ["hr"], features: {}, seats: 50, expiresAt: null });
}, 120_000);

afterAll(() => world?.close());

const status = (id: string) => (world.sqlite.prepare(`SELECT status FROM hr_employee WHERE id = ?`).get(id) as { status: string }).status;

describe("ending service on a plan whose payroll is read-only", () => {
  it("refuses a last day that payroll already paid past, and posts nothing", async () => {
    const entriesBefore = world.count("journal_entry");
    const answer = await world.request("POST", "/hr/employees/EMP-DEMO-2/terminate", { effectiveDate: "2026-06-12" });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ error: "MODULE_READ_ONLY", module: "hr.payroll" });
    expect(status("EMP-DEMO-2")).toBe("active");
    expect(world.count("journal_entry")).toBe(entriesBefore);
  });

  it("still ends the service of someone payroll never paid past that day", async () => {
    const hired = await world.request("POST", "/hr/employees", { firstName: "عامل", lastName: "مؤقت", branchId: "BR-MAIN", hireDate: "2026-09-01" });
    expect(hired.status).toBe(201);
    const id = String(hired.body.id);
    const entriesBefore = world.count("journal_entry");
    const answer = await world.request("POST", `/hr/employees/${id}/terminate`, { effectiveDate: "2026-09-30" });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: "terminated", payRecovery: null });
    expect(world.count("journal_entry")).toBe(entriesBefore);
  });
});
