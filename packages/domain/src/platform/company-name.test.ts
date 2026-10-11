import { describe, expect, it } from "vitest";
import { COMPANY_NAME_MAX_LENGTH, CompanyNameProblem, companyNameProblem } from "./company-name.js";
import { createTenant, type Tenant, type TenantRepository } from "./tenant.js";
import { startSignup, type SignupRequest, type SignupRequestRepository } from "./signup.js";
import { InvalidSignupError, InvalidTenantError } from "./errors.js";
import type { Plan, PlanRepository } from "./plan.js";

const NOW = "2026-09-13T10:00:00.000Z";

function tenants(): TenantRepository & { rows: Tenant[] } {
  const rows: Tenant[] = [];
  return {
    rows,
    async findById(id) { return rows.find((t) => t.id === id) ?? null; },
    async findByCode(code) { return rows.find((t) => t.code === code) ?? null; },
    async list() { return rows; },
    async save(t) { rows.push(t); },
    async compareAndSetOwner() { return false; },
  };
}

function signups(): SignupRequestRepository & { rows: SignupRequest[] } {
  const rows: SignupRequest[] = [];
  return {
    rows,
    async findByTokenHash(hash) { return rows.find((r) => r.tokenHash === hash) ?? null; },
    async findActiveByCode() { return null; },
    async save(r) { rows.push(r); },
    async tryMarkVerified() { return null; },
    async tryClaimProvisioning() { return true; },
    async renewProvisioning() { return true; },
    async provisioningClaimedAt() { return null; },
    async provisioningFence() { return 1; },
    async followOwnerEmail() {},
    async releaseProvisioning() {},
  };
}

const plans: PlanRepository = {
  async findById(id) { return { id, isPublic: true, status: "active" } as Plan; },
  async findByCode() { return null; },
  async list() { return []; },
  async save() {},
};

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

describe("the platform's own validators hold the same rule", () => {
  const tenant = { id: "T1", code: "cyag", nameAr: "سياج", ownerEmail: "owner@cyag.eg", now: NOW };
  const signup = { id: "S1", code: "cyag", nameAr: "سياج", ownerEmail: "owner@cyag.eg", ownerNameAr: "سارة", planId: "PLAN-CORE", billingCycle: "monthly" as const, tokenHash: "hash", now: NOW, expiresInMs: 1000 };

  it.each([
    ["too long", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)],
    ["carrying a right-to-left override", "شركة \u202Eevil"],
  ])("createTenant refuses a name %s and saves nothing", async (_what, nameAr) => {
    const repo = tenants();
    await expect(createTenant({ ...tenant, nameAr }, repo)).rejects.toThrow(InvalidTenantError);
    expect(repo.rows).toEqual([]);
  });

  it.each([
    ["too long", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1)],
    ["carrying a right-to-left override", "شركة \u202Eevil"],
  ])("startSignup refuses a name %s and saves nothing", async (_what, nameAr) => {
    const repo = signups();
    await expect(startSignup({ ...signup, nameAr }, repo, tenants(), plans)).rejects.toThrow(InvalidSignupError);
    expect(repo.rows).toEqual([]);
  });

  it("both still accept the longest name", async () => {
    const nameAr = "ش".repeat(COMPANY_NAME_MAX_LENGTH);
    expect((await createTenant({ ...tenant, nameAr }, tenants())).nameAr).toBe(nameAr);
    expect((await startSignup({ ...signup, nameAr }, signups(), tenants(), plans)).nameAr).toBe(nameAr);
  });
});
