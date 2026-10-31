import { describe, expect, it } from "vitest";
import { createEntitlements } from "../entitlements/entitlements.js";
import { licensedTemplatePermissions } from "./templates.js";

describe("role templates follow HR parts", () => {
  it("keeps the free staff list and drops paid parts the plan lacks", () => {
    const ent = createEntitlements({ plan: "P", activeModules: ["sales"], features: {}, seats: 1, expiresAt: null });
    const { granted, omitted } = licensedTemplatePermissions({ permissions: ["sales.invoice.view", "hr.employee.view", "hr.payroll.view"] }, ent);
    expect(granted).toEqual(["sales.invoice.view", "hr.employee.view"]);
    expect(omitted).toEqual(["hr.payroll.view"]);
  });
});
