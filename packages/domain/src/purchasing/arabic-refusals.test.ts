import { describe, it, expect } from "vitest";
import * as purchasing from "./errors.js";
import * as fiscalPeriods from "../fiscal-periods/errors.js";

/**
 * Every refusal these modules raise reaches the Arabic UI verbatim — the API
 * forwards `message` straight into the screen's error banner — so an
 * English-only message is a defect the user reads, not an internal detail
 * (D74).
 *
 * This walks the exported error classes rather than listing them, so a new one
 * added in English fails here on the day it is written.
 */
const ARABIC = /[؀-ۿ]/;

/** Ids, codes and statuses interpolated into a message are not prose. */
const SAMPLE = "x";
const SAMPLE_PERIOD = { id: SAMPLE, year: 2026, periodNumber: 4 };

function messagesFrom(module: Record<string, unknown>): { name: string; message: string }[] {
  const out: { name: string; message: string }[] = [];
  for (const [name, value] of Object.entries(module)) {
    if (typeof value !== "function" || !/Error$/.test(name)) continue;
    const Ctor = value as new (...args: unknown[]) => Error;
    // Construct with a generous spread of placeholder arguments: these errors
    // take ids, statuses and reason arrays, and an unused extra is harmless.
    for (const args of [
      [SAMPLE, SAMPLE, SAMPLE],
      [[SAMPLE, SAMPLE]],
      [SAMPLE, 1],
      [],
      [SAMPLE_PERIOD, "closed", "close"],
    ]) {
      try {
        const instance = new Ctor(...args);
        if (instance instanceof Error && instance.message) {
          out.push({ name, message: instance.message });
          break;
        }
      } catch {
        // Wrong arity for this shape; try the next.
      }
    }
  }
  return out;
}

describe("a refusal the Arabic UI shows is written in Arabic (D74)", () => {
  it("finds the error classes, so this suite is not silently empty", () => {
    expect(messagesFrom(purchasing).length).toBeGreaterThan(8);
    expect(messagesFrom(fiscalPeriods).length).toBeGreaterThan(3);
  });

  it("writes every purchasing refusal in Arabic", () => {
    const english = messagesFrom(purchasing).filter((e) => !ARABIC.test(e.message));
    expect(english.map((e) => `${e.name}: ${e.message}`)).toEqual([]);
  });

  it("writes every fiscal-period refusal in Arabic", () => {
    const english = messagesFrom(fiscalPeriods).filter((e) => !ARABIC.test(e.message));
    expect(english.map((e) => `${e.name}: ${e.message}`)).toEqual([]);
  });
});
