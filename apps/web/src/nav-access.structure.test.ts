import { describe, expect, it } from "vitest";
import { getPermission } from "@mezan/domain";
import { NAV_ITEM_ACCESS, navGroupSpecs } from "./nav-config";

const destinations = navGroupSpecs.flatMap((group) => [...(group.itemKeys ?? []), ...(group.sections ?? []).flatMap((section) => section.itemKeys)]);

const OPEN_TO_ANY_SESSION = ["notifications", "settings-profile"];

describe("what each rail destination costs to reach", () => {
  it("reads the rail", () => {
    expect(destinations.length).toBeGreaterThan(150);
  });

  it("every destination states its access, so the rail never offers a seat a screen whose every call is refused", () => {
    expect(destinations.filter((key) => NAV_ITEM_ACCESS[key] === undefined)).toEqual([]);
  });

  it("only a person's own inbox and profile are open to any session", () => {
    expect(destinations.filter((key) => NAV_ITEM_ACCESS[key] !== undefined && NAV_ITEM_ACCESS[key]!.permission === undefined).sort()).toEqual([...OPEN_TO_ANY_SESSION].sort());
  });

  it("every stated permission is one the catalog holds", () => {
    const unknown = destinations.flatMap((key) => {
      const permission = NAV_ITEM_ACCESS[key]?.permission;
      return permission !== undefined && getPermission(permission) === undefined ? [`${key}: ${permission}`] : [];
    });
    expect(unknown).toEqual([]);
  });
});
