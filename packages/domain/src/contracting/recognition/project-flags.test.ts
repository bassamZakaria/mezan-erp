import { describe, expect, it } from "vitest";
import { Money } from "../../money/index.js";
import { deriveProjectStatusFlags, type ProjectFlagContract } from "./project-flags.js";

const TODAY = "2026-09-13";

function contract(overrides: Partial<ProjectFlagContract> = {}): ProjectFlagContract {
  return {
    projectId: "PRJ-1",
    status: "active",
    plannedEndDate: "2027-02-28",
    estimatedTotalCost: Money.fromMajor("800000"),
    contractValue: Money.fromMajor("1000000"),
    ...overrides,
  };
}

describe("deriveProjectStatusFlags", () => {
  it("flags nothing on a contract that is inside its budget and its programme", () => {
    expect(deriveProjectStatusFlags([contract()], TODAY).get("PRJ-1")).toBeUndefined();
  });

  it("flags «عقد خاسر» once the forecast cost passes the contract value", () => {
    const flags = deriveProjectStatusFlags([contract({ estimatedTotalCost: Money.fromMajor("1200000") })], TODAY);
    expect(flags.get("PRJ-1")).toEqual(["onerous_contract"]);
  });

  it("flags «غرامة تأخير محتملة» once the planned end date has passed", () => {
    const flags = deriveProjectStatusFlags([contract({ plannedEndDate: "2026-07-15" })], TODAY);
    expect(flags.get("PRJ-1")).toEqual(["late_penalty_risk"]);
  });

  it("carries both flags when both are true, without repeating one across two contracts", () => {
    const flags = deriveProjectStatusFlags(
      [
        contract({ estimatedTotalCost: Money.fromMajor("1200000"), plannedEndDate: "2026-07-15" }),
        contract({ estimatedTotalCost: Money.fromMajor("1300000") }),
      ],
      TODAY,
    );
    expect(flags.get("PRJ-1")).toEqual(["onerous_contract", "late_penalty_risk"]);
  });

  it("never flags a contract that is no longer live — a finished job cannot run late", () => {
    const flags = deriveProjectStatusFlags(
      [contract({ status: "completed", plannedEndDate: "2026-07-15", estimatedTotalCost: Money.fromMajor("1200000") })],
      TODAY,
    );
    expect(flags.size).toBe(0);
  });

  it("does not flag a contract with no cost estimate — an unknown forecast is not a loss", () => {
    expect(deriveProjectStatusFlags([contract({ estimatedTotalCost: null })], TODAY).size).toBe(0);
  });
});
