import { describe, expect, it } from "vitest";
import { createEntitlements, heldModuleIds } from "@mezan/domain";
import { isNavItemVisible } from "@mezan/ui";
import { NAV_ITEM_ACCESS, moduleOutsideLicence, navGroupSpecs } from "./nav-config";

const plan = (activeModules: string[]) => createEntitlements({ plan: "P", activeModules, features: {}, seats: 1, expiresAt: null });

const peopleItems = (): string[] => {
  const group = navGroupSpecs.find((g) => g.key === "people")!;
  return [...group.itemKeys, ...(group.sections ?? []).flatMap((s) => s.itemKeys)];
};

const visibleIn = (activeModules: string[]) =>
  peopleItems().filter((key) =>
    isNavItemVisible({ key, label: key, ...NAV_ITEM_ACCESS[key] }, { permissions: ["*"], activeModules: heldModuleIds(plan(activeModules)) }),
  );

describe("the HR menu follows the plan's HR parts", () => {
  it("shows only the staff list on a plan without HR", () => {
    expect(visibleIn(["sales"]).sort()).toEqual(["departments", "employees", "hr-dashboard", "job-titles", "report-headcount-movement"].sort());
  });

  it("shows every HR screen on a plan with all of HR", () => {
    expect(visibleIn(["hr"]).sort()).toEqual(peopleItems().sort());
  });

  it("adds a part's screens on top of the staff list", () => {
    const shown = visibleIn(["hr.time"]);
    expect(shown).toContain("attendance");
    expect(shown).toContain("leave-requests");
    expect(shown).not.toContain("payroll");
    expect(shown).not.toContain("contracts");
  });

  it("names the missing part for a screen opened by its address", () => {
    expect(moduleOutsideLicence("payroll", plan(["hr.time"]))).toBe("hr.payroll");
    expect(moduleOutsideLicence("employees", plan(["sales"]))).toBeNull();
  });
});
