import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  EGYPT_END_OF_SERVICE_TABLES,
  EGYPT_INCOME_TAX_TABLES,
  EGYPT_PAYROLL_LEVY_TABLES,
  EGYPT_SOCIAL_INSURANCE_TABLES,
  resolveEgyptStatutoryRules,
  unverifiedStatutoryTableCodes,
  type ResolvedSocialInsuranceTable,
  type SocialInsuranceYearOverride,
} from "./egypt-statutory.js";
import {
  ageOn,
  annualIncomeTax,
  endOfServiceGratuity,
  insurableWage,
  monthlyIncomeTax,
  payrollLevies,
  socialInsuranceFor,
} from "./statutory-payroll.js";
import { StatutoryRulesUnavailableError } from "./errors.js";

const TAX = EGYPT_INCOME_TAX_TABLES[0]!;
const SI_2026 = EGYPT_SOCIAL_INSURANCE_TABLES.find((t) => t.code === "EG_SOCIAL_INSURANCE_2026") as ResolvedSocialInsuranceTable;
const EOS = EGYPT_END_OF_SERVICE_TABLES[0]!;
const LEVIES = EGYPT_PAYROLL_LEVY_TABLES[0]!;

function override(year: number, floor: string, ceiling: string): SocialInsuranceYearOverride {
  return { year, monthlyWageFloor: floor, monthlyWageCeiling: ceiling, note: null, enteredBy: "admin", enteredAt: `${year}-01-02T00:00:00.000Z` };
}

describe("annualIncomeTax — the bracket walk either side of the elimination thresholds", () => {
  it("599,999 a year walks every band with nothing eliminated: 124,749.75", () => {
    const result = annualIncomeTax(Money.fromMajor("599999"), TAX);
    expect(result.eliminatedBrackets).toBe(0);
    expect(result.tax.toString()).toBe("124749.750000");
  });

  it("exactly 600,000 is still below the first tier (the tier starts ABOVE it): 124,750.00", () => {
    const result = annualIncomeTax(Money.fromMajor("600000"), TAX);
    expect(result.eliminatedBrackets).toBe(0);
    expect(result.tax.toString()).toBe("124750.000000");
  });

  it("600,001 loses the 0% band: the first 40,000 is taxed at 10%, so 128,750.25", () => {
    const result = annualIncomeTax(Money.fromMajor("600001"), TAX);
    expect(result.eliminatedBrackets).toBe(1);
    expect(result.tax.toString()).toBe("128750.250000");
  });

  it("1,200,001 folds the first 400,000 into 25% and taxes the last pound at 27.5%: 300,000.28 to the piastre", () => {
    const result = annualIncomeTax(Money.fromMajor("1200001"), TAX);
    expect(result.eliminatedBrackets).toBe(5);
    expect(result.tax.toString()).toBe("300000.280000");
  });

  it("taxes nothing at or below zero", () => {
    expect(annualIncomeTax(Money.zero(), TAX).tax.scaled).toBe(0n);
  });
});

describe("monthlyIncomeTax — annualised, insurance deducted, exemption applied, divided back", () => {
  it("10,000 a month with 1,100 insurance withholds 592.50", () => {
    const result = monthlyIncomeTax({ monthlyTaxableGross: Money.fromMajor("10000"), monthlyEmployeeInsurance: Money.fromMajor("1100") }, TAX);
    expect(result.annualTaxableIncome.toString()).toBe("86800.000000");
    expect(result.monthlyTax.toString()).toBe("592.500000");
  });

  it("the disability exemption is 1.5 × the personal exemption, so the same pay withholds 425.83", () => {
    const result = monthlyIncomeTax(
      { monthlyTaxableGross: Money.fromMajor("10000"), monthlyEmployeeInsurance: Money.fromMajor("1100"), disabilityExemption: true },
      TAX,
    );
    expect(result.annualTaxableIncome.toString()).toBe("76800.000000");
    expect(result.monthlyTax.toString()).toBe("425.830000");
  });
});

