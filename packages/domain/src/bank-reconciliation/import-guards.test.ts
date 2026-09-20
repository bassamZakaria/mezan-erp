import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { BankReconciliationService, type ImportStatementCommand, type ImportStatementFileCommand } from "./reconciliation-service.js";
import { InMemoryBankStatementRepository, InMemoryColumnMappingRepository, FakeTreasuryLedgerReader } from "./test-helpers/in-memory-stores.js";
import {
  DuplicateStatementImportError,
  MatchCurrencyMismatchError,
  StatementAccountMismatchError,
  StatementCurrencyMismatchError,
  StatementOutOfBranchScopeError,
  TreasuryAccountNumberMissingError,
  TreasuryAccountOutOfBranchScopeError,
} from "./errors.js";
import { StatementFileFormat } from "./statement-file.js";
import type { TreasuryAccount } from "../treasury-accounts/treasury-account.js";
import type { TreasuryLedgerCandidate } from "./matching.js";

const RAW_CSV =
  "Date,Description,Amount,Ref\n" +
  "2026-08-01,Cash Voucher: CV-1,100.00,TX1\n" +
  "2026-08-02,Cash Voucher: CV-2,-50.00,TX2\n";

function account(overrides: Partial<TreasuryAccount> = {}): TreasuryAccount {
  return {
    id: "ta-bank1",
    code: "BANK-001",
    name: "البنك الأهلي",
    nameEn: null,
    type: "bank",
    currency: "EGP",
    bankAccountNumber: "1234567890",
    branchId: "BR-MAIN",
    glAccountId: "1310",
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: null,
    status: "active",
    ...overrides,
  };
}

function buildService(
  accounts: TreasuryAccount[],
  opts: { branchScope?: readonly string[]; candidates?: TreasuryLedgerCandidate[] } = {},
) {
  const statements = new InMemoryBankStatementRepository();
  const mappings = new InMemoryColumnMappingRepository();
  const ledgerReader = new FakeTreasuryLedgerReader(new Map([["ta-bank1", opts.candidates ?? []]]));
  const service = new BankReconciliationService({
    statements,
    mappings,
    ledgerReader,
    treasuryAccounts: { async findById(id) { return accounts.find((a) => a.id === id) ?? null; } },
    ...(opts.branchScope ? { branchScope: opts.branchScope } : {}),
    now: () => "2026-08-22T10:00:00.000Z",
  });
  return { service, statements };
}

function csvCmd(overrides: Partial<ImportStatementCommand> = {}): ImportStatementCommand {
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
    closingBalance: Money.fromMajor("50"),
    ...overrides,
  };
}

const OFX = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD</CURDEF>
<BANKACCTFROM><ACCTID>1234567890</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260801</DTSTART><DTEND>20260831</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260805</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>F1</FITID><NAME>WIRE IN</NAME></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>100.00</BALAMT></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

function fileCmd(overrides: Partial<ImportStatementFileCommand> = {}): ImportStatementFileCommand {
  return { id: "stmt-f1", treasuryAccountId: "ta-bank1", format: StatementFileFormat.Ofx, content: OFX, ...overrides };
}

describe("re-importing the same statement", () => {
  it("is recognised as the statement already imported, not duplicated", async () => {
    const { service, statements } = buildService([account()]);
    const first = await service.importStatement(csvCmd());
    expect(first.statement.importFingerprint).not.toBeNull();

    await expect(service.importStatement(csvCmd({ id: "stmt-2" }))).rejects.toBeInstanceOf(DuplicateStatementImportError);
    await expect(service.importStatement(csvCmd({ id: "stmt-2" }))).rejects.toMatchObject({
      code: "DUPLICATE_STATEMENT_IMPORT",
      existingStatementId: "stmt-1",
    });
    expect(await statements.list()).toHaveLength(1);
  });

  it("still accepts a genuinely different period on the same account", async () => {
    const { service, statements } = buildService([account()]);
    await service.importStatement(csvCmd());
    await service.importStatement(csvCmd({ id: "stmt-2", periodStart: "2026-09-01", periodEnd: "2026-09-30" }));
    expect(await statements.list()).toHaveLength(2);
  });
});

