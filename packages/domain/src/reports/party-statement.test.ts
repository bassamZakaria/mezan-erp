import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildPartyStatement, statementSides } from "./party-statement.js";

describe("buildPartyStatement", () => {
  it("puts the opening balance first, orders the rest by day and carries a running balance", () => {
    const statement = buildPartyStatement([
      { key: "b", date: "2026-08-10", kind: "receipt", reference: "CV-1", ...statementSides(Money.fromMajor("-400")) },
      { key: "a", date: "2026-08-01", kind: "invoice", reference: "INV-1", ...statementSides(Money.fromMajor("1000")) },
      { key: "o", date: "2026-09-01", kind: "opening", reference: "", ...statementSides(Money.fromMajor("250")) },
    ]);
    expect(statement.lines.map((l) => [l.kind, l.balance.toString()])).toEqual([
      ["opening", "250.000000"],
      ["invoice", "1250.000000"],
      ["receipt", "850.000000"],
    ]);
    expect(statement.totalIncrease.toString()).toBe("1250.000000");
    expect(statement.totalDecrease.toString()).toBe("400.000000");
    expect(statement.closing.toString()).toBe("850.000000");
  });
});
