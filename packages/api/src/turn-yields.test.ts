import { afterEach, describe, expect, it, vi } from "vitest";
import { drainTurnYields, reportTurnYield } from "./turn-yields.js";

afterEach(() => {
  vi.restoreAllMocks();
  drainTurnYields();
});

describe("reports of a handler that held the connection across outside work", () => {
  it("logs each one with the route and what the process was waiting on", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportTurnYield("background eta receipts");

    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[0])).toMatch(/background eta receipts .*waiting on /);
    expect(drainTurnYields()).toEqual([expect.stringMatching(/^background eta receipts \[.+\]$/)]);
  });

  it("keeps the most recent two hundred, however many arrive between drains", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (let i = 0; i < 1000; i += 1) reportTurnYield(`POST /route-${i}`);

    const held = drainTurnYields();
    expect(held).toHaveLength(200);
    expect(held[0]).toMatch(/^POST \/route-800 /);
    expect(held[199]).toMatch(/^POST \/route-999 /);
  });
});
