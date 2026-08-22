import { describe, it, expect } from "vitest";
import { ALLOWED_LEAD_TRANSITIONS, canTransitionLead, type LeadStatus } from "./lead.js";

const ALL_STATUSES: readonly LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost", "unqualified"];

describe("canTransitionLead / ALLOWED_LEAD_TRANSITIONS", () => {
  it("allows every transition listed in ALLOWED_LEAD_TRANSITIONS", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALLOWED_LEAD_TRANSITIONS[from]) {
        expect(canTransitionLead(from, to)).toBe(true);
      }
    }
  });

  it("rejects every transition not listed in ALLOWED_LEAD_TRANSITIONS", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const allowed = ALLOWED_LEAD_TRANSITIONS[from].includes(to);
        expect(canTransitionLead(from, to)).toBe(allowed);
      }
    }
  });

  it("new -> contacted / unqualified / lost are allowed", () => {
    expect(canTransitionLead("new", "contacted")).toBe(true);
    expect(canTransitionLead("new", "unqualified")).toBe(true);
    expect(canTransitionLead("new", "lost")).toBe(true);
  });

  it("new -> qualified / converted are rejected (must pass through contacted)", () => {
    expect(canTransitionLead("new", "qualified")).toBe(false);
    expect(canTransitionLead("new", "converted")).toBe(false);
  });

  it("contacted -> qualified / unqualified / lost are allowed", () => {
    expect(canTransitionLead("contacted", "qualified")).toBe(true);
    expect(canTransitionLead("contacted", "unqualified")).toBe(true);
    expect(canTransitionLead("contacted", "lost")).toBe(true);
  });

  it("contacted -> converted is rejected", () => {
    expect(canTransitionLead("contacted", "converted")).toBe(false);
  });

  it("qualified -> converted / lost are allowed", () => {
    expect(canTransitionLead("qualified", "converted")).toBe(true);
    expect(canTransitionLead("qualified", "lost")).toBe(true);
  });

  it("qualified -> contacted / unqualified are rejected", () => {
    expect(canTransitionLead("qualified", "contacted")).toBe(false);
    expect(canTransitionLead("qualified", "unqualified")).toBe(false);
  });

  it("converted, lost, and unqualified are terminal (no outgoing transitions)", () => {
    expect(ALLOWED_LEAD_TRANSITIONS.converted).toEqual([]);
    expect(ALLOWED_LEAD_TRANSITIONS.lost).toEqual([]);
    expect(ALLOWED_LEAD_TRANSITIONS.unqualified).toEqual([]);
    for (const to of ALL_STATUSES) {
      expect(canTransitionLead("converted", to)).toBe(false);
      expect(canTransitionLead("lost", to)).toBe(false);
      expect(canTransitionLead("unqualified", to)).toBe(false);
    }
  });
});
