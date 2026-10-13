import { describe, expect, it } from "vitest";
import { InMemoryTaxRateRepository } from "./test-helpers/in-memory-tax-rate-repository.js";
import { createTaxRate } from "./create-tax-rate.js";
import { updateTaxRate } from "./update-tax-rate.js";
import { SystemTaxRateLockedError } from "./errors.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import { EtaVatSubTypeCode, TaxRateStatusCode } from "./tax-rate.js";
import { SYSTEM_NOT_SUBJECT_TAX_RATE, SYSTEM_NOT_SUBJECT_TAX_RATE_ID, ensureSystemTaxRates, isSystemTaxRate } from "./system-tax-rates.js";
import { ReservedTaxRateError } from "./errors.js";

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

  it.each([
    ["deactivated", { status: TaxRateStatusCode.Inactive }],
    ["repriced", { rate: 14 }],
    ["reclassified", { etaSubType: EtaVatSubTypeCode.BasicSales }],
    ["renamed", { name: "معفى" }],
    ["made the default", { isDefault: true }],
    ["recoded", { code: "X" }],
    ["all of it at once", { status: TaxRateStatusCode.Inactive, rate: 14, etaSubType: EtaVatSubTypeCode.BasicSales, name: "x" }],
  ] as const)("repairs a row found %s in an existing books file — existence alone is not the contract (D79 round 4)", async (_what, damage) => {
    const repo = new InMemoryTaxRateRepository();
    await ensureSystemTaxRates(repo);
    await repo.update({ ...SYSTEM_NOT_SUBJECT_TAX_RATE, ...damage });
    await ensureSystemTaxRates(repo);
    expect(await repo.findById(SYSTEM_NOT_SUBJECT_TAX_RATE_ID)).toEqual(SYSTEM_NOT_SUBJECT_TAX_RATE);
  });

  it("writes nothing when the row is already right", async () => {
    const repo = new InMemoryTaxRateRepository();
    await ensureSystemTaxRates(repo);
    let writes = 0;
    const update = repo.update.bind(repo);
    repo.update = async (taxRate) => {
      writes += 1;
      await update(taxRate);
    };
    await ensureSystemTaxRates(repo);
    expect(writes).toBe(0);
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
    await expect(createTaxRate({ id: SYSTEM_NOT_SUBJECT_TAX_RATE_ID, code: "X", name: "أخرى", rate: 14 }, repo)).rejects.toBeInstanceOf(DuplicateRecordIdError);
  });
});

describe("nothing a user creates may pass for the system rate (D79 round 4)", () => {
  async function seeded() {
    const repo = new InMemoryTaxRateRepository();
    await ensureSystemTaxRates(repo);
    return repo;
  }
  const own = { id: "OWN", code: "OWN", name: "ضريبة المنشأة", rate: 0, etaSubType: EtaVatSubTypeCode.Exempt } as const;

  it.each([
    ["its id in another case", { id: "sys-not-subject" }],
    ["its id as the code", { code: "SYS-NOT-SUBJECT" }],
    ["its code in another case", { code: "Sys-Not-Subject" }],
    ["its id with surrounding blanks", { id: " SYS-NOT-SUBJECT " }],
  ] as const)("refuses %s, in Arabic", async (_what, clash) => {
    const repo = await seeded();
    await expect(createTaxRate({ ...own, ...clash }, repo)).rejects.toBeInstanceOf(ReservedTaxRateError);
    await expect(createTaxRate({ ...own, ...clash }, repo)).rejects.toThrow(/[\u0600-\u06FF]/);
    expect(await repo.list()).toHaveLength(1);
  });

  it("refuses a rate with the system rate's percent, sub-type and name — a second «غير خاضع» a user could pick by mistake", async () => {
    const repo = await seeded();
    const shadow = { id: "SHADOW", code: "SHADOW", name: " غير خاضع ", rate: 0, etaSubType: EtaVatSubTypeCode.NotSubject } as const;
    await expect(createTaxRate(shadow, repo)).rejects.toBeInstanceOf(ReservedTaxRateError);
    expect(await repo.list()).toHaveLength(1);
  });

  it("still lets a tenant hold its own not-subject rate under its own name, or the system's name on another classification", async () => {
    const repo = await seeded();
    await createTaxRate({ id: "OWN-V004", code: "OWN-V004", name: "غير خاضع (المنشأة)", rate: 0, etaSubType: EtaVatSubTypeCode.NotSubject }, repo);
    await createTaxRate({ id: "OWN-V003", code: "OWN-V003", name: "غير خاضع", rate: 0, etaSubType: EtaVatSubTypeCode.Exempt }, repo);
    expect((await repo.list()).map((r) => r.id).sort()).toEqual(["OWN-V003", "OWN-V004", SYSTEM_NOT_SUBJECT_TAX_RATE_ID]);
  });

  it("refuses renaming or reclassifying a user rate INTO the system rate's identity", async () => {
    const repo = await seeded();
    await createTaxRate({ id: "OWN-V004", code: "OWN-V004", name: "غير خاضع (المنشأة)", rate: 0, etaSubType: EtaVatSubTypeCode.NotSubject }, repo);
    await expect(updateTaxRate("OWN-V004", { name: "غير خاضع" }, repo, unreferenced)).rejects.toBeInstanceOf(ReservedTaxRateError);
    expect((await repo.findById("OWN-V004"))?.name).toBe("غير خاضع (المنشأة)");
  });
});
