import { describe, it, expect } from "vitest";
import {
  DOMAIN_EVENT_CATALOG,
  EVENT_CATEGORIES,
  EVENT_CATALOG_VERSION,
  isEventCode,
  getEventDefinition,
  type EventCategory,
} from "./catalog.js";

describe("domain event catalog", () => {
  it("encodes the 39 notification events from catalog 09 plus the cash-runway alert", () => {
    expect(DOMAIN_EVENT_CATALOG).toHaveLength(40);
    expect(isEventCode("CASH_FORECAST_LOW")).toBe(true);
  });

  it("is versioned, and the version moved when the catalog gained an event", () => {
    expect(EVENT_CATALOG_VERSION).toBe(2);
  });

  it("has unique codes", () => {
    const codes = new Set(DOMAIN_EVENT_CATALOG.map((e) => e.code));
    expect(codes.size).toBe(40);
  });

  it("matches the catalog's per-category counts", () => {
    const counts: Record<EventCategory, number> = {
      workflow: 0,
      sales: 0,
      purchases: 0,
      treasury: 0,
      installments: 0,
      cheques: 0,
      pos: 0,
      inventory: 0,
      manufacturing: 0,
      platform: 0,
    };
    for (const e of DOMAIN_EVENT_CATALOG) counts[e.category]++;
    expect(counts).toEqual({
      workflow: 4,
      sales: 7,
      purchases: 7,
      treasury: 4,
      installments: 4,
      cheques: 5,
      pos: 5,
      inventory: 1,
      manufacturing: 2,
      platform: 1,
    });
    // Categories sum back to the whole catalog.
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("every event uses a declared category", () => {
    const declared = new Set<string>(EVENT_CATEGORIES);
    for (const e of DOMAIN_EVENT_CATALOG) {
      expect(declared.has(e.category)).toBe(true);
    }
  });

  it("isEventCode / getEventDefinition round-trip", () => {
    expect(isEventCode("SALES_INVOICE_CONFIRMED")).toBe(true);
    expect(isEventCode("NOT_AN_EVENT")).toBe(false);
    expect(getEventDefinition("CHEQUE_BOUNCED").labelAr).toBe("شيك مرتجع");
  });
});