describe("insurableWage — the floor and the ceiling are monthly clamps, not gross", () => {
  it("raises a wage below the 2026 floor to 2,700", () => {
    const r = insurableWage(Money.fromMajor("2000"), SI_2026);
    expect(r.wage.toString()).toBe("2700.000000");
    expect(r.raisedToFloor).toBe(true);
    expect(r.cappedByCeiling).toBe(false);
  });

  it("caps a wage above the 2026 ceiling at 16,700", () => {
    const r = insurableWage(Money.fromMajor("22000"), SI_2026);
    expect(r.wage.toString()).toBe("16700.000000");
    expect(r.cappedByCeiling).toBe(true);
  });

  it("leaves a wage between the limits untouched, and the ceiling itself is not 'capped'", () => {
    expect(insurableWage(Money.fromMajor("10000"), SI_2026).wage.toString()).toBe("10000.000000");
    expect(insurableWage(Money.fromMajor("16700"), SI_2026).cappedByCeiling).toBe(false);
  });

  it("contributes 11% / 18.75% of the CEILING for a salary above it: 1,837.00 and 3,131.25", () => {
    const r = socialInsuranceFor(Money.fromMajor("22000"), SI_2026);
    expect(r.employeeTotal.toString()).toBe("1837.000000");
    expect(r.employerTotal.toString()).toBe("3131.250000");
  });
});

describe("socialInsuranceFor — sub-fund shares sum EXACTLY to the rounded total", () => {
  const unclamped: ResolvedSocialInsuranceTable = { ...SI_2026, monthlyWageFloor: "1", monthlyWageCeiling: "100000" };

  it("an employee residue of +0.01 lands on the largest share", () => {
    const r = socialInsuranceFor(Money.fromMajor("10.05"), unclamped);
    expect(r.employeeTotal.toString()).toBe("1.110000");
    expect(r.employeeShares.map((s) => [s.code, s.amount.toString()])).toEqual([
      ["pension", "0.910000"],
      ["end_of_service", "0.100000"],
      ["sickness", "0.100000"],
    ]);
  });

  it("an employer residue of −0.01 is taken back from the largest share", () => {
    const r = socialInsuranceFor(Money.fromMajor("10.05"), unclamped);
    expect(r.employerTotal.toString()).toBe("1.880000");
    expect(Money.sum(r.employerShares.map((s) => s.amount)).toString()).toBe("1.880000");
    expect(r.employerShares.find((s) => s.code === "pension")!.amount.toString()).toBe("1.200000");
  });

  it("sums exactly for a spread of awkward wages", () => {
    for (const wage of ["2700.01", "3333.33", "9999.99", "12345.67", "16699.99"]) {
      const r = socialInsuranceFor(Money.fromMajor(wage), SI_2026);
      expect(Money.sum(r.employeeShares.map((s) => s.amount)).scaled).toBe(r.employeeTotal.scaled);
      expect(Money.sum(r.employerShares.map((s) => s.amount)).scaled).toBe(r.employerTotal.scaled);
    }
  });
});

describe("the 2027 social-insurance row — shares step up, limits unpublished", () => {
  it("raises old-age cover to 9.5% employee / 12.5% employer, and is marked unverified", () => {
    const row = EGYPT_SOCIAL_INSURANCE_TABLES.find((t) => t.code === "EG_SOCIAL_INSURANCE_2027")!;
    expect(row.effectiveFrom).toBe("2027-01-01");
    expect(row.employeeShares.find((s) => s.code === "pension")!.rateBp).toBe(950);
    expect(row.employerShares.find((s) => s.code === "pension")!.rateBp).toBe(1250);
    expect(row.verified).toBe(false);
    expect(row.monthlyWageFloor).toBeNull();
  });

  it("a 2027 run REFUSES until an admin enters the year's limits, naming the year", () => {
    expect(() => resolveEgyptStatutoryRules("2027-06-30")).toThrow(StatutoryRulesUnavailableError);
    try {
      resolveEgyptStatutoryRules("2027-06-30");
    } catch (err) {
      expect((err as StatutoryRulesUnavailableError).missing.join(" ")).toContain("2027");
    }
  });

  it("an admin-entered 2027 year takes its shares from the 2027 row, not the 2019 schedule", () => {
    const rules = resolveEgyptStatutoryRules("2027-06-30", [override(2027, "3100", "19200")]);
    expect(rules.socialInsurance.code).toBe("EG_SOCIAL_INSURANCE_2027_OVERRIDE");
    expect(rules.socialInsurance.monthlyWageCeiling).toBe("19200");
    expect(rules.socialInsurance.employeeShares.find((s) => s.code === "pension")!.rateBp).toBe(950);
    expect(rules.socialInsurance.verified).toBe(false);
  });

  it("a year after the last shipped row inherits the PRECEDING row's shares", () => {
    const rules = resolveEgyptStatutoryRules("2029-03-31", [override(2029, "4100", "25400")]);
    expect(rules.socialInsurance.employerShares.find((s) => s.code === "pension")!.rateBp).toBe(1250);
  });

  it("an override for a shipped year still wins over the shipped limits", () => {
    const rules = resolveEgyptStatutoryRules("2026-05-31", [override(2026, "2800", "17000")]);
    expect(rules.socialInsurance.monthlyWageFloor).toBe("2800");
    expect(rules.socialInsurance.employeeShares.find((s) => s.code === "pension")!.rateBp).toBe(900);
  });
});

