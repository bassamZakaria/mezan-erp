import { describe, expect, it } from "vitest";
import { InMemoryTaxRateRepository } from "./test-helpers/in-memory-tax-rate-repository.js";
import { createTaxRate } from "./create-tax-rate.js";
import { updateTaxRate } from "./update-tax-rate.js";
import { DuplicateTaxRateIdError, SystemTaxRateLockedError } from "./errors.js";
import { EtaVatSubTypeCode, TaxRateStatusCode } from "./tax-rate.js";
import { SYSTEM_NOT_SUBJECT_TAX_RATE_ID, ensureSystemTaxRates, isSystemTaxRate } from "./system-tax-rates.js";

const unreferenced = { isReferenced: async () => false };

describe("ensureSystemTaxRates — every tenant holds «غير خاضع»", () => {
  it("creates it at 0% under the authority's not-subject sub-type, active and not the default", async () => {
    const repo = new InMemoryTaxRateRepository();
    await ensureSystemTaxRates(repo);
    expect(await repo.findById(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toMatchObject({
      name: "غير خاضع",
      rate: 0,
      etaSubType: EtaVatSubTypeCode.NotSubject,
      status: TaxRateStatusCode.Active,
      isDefault: false,
    });
  });

  it("changes nothing on a tenant that already holds it, and leaves the tenant's own rates alone", async () => {
    const repo = new InMemoryTaxRateRepository();
    await createTaxRate({ id: "VAT14", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, isDefault: true }, repo);
    await createTaxRate({ id: "OWN-V004", code: "OWN-V004", name: "غير خاضع (المنشأة)", rate: 0, etaSubType: EtaVatSubTypeCode.NotSubject }, repo);
    await ensureSystemTaxRates(repo);
    await ensureSystemTaxRates(repo);
    const rates = await repo.list();
    expect(rates.map((r) => r.id).sort()).toEqual(["OWN-V004", SYSTEM_NOT_SUBJECT_TAX_RATE_ID, "VAT14"].sort());
    expect(rates.find((r) => r.id === "VAT14")?.isDefault).toBe(true);
  });

  it("knows its own id and no other", () => {
    expect(isSystemTaxRate(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toBe(true);
    expect(isSystemTaxRate("VAT14")).toBe(false);
  });
});

describe("the system rate is locked — posted lines name it, so nobody edits it", () => {
  async function seeded() {
    const repo = new InMemoryTaxRateRepository();
    await ensureSystemTaxRates(repo);
    return repo;
  }

  it.each([
    ["its percent", { rate: 5 }],
    ["its ETA sub-type", { etaSubType: EtaVatSubTypeCode.Exempt }],
    ["its name", { name: "معفى" }],
    ["its status", { status: TaxRateStatusCode.Inactive }],
    ["making it the default", { isDefault: true }],
  ] as const)("refuses to change %s, in Arabic, though nothing references it yet", async (_what, change) => {
    const repo = await seeded();
    await expect(updateTaxRate(SYSTEM_NOT_SUBJECT_TAX_RATE_ID, change, repo, unreferenced)).rejects.toBeInstanceOf(SystemTaxRateLockedError);
    await expect(updateTaxRate(SYSTEM_NOT_SUBJECT_TAX_RATE_ID, change, repo, unreferenced)).rejects.toThrow(/غير خاضع/);
    expect(await repo.findById(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toMatchObject({ name: "غير خاضع", rate: 0, etaSubType: "V004", status: "active", isDefault: false });
  });

  it("cannot be created over", async () => {
    const repo = await seeded();
    await expect(createTaxRate({ id: SYSTEM_NOT_SUBJECT_TAX_RATE_ID, code: "X", name: "أخرى", rate: 14 }, repo)).rejects.toBeInstanceOf(DuplicateTaxRateIdError);
  });
});
