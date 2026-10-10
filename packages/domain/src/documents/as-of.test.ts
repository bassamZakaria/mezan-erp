import { describe, expect, it } from "vitest";
import { ledgerPresenceAsOf } from "./as-of.js";

describe("ledgerPresenceAsOf", () => {
  const reversedInJuly = { date: "2026-06-29", live: false, endedOn: "2026-07-10" };

  it("counts a document reversed in July at the end of June, and not from the day of the reversal", () => {
    expect(ledgerPresenceAsOf(reversedInJuly, "2026-06-30")).toBe(1);
    expect(ledgerPresenceAsOf(reversedInJuly, "2026-07-09")).toBe(1);
    expect(ledgerPresenceAsOf(reversedInJuly, "2026-07-10")).toBe(0);
    expect(ledgerPresenceAsOf(reversedInJuly, "2026-07-31")).toBe(0);
  });

  it("does not count a document before its own date", () => {
    expect(ledgerPresenceAsOf(reversedInJuly, "2026-06-28")).toBe(0);
    expect(ledgerPresenceAsOf({ date: "2026-06-29", live: true, endedOn: null }, "2026-06-28")).toBe(0);
    expect(ledgerPresenceAsOf({ date: "2026-06-29", live: true, endedOn: null }, "2026-06-29")).toBe(1);
  });

  it("reads a reversal date that carries a time as its day", () => {
    expect(ledgerPresenceAsOf({ date: "2026-06-29", live: false, endedOn: "2026-07-10T19:22:25.972Z" }, "2026-07-10")).toBe(0);
  });

  it("never counts a document that was not posted — ended with no reversal on the ledger", () => {
    expect(ledgerPresenceAsOf({ date: "2026-06-29", live: false, endedOn: null }, "2026-06-30")).toBe(0);
  });

  it("mirrors the ledger when a reversal is dated before the document it undoes", () => {
    expect(ledgerPresenceAsOf({ date: "2026-08-05", live: false, endedOn: "2026-07-10" }, "2026-07-31")).toBe(-1);
    expect(ledgerPresenceAsOf({ date: "2026-08-05", live: false, endedOn: "2026-07-10" }, "2026-08-31")).toBe(0);
  });

  it("with no as-of date, counts exactly the documents that stand today", () => {
    expect(ledgerPresenceAsOf(reversedInJuly, undefined)).toBe(0);
    expect(ledgerPresenceAsOf({ date: "2027-01-01", live: true, endedOn: null }, undefined)).toBe(1);
  });
});
