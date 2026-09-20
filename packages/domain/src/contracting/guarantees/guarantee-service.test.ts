import { beforeEach, describe, expect, it } from "vitest";
import { Money } from "../../money/index.js";
import type { Account } from "../../accounts/account.js";
import { InMemoryAccountRepository } from "../../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { InMemoryProjectRepository } from "../../projects/test-helpers/in-memory-project-repository.js";
import { InMemoryTreasuryAccountRepository } from "../../treasury-accounts/test-helpers/in-memory-treasury-account-repository.js";
import { NextNumberService } from "../../numbering/index.js";
import type { JournalEntry } from "../../journal.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
} from "../../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryGuaranteeRepository } from "./test-helpers/in-memory-guarantee-repository.js";
import { GuaranteeService } from "./guarantee-service.js";
import { guaranteeMarginOf, isExpiringWithin, derivedGuaranteeStatus } from "./guarantee.js";
import { computeGuaranteeSummary } from "./guarantee-summary.js";
import {
  GuaranteeAmountExceedsValueError,
  GuaranteeBankAccountInvalidError,
  GuaranteeChargeAccountNotFoundError,
  GuaranteeNotDraftError,
  InvalidGuaranteeError,
  InvalidGuaranteeTransitionError,
} from "./errors.js";

const TODAY = "2026-09-13";

function account(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"] = "debit"): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

interface Harness {
  service: GuaranteeService;
  ledger: InMemoryLedgerRepository;
  guarantees: InMemoryGuaranteeRepository;
  treasuryAccounts: InMemoryTreasuryAccountRepository;
  projects: InMemoryProjectRepository;
}

async function harness(options: { contractsExist?: boolean } = {}): Promise<Harness> {
  const ledger = new InMemoryLedgerRepository();
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const guarantees = new InMemoryGuaranteeRepository();
  const treasuryAccounts = new InMemoryTreasuryAccountRepository();
  const projects = new InMemoryProjectRepository();

  await accounts.create(account("9100", "memorandum", "debit"));
  await accounts.create(account("9200", "memorandum", "credit"));
  await accounts.create(account("1340", "asset", "debit"));
  await accounts.create(account("1310", "asset", "debit"));
  await accounts.create(account("5930", "expense", "debit"));
  await accounts.create(account("5910", "expense", "debit"));

  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const last = new Date(Date.UTC(2026, month, 0)).toISOString().slice(8, 10);
    await periods.create({
      id: `fp-2026-${mm}`,
      year: 2026,
      periodNumber: month,
      startDate: `2026-${mm}-01`,
      endDate: `2026-${mm}-${last}`,
      status: "open",
    });
  }

  await treasuryAccounts.create({
    id: "TR-BANK",
    code: "BANK-001",
    name: "البنك الأهلي — جاري",
    nameEn: null,
    type: "bank",
    currency: "EGP",
    bankAccountNumber: null,
    branchId: "BR-MAIN",
    glAccountId: "1310",
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: Money.fromMajor("10000000"),
    status: "active",
  });
  await treasuryAccounts.create({
    id: "TR-CASH",
    code: "CASH-001",
    name: "الخزينة الرئيسية",
    nameEn: null,
    type: "cash",
    currency: "EGP",
    bankAccountNumber: null,
    branchId: "BR-MAIN",
    glAccountId: "1300-1",
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: null,
    status: "active",
  });
  await projects.create({
    id: "PRJ-1",
    code: "TOWER",
    nameAr: "برج الأمل",
    nameEn: null,
    status: "active",
    customerId: null,
    managerId: null,
    startDate: null,
    endDate: null,
    budget: Money.zero(),
    siteAddress: null,
    notes: null,
    costCenterId: "cc-prj-1",
  });

  const service = new GuaranteeService({
    guarantees,
    treasuryAccounts,
    accounts,
    projects,
    contracts:
      options.contractsExist === undefined ? undefined : { exists: async () => options.contractsExist === true },
    gl: {
      ledger,
      accounts,
      periods,
      numbering: new NextNumberService(new InMemorySequenceStore()),
      projects,
      now: () => "2026-09-13T09:00:00.000Z",
    },
    today: () => TODAY,
  });

  return { service, ledger, guarantees, treasuryAccounts, projects };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "LG-1",
    kind: "performance" as const,
    projectId: "PRJ-1",
    beneficiaryNameAr: "الهيئة الهندسية للقوات المسلحة",
    bankTreasuryAccountId: "TR-BANK",
    faceValue: Money.fromMajor("1247000"),
    percentOfContract: "5",
    cashMarginPercent: "20",
    issueDate: "2026-03-14",
    expiryDate: "2027-03-14",
    ...overrides,
  };
}

