import { describe, it, expect } from "vitest";
import type { Lead } from "./lead.js";
import { transitionLead } from "./transition-lead.js";
import { InvalidLeadTransitionError } from "./errors.js";

function lead(status: Lead["status"]): Lead {
  return {
    id: "lead-1",
    name: "أحمد محمد",
    company: null,
    email: null,
    phone: null,
    source: "other",
    expectedValue: null,
    interest: null,
    notes: null,
    status,
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("transitionLead", () => {
  it("applies a valid transition", () => {
    const next = transitionLead(lead("new"), "contacted");
    expect(next.status).toBe("contacted");
  });

  it("applies the full happy path new -> contacted -> qualified -> converted", () => {
    let current = lead("new");
    current = transitionLead(current, "contacted");
    expect(current.status).toBe("contacted");
    current = transitionLead(current, "qualified");
    expect(current.status).toBe("qualified");
    current = transitionLead(current, "converted");
    expect(current.status).toBe("converted");
  });

  it("throws InvalidLeadTransitionError for an invalid transition (new -> converted)", () => {
    expect(() => transitionLead(lead("new"), "converted")).toThrow(InvalidLeadTransitionError);
  });

  it("throws InvalidLeadTransitionError out of a terminal status", () => {
    expect(() => transitionLead(lead("converted"), "contacted")).toThrow(InvalidLeadTransitionError);
  });

  it("does not mutate the input lead", () => {
    const original = lead("new");
    transitionLead(original, "contacted");
    expect(original.status).toBe("new");
  });
});
