import { describe, it, expect } from "vitest";
import {
  SALES_INVOICE_TRANSITIONS,
  canTransition,
  assertTransition,
} from "./status.js";
import { InvalidSalesInvoiceTransitionError } from "./errors.js";
import type { SalesInvoiceStatus } from "./sales-invoice.js";

const ALL_STATUSES: readonly SalesInvoiceStatus[] = [
  "draft",
  "pending",
  "confirmed",
  "partially_paid",
  "paid",
  "cancelled",
  "reversed",
];

describe("SALES_INVOICE_TRANSITIONS — exhaustive matrix", () => {
  it("matches the declared table exactly for every from/to pair", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = SALES_INVOICE_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });

  it("cancelled and reversed are terminal — no transitions out", () => {
    expect(SALES_INVOICE_TRANSITIONS.cancelled).toEqual([]);
    expect(SALES_INVOICE_TRANSITIONS.reversed).toEqual([]);
    for (const to of ALL_STATUSES) {
      expect(canTransition("cancelled", to)).toBe(false);
      expect(canTransition("reversed", to)).toBe(false);
    }
  });

  it("draft may go to pending, confirmed or cancelled, and nowhere else", () => {
    expect(canTransition("draft", "pending")).toBe(true);
    expect(canTransition("draft", "confirmed")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
    expect(canTransition("draft", "partially_paid")).toBe(false);
    expect(canTransition("draft", "paid")).toBe(false);
    expect(canTransition("draft", "reversed")).toBe(false);
    expect(canTransition("draft", "draft")).toBe(false);
  });

  it("payment states walk both forwards and backwards (reversible allocation)", () => {
    expect(canTransition("confirmed", "partially_paid")).toBe(true);
    expect(canTransition("confirmed", "paid")).toBe(true);
    expect(canTransition("partially_paid", "confirmed")).toBe(true);
    expect(canTransition("partially_paid", "paid")).toBe(true);
    expect(canTransition("paid", "confirmed")).toBe(true);
    expect(canTransition("paid", "partially_paid")).toBe(true);
  });

  it("a live invoice reaches reversed only from confirmed, partially_paid or paid", () => {
    expect(canTransition("confirmed", "reversed")).toBe(true);
    expect(canTransition("partially_paid", "reversed")).toBe(true);
    expect(canTransition("paid", "reversed")).toBe(true);
    expect(canTransition("draft", "reversed")).toBe(false);
    expect(canTransition("pending", "reversed")).toBe(false);
  });

  it("a live invoice never cancels directly — must be reversed", () => {
    expect(canTransition("confirmed", "cancelled")).toBe(false);
    expect(canTransition("partially_paid", "cancelled")).toBe(false);
    expect(canTransition("paid", "cancelled")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("does not throw for a legal transition", () => {
    expect(() => assertTransition("inv-1", "draft", "confirmed")).not.toThrow();
  });

  it("throws InvalidSalesInvoiceTransitionError carrying the invoice id, from and to on an illegal transition", () => {
    let caught: unknown;
    try {
      assertTransition("inv-42", "cancelled", "confirmed");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidSalesInvoiceTransitionError);
    const err = caught as InvalidSalesInvoiceTransitionError;
    expect(err.invoiceId).toBe("inv-42");
    expect(err.from).toBe("cancelled");
    expect(err.to).toBe("confirmed");
    expect(err.code).toBe("INVALID_SALES_INVOICE_TRANSITION");
  });

  it("renders the exact Arabic status labels in the error message", () => {
    let caught: unknown;
    try {
      assertTransition("inv-9", "paid", "cancelled");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidSalesInvoiceTransitionError);
    expect((caught as Error).message).toBe(
      'لا يمكن نقل الفاتورة inv-9 من "مدفوع" إلى "ملغي".',
    );
  });
});