/** Σ debit and Σ credit of every posted entry, plus the net per account. */
async function ledgerState(ledger: InMemoryLedgerRepository) {
  const entries = (await ledger.list({})) as readonly JournalEntry[];
  const net = new Map<string, bigint>();
  for (const entry of entries) {
    let debit = 0n;
    let credit = 0n;
    for (const line of entry.lines) {
      debit += line.debit.scaled;
      credit += line.credit.scaled;
      net.set(line.accountId, (net.get(line.accountId) ?? 0n) + line.debit.scaled - line.credit.scaled);
    }
    // Every entry balances on its own — a half-posted guarantee is not a thing.
    expect(debit).toBe(credit);
  }
  return { entries, net };
}

function major(net: Map<string, bigint>, accountId: string): string {
  return Money.fromScaled(net.get(accountId) ?? 0n).toString();
}

describe("guaranteeMarginOf", () => {
  it("computes the margin in exact scaled integers, never a float", () => {
    expect(guaranteeMarginOf(Money.fromMajor("1247000"), "20").toString()).toBe("249400.000000");
    expect(guaranteeMarginOf(Money.fromMajor("184500"), "20").toString()).toBe("36900.000000");
    // 970,304 × 20% = 194,060.80 exactly — no 194060.79999999999.
    expect(guaranteeMarginOf(Money.fromMajor("970304"), "20").toString()).toBe("194060.800000");
    expect(guaranteeMarginOf(Money.fromMajor("1000"), "0").toString()).toBe("0.000000");
  });
});

describe("createDraft", () => {
  it("derives the cash margin from the percentage and starts at the face value", async () => {
    const h = await harness();
    const g = await h.service.createDraft(draft());
    expect(g.status).toBe("draft");
    expect(g.docNo).toBeNull();
    expect(g.cashMarginAmount.toString()).toBe("249400.000000");
    expect(g.currentValue.toString()).toBe("1247000.000000");
    expect(g.bankNameAr).toBe("البنك الأهلي — جاري");
    expect((await ledgerState(h.ledger)).entries).toHaveLength(0);
  });

  it("takes an explicit margin over the computed one — the bank's number wins", async () => {
    const h = await harness();
    const g = await h.service.createDraft(draft({ cashMarginAmount: Money.fromMajor("194061") }));
    expect(g.cashMarginAmount.toString()).toBe("194061.000000");
  });

  it("refuses a letter belonging to neither a project nor a tender", async () => {
    const h = await harness();
    await expect(h.service.createDraft(draft({ projectId: null }))).rejects.toBeInstanceOf(InvalidGuaranteeError);
  });

  it("accepts a bid bond that names a tender instead of a project", async () => {
    const h = await harness();
    const g = await h.service.createDraft(draft({ kind: "bid", projectId: null, tenderRef: "TND-021" }));
    expect(g.tenderRef).toBe("TND-021");
  });

  it("refuses a margin larger than the face value, an expiry before the issue, and a zero face", async () => {
    const h = await harness();
    await expect(
      h.service.createDraft(draft({ cashMarginAmount: Money.fromMajor("2000000") })),
    ).rejects.toBeInstanceOf(InvalidGuaranteeError);
    await expect(h.service.createDraft(draft({ expiryDate: "2026-03-13" }))).rejects.toBeInstanceOf(InvalidGuaranteeError);
    await expect(h.service.createDraft(draft({ faceValue: Money.zero() }))).rejects.toBeInstanceOf(InvalidGuaranteeError);
  });

  it("refuses a cash drawer — a letter of guarantee is issued by a bank", async () => {
    const h = await harness();
    await expect(h.service.createDraft(draft({ bankTreasuryAccountId: "TR-CASH" }))).rejects.toBeInstanceOf(
      GuaranteeBankAccountInvalidError,
    );
  });

  it("refuses a project that does not exist", async () => {
    const h = await harness();
    await expect(h.service.createDraft(draft({ projectId: "PRJ-NOPE" }))).rejects.toBeInstanceOf(InvalidGuaranteeError);
  });

  it("refuses a contract the contracts port does not know, and accepts one it does", async () => {
    const missing = await harness({ contractsExist: false });
    await expect(missing.service.createDraft(draft({ contractId: "CTR-0001" }))).rejects.toBeInstanceOf(
      InvalidGuaranteeError,
    );
    const present = await harness({ contractsExist: true });
    const g = await present.service.createDraft(draft({ contractId: "CTR-0001" }));
    expect(g.contractId).toBe("CTR-0001");
  });

  it("keeps a contract id as an opaque reference when no contracts port is composed in", async () => {
    const h = await harness();
    const g = await h.service.createDraft(draft({ contractId: "CTR-0001" }));
    expect(g.contractId).toBe("CTR-0001");
  });
});

