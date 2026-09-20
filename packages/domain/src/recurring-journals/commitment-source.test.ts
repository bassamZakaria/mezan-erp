import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { CashFlowDirection } from "../cash-forecast/types.js";
import {
  CommitmentCashBasis,
  commitmentNet,
  createRecurringJournalCommitmentSource,
  recurringJournalCommitments,
  type RecurringJournalCommitmentDeps,
} from "./commitment-source.js";
import {
  RecurringJournalFrequency,
  RecurringJournalTemplateStatus,
  type RecurringJournalRun,
  type RecurringJournalSkip,
  type RecurringJournalTemplate,
  type RecurringJournalTemplateLine,
} from "./types.js";

const CASH = new Set(["1300-1", "1310"]);
const PARTY_CONTROL = new Set(["1105", "2100"]);

function line(accountId: string, debit: string, credit: string, branchId?: string | null): RecurringJournalTemplateLine {
  return { accountId, debit: Money.fromMajor(debit), credit: Money.fromMajor(credit), branchId: branchId ?? null };
}

function template(overrides: Partial<RecurringJournalTemplate> = {}): RecurringJournalTemplate {
  return {
    id: "tpl-1",
    nameAr: "رسوم اشتراك سحابي شهرية",
    nameEn: "Monthly cloud subscription fee",
    memo: "رسوم اشتراك",
    frequency: RecurringJournalFrequency.Monthly,
    dayOfPeriod: 1,
    yearlyMonth: null,
    startDate: "2026-01-01",
    endDate: null,
    autoReverseNextPeriod: false,
    status: RecurringJournalTemplateStatus.Active,
    // Dr expense / Cr cash — the seed's own «رسوم اشتراك سحابي شهرية».
    lines: [line("5910", "500", "0"), line("1300-1", "0", "500")],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function deps(
  templates: readonly RecurringJournalTemplate[],
  options: { runs?: readonly string[]; skips?: readonly string[] } = {},
): RecurringJournalCommitmentDeps {
  const runs = new Set(options.runs ?? []);
  const skips = new Set(options.skips ?? []);
  return {
    templates: { async list() { return [...templates]; } },
    runs: {
      async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalRun | null> {
        return runs.has(`${templateId}:${period}`) ? ({ id: "run" } as RecurringJournalRun) : null;
      },
    },
    skips: {
      async findByTemplateAndPeriod(templateId: string, period: string): Promise<RecurringJournalSkip | null> {
        return skips.has(`${templateId}:${period}`) ? ({ id: "skip" } as RecurringJournalSkip) : null;
      },
    },
    cashAccountIds: async () => CASH,
    partyControlAccountIds: async () => PARTY_CONTROL,
  };
}

const WINDOW = { from: "2026-09-20", to: "2026-12-19" };

describe("commitmentNet", () => {
  it("nets over the cash lines, not over every line", () => {
    // The whole entry nets to zero BY CONSTRUCTION — a template that did not
    // balance could not be saved — which is why summing every line always
    // returned null and the forecast projected nothing at all.
    const tpl = template();
    let wholeEntry = Money.zero();
    for (const l of tpl.lines) wholeEntry = wholeEntry.add(l.debit).add(l.credit.negate());
    expect(wholeEntry.toString()).toBe("0.000000");

    const net = commitmentNet(tpl, CASH, PARTY_CONTROL);
    expect(net).not.toBeNull();
    expect(net?.basis).toBe(CommitmentCashBasis.CashAccount);
    expect(net?.direction).toBe(CashFlowDirection.Outflow);
    expect(net?.amount.toString()).toBe("500.000000");
  });

  it("reads a cash line that is debited as money coming in", () => {
    const net = commitmentNet(
      template({ lines: [line("1310", "2500", "0"), line("4100", "0", "2500")] }),
      CASH,
      PARTY_CONTROL,
    );
    expect(net?.direction).toBe(CashFlowDirection.Inflow);
    expect(net?.amount.toString()).toBe("2500.000000");
  });

  it("falls back to the party control lines when the template posts no cash line", () => {
    // Dr rent expense / Cr suppliers: the cash leaves when the payable is
    // settled, so the commitment is the payable's own credit.
    const net = commitmentNet(
      template({ lines: [line("5200", "7000", "0"), line("2100", "0", "7000")] }),
      CASH,
      PARTY_CONTROL,
    );
    expect(net?.basis).toBe(CommitmentCashBasis.PartyControl);
    expect(net?.direction).toBe(CashFlowDirection.Outflow);
    expect(net?.amount.toString()).toBe("7000.000000");

    const receivable = commitmentNet(
      template({ lines: [line("1105", "3000", "0"), line("4100", "0", "3000")] }),
      CASH,
      PARTY_CONTROL,
    );
    expect(receivable?.basis).toBe(CommitmentCashBasis.PartyControl);
    expect(receivable?.direction).toBe(CashFlowDirection.Inflow);
    expect(receivable?.amount.toString()).toBe("3000.000000");
  });

  it("projects nothing for a template that moves no cash at all", () => {
    // Depreciation and prepaid amortization are real recurring entries and
    // never a cash movement; reporting their P&L effect as a commitment would
    // charge the forecast for money that never leaves.
    expect(commitmentNet(template({ lines: [line("5300", "1200", "0"), line("1600", "0", "1200")] }), CASH, PARTY_CONTROL)).toBeNull();
  });

  it("prefers the cash line when a template carries both", () => {
    // Dr payable 1,000 / Cr cash 1,000 — settling an accrual. The cash is the
    // movement; counting the payable too would double it.
    const net = commitmentNet(
      template({ lines: [line("2100", "1000", "0"), line("1300-1", "0", "1000")] }),
      CASH,
      PARTY_CONTROL,
    );
    expect(net?.basis).toBe(CommitmentCashBasis.CashAccount);
    expect(net?.amount.toString()).toBe("1000.000000");
  });
});

describe("recurringJournalCommitments", () => {
  it("emits one commitment per future occurrence inside the window", async () => {
    const out = await recurringJournalCommitments(deps([template()]), WINDOW);
    expect(out.map((c) => c.date)).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    let total = Money.zero();
    for (const c of out) total = total.add(c.amount);
    expect(total.toString()).toBe("1500.000000");
    expect(out.every((c) => c.direction === CashFlowDirection.Outflow)).toBe(true);
    expect(out[0]?.id).toBe("recurring-journal:tpl-1:2026-10");
    expect(out[0]?.label).toBe("رسوم اشتراك سحابي شهرية");
    expect(out[0]?.documentId).toBe("tpl-1");
  });

  it("leaves out a period the operator skipped (D305)", async () => {
    // Unverifiable until the source emitted anything: the exclusion was
    // correct and no test could see it, because every template netted to zero.
    const out = await recurringJournalCommitments(deps([template()], { skips: ["tpl-1:2026-11"] }), WINDOW);
    expect(out.map((c) => c.date)).toEqual(["2026-10-01", "2026-12-01"]);
  });

  it("leaves out a period already posted as a run", async () => {
    const out = await recurringJournalCommitments(deps([template()], { runs: ["tpl-1:2026-12"] }), WINDOW);
    expect(out.map((c) => c.date)).toEqual(["2026-10-01", "2026-11-01"]);
  });

  it("ignores a paused template", async () => {
    const paused = template({ status: RecurringJournalTemplateStatus.Paused });
    expect(await recurringJournalCommitments(deps([paused]), WINDOW)).toEqual([]);
  });

  it("attributes the branch only when every line agrees on one", async () => {
    const oneBranch = template({ lines: [line("5910", "500", "0", "BR-MAIN"), line("1300-1", "0", "500", "BR-MAIN")] });
    expect((await recurringJournalCommitments(deps([oneBranch]), WINDOW))[0]?.branchId).toBe("BR-MAIN");

    const split = template({ lines: [line("5910", "500", "0", "BR-MAIN"), line("1300-1", "0", "500", "BR-ALEX")] });
    expect((await recurringJournalCommitments(deps([split]), WINDOW))[0]?.branchId).toBeNull();
  });

  it("exposes itself as the `recurring-journals` commitment source", async () => {
    const source = createRecurringJournalCommitmentSource(deps([template()]));
    expect(source.id).toBe("recurring-journals");
    expect((await source.commitments(WINDOW)).length).toBe(3);
  });
});
