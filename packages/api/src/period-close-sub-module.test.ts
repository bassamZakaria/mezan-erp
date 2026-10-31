import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { createEntitlements } from "@mezan/domain";
import { periodCloseScopeOf } from "./period-close-routes.js";

const scopeFor = (activeModules: string[]) => {
  const ent = createEntitlements({ plan: "P", activeModules, features: {}, seats: 1, expiresAt: null });
  return periodCloseScopeOf({ get: () => ent } as unknown as Context);
};

describe("period close asks for payroll only where payroll is licensed", () => {
  it("is entitled under the whole module or the payroll part", () => {
    expect(scopeFor(["hr"]).payrollEntitled).toBe(true);
    expect(scopeFor(["hr.payroll"]).payrollEntitled).toBe(true);
  });
  it("is not entitled under another part or the free staff list", () => {
    expect(scopeFor(["hr.time"]).payrollEntitled).toBe(false);
    expect(scopeFor(["sales"]).payrollEntitled).toBe(false);
  });
});