describe("issue", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await h.service.createDraft(draft());
  });

  it("stamps a number off the LETTER_OF_GUARANTEE sequence", async () => {
    const issued = await h.service.issue("LG-1");
    expect(issued.docNo).toBe("LG-000001");
    expect(issued.status).toBe("active");
  });

  it("posts the memorandum pair for the face value and the margin into restricted cash", async () => {
    await h.service.issue("LG-1");
    const { entries, net } = await ledgerState(h.ledger);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.date).toBe("2026-03-14");
    expect(entries[0]!.sourceDocType).toBe("LETTER_OF_GUARANTEE");
    expect(entries[0]!.sourceDocId).toBe("LG-1");
    expect(major(net, "9100")).toBe("1247000.000000");
    expect(major(net, "9200")).toBe("-1247000.000000");
    expect(major(net, "1340")).toBe("249400.000000");
    expect(major(net, "1310")).toBe("-249400.000000");
  });

  it("carries the project dimension on every line and never a cost category", async () => {
    await h.service.issue("LG-1");
    const { entries } = await ledgerState(h.ledger);
    for (const line of entries[0]!.lines) {
      expect(line.projectId).toBe("PRJ-1");
      expect(line.costCategory ?? null).toBeNull();
    }
  });

  it("posts no margin leg at all when the letter is unsecured", async () => {
    const bare = await harness();
    await bare.service.createDraft(draft({ id: "LG-2", cashMarginAmount: Money.zero() }));
    await bare.service.issue("LG-2");
    const { entries, net } = await ledgerState(bare.ledger);
    expect(entries[0]!.lines).toHaveLength(2);
    expect(major(net, "1340")).toBe("0.000000");
  });

  it("refuses a second issue", async () => {
    await h.service.issue("LG-1");
    await expect(h.service.issue("LG-1")).rejects.toBeInstanceOf(InvalidGuaranteeTransitionError);
  });

  it("refuses an edit once the bank has issued it", async () => {
    await h.service.issue("LG-1");
    await expect(h.service.updateDraft("LG-1", { faceValue: Money.fromMajor("1") })).rejects.toBeInstanceOf(
      GuaranteeNotDraftError,
    );
  });
});

describe("reduce", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await h.service.createDraft(draft({ kind: "advance", faceValue: Money.fromMajor("970304"), cashMarginAmount: Money.fromMajor("194061") }));
    await h.service.issue("LG-1");
  });

  it("reverses the memorandum pair for the reduction and leaves the margin alone", async () => {
    const reduced = await h.service.reduce("LG-1", {
      date: "2026-08-06",
      amount: Money.fromMajor("60000"),
      reason: "استرداد من المستخلص",
      sourceRef: "CERT-0003",
    });
    expect(reduced.status).toBe("reduced");
    expect(reduced.currentValue.toString()).toBe("910304.000000");
    expect(reduced.reductions).toHaveLength(1);
    expect(reduced.reductions[0]!.sourceRef).toBe("CERT-0003");

    const { net } = await ledgerState(h.ledger);
    expect(major(net, "9100")).toBe("910304.000000");
    expect(major(net, "9200")).toBe("-910304.000000");
    // The bank does not release the margin until the letter itself comes back.
    expect(major(net, "1340")).toBe("194061.000000");
  });

  it("refuses a reduction larger than what is left, and one with no reason", async () => {
    await expect(
      h.service.reduce("LG-1", { date: "2026-08-06", amount: Money.fromMajor("2000000"), reason: "x" }),
    ).rejects.toBeInstanceOf(GuaranteeAmountExceedsValueError);
    await expect(
      h.service.reduce("LG-1", { date: "2026-08-06", amount: Money.fromMajor("100"), reason: "  " }),
    ).rejects.toBeInstanceOf(InvalidGuaranteeError);
  });

  it("refuses a reduction on a draft the bank has not issued", async () => {
    const fresh = await harness();
    await fresh.service.createDraft(draft({ id: "LG-9" }));
    await expect(
      fresh.service.reduce("LG-9", { date: "2026-08-06", amount: Money.fromMajor("10"), reason: "ر" }),
    ).rejects.toBeInstanceOf(InvalidGuaranteeTransitionError);
  });
});

