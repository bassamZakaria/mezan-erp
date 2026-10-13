import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuplicateRecordIdError } from "@mezan/domain";
import { insertingNew, prepareInsertOnly } from "./insert-new.js";

const UPSERT = `
  INSERT INTO ledger_thing (id, status, amount) VALUES (@id, @status, @amount)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, amount = excluded.amount
`;

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE ledger_thing (id TEXT PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL)");
});
afterEach(() => sqlite.close());

const rows = () => sqlite.prepare("SELECT * FROM ledger_thing ORDER BY id").all();

describe("prepareInsertOnly — the store's backstop when two creates race past every check above it", () => {
  it("inserts a new row", () => {
    prepareInsertOnly(sqlite, UPSERT).run({ id: "T-1", status: "draft", amount: 100 });
    expect(rows()).toEqual([{ id: "T-1", status: "draft", amount: 100 }]);
  });

  it("refuses a second insert under an id already held and leaves the first row exactly as it was", () => {
    const insert = prepareInsertOnly(sqlite, UPSERT);
    insert.run({ id: "T-1", status: "locked", amount: 100 });
    expect(() => insertingNew("T-1", () => insert.run({ id: "T-1", status: "draft", amount: 999 }))).toThrow(DuplicateRecordIdError);
    expect(rows()).toEqual([{ id: "T-1", status: "locked", amount: 100 }]);
  });

  it("two creates of one id that both passed their existence check end as one row and one refusal", async () => {
    const insert = prepareInsertOnly(sqlite, UPSERT);
    const exists = sqlite.prepare("SELECT 1 FROM ledger_thing WHERE id = ?");
    const create = async (status: string, amount: number) => {
      const taken = exists.get("T-RACE") !== undefined;
      await Promise.resolve();
      if (taken) throw new DuplicateRecordIdError("T-RACE");
      insertingNew("T-RACE", () => insert.run({ id: "T-RACE", status, amount }));
    };
    const outcomes = await Promise.allSettled([create("first", 1), create("second", 2)]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")!;
    expect(refused.reason).toBeInstanceOf(DuplicateRecordIdError);
    expect(rows()).toEqual([{ id: "T-RACE", status: "first", amount: 1 }]);
  });

  it("does not turn another constraint failure into «this id is taken»", () => {
    const insert = prepareInsertOnly(sqlite, UPSERT);
    expect(() => insertingNew("T-2", () => insert.run({ id: "T-2", status: null, amount: 1 }))).toThrow(/NOT NULL/);
  });

  it("accepts only an upsert it can strip, so a create path cannot be handed a statement that still replaces", () => {
    expect(() => prepareInsertOnly(sqlite, "INSERT OR REPLACE INTO ledger_thing (id, status, amount) VALUES (@id, @status, @amount)")).toThrow();
  });
});
