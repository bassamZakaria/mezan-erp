import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";
import { gatedFamilies } from "./test-helpers/gated-families.js";

let kit: BackendKit;
const FAMILIES = gatedFamilies(() => kit);
const CALLER = "LIMITED";

beforeAll(async () => {
  kit = await bootBackendKit();
}, 180_000);

afterAll(async () => {
  await kit.close();
});

describe.each(FAMILIES)("the audit trail of a $mount document names the caller", (family) => {
  const actorsOf = async (id: string, action: string) => (await kit.auditRows(family.auditEntity, id, action)).map((row) => row.actor);

  it("on confirm", async () => {
    const id = `ACT-C-${family.actionType}`;
    expect((await family.draft(id)).status).toBe(201);
    const confirmed = await kit.call("POST", `${family.mount}/${id}/confirm`, {}, family.submitter);
    expect([confirmed.status, family.documentOf(confirmed).status], JSON.stringify(confirmed.body)).toEqual([200, family.postedStatus]);
    expect(await actorsOf(id, "CONFIRM")).toEqual([CALLER]);
  });

  it.skipIf(family.canceller === null)("on cancel", async () => {
    const id = `ACT-X-${family.actionType}`;
    expect((await family.draft(id)).status).toBe(201);
    const cancelled = await kit.call("POST", `${family.mount}/${id}/cancel`, {}, family.canceller ?? []);
    expect([cancelled.status, cancelled.body.status], JSON.stringify(cancelled.body)).toEqual([200, "cancelled"]);
    expect(await actorsOf(id, "CANCEL")).toEqual([CALLER]);
  });
});

describe("after every family has been confirmed and cancelled", () => {
  it("the books still reconcile", async () => {
    expect(await kit.invariants()).toEqual({ tb: 0n, inventory: 0n, ap: 0n, ar: 0n });
  });
});