describe("what the imported file says about itself", () => {
  it("refuses a file whose currency is not the reconciled account's", async () => {
    const { service } = buildService([account({ currency: "EGP" })]);
    await expect(service.importStatementFile(fileCmd())).rejects.toBeInstanceOf(StatementCurrencyMismatchError);
  });

  it("refuses a file naming a different bank account number", async () => {
    const { service } = buildService([account({ currency: "USD", bankAccountNumber: "9999-0000" })]);
    await expect(service.importStatementFile(fileCmd())).rejects.toBeInstanceOf(StatementAccountMismatchError);
  });

  it("refuses when the treasury account carries no number to check the file against", async () => {
    const { service } = buildService([account({ currency: "USD", bankAccountNumber: null })]);
    await expect(service.importStatementFile(fileCmd())).rejects.toBeInstanceOf(TreasuryAccountNumberMissingError);
  });

  it("accepts the file when both the currency and the account number agree", async () => {
    const { service } = buildService([account({ currency: "USD", bankAccountNumber: "1234 5678 90" })]);
    const { statement } = await service.importStatementFile(fileCmd());
    expect(statement.currency).toBe("USD");
    expect(statement.branchId).toBe("BR-MAIN");
  });
});

describe("branch scope", () => {
  it("refuses to import into an account outside the caller's branches", async () => {
    const { service } = buildService([account({ branchId: "BR-ALEX" })], { branchScope: ["BR-MAIN"] });
    await expect(service.importStatement(csvCmd())).rejects.toBeInstanceOf(TreasuryAccountOutOfBranchScopeError);
  });

  it("hides another branch's statement from the list and refuses to open it", async () => {
    const { service: alex } = buildService([account({ branchId: "BR-ALEX" })]);
    await alex.importStatement(csvCmd());

    const { service, statements } = buildService([account({ branchId: "BR-ALEX" })], { branchScope: ["BR-MAIN"] });
    const imported = await alex.findById("stmt-1");
    await statements.save(imported!);

    expect(await service.list()).toEqual([]);
    await expect(service.reconciliation("stmt-1")).rejects.toBeInstanceOf(StatementOutOfBranchScopeError);
  });
});

describe("a foreign-currency bank account", () => {
  const usdAccount = account({ currency: "USD", bankAccountNumber: "1234567890" });

  it("matches a line against an entry stated in the account's own currency", async () => {
    const { service } = buildService([usdAccount], {
      candidates: [
        {
          entryId: "je-usd",
          entryNo: "JE-9",
          date: "2026-08-05",
          amount: Money.fromMajor("100"),
          description: "wire",
          currency: "USD",
          baseAmount: Money.fromMajor("4960"),
        },
      ],
    });
    const { lines } = await service.importStatementFile(fileCmd());
    const matched = await service.matchLine("stmt-f1", lines[0]!.id, "je-usd");
    expect(matched.status).toBe("matched");
  });

  it("refuses to match an entry the books hold only in the base currency", async () => {
    const { service } = buildService([usdAccount], {
      candidates: [
        {
          entryId: "je-egp",
          entryNo: "JE-8",
          date: "2026-08-05",
          amount: Money.fromMajor("100"),
          description: "unrated",
          currency: "EGP",
          baseAmount: Money.fromMajor("100"),
        },
      ],
    });
    const { lines } = await service.importStatementFile(fileCmd());
    await expect(service.matchLine("stmt-f1", lines[0]!.id, "je-egp")).rejects.toBeInstanceOf(MatchCurrencyMismatchError);
    expect(await service.matchCandidates("stmt-f1")).toEqual([]);
  });
});
