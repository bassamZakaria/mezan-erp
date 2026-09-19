import { afterEach, describe, expect, it } from "vitest";
import { installClockOverride } from "./clock-override.js";

const RealDate = globalThis.Date;
afterEach(() => {
  globalThis.Date = RealDate;
});

describe("installClockOverride", () => {
  it("does nothing without MEZAN_FAKE_TODAY", () => {
    expect(installClockOverride({})).toBeNull();
    expect(globalThis.Date).toBe(RealDate);
  });

  it("moves today and Date.now while leaving explicit dates and instanceof alone", () => {
    expect(installClockOverride({ MEZAN_FAKE_TODAY: "2026-12-31" })).toBe("2026-12-31");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(new Date(Date.now()).toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(new Date("2026-08-24T10:00:00.000Z").toISOString()).toBe("2026-08-24T10:00:00.000Z");
    expect(new Date(2026, 0, 2).getMonth()).toBe(0);
    expect(new Date() instanceof Date).toBe(true);
    expect(new Date() instanceof RealDate).toBe(true);
    expect(Date.UTC(2026, 0, 1)).toBe(RealDate.UTC(2026, 0, 1));
  });

  it("starts at an exact instant, for the hours where the tenant's day and UTC's differ", () => {
    installClockOverride({ MEZAN_FAKE_TODAY: "2026-09-19T00:30:00+03:00" });
    expect(new Date().toISOString().slice(0, 13)).toBe("2026-09-18T21");
  });

  it("refuses production, a day that does not exist and an instant with no offset", () => {
    expect(() => installClockOverride({ MEZAN_FAKE_TODAY: "2026-08-24", NODE_ENV: "production" })).toThrow(/production/);
    expect(() => installClockOverride({ MEZAN_FAKE_TODAY: "2026-02-30" })).toThrow();
    expect(() => installClockOverride({ MEZAN_FAKE_TODAY: "24/08/2026" })).toThrow();
    expect(() => installClockOverride({ MEZAN_FAKE_TODAY: "2026-09-19T00:30:00" })).toThrow();
    expect(globalThis.Date).toBe(RealDate);
  });
});
