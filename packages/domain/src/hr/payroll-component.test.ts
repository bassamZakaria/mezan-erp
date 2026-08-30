import { describe, it, expect } from "vitest";
import { createPayrollComponent, updatePayrollComponent, componentAccountId, type PayrollComponent } from "./payroll-component.js";
import { InvalidPayrollComponentError } from "./errors.js";

describe("createPayrollComponent", () => {
  it("creates a component with defaults, trimming code/name and nulling a blank English name", () => {
    const c = createPayrollComponent(
      { id: "pc-1", code: "  TRANSPORT  ", nameAr: "  بدل مواصلات  ", nameEn: "   ", kind: "earning" },
      () => "2026-01-01T00:00:00.000Z",
    );
    expect(c).toEqual({
      id: "pc-1",
      code: "TRANSPORT",
      nameAr: "بدل مواصلات",
      nameEn: null,
      kind: "earning",
      glAccountId: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("accepts an explicit glAccountId, nameEn and active flag", () => {
    const c = createPayrollComponent({
      id: "pc-2",
      code: "SOC_INS",
      nameAr: "تأمينات",
      nameEn: "Social insurance",
      kind: "deduction",
      glAccountId: "2190",
      active: false,
    });
    expect(c.glAccountId).toBe("2190");
    expect(c.nameEn).toBe("Social insurance");
    expect(c.active).toBe(false);
  });

  it("rejects an empty code", () => {
    expect(() => createPayrollComponent({ id: "pc-1", code: "  ", nameAr: "بدل", kind: "earning" })).toThrow(InvalidPayrollComponentError);
  });

  it("rejects an empty Arabic name", () => {
    expect(() => createPayrollComponent({ id: "pc-1", code: "X", nameAr: "  ", kind: "earning" })).toThrow(InvalidPayrollComponentError);
  });

  it("accepts every payslip line kind", () => {
    for (const kind of ["earning", "deduction", "employer_contribution"] as const) {
      expect(createPayrollComponent({ id: `pc-${kind}`, code: kind.toUpperCase(), nameAr: kind, kind }).kind).toBe(kind);
    }
  });
});

describe("updatePayrollComponent", () => {
  const base = createPayrollComponent(
    { id: "pc-1", code: "TRANSPORT", nameAr: "بدل مواصلات", kind: "earning" },
    () => "2026-01-01T00:00:00.000Z",
  );

  it("applies a patch and stamps updatedAt", () => {
    const updated = updatePayrollComponent(base, { nameAr: "بدل انتقال", glAccountId: "5121", active: false }, () => "2026-02-01T00:00:00.000Z");
    expect(updated.nameAr).toBe("بدل انتقال");
    expect(updated.glAccountId).toBe("5121");
    expect(updated.active).toBe(false);
    expect(updated.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(updated.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.code).toBe("TRANSPORT");
  });

  it("rejects blanking the Arabic name on update", () => {
    expect(() => updatePayrollComponent(base, { nameAr: "" })).toThrow(InvalidPayrollComponentError);
  });
});

describe("componentAccountId", () => {
  const components: PayrollComponent[] = [
    createPayrollComponent({ id: "pc-1", code: "TRANSPORT", nameAr: "بدل مواصلات", kind: "earning", glAccountId: "5121" }),
    createPayrollComponent({ id: "pc-2", code: "MEAL", nameAr: "بدل وجبة", kind: "earning", glAccountId: null }),
  ];

  it("returns null when the line carries no component", () => {
    expect(componentAccountId(components, null)).toBeNull();
  });

  it("resolves the component's GL account when found", () => {
    expect(componentAccountId(components, "pc-1")).toBe("5121");
  });

  it("returns null when the component has no account of its own", () => {
    expect(componentAccountId(components, "pc-2")).toBeNull();
  });

  it("returns null when the component id is no longer in the registry", () => {
    expect(componentAccountId(components, "pc-missing")).toBeNull();
  });
});
