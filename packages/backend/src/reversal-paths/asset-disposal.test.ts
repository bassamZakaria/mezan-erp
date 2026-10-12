import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, entry, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const asset = () => world.sqlite.prepare(`SELECT status, accumulated_depreciation AS accumulated FROM asset WHERE id = 'ASSET-DEMO-5'`).safeIntegers().get() as { status: string; accumulated: bigint };
const disposalEntries = () =>
  world.sqlite.prepare(`SELECT id, status FROM journal_entry WHERE source_doc_type = 'ASSET_DISPOSAL' AND source_doc_id = 'ASSET-DEMO-5' AND reverses_entry_id IS NULL ORDER BY created_at`).all() as { id: string; status: string }[];

describe("undoing an asset disposal", () => {
  it("puts the asset back in service, reverses the gain or loss entry, and lets it be disposed again", async () => {
    const before = { cost: world.balance("1500"), gain: world.balance("4500"), loss: world.balance("5450"), bank: world.balance("1310"), accumulated: asset().accumulated };
    const disposed = await world.request("POST", "/assets/ASSET-DEMO-5/dispose", { date: "2026-08-20", proceeds: "9000.00", proceedsAccountId: "1310" });
    expect(disposed.status, JSON.stringify(disposed.body)).toBe(200);
    expect(asset().status).toBe("disposed");
    const [posting] = disposalEntries();
    expect(posting).toMatchObject({ status: "posted" });
    await expectJournalRouteClosed(world, posting!.id);
    await expectRefusedInClosedPeriod(world, "fp-2026-08", () => world.request("POST", "/assets/ASSET-DEMO-5/undo-disposal", { memo: "سبب العكس" }));
    expect(asset().status).toBe("disposed");

    const undone = await world.request("POST", "/assets/ASSET-DEMO-5/undo-disposal", { memo: "سبب العكس" });

    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body).toMatchObject({ id: "ASSET-DEMO-5", status: "active" });
    expect(asset()).toEqual({ status: "active", accumulated: before.accumulated });
    expect(entry(world, posting!.id).status).toBe("reversed");
    expect({ cost: world.balance("1500"), gain: world.balance("4500"), loss: world.balance("5450"), bank: world.balance("1310") }).toEqual({ cost: before.cost, gain: before.gain, loss: before.loss, bank: before.bank });
    expect(auditRows(world, "ASSET", "ASSET-DEMO-5", "UNDO_DISPOSAL")).toBe(1);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const again = await world.request("POST", "/assets/ASSET-DEMO-5/undo-disposal", { memo: "سبب العكس" });
    expect(`${again.status} ${String(again.body.error)}`).toBe("409 ASSET_NOT_DISPOSED");
    expect(typeof again.body.messageEn).toBe("string");

    const redisposed = await world.request("POST", "/assets/ASSET-DEMO-5/dispose", { date: "2026-08-25" });
    expect(redisposed.status, JSON.stringify(redisposed.body)).toBe(200);
    expect(disposalEntries().map((e) => e.status)).toEqual(["reversed", "posted"]);
  });

  it("an undone disposal no longer excuses the asset from the months that follow", async () => {
    await world.request("POST", "/assets/ASSET-DEMO-4/dispose", { date: "2026-08-05" });
    const datesBefore = world.sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry WHERE source_doc_type = 'ASSET_DISPOSAL' AND source_doc_id = 'ASSET-DEMO-4' AND status = 'posted' AND reverses_entry_id IS NULL`).get() as { n: number };
    expect(datesBefore.n).toBe(1);
    expect((await world.request("POST", "/assets/ASSET-DEMO-4/undo-disposal", { memo: "سبب العكس" })).status).toBe(200);
    const drafted = await world.request("POST", "/assets/depreciation/runs", { period: "2026-08" });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    expect((drafted.body.lines as { assetId: string }[]).some((l) => l.assetId === "ASSET-DEMO-4")).toBe(true);
  });
});