describe("the salary-tax row — Law 7/2024 from 1 March 2024", () => {
  it("is effective 2024-03-01 and cites Law 7/2024", () => {
    expect(TAX.effectiveFrom).toBe("2024-03-01");
    expect(TAX.source).toContain("7/2024");
    expect(TAX.citationAr).toContain("7 لسنة 2024");
  });

  it("a period before it refuses rather than computing on the new brackets", () => {
    expect(() => resolveEgyptStatutoryRules("2024-02-29")).toThrow(StatutoryRulesUnavailableError);
  });
});

describe("payrollLevies — the Martyrs' Fund", () => {
  it("cites Law 16/2018 as amended by Law 4/2021", () => {
    expect(LEVIES.source).toBe("Law 16/2018 as amended by Law 4/2021");
  });

  it("takes 0.05% of gross from a monthly worker", () => {
    const lines = payrollLevies(Money.fromMajor("10000"), Money.fromMajor("10000"), LEVIES, "monthly");
    expect(lines.map((l) => l.amount.toString())).toEqual(["5.000000"]);
  });

  it("does not apply to a daily worker", () => {
    expect(payrollLevies(Money.fromMajor("10000"), Money.fromMajor("10000"), LEVIES, "daily")).toEqual([]);
  });
});

describe("endOfServiceGratuity — payable only at 60+ with no pension entitlement", () => {
  const wage = Money.fromMajor("10000");

  it("pays half a month for each of the first five years and a month after: 7 years = 4.5 months = 45,000", () => {
    const r = endOfServiceGratuity(wage, 7, EOS, { birthDate: "1960-01-01", onDate: "2026-06-30", hasPensionEntitlement: false });
    expect(r.eligible).toBe(true);
    expect(r.ineligibleReasonAr).toBeNull();
    expect(r.monthsEarned).toBe("4.5");
    expect(r.gratuity.toString()).toBe("45000.000000");
  });

  it("is zero, with the reason, for an employee who holds a pension entitlement", () => {
    const r = endOfServiceGratuity(wage, 7, EOS, { birthDate: "1960-01-01", onDate: "2026-06-30", hasPensionEntitlement: true });
    expect(r.eligible).toBe(false);
    expect(r.gratuity.scaled).toBe(0n);
    expect(r.tierBreakdown).toEqual([]);
    expect(r.ineligibleReasonAr).toContain("معاش");
  });

  it("is zero, with the reason, below 60 — and payable on the 60th birthday itself", () => {
    const young = endOfServiceGratuity(wage, 7, EOS, { birthDate: "1967-07-01", onDate: "2027-06-30", hasPensionEntitlement: false });
    expect(young.eligible).toBe(false);
    expect(young.ineligibleReasonAr).toContain("59");
    const sixty = endOfServiceGratuity(wage, 7, EOS, { birthDate: "1967-06-30", onDate: "2027-06-30", hasPensionEntitlement: false });
    expect(sixty.eligible).toBe(true);
  });

  it("is not computed when the birth date or the pension answer is missing", () => {
    expect(endOfServiceGratuity(wage, 7, EOS, { birthDate: null, onDate: "2026-06-30", hasPensionEntitlement: false }).eligible).toBe(false);
    expect(endOfServiceGratuity(wage, 7, EOS, { birthDate: "1960-01-01", onDate: "2026-06-30", hasPensionEntitlement: null }).eligible).toBe(false);
  });

  it("counts age in completed years", () => {
    expect(ageOn("1966-07-01", "2026-06-30")).toBe(59);
    expect(ageOn("1966-06-30", "2026-06-30")).toBe(60);
    expect(ageOn(null, "2026-06-30")).toBeNull();
  });
});

describe("provenance", () => {
  it("every shipped row carries a source and a verified flag, and none is verified before legal review", () => {
    const codes = unverifiedStatutoryTableCodes();
    expect(codes).toContain("EG_SALARY_TAX_2024");
    expect(codes).toContain("EG_SOCIAL_INSURANCE_2027");
    expect(codes).toContain("EG_PAYROLL_LEVIES_2024");
    for (const row of [...EGYPT_INCOME_TAX_TABLES, ...EGYPT_SOCIAL_INSURANCE_TABLES, ...EGYPT_PAYROLL_LEVY_TABLES, ...EGYPT_END_OF_SERVICE_TABLES]) {
      expect(row.source.length).toBeGreaterThan(0);
      expect(typeof row.verified).toBe("boolean");
    }
  });
});