describe("release", () => {
  it("closes the memorandum pair for what is left and returns the margin to the bank", async () => {
    const h = await harness();
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    await h.service.reduce("LG-1", { date: "2026-08-06", amount: Money.fromMajor("247000"), reason: "استرداد" });
    const released = await h.service.release("LG-1", { date: "2026-09-01" });

    expect(released.status).toBe("released");
    expect(released.currentValue.toString()).toBe("0.000000");
    expect(released.closedAmount.toString()).toBe("1000000.000000");

    const { net } = await ledgerState(h.ledger);
    expect(major(net, "9100")).toBe("0.000000");
    expect(major(net, "9200")).toBe("0.000000");
    expect(major(net, "1340")).toBe("0.000000");
    expect(major(net, "1310")).toBe("0.000000");
  });
});

describe("call", () => {
  it("charges the drawn amount to the routed loss account and returns the margin", async () => {
    const h = await harness();
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    const called = await h.service.call("LG-1", { date: "2026-09-10" });

    expect(called.status).toBe("called");
    expect(called.closedAmount.toString()).toBe("1247000.000000");

    const { net } = await ledgerState(h.ledger);
    expect(major(net, "9100")).toBe("0.000000");
    expect(major(net, "9200")).toBe("0.000000");
    expect(major(net, "5930")).toBe("1247000.000000");
    expect(major(net, "1340")).toBe("0.000000");
    // Over the letter's whole life the bank is out the full 1,247,000: the
    // 249,400 margin it took at issue came straight back when it was called.
    expect(major(net, "1310")).toBe("-1247000.000000");
  });

  it("takes an explicit charge account when the finance manager names one", async () => {
    const h = await harness();
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    await h.service.call("LG-1", { date: "2026-09-10", chargeAccountId: "5910" });
    const { net } = await ledgerState(h.ledger);
    expect(major(net, "5910")).toBe("1247000.000000");
    expect(major(net, "5930")).toBe("0.000000");
  });

  it("refuses a charge account that is not in the chart of accounts", async () => {
    const h = await harness();
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    await expect(
      h.service.call("LG-1", { date: "2026-09-10", chargeAccountId: "9999" }),
    ).rejects.toBeInstanceOf(GuaranteeChargeAccountNotFoundError);
    // Nothing posted: the refusal came before the ledger was touched.
    const { entries } = await ledgerState(h.ledger);
    expect(entries).toHaveLength(1);
  });

  it("refuses drawing more than the letter is still worth", async () => {
    const h = await harness();
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    await expect(
      h.service.call("LG-1", { date: "2026-09-10", amount: Money.fromMajor("2000000") }),
    ).rejects.toBeInstanceOf(GuaranteeAmountExceedsValueError);
  });
});

describe("expiry — derived, never stored", () => {
  it("reads «منتهي» once the date passes while the stored status stays active", async () => {
    const h = await harness();
    await h.service.createDraft(draft({ expiryDate: "2026-09-01" }));
    await h.service.issue("LG-1");
    const stored = (await h.guarantees.findById("LG-1"))!;
    expect(stored.status).toBe("active");
    expect(derivedGuaranteeStatus(stored, TODAY)).toBe("expired");
    expect(h.service.daysLeft(stored)).toBe(-12);
  });

  it("counts a letter as expiring within N days by the real date arithmetic", async () => {
    const h = await harness();
    await h.service.createDraft(draft({ expiryDate: "2026-09-25" }));
    await h.service.issue("LG-1");
    const g = (await h.guarantees.findById("LG-1"))!;
    expect(h.service.daysLeft(g)).toBe(12);
    expect(isExpiringWithin(g, TODAY, 30)).toBe(true);
    expect(isExpiringWithin(g, TODAY, 10)).toBe(false);
  });

  it("never counts a released letter as expiring, however old its date", async () => {
    const h = await harness();
    await h.service.createDraft(draft({ expiryDate: "2026-09-25" }));
    await h.service.issue("LG-1");
    await h.service.release("LG-1", { date: "2026-09-05" });
    const g = (await h.guarantees.findById("LG-1"))!;
    expect(isExpiringWithin(g, TODAY, 365)).toBe(false);
    expect(derivedGuaranteeStatus(g, TODAY)).toBe("released");
  });
});

