import { describe, it, expect, afterEach } from "vitest";
import { applyLeavePolicyPreset, setLeavePolicy } from "@mezan/domain";
import { createSqliteLeavePolicyRepository } from "./hr-leave-policy-store.js";

const handles: { close(): void }[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("SqliteLeavePolicyRepository", () => {
  it("applies a preset and finds the effective version per leave type", async () => {
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });

    const annual = await policies.findEffective("ANNUAL", "2026-01-01");
    expect(annual?.baseBalanceDays).toBe(21);
    expect((await policies.listEffective("2026-01-01"))).toHaveLength(8);
  });

  it("a later-dated manual version supersedes without deleting history", async () => {
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_12_2003", idPrefix: "p12" }, { policies });
    await setLeavePolicy(
      {
        id: "m1",
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

    expect((await policies.findEffective("ANNUAL", "2026-12-31"))?.baseBalanceDays).toBe(21);
    expect((await policies.findEffective("ANNUAL", "2027-01-01"))?.baseBalanceDays).toBe(25);
    expect(await policies.listVersions("ANNUAL")).toHaveLength(2);
  });

  it("findEffective returns null before any version's effective date", async () => {
    const policies = createSqliteLeavePolicyRepository();
    handles.push(policies);
    await applyLeavePolicyPreset({ source: "PRESET_EG_LAW_14_2025", idPrefix: "p14" }, { policies });
    expect(await policies.findEffective("ANNUAL", "2020-01-01")).toBeNull();
  });
});
