import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { BankReconciliationService, type ImportStatementCommand } from "./reconciliation-service.js";
import {
  InMemoryBankStatementRepository,
  InMemoryColumnMappingRepository,
  FakeTreasuryLedgerReader,
} from "./test-helpers/in-memory-stores.js";
import {
  LineAlreadyMatchedError,
  LineNotMatchedError,
  StatementAlreadyFinalizedError,
} from "./errors.js";
import type { TreasuryLedgerCandidate } from "./matching.js";

const RAW_CSV =
  "Date,Description,Amount,Ref\n" +
  "2026-08-01,Cash Voucher: CV-1,100.00,TX1\n" +
  "2026-08-02,Cash Voucher: CV-2,-50.00,TX2\n" +
  "2026-08-05,Unmatched fee,-5.00,TX3\n";

function buildService(candidates: TreasuryLedgerCandidate[] = []) {
  const statements = new InMemoryBankStatementRepository();
  const mappings = new InMemoryColumnMappingRepository();
  const ledgerReader = new FakeTreasuryLedgerReader(new Map([["ta-bank1", candidates]]));
  const service = new BankReconciliationService({ statements, mappings, ledgerReader, now: () => "2026-08-22T10:00:00.000Z" });
  return { service, statements, mappings };
}

function importCmd(overrides: Partial<ImportStatementCommand> = {}): ImportStatementCommand {
  return {
    id: "stmt-1",
    treasuryAccountId: "ta-bank1",
    rawCsv: RAW_CSV,
    mapping: {
      dateColumn: "Date",
      descriptionColumn: "Description",
      amountColumn: "Amount",
      debitColumn: null,
      creditColumn: null,
      referenceColumn: "Ref",
      dateFormat: "YYYY-MM-DD",
    },
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalance: Money.zero(),
    closingBalance: Money.fromMajor("45"),
    ...overrides,
  };
}

describe("BankReconciliationService.importStatement", () => {
  it("persists the statement, its lines, and the column mapping", async () => {
    const { service, mappings } = buildService();
    const { statement, lines } = await service.importStatement(importCmd());
    expect(statement.status).toBe("imported");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ date: "2026-08-01", description: "Cash Voucher: CV-1", amount: Money.fromMajor("100"), status: "unmatched" });

    const savedMapping = await mappings.findByTreasuryAccount("ta-bank1");
    expect(savedMapping?.dateColumn).toBe("Date");
  });
});

describe("BankReconciliationService.autoMatch", () => {
  it("applies exact matches and moves the statement to in_progress", async () => {
    const candidates: TreasuryLedgerCandidate[] = [
      { entryId: "je-1", date: "2026-08-01", amount: Money.fromMajor("100"), description: "CV-1" },
      { entryId: "je-2", date: "2026-08-02", amount: Money.fromMajor("-50"), description: "CV-2" },
    ];
    const { service, statements } = buildService(candidates);
    await service.importStatement(importCmd());

    const result = await service.autoMatch("stmt-1");
    expect(result.matchedCount).toBe(2);

    const lines = await service.listLines("stmt-1");
    const matched = lines.filter((l) => l.status === "matched");
    expect(matched).toHaveLength(2);
    expect(matched.map((l) => l.matchedEntryId).sort()).toEqual(["je-1", "je-2"]);

    const statement = await statements.findById("stmt-1");
    expect(statement?.status).toBe("in_progress");

    const summary = await service.matchSummary("stmt-1");
    expect(summary).toEqual({ total: 3, matched: 2, unmatched: 1, matchRate: 2 / 3 });
  });

  it("leaves the statement imported when nothing matches", async () => {
    const { service, statements } = buildService([]);
    await service.importStatement(importCmd());
    const result = await service.autoMatch("stmt-1");
    expect(result.matchedCount).toBe(0);
    expect((await statements.findById("stmt-1"))?.status).toBe("imported");
  });
});

