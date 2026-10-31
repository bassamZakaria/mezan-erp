import { describe, expect, it } from "vitest";
import { COMPANY_NAME_MAX_LENGTH, CompanyNameProblem, companyNameProblem } from "./company-name.js";
import { createTenant, type Tenant, type TenantRepository } from "./tenant.js";
import { InvalidTenantError } from "./errors.js";

const NOW = "2026-09-13T10:00:00.000Z";

function tenants(): TenantRepository & { rows: Tenant[] } {
  const rows: Tenant[] = [];
  return {
    rows,
    async findById(id) { return rows.find((t) => t.id === id) ?? null; },
    async findByCode(code) { return rows.find((t) => t.code === code) ?? null; },
    async list() { return rows; },
    async save(t) { rows.push(t); },
    async discardProvisioning() { return false; },
    async compareAndSetOwner() { return false; },
    async compareAndSetStatus() { return false; },
    async setDbFile() { return false; },
  };
}

describe("companyNameProblem", () => {
  it("accepts an ordinary Arabic or Latin trading name", () => {
    expect(companyNameProblem("شركة النيل للتجارة")).toBeNull();
    expect(companyNameProblem("Nile Trading Co. (S.A.E) – 2")).toBeNull();
  });

  it("accepts a name of exactly the longest length and refuses one character more", () => {
    expect(companyNameProblem("ش".repeat(COMPANY_NAME_MAX_LENGTH))).toBeNull();
    expect(companyNameProblem("ش".repeat(COMPANY_NAME_MAX_LENGTH + 1))).toBe(CompanyNameProblem.TooLong);
  });

  it("measures the name without the spaces around it", () => {
    expect(companyNameProblem(`  ${"ش".repeat(COMPANY_NAME_MAX_LENGTH)}  `)).toBeNull();
    expect(companyNameProblem("   ")).toBe(CompanyNameProblem.Empty);
  });

  it.each([
    ["LRE", "\u202A"], ["RLE", "\u202B"], ["PDF", "\u202C"], ["LRO", "\u202D"], ["RLO", "\u202E"],
    ["LRI", "\u2066"], ["RLI", "\u2067"], ["FSI", "\u2068"], ["PDI", "\u2069"],
    ["NUL", "\u0000"], ["tab", "\t"], ["line feed", "\n"], ["DEL", "\u007F"], ["a C1 control", "\u0085"],
    ["a line separator", "\u2028"], ["a paragraph separator", "\u2029"],
  ])("refuses a name carrying %s", (_name, character) => {
    expect(companyNameProblem(`شركة${character}النيل`)).toBe(CompanyNameProblem.ForbiddenCharacter);
  });

  it.each([["ZWNJ", "\u200C"], ["ZWJ", "\u200D"], ["LRM", "\u200E"], ["RLM", "\u200F"]])("keeps %s, which Arabic-script text is typed with", (_name, character) => {
    expect(companyNameProblem(`شركة${character}النيل`)).toBeNull();
  });
});

describe("createTenant holds the same rule", () => {
  const tenant = { id: "T1", code: "cyag", nameAr: "سياج", ownerEmail: "owner@cyag.eg", now: NOW };

  it.each([
    ["too long", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)],
    ["carrying a right-to-left override", "شركة \u202Eevil"],
  ])("createTenant refuses a name %s and saves nothing", async (_what, nameAr) => {
    const repo = tenants();
    await expect(createTenant({ ...tenant, nameAr }, repo)).rejects.toThrow(InvalidTenantError);
    expect(repo.rows).toEqual([]);
  });

  it("still accepts the longest name", async () => {
    const nameAr = "ش".repeat(COMPANY_NAME_MAX_LENGTH);
    expect((await createTenant({ ...tenant, nameAr }, tenants())).nameAr).toBe(nameAr);
  });
});
