import { describe, expect, it } from "vitest";
import { HISTORICAL_COLUMNS, resolveStepSpec, STEPS } from "./data-migration-steps";

function fakeT(key: string): string {
  const catalogue: Record<string, string> = {
    "dm.sheet.departments": "الأقسام",
    "dm.col.code": "الكود",
    "dm.col.name": "الاسم",
    "dm.eg.sales": "المبيعات",
  };
  return catalogue[key] ?? `[${key}]`;
}

describe("resolveStepSpec", () => {
  it("translates the sheet name and every column header through t()", () => {
    const spec = {
      id: "departments",
      sheetName: "dm.sheet.departments",
      columns: [{ key: "code", header: "dm.col.code" }],
    } as never;
    const resolved = resolveStepSpec(spec, fakeT);
    expect(resolved.sheetName).toBe("الأقسام");
    expect(resolved.columns[0]?.header).toBe("الكود");
    expect(resolved.columns[0]?.key).toBe("code");
  });

  it("translates an example that starts with the 'dm.eg.' catalogue prefix", () => {
    const spec = {
      id: "departments",
      sheetName: "dm.sheet.departments",
      columns: [{ key: "nameAr", header: "dm.col.name", example: "dm.eg.sales" }],
    } as never;
    const resolved = resolveStepSpec(spec, fakeT);
    expect(resolved.columns[0]?.example).toBe("المبيعات");
  });

  it("passes a LITERAL example (not a 'dm.eg.' key) straight through, unchanged", () => {
    const spec = {
      id: "departments",
      sheetName: "dm.sheet.departments",
      columns: [{ key: "code", header: "dm.col.code", example: "SALES" }],
    } as never;
    const resolved = resolveStepSpec(spec, fakeT);
    expect(resolved.columns[0]?.example).toBe("SALES");
  });

  it("omits the example field entirely when the source column has none", () => {
    const spec = {
      id: "departments",
      sheetName: "dm.sheet.departments",
      columns: [{ key: "hireDate", header: "dm.col.code" }],
    } as never;
    const resolved = resolveStepSpec(spec, fakeT);
    expect("example" in resolved.columns[0]!).toBe(false);
  });
});

describe("STEPS (the migration wizard's step catalogue)", () => {
  it("every step has a non-empty title, help key and at least one column", () => {
    for (const step of STEPS) {
      expect(step.title).toBeTruthy();
      expect(step.help).toBeTruthy();
      expect(step.spec.columns.length).toBeGreaterThan(0);
    }
  });

  it("every master step's id is unique", () => {
    const ids = STEPS.filter((s) => s.kind === "master").map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every historical step's docType is unique", () => {
    const docTypes = STEPS.filter((s) => s.kind === "historical").map((s) => s.docType);
    expect(new Set(docTypes).size).toBe(docTypes.length);
  });

  it("includes both master and historical steps", () => {
    expect(STEPS.some((s) => s.kind === "master")).toBe(true);
    expect(STEPS.some((s) => s.kind === "historical")).toBe(true);
  });

  it("every historical step shares the same HISTORICAL_COLUMNS spec", () => {
    for (const step of STEPS.filter((s) => s.kind === "historical")) {
      expect(step.spec.columns).toBe(HISTORICAL_COLUMNS);
    }
  });

  it("master steps come before the historical steps (masters must exist before documents referencing them import)", () => {
    const kinds = STEPS.map((s) => s.kind);
    const firstHistorical = kinds.indexOf("historical");
    const lastMaster = kinds.lastIndexOf("master");
    expect(firstHistorical).toBeGreaterThan(lastMaster);
  });
});
