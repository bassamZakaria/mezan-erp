import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIVE_INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";
import { auditRows, expectJournalRouteClosed, expectRefusedInClosedPeriod } from "./world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const EGP = 1_000_000n;
const ID = "LG-REV-1";
const postings = () =>
  world.sqlite
    .prepare(`SELECT id, status FROM journal_entry WHERE source_doc_type = 'LETTER_OF_GUARANTEE' AND source_doc_id = ? AND reverses_entry_id IS NULL ORDER BY created_at, id`)
    .all(ID) as { id: string; status: string }[];
const letter = async () => (await world.request("GET", `/contracting/guarantees/${ID}`)).body as { status: string; currentValue: string; reductions: unknown[]; closedDate: string | null };
const undo = () => world.request("POST", `/contracting/guarantees/${ID}/reverse-last`, {});
const balances = () => ({ memo: world.balance("9100"), restricted: world.balance("1340"), bank: world.balance("1310"), loss: world.balance("5930") });

describe("reversing a letter of guarantee's postings", () => {
  it("undoes the latest posting each time — the call, then the reduction, then the issue — and the letter follows", async () => {
    const start = balances();
    const created = await world.request("POST", "/contracting/guarantees", {
      id: ID,
      kind: "bid",
      tenderRef: "مناقصة 2026/14",
      beneficiaryNameAr: "جهة الإسناد",
      bankTreasuryAccountId: "TR-DEMO-BANK",
      faceValue: "100000.00",
      cashMarginAmount: "10000.00",
      issueDate: "2026-08-03",
      expiryDate: "2027-08-03",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await world.request("POST", `/contracting/guarantees/${ID}/issue`, {})).status).toBe(200);
    const issued = balances();
    expect(issued.restricted - start.restricted).toBe(10_000n * EGP);
    expect((await world.request("POST", `/contracting/guarantees/${ID}/reduce`, { date: "2026-08-10", amount: "25000.00", reason: "تخفيض باتفاق" })).status).toBe(200);
    const reduced = balances();
    expect((await world.request("POST", `/contracting/guarantees/${ID}/call`, { date: "2026-08-20" })).status).toBe(200);
    expect((await letter()).status).toBe("called");
    const [issueEntry, reduceEntry, callEntry] = postings();
    await expectJournalRouteClosed(world, callEntry!.id);
    await expectRefusedInClosedPeriod(world, "fp-2026-08", undo);
    expect((await letter()).status).toBe("called");

    const callUndone = await undo();
    expect(callUndone.status, JSON.stringify(callUndone.body)).toBe(200);
    expect(await letter()).toMatchObject({ status: "reduced", currentValue: "75000.000000", closedDate: null });
    expect(balances()).toEqual(reduced);
    expect(postings().map((p) => p.status)).toEqual(["posted", "posted", "reversed"]);

    expect((await undo()).status).toBe(200);
    expect(await letter()).toMatchObject({ status: "active", currentValue: "100000.000000", reductions: [] });
    expect(balances()).toEqual(issued);
    expect(postings().find((p) => p.id === reduceEntry!.id)?.status).toBe("reversed");

    expect((await undo()).status).toBe(200);
    expect((await letter()).status).toBe("draft");
    expect(balances()).toEqual(start);
    expect(postings().find((p) => p.id === issueEntry!.id)?.status).toBe("reversed");
    expect(auditRows(world, "LETTER_OF_GUARANTEE", ID, "REVERSE")).toBe(3);
    expect(await world.fiveInvariants()).toEqual(FIVE_INVARIANTS_ZERO);

    const nothing = await undo();
    expect(`${nothing.status} ${String(nothing.body.error)}`).toBe("409 GUARANTEE_NOTHING_TO_REVERSE");
    expect(typeof nothing.body.messageEn).toBe("string");

    expect((await world.request("POST", `/contracting/guarantees/${ID}/issue`, {})).status).toBe(200);
    expect(balances()).toEqual(issued);
  });

  it("refuses to undo a reduction a certificate made, and names the certificate as the way to undo it", async () => {
    const res = await world.request("POST", "/contracting/guarantees/LG-DEMO-2/reverse-last", {});
    expect(`${res.status} ${String(res.body.error)}`).toBe("409 GUARANTEE_POSTING_FROM_DOCUMENT");
    expect(String(res.body.message)).toMatch(/[؀-ۿ]/);
    expect(typeof res.body.messageEn).toBe("string");
  });
});
