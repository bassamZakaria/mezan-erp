import { describe, it, expect } from "vitest";
import { applyLeavePolicyPreset } from "./apply-preset.js";
import { setLeavePolicy } from "./set-leave-policy.js";
import { LEAVE_TYPE_CODES } from "./leave-type.js";
import { createInMemoryLeavePolicyRepository } from "./test-helpers/in-memory-leave-policy-repository.js";

describe("applyLeavePolicyPreset", () => {
  it("creates one version per leave type for the 12/2003 preset", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    const versions = await applyLeavePolicyPreset(
      { source: "PRESET_EG_LAW_12_2003", idPrefix: "preset-1", now: () => "2026-01-01T00:00:00.000Z" },
      { policies },
    );

    expect(versions).toHaveLength(LEAVE_TYPE_CODES.length);
    expect(versions.every((v) => v.effectiveDate === "2003-07-07")).toBe(true);
    expect(versions.every((v) => v.source === "PRESET_EG_LAW_12_2003")).toBe(true);

    const annual = await policies.findEffective("ANNUAL", "2026-01-01");
    expect(annual?.baseBalanceDays).toBe(21);
  });

  it("applying the 14/2025 preset after 12/2003 layers a newer effective version", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_14_2025", idPrefix: "p14" }, { policies });

    // Before the 14/2025 statute takes effect, the 12/2003 figures still apply.
    const beforeTransition = await policies.findEffective("MATERNITY", "2025-01-01");
    expect(beforeTransition?.baseBalanceDays).toBe(90);

    const afterTransition = await policies.findEffective("MATERNITY", "2026-01-01");
    expect(afterTransition?.baseBalanceDays).toBe(120);
    expect(afterTransition?.source).toBe("PRESET_EG_LAW_14_2025");
  });

  it("a subsequent manual edit takes effect from its own date without erasing history", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    await setLeavePolicy(
      {
        id: "manual-1",
        leaveTypeCode: "ANNUAL",
        effectiveDate: "2027-01-01",
        baseBalanceDays: 25,
        accrualFrequency: "MONTHLY",
        carryover: "LIMITED",
        carryoverMaxDays: 10,
        payoutOnTermination: true,
        legallyMandatory: true,
      },
      { policies },
    );

    expect((await policies.findEffective("ANNUAL", "2026-06-01"))?.baseBalanceDays).toBe(21);
    expect((await policies.findEffective("ANNUAL", "2027-06-01"))?.baseBalanceDays).toBe(25);
    expect(await policies.listVersions("ANNUAL")).toHaveLength(2);
  });

  it("rejects an unknown preset source", async () => {
    const policies = createInMemoryLeavePolicyRepository();
    await expect(
      applyLeavePolicyPreset({ source: "PRESET_DOES_NOT_EXIST" as never, idPrefix: "x" }, { policies }),
    ).rejects.toThrow();
  });
});