describe("bank facility summary", () => {
  async function seeded(): Promise<Harness> {
    const h = await harness();
    await h.service.createDraft(draft({ id: "LG-1" }));
    await h.service.issue("LG-1");
    await h.service.createDraft(
      draft({
        id: "LG-2",
        kind: "advance",
        faceValue: Money.fromMajor("970304"),
        cashMarginAmount: Money.fromMajor("194061"),
        expiryDate: "2026-11-30",
        percentOfContract: null,
      }),
    );
    await h.service.issue("LG-2");
    await h.service.reduce("LG-2", { date: "2026-08-06", amount: Money.fromMajor("60000"), reason: "استرداد من المستخلص" });
    await h.service.createDraft(
      draft({
        id: "LG-3",
        kind: "bid",
        projectId: null,
        tenderRef: "TND-021",
        faceValue: Money.fromMajor("184500"),
        percentOfContract: "1.5",
        expiryDate: "2026-09-25",
      }),
    );
    await h.service.issue("LG-3");
    return h;
  }

  it("reports outstanding, restricted cash, what is left of the limit and what expires soon", async () => {
    const h = await seeded();
    const summary = computeGuaranteeSummary(
      await h.guarantees.list(),
      await h.treasuryAccounts.list(),
      await h.projects.list(),
      TODAY,
    );
    // 1,247,000 + 910,304 + 184,500
    expect(summary.totalOutstanding.toString()).toBe("2341804.000000");
    // 249,400 + 194,061 + 36,900
    expect(summary.restrictedCash.toString()).toBe("480361.000000");
    expect(summary.totalFacilityLimit.toString()).toBe("10000000.000000");
    expect(summary.totalAvailable.toString()).toBe("7658196.000000");
    expect(summary.expiringWithin30Days).toBe(1);

    const bank = summary.byBank.find((b) => b.bankTreasuryAccountId === "TR-BANK")!;
    expect(bank.outstanding.toString()).toBe("2341804.000000");
    expect(bank.available?.toString()).toBe("7658196.000000");
    expect(bank.count).toBe(3);
  });

  it("ties the outstanding total to the 9100 memorandum balance, to the millieme", async () => {
    const h = await seeded();
    const summary = computeGuaranteeSummary(
      await h.guarantees.list(),
      await h.treasuryAccounts.list(),
      await h.projects.list(),
      TODAY,
    );
    const { net } = await ledgerState(h.ledger);
    expect(major(net, "9100")).toBe(summary.totalOutstanding.toString());
    expect(major(net, "1340")).toBe(summary.restrictedCash.toString());
  });

  it("drops a released letter out of the exposure entirely", async () => {
    const h = await seeded();
    await h.service.release("LG-3", { date: "2026-09-12" });
    const summary = computeGuaranteeSummary(
      await h.guarantees.list(),
      await h.treasuryAccounts.list(),
      await h.projects.list(),
      TODAY,
    );
    expect(summary.totalOutstanding.toString()).toBe("2157304.000000");
    expect(summary.expiringWithin30Days).toBe(0);
    const { net } = await ledgerState(h.ledger);
    expect(major(net, "9100")).toBe(summary.totalOutstanding.toString());
  });

  it("reports no available figure for a bank with no facility configured rather than inventing one", async () => {
    const h = await harness();
    await h.treasuryAccounts.update({
      ...(await h.treasuryAccounts.findById("TR-BANK"))!,
      guaranteeFacilityLimit: null,
    });
    await h.service.createDraft(draft());
    await h.service.issue("LG-1");
    const summary = computeGuaranteeSummary(
      await h.guarantees.list(),
      await h.treasuryAccounts.list(),
      await h.projects.list(),
      TODAY,
    );
    expect(summary.byBank[0]!.facilityLimit).toBeNull();
    expect(summary.byBank[0]!.available).toBeNull();
    expect(summary.totalFacilityLimit.toString()).toBe("0.000000");
  });

  it("groups the bid bond under «بدون مشروع» and the rest under their project", async () => {
    const h = await seeded();
    const summary = computeGuaranteeSummary(
      await h.guarantees.list(),
      await h.treasuryAccounts.list(),
      await h.projects.list(),
      TODAY,
    );
    const byProject = new Map(summary.byProject.map((p) => [p.projectId, p]));
    expect(byProject.get("PRJ-1")!.projectNameAr).toBe("برج الأمل");
    expect(byProject.get("PRJ-1")!.outstanding.toString()).toBe("2157304.000000");
    expect(byProject.get(null)!.outstanding.toString()).toBe("184500.000000");
  });
});
