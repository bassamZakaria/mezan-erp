import { describe, it, expect } from "vitest";
import { Qty } from "../money/index.js";
import {
  LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS,
  getLeaveAccrualFrequencyLabel,
  createLeavePolicy,
  updateLeavePolicy,
  accrualDaysPerPeriod,
  LEAVE_POLICY_PRESETS,
  findLeavePolicyPreset,
  applyLeavePolicyPreset,
  type LeaveAccrualFrequency,
  type LeavePolicy,
} from "./leave-policy.js";
import { InvalidLeavePolicyError, UnknownLeavePolicyPresetError } from "./errors.js";

describe("getLeaveAccrualFrequencyLabel", () => {
  it("returns the Arabic label for every defined frequency", () => {
    for (const def of LEAVE_ACCRUAL_FREQUENCY_DEFINITIONS) {
      expect(getLeaveAccrualFrequencyLabel(def.code)).toBe(def.labelAr);
    }
  });

  it("falls back to the raw code for an unknown frequency", () => {
    expect(getLeaveAccrualFrequencyLabel("bogus" as LeaveAccrualFrequency)).toBe("bogus");
  });
});

describe("createLeavePolicy", () => {
  const base = { id: "lp-1", leaveType: "annual" as const, entitlementDays: Qty.fromMajor("21"), accrualFrequency: "monthly" as const };

  it("creates a policy with defaults, starting active", () => {
    const policy = createLeavePolicy(base, () => "2026-01-01T00:00:00.000Z");
    expect(policy).toMatchObject({
      carryOver: false,
      maxCarryOverDays: null,
      payoutOnTermination: false,
      legallyMandated: false,
      presetCode: null,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects negative entitlement days", () => {
    expect(() => createLeavePolicy({ ...base, entitlementDays: Qty.fromMajor("-1") })).toThrow(InvalidLeavePolicyError);
  });

  it("rejects negative carry-over cap", () => {
    expect(() => createLeavePolicy({ ...base, carryOver: true, maxCarryOverDays: Qty.fromMajor("-1") })).toThrow(InvalidLeavePolicyError);
  });

  it("rejects a carry-over cap without carryOver enabled", () => {
    expect(() => createLeavePolicy({ ...base, carryOver: false, maxCarryOverDays: Qty.fromMajor("5") })).toThrow(InvalidLeavePolicyError);
  });

  it("accepts a carry-over cap when carryOver is enabled", () => {
    const policy = createLeavePolicy({ ...base, carryOver: true, maxCarryOverDays: Qty.fromMajor("10") });
    expect(policy.maxCarryOverDays?.toString()).toBe("10.000000");
  });
});

describe("updateLeavePolicy", () => {
  const base = createLeavePolicy(
    { id: "lp-1", leaveType: "annual", entitlementDays: Qty.fromMajor("21"), accrualFrequency: "monthly", presetCode: "EG_LABOUR_LAW_12_2003" },
    () => "2026-01-01T00:00:00.000Z",
  );

  it("applies a patch, detaches from its preset (تخصيص يدوي), and stamps updatedAt", () => {
    const updated = updateLeavePolicy(base, { entitlementDays: Qty.fromMajor("25") }, () => "2026-02-01T00:00:00.000Z");
    expect(updated.entitlementDays.toString()).toBe("25.000000");
    expect(updated.presetCode).toBeNull();
    expect(updated.updatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("rejects an invalid patch", () => {
    expect(() => updateLeavePolicy(base, { entitlementDays: Qty.fromMajor("-5") })).toThrow(InvalidLeavePolicyError);
  });
});

describe("accrualDaysPerPeriod", () => {
  const annualPolicy: LeavePolicy = createLeavePolicy({
    id: "lp-1",
    leaveType: "annual",
    entitlementDays: Qty.fromMajor("21"),
    accrualFrequency: "monthly",
  });

  it("is zero when the requested frequency does not match the policy's own", () => {
    expect(accrualDaysPerPeriod(annualPolicy, "annual").isZero()).toBe(true);
  });

  it("is zero for the 'none' frequency", () => {
    const policy = createLeavePolicy({ id: "lp-2", leaveType: "maternity", entitlementDays: Qty.fromMajor("90"), accrualFrequency: "none" });
    expect(accrualDaysPerPeriod(policy, "none").isZero()).toBe(true);
  });

  it("an annual-frequency policy credits the full entitlement in one period", () => {
    const policy = createLeavePolicy({ id: "lp-3", leaveType: "sick", entitlementDays: Qty.fromMajor("180"), accrualFrequency: "annual" });
    expect(accrualDaysPerPeriod(policy, "annual").toString()).toBe("180.000000");
  });

  it("a monthly-frequency policy divides the entitlement by 12 exactly when it divides evenly", () => {
    expect(accrualDaysPerPeriod(annualPolicy, "monthly").toString()).toBe("1.750000"); // 21 / 12
  });

  it("truncates (never over-credits) when the division does not land exactly", () => {
    const policy = createLeavePolicy({ id: "lp-4", leaveType: "casual", entitlementDays: Qty.fromMajor("7"), accrualFrequency: "monthly" });
    // 7 / 12 = 0.58333... -> truncated to 6 decimal places, never rounded up.
    expect(accrualDaysPerPeriod(policy, "monthly").toString()).toBe("0.583333");
  });
});

describe("LEAVE_POLICY_PRESETS", () => {
  it("findLeavePolicyPreset resolves a known code and returns null for an unknown one", () => {
    expect(findLeavePolicyPreset("EG_LABOUR_LAW_12_2003")?.labelAr).toBe("مصر — قانون 12 لسنة 2003");
    expect(findLeavePolicyPreset("bogus")).toBeNull();
  });

  it("the 2025 law preset adds paternity leave that the 2003 preset does not have", () => {
    const p2003 = findLeavePolicyPreset("EG_LABOUR_LAW_12_2003")!;
    const p2025 = findLeavePolicyPreset("EG_LABOUR_LAW_14_2025")!;
    expect(p2003.lines.some((l) => l.leaveType === "paternity")).toBe(false);
    expect(p2025.lines.some((l) => l.leaveType === "paternity")).toBe(true);
  });
});

describe("applyLeavePolicyPreset", () => {
  it("rejects an unknown preset code", () => {
    expect(() => applyLeavePolicyPreset("bogus", [], () => "id")).toThrow(UnknownLeavePolicyPresetError);
  });

  it("creates every preset line as a new policy when the matrix starts empty", () => {
    const result = applyLeavePolicyPreset("EG_LABOUR_LAW_12_2003", [], () => "generated-id", () => "2026-01-01T00:00:00.000Z");
    expect(result.updated).toEqual([]);
    expect(result.created).toHaveLength(LEAVE_POLICY_PRESETS[0]!.lines.length);
    const annual = result.created.find((p) => p.leaveType === "annual")!;
    expect(annual.entitlementDays.toString()).toBe("21.000000");
    expect(annual.presetCode).toBe("EG_LABOUR_LAW_12_2003");
    expect(annual.legallyMandated).toBe(true);
    expect(annual.carryOver).toBe(true);
  });

  it("rewrites an existing row for the same leave type instead of duplicating it", () => {
    const existingAnnual = createLeavePolicy({ id: "existing-annual", leaveType: "annual", entitlementDays: Qty.fromMajor("15"), accrualFrequency: "none" });
    const result = applyLeavePolicyPreset("EG_LABOUR_LAW_12_2003", [existingAnnual], () => "generated-id", () => "2026-01-01T00:00:00.000Z");
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]!.id).toBe("existing-annual");
    expect(result.updated[0]!.entitlementDays.toString()).toBe("21.000000");
    expect(result.updated[0]!.presetCode).toBe("EG_LABOUR_LAW_12_2003");
    // every OTHER preset line (sick, casual, maternity, unpaid) is created fresh.
    expect(result.created).toHaveLength(LEAVE_POLICY_PRESETS[0]!.lines.length - 1);
    expect(result.created.some((p) => p.leaveType === "annual")).toBe(false);
  });

  it("leaves a row for a leave type the preset does not name untouched (neither created nor updated)", () => {
    const paternityRow = createLeavePolicy({ id: "existing-paternity", leaveType: "paternity", entitlementDays: Qty.fromMajor("3"), accrualFrequency: "none" });
    const result = applyLeavePolicyPreset("EG_LABOUR_LAW_12_2003", [paternityRow], () => "generated-id");
    expect(result.updated.some((p) => p.leaveType === "paternity")).toBe(false);
    expect(result.created.some((p) => p.leaveType === "paternity")).toBe(false);
  });

  it("parses preset day counts as exact Qty values, never floats", () => {
    const result = applyLeavePolicyPreset("EG_LABOUR_LAW_14_2025", [], () => "id");
    const paternity = result.created.find((p) => p.leaveType === "paternity")!;
    expect(paternity.entitlementDays.toString()).toBe("1.000000");
    const unpaid = result.created.find((p) => p.leaveType === "unpaid")!;
    expect(unpaid.entitlementDays.toString()).toBe("0.000000");
    expect(unpaid.legallyMandated).toBe(false);
  });
});
