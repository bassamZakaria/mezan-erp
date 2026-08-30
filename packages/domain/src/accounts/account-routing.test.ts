import { describe, it, expect } from "vitest";
import {
  ACCOUNT_ROUTING_SLOTS,
  DEFAULT_ACCOUNT_ROUTING_OPTIONS,
  EMPTY_ACCOUNT_ROUTING,
  isAccountRoutingKey,
  routedAccountId,
  type AccountRouting,
} from "./account-routing.js";

describe("ACCOUNT_ROUTING_SLOTS", () => {
  it("has a unique key per slot", () => {
    const keys = ACCOUNT_ROUTING_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every slot carries a section, an Arabic label and a default account id", () => {
    for (const slot of ACCOUNT_ROUTING_SLOTS) {
      expect(slot.labelAr.length).toBeGreaterThan(0);
      expect(slot.labelEn.length).toBeGreaterThan(0);
      expect(slot.defaultAccountId.length).toBeGreaterThan(0);
    }
  });
});

describe("isAccountRoutingKey", () => {
  it("is true for a known slot key", () => {
    expect(isAccountRoutingKey("tax.output_vat")).toBe(true);
  });

  it("is false for an unknown key", () => {
    expect(isAccountRoutingKey("does.not.exist")).toBe(false);
  });
});

describe("routedAccountId", () => {
  it("falls back to the slot's shipped default when routing is empty", () => {
    expect(routedAccountId(EMPTY_ACCOUNT_ROUTING, "tax.output_vat")).toBe("2200");
  });

  it("falls back to the shipped default when routing is null or undefined", () => {
    expect(routedAccountId(null, "tax.output_vat")).toBe("2200");
    expect(routedAccountId(undefined, "tax.output_vat")).toBe("2200");
  });

  it("uses a tenant override when one is present for the key", () => {
    const routing: AccountRouting = {
      overrides: { "tax.output_vat": "2299-custom" },
      options: DEFAULT_ACCOUNT_ROUTING_OPTIONS,
    };
    expect(routedAccountId(routing, "tax.output_vat")).toBe("2299-custom");
  });

  it("returns null for a key with no slot and no override", () => {
    expect(routedAccountId(EMPTY_ACCOUNT_ROUTING, "does.not.exist")).toBeNull();
  });

  it("an override for an unknown key still wins over the missing default", () => {
    const routing: AccountRouting = {
      overrides: { "does.not.exist": "9999" },
      options: DEFAULT_ACCOUNT_ROUTING_OPTIONS,
    };
    expect(routedAccountId(routing, "does.not.exist")).toBe("9999");
  });
});

describe("DEFAULT_ACCOUNT_ROUTING_OPTIONS / EMPTY_ACCOUNT_ROUTING", () => {
  it("ship revenue_deduction for the late-penalty treatment and no separate discount account", () => {
    expect(DEFAULT_ACCOUNT_ROUTING_OPTIONS).toEqual({
      latePenaltyTreatment: "revenue_deduction",
      useSeparateDiscountAccount: false,
      applyDiscountAccountToLines: false,
    });
  });

  it("EMPTY_ACCOUNT_ROUTING has no overrides and carries the default options", () => {
    expect(EMPTY_ACCOUNT_ROUTING.overrides).toEqual({});
    expect(EMPTY_ACCOUNT_ROUTING.options).toEqual(DEFAULT_ACCOUNT_ROUTING_OPTIONS);
  });
});
