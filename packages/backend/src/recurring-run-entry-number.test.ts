import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

interface RunRow {
  readonly id: string;
  readonly journalEntryId: string;
  readonly journalEntryNo: string | null;
  readonly entryStatus: string;
  readonly current: boolean;
  readonly reversedByEntryNo: string | null;
}

const runs = async () => (await world.request("GET", "/gl/recurring/runs")).body as unknown as RunRow[];

describe("the recurring history names an entry by the number it carries now", () => {
  it("a generated draft has no number; once posted the run reads its JE number, and still does after it is reversed", async () => {
    const draft = (await runs()).find((row) => row.current && row.entryStatus === "draft");
    expect(draft, "the seed leaves a generated draft to post").toBeDefined();
    expect(draft!.journalEntryNo).toBeNull();

    const posted = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(draft!.journalEntryId)}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const entryNo = String(posted.body.entryNo);
    expect(entryNo).toMatch(/^JE-\d+$/);
    expect((await runs()).find((row) => row.id === draft!.id)).toMatchObject({ entryStatus: "posted", journalEntryNo: entryNo });

    const reversed = await world.request("POST", `/gl/recurring/runs/${draft!.id}/reverse`, { memo: "قيد مكرر" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    const after = (await runs()).find((row) => row.id === draft!.id);
    expect(after).toMatchObject({ entryStatus: "reversed", journalEntryNo: entryNo });
    expect(after!.reversedByEntryNo).toMatch(/^JE-\d+$/);
    const byTemplate = (await world.request("GET", `/gl/recurring/templates/${(after as unknown as { templateId: string }).templateId}/runs`)).body as unknown as RunRow[];
    expect(byTemplate.find((row) => row.id === draft!.id)?.journalEntryNo).toBe(entryNo);
  });
});
