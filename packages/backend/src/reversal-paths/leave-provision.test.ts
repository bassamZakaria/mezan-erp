import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIVE_INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const preview = async (asOfDate: string) => (await world.request("GET", `/hr/payroll/provisions/leave/preview?asOfDate=${asOfDate}`)).body as { postedBalance: string; movement: string };
const reverse = (asOfDate: string) => world.request("POST", `/hr/payroll/provisions/leave/${asOfDate}/reverse`, {});

describe("reversing a leave provision posting", () => {
  it("takes the movement back off 2180 through the provision's own route and lets the same date be provisioned again", async () => {
    const liabilityBefore = world.balance("2180");
    const before = await preview("2026-08-31");
    const posted = await world.request("POST", "/hr/payroll/provisions/leave", { asOfDate: "2026-08-31" });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const entryId = String(posted.body.journalEntryId);
    expect(world.balance("2180")).not.toBe(liabilityBefore);
    await expectJournalRouteClosed(world, entryId);
    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => reverse("2026-08-31"));

    const listed = (await world.request("GET", "/hr/payroll/provisions/leave/postings")).body.postings as { asOfDate: string; status: string; reversible: boolean }[];
    expect(listed.find((p) => p.asOfDate === "2026-08-31")).toMatchObject({ status: "posted", reversible: true });

    const reversed = await reverse("2026-08-31");

    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect(entry(world, entryId).status).toBe("reversed");
    expect(world.balance("2180")).toBe(liabilityBefore);
    expect(await preview("2026-08-31")).toMatchObject({ postedBalance: before.postedBalance, movement: before.movement });
    expect(auditRows(world, "HR_LEAVE_PROVISION", "leave:2026-08-31", "REVERSE")).toBe(1);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);

    const again = await reverse("2026-08-31");
    expect(`${again.status} ${String(again.body.error)}`).toBe("404 HR_PROVISION_POSTING_NOT_FOUND");
    expect(typeof again.body.messageEn).toBe("string");

    const reposted = await world.request("POST", "/hr/payroll/provisions/leave", { asOfDate: "2026-08-31" });
    expect(reposted.status, JSON.stringify(reposted.body)).toBe(200);
    expect(reposted.body.movement).toBe(before.movement);
  });

  it("refuses to reverse a posting a later provision was measured on top of, and says which to reverse first", async () => {
    world.sqlite.prepare(`UPDATE hr_leave_balance SET carried_over = carried_over + 5000000 WHERE leave_type = 'annual'`).run();
    const later = await world.request("POST", "/hr/payroll/provisions/leave", { asOfDate: "2026-09-30" });
    expect(later.status, JSON.stringify(later.body)).toBe(200);

    const refused = await reverse("2026-08-31");

    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 HR_PROVISION_LATER_POSTING_EXISTS");
    expect(String(refused.body.message)).toContain("2026-09-30");
    expect(String(refused.body.messageEn)).toContain("2026-09-30");
  });
});