describe("BankReconciliationService manual match/unmatch", () => {
  it("matches a line manually and moves the statement to in_progress", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    const updated = await service.matchLine("stmt-1", lines[2]!.id, "je-manual");
    expect(updated.status).toBe("matched");
    expect(updated.matchedEntryId).toBe("je-manual");
    expect((await service.findById("stmt-1"))?.status).toBe("in_progress");
  });

  it("rejects matching an already-matched line", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    await service.matchLine("stmt-1", lines[0]!.id, "je-1");
    await expect(service.matchLine("stmt-1", lines[0]!.id, "je-2")).rejects.toThrow(LineAlreadyMatchedError);
  });

  it("unmatches a matched line", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    await service.matchLine("stmt-1", lines[0]!.id, "je-1");
    const unmatched = await service.unmatchLine("stmt-1", lines[0]!.id);
    expect(unmatched.status).toBe("unmatched");
    expect(unmatched.matchedEntryId).toBeNull();
  });

  it("rejects unmatching an already-unmatched line", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    await expect(service.unmatchLine("stmt-1", lines[0]!.id)).rejects.toThrow(LineNotMatchedError);
  });
});

describe("BankReconciliationService.addManualLine", () => {
  it("adds an unmatched line the CSV import missed", async () => {
    const { service } = buildService();
    await service.importStatement(importCmd());
    const line = await service.addManualLine({
      id: "stmt-1:manual-1",
      statementId: "stmt-1",
      date: "2026-08-06",
      description: "Bank charge",
      amount: Money.fromMajor("-2.50"),
    });
    expect(line.status).toBe("unmatched");
    expect(await service.listLines("stmt-1")).toHaveLength(4);
  });
});

describe("BankReconciliationService.finalize", () => {
  it("locks the statement and stamps finalizedAt", async () => {
    const { service } = buildService();
    await service.importStatement(importCmd());
    const finalized = await service.finalize("stmt-1");
    expect(finalized.status).toBe("completed");
    expect(finalized.finalizedAt).toBe("2026-08-22T10:00:00.000Z");
  });

  it("rejects finalizing twice", async () => {
    const { service } = buildService();
    await service.importStatement(importCmd());
    await service.finalize("stmt-1");
    await expect(service.finalize("stmt-1")).rejects.toThrow(StatementAlreadyFinalizedError);
  });

  it("blocks matching/unmatching/adding lines on a finalized statement", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    await service.finalize("stmt-1");
    await expect(service.matchLine("stmt-1", lines[0]!.id, "je-1")).rejects.toThrow(StatementAlreadyFinalizedError);
    await expect(
      service.addManualLine({ id: "x", statementId: "stmt-1", date: "2026-08-06", description: "x", amount: Money.zero() }),
    ).rejects.toThrow(StatementAlreadyFinalizedError);
  });
});

describe("BankReconciliationService.matchSummary", () => {
  it("reports zero counts and a zero match rate for a statement with no lines", async () => {
    const { service } = buildService();
    await service.importStatement(importCmd({ rawCsv: "Date,Description,Amount,Ref\n" }));
    expect(await service.matchSummary("stmt-1")).toEqual({ total: 0, matched: 0, unmatched: 0, matchRate: 0 });
  });

  it("tracks matched/unmatched counts and the match rate as lines are matched and unmatched", async () => {
    const { service } = buildService();
    const { lines } = await service.importStatement(importCmd());
    expect(await service.matchSummary("stmt-1")).toEqual({ total: 3, matched: 0, unmatched: 3, matchRate: 0 });

    await service.matchLine("stmt-1", lines[0]!.id, "je-1");
    await service.matchLine("stmt-1", lines[1]!.id, "je-2");
    expect(await service.matchSummary("stmt-1")).toEqual({ total: 3, matched: 2, unmatched: 1, matchRate: 2 / 3 });

    await service.unmatchLine("stmt-1", lines[0]!.id);
    expect(await service.matchSummary("stmt-1")).toEqual({ total: 3, matched: 1, unmatched: 2, matchRate: 1 / 3 });
  });
});
