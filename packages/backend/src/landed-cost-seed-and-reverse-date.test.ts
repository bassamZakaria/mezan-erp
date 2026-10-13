import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

describe("landed costs", () => {
  it("a reverse whose date is not a string is a bad request, not a reversal dated today", async () => {
    const refused = await world.request("POST", "/landed-costs/LC-DEMO-1/reverse", { date: 20261005 });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("VALIDATION_ERROR");
    expect(String(refused.body.messageEn)).toContain("date");
    expect((await world.request("GET", "/landed-costs/LC-DEMO-1")).body.status).toBe("confirmed");
  });

  it("the draft the seed ships can be confirmed", async () => {
    expect((await world.request("GET", "/landed-costs/LC-DEMO-2")).body.status).toBe("draft");
    const confirmed = await world.request("POST", "/landed-costs/LC-DEMO-2/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
