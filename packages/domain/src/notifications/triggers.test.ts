import { describe, it, expect } from "vitest";
import { DOMAIN_EVENT_CATALOG } from "../events/catalog.js";
import { buildNotificationTriggerCatalog, IMPLEMENTED_NOTIFICATION_CHANNELS } from "./triggers.js";

describe("IMPLEMENTED_NOTIFICATION_CHANNELS", () => {
  it("is honest about what this build can actually deliver: in_app only", () => {
    expect(IMPLEMENTED_NOTIFICATION_CHANNELS).toEqual(["in_app"]);
  });
});

describe("buildNotificationTriggerCatalog", () => {
  it("returns one trigger per catalogued event, in catalog order", () => {
    const triggers = buildNotificationTriggerCatalog([]);
    expect(triggers).toHaveLength(DOMAIN_EVENT_CATALOG.length);
    expect(triggers.map((t) => t.code)).toEqual(DOMAIN_EVENT_CATALOG.map((e) => e.code));
  });

  it("marks emitted:true only for codes passed in emittedCodes, false for everything else", () => {
    const first = DOMAIN_EVENT_CATALOG[0]!.code;
    const triggers = buildNotificationTriggerCatalog([first]);
    for (const trigger of triggers) {
      expect(trigger.emitted).toBe(trigger.code === first);
    }
  });

  it("every catalogued code is still selectable when emittedCodes is empty — none are dropped, just marked not-yet-emitted", () => {
    const triggers = buildNotificationTriggerCatalog([]);
    expect(triggers.every((t) => t.emitted === false)).toBe(true);
    expect(triggers).toHaveLength(DOMAIN_EVENT_CATALOG.length);
  });

  it("carries the category and Arabic label straight from the catalog", () => {
    const [event] = DOMAIN_EVENT_CATALOG;
    const [trigger] = buildNotificationTriggerCatalog([]);
    expect(trigger?.category).toBe(event?.category);
    expect(trigger?.labelAr).toBe(event?.labelAr);
  });
});
