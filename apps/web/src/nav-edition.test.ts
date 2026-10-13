import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_BILLING_FEATURE, type Entitlements } from "@mezan/domain";
import { navGroupItems } from "@mezan/ui";
import { buildNavGroups, withoutScreensThisEditionLacks } from "./nav-config";

const BILLING = "settings-billing";
const t = (key: string) => key;

const LICENCE: Entitlements = { plan: "DESKTOP", activeModules: ["sales", "accounting"], features: {}, seats: 5, expiresAt: null };
const CLOUD: Entitlements = { ...LICENCE, plan: "business", features: { [SUBSCRIPTION_BILLING_FEATURE]: true } };

function keysOf(entitlements: Entitlements | null): string[] {
  return withoutScreensThisEditionLacks(buildNavGroups(t as Parameters<typeof buildNavGroups>[0]), entitlements).flatMap((group) => navGroupItems(group).map((item) => item.key));
}

describe("«الباقة والاستخدام» is offered only where subscription billing exists", () => {
  it("is in the nav tree to begin with", () => {
    expect(buildNavGroups(t as Parameters<typeof buildNavGroups>[0]).flatMap((group) => navGroupItems(group).map((item) => item.key))).toContain(BILLING);
  });

  it("is not offered under an on-premises licence", () => {
    expect(keysOf(LICENCE)).not.toContain(BILLING);
  });

  it("is offered to a cloud tenant", () => {
    expect(keysOf(CLOUD)).toContain(BILLING);
  });

  it("is not offered before the edition is known", () => {
    expect(keysOf(null)).not.toContain(BILLING);
  });

  it("removes nothing else", () => {
    const every = buildNavGroups(t as Parameters<typeof buildNavGroups>[0]).flatMap((group) => navGroupItems(group).map((item) => item.key));
    expect(keysOf(LICENCE)).toEqual(every.filter((key) => key !== BILLING));
    expect(keysOf(CLOUD)).toEqual(every);
  });
});
