import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIVE_INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const setPeriod = (id: string, status: string) => world.sqlite.prepare(`UPDATE fiscal_period SET status = ? WHERE id = ?`).run(status, id);
const close = (year: number) => world.request("POST", "/gl/year-end-close", { year, retainedEarningsAccountId: "3900" });
const reopen = (year: number) => world.request("POST", `/gl/year-end-close/${year}/reopen`, {});

describe("reopening a closed year", () => {
  it("reverses the closing entry on the year's last day, only while the following year is not closed and December is open", async () => {
    setPeriod("fp-2024-12", "open");
    setPeriod("fp-2025-12", "open");
    const retainedBefore = world.balance("3900");
    const closed2024 = await close(2024);
    expect(closed2024.status, JSON.stringify(closed2024.body)).toBe(201);
    const closingEntryId = String(closed2024.body.journalEntryId);
    const retainedClosed = world.balance("3900");
    expect(retainedClosed).not.toBe(retainedBefore);
    await expectJournalRouteClosed(world, closingEntryId);
    expect((await close(2025)).status).toBe(201);

    const blockedByNextYear = await reopen(2024);
    expect(`${blockedByNextYear.status} ${String(blockedByNextYear.body.error)}`).toBe("409 FOLLOWING_YEAR_CLOSED");
    expect(String(blockedByNextYear.body.message)).toContain("2025");
    expect(String(blockedByNextYear.body.messageEn)).toContain("2025");

    expect((await reopen(2025)).status).toBe(201);
    expect(world.balance("3900")).toBe(retainedClosed);

    setPeriod("fp-2024-12", "closed");
    const blockedByPeriod = await reopen(2024);
    expect(`${blockedByPeriod.status} ${String(blockedByPeriod.body.error)}`).toBe("422 PERIOD_NOT_OPEN_FOR_POSTING");
    expect(entry(world, closingEntryId).status).toBe("posted");
    setPeriod("fp-2024-12", "open");

    const reopened = await reopen(2024);

    expect(reopened.status, JSON.stringify(reopened.body)).toBe(201);
    expect(entry(world, closingEntryId).status).toBe("reversed");
    expect(entry(world, String(reopened.body.reversalEntryId)).date).toBe("2024-12-31");
    expect(world.balance("3900")).toBe(retainedBefore);
    expect((await world.request("GET", "/gl/year-end-close/2024")).body).toMatchObject({ closed: false });
    expect(auditRows(world, "FISCAL_YEAR", "2024", "REOPEN")).toBe(1);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);

    const notClosed = await reopen(2024);
    expect(`${notClosed.status} ${String(notClosed.body.error)}`).toBe("409 YEAR_NOT_CLOSED");
    expect(typeof notClosed.body.messageEn).toBe("string");

    const reclosed = await close(2024);
    expect(reclosed.status, JSON.stringify(reclosed.body)).toBe(201);
    expect(world.balance("3900")).toBe(retainedClosed);
    expect((await world.request("GET", "/gl/year-end-close/2024")).body).toMatchObject({ closed: true });
  });
});
