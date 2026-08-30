import { describe, it, expect } from "vitest";
import { SALES_QUOTE_TRANSITIONS, canTransition, assertTransition } from "./status.js";
import { InvalidSalesQuoteTransitionError } from "./errors.js";
import type { SalesQuoteStatus } from "./sales-quote.js";

const ALL_STATUSES: readonly SalesQuoteStatus[] = ["draft", "sent", "accepted", "rejected", "converted", "cancelled"];

describe("SALES_QUOTE_TRANSITIONS — exhaustive matrix", () => {
  it("matches the declared table exactly for every from/to pair", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(SALES_QUOTE_TRANSITIONS[from].includes(to));
      }
    }
  });

  it("rejected, converted and cancelled are terminal", () => {
    for (const from of ["rejected", "converted", "cancelled"] as const) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("draft may only go to sent or cancelled", () => {
    expect(canTransition("draft", "sent")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
    expect(canTransition("draft", "accepted")).toBe(false);
    expect(canTransition("draft", "rejected")).toBe(false);
    expect(canTransition("draft", "converted")).toBe(false);
  });

  it("sent may go to accepted, rejected or cancelled", () => {
    expect(canTransition("sent", "accepted")).toBe(true);
    expect(canTransition("sent", "rejected")).toBe(true);
    expect(canTransition("sent", "cancelled")).toBe(true);
    expect(canTransition("sent", "converted")).toBe(false);
  });

  it("accepted may go to converted or cancelled, never back to sent", () => {
    expect(canTransition("accepted", "converted")).toBe(true);
    expect(canTransition("accepted", "cancelled")).toBe(true);
    expect(canTransition("accepted", "sent")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("passes silently for a legal transition", () => {
    expect(() => assertTransition("qt-1", "draft", "sent")).not.toThrow();
  });

  it("throws InvalidSalesQuoteTransitionError with the quote id and both statuses for an illegal one", () => {
    try {
      assertTransition("qt-1", "draft", "accepted");
      throw new Error("expected assertTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSalesQuoteTransitionError);
      const e = err as InvalidSalesQuoteTransitionError;
      expect(e.quoteId).toBe("qt-1");
      expect(e.from).toBe("draft");
      expect(e.to).toBe("accepted");
    }
  });
});
