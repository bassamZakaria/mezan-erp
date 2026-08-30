import { describe, it, expect, afterEach } from "vitest";
import { Money, postJournalEntry, type Account, type JournalPostingDeps } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteExchangeRateRepository,
} from "@mezan/persistence";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";
import { createFxRevaluationRoutes, type FxRevaluationRoutesDeps } from "./fx-revaluation-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function grant(sessions: ReturnType<typeof createSessionRegistry>, permissions: string[]) {
  const token = sessions.issue({ userId: "u1", permissions, roleCode: null, branchScope: "*", warehouseScope: "*" });
  return { headers: { authorization: `Bearer ${token}` } };
}

function req(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, headers, ...rest } = init;
  const h = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    h.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  return new Request(`http://local${path}`, { ...rest, body, headers: h });
}

async function seed(periodStatus: "open" | "closed" | "locked" = "open") {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const exchangeRates = createSqliteExchangeRateRepository();
  closers.push(ledger, accounts, periods, exchangeRates);

  await accounts.create(account("1100")); // AR (debit-natured)
  await accounts.create(account("4000", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("4900", { type: "revenue", naturalBalance: "credit" })); // FX gain
  await accounts.create(account("5900", { type: "expense", naturalBalance: "debit" })); // FX loss
  await periods.create({ id: "fp-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: periodStatus });
  await periods.create({ id: "fp-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" });
  await exchangeRates.create({ id: "usd", currency: "USD", rate: "55", effectiveDate: "2026-08-01", rateType: "standard", source: "manual", status: "approved" });

  const postingDeps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };
  // AR sale in USD, booked at rate 50 → 5000 base for 100 USD.
  await postJournalEntry({ id: "je1", date: "2026-08-10", memo: "sale", source: "system", lines: [
    { accountId: "1100", debit: Money.fromMajor("5000"), credit: Money.zero(), currency: "USD", fxRate: "50" },
    { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("5000") },
  ] }, postingDeps);

  return { ledger, accounts, periods, exchangeRates };
}

function newApp(seeded: Awaited<ReturnType<typeof seed>>) {
  const sessions = createSessionRegistry();
  const deps: FxRevaluationRoutesDeps = {
    ledger: seeded.ledger,
    accounts: seeded.accounts,
    periods: seeded.periods,
    numbering: seeded.ledger.numbering,
    exchangeRates: seeded.exchangeRates,
    gainAccountId: "4900",
    lossAccountId: "5900",
    now: () => "2026-08-31T10:00:00.000Z",
  };
  const app = createFxRevaluationRoutes(deps, createSessionAuthContextResolver(sessions));
  return { app, sessions };
}

describe("fx-revaluation router — permission gate", () => {
  it("401s an unauthenticated caller on preview and post", async () => {
    const seeded = await seed();
    const { app } = newApp(seeded);
    const preview = await app.fetch(req("/preview", { method: "POST", json: { date: "2026-08-31" } }));
    expect(preview.status).toBe(401);
    const post = await app.fetch(req("/post", { method: "POST", json: { date: "2026-08-31" } }));
    expect(post.status).toBe(401);
  });

  it("403s a caller without accounting.journal.post", async () => {
    const seeded = await seed();
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.reports.view"]);
    const res = await app.fetch(req("/preview", { method: "POST", json: { date: "2026-08-31" }, headers: auth.headers }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe("accounting.journal.post");
  });
});

describe("fx-revaluation router — validation", () => {
  it("400s a body missing the required date field", async () => {
    const seeded = await seed();
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(req("/preview", { method: "POST", json: {}, headers: auth.headers }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, unknown> } };
    expect(Object.keys(body.details.fieldErrors)).toContain("date");
  });
});

describe("fx-revaluation router — POST /preview", () => {
  it("previews a gain from a rate increase without posting anything", async () => {
    const seeded = await seed();
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(req("/preview", { method: "POST", json: { date: "2026-08-31" }, headers: auth.headers }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasImpact: boolean; totalGain: string; reversalDate: string };
    expect(body.hasImpact).toBe(true);
    expect(body.totalGain).toBe(Money.fromMajor("500").toString());
    expect(body.reversalDate).toBe("2026-09-01");

    const balAfterPreview = await seeded.ledger.accountBalance("1100");
    expect(balAfterPreview.balance.toString()).toBe(Money.fromMajor("5000").toString());
  });

  it("422s with FX_RATE_MISSING when the balance's currency has no closing rate", async () => {
    const seeded = await seed();
    const { ledger, accounts, periods } = seeded;
    const postingDeps: JournalPostingDeps = { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-31T10:00:00.000Z" };
    await postJournalEntry({ id: "je-eur", date: "2026-08-13", memo: "eur sale", source: "system", lines: [
      { accountId: "1100", debit: Money.fromMajor("600"), credit: Money.zero(), currency: "EUR", fxRate: "60" },
      { accountId: "4000", debit: Money.zero(), credit: Money.fromMajor("600") },
    ] }, postingDeps);
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/preview", { method: "POST", json: { date: "2026-08-31", currencies: ["EUR"] }, headers: auth.headers }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("FX_RATE_MISSING");
  });
});

describe("fx-revaluation router — POST /post", () => {
  it("posts the revaluation without auto-reverse: the AR sub-ledger balance and the FX-gain GL account both move, in agreement", async () => {
    const seeded = await seed();
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/post", { method: "POST", json: { date: "2026-08-31", autoReverse: false }, headers: auth.headers }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entryId: string | null; reversalId: string | null; preview: { totalGain: string } };
    expect(body.entryId).not.toBeNull();
    expect(body.reversalId).toBeNull();
    expect(body.preview.totalGain).toBe(Money.fromMajor("500").toString());

    const arBalance = await seeded.ledger.accountBalance("1100");
    const gainBalance = await seeded.ledger.accountBalance("4900");
    // AR (debit-natured) revalued up by 500; FX-gain (credit-natured) up by 500 — same 500 on both sides of the entry.
    expect(arBalance.balance.toString()).toBe(Money.fromMajor("5500").toString());
    expect(gainBalance.balance.toString()).toBe(Money.fromMajor("-500").toString());
  });

  it("posts the revaluation with its next-day auto-reversal: both the AR balance and the FX-gain account return to their pre-revaluation figures", async () => {
    const seeded = await seed();
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/post", { method: "POST", json: { date: "2026-08-31", autoReverse: true }, headers: auth.headers }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entryId: string | null; reversalId: string | null };
    expect(body.entryId).not.toBeNull();
    expect(body.reversalId).not.toBeNull();

    const arBalance = await seeded.ledger.accountBalance("1100");
    const gainBalance = await seeded.ledger.accountBalance("4900");
    expect(arBalance.balance.toString()).toBe(Money.fromMajor("5000").toString());
    expect(gainBalance.balance.toString()).toBe(Money.zero().toString());
  });

  it("returns no entry when there is no rate movement (hasImpact false)", async () => {
    const seeded = await seed();
    await seeded.exchangeRates.create({ id: "usd-same", currency: "USD", rate: "50", effectiveDate: "2026-08-20", rateType: "standard", source: "manual", status: "approved" });
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/post", { method: "POST", json: { date: "2026-08-31" }, headers: auth.headers }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entryId: string | null; reversalId: string | null; preview: { hasImpact: boolean } };
    expect(body.preview.hasImpact).toBe(false);
    expect(body.entryId).toBeNull();
    expect(body.reversalId).toBeNull();
  });
});

describe("fx-revaluation router — fiscal period gate", () => {
  it("refuses to post when the revaluation date falls in a closed period", async () => {
    const seeded = await seed("closed");
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/post", { method: "POST", json: { date: "2026-08-31" }, headers: auth.headers }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
    const arBalance = await seeded.ledger.accountBalance("1100");
    expect(arBalance.balance.toString()).toBe(Money.fromMajor("5000").toString());
  });

  it("refuses to post when the revaluation date falls in a locked period", async () => {
    const seeded = await seed("locked");
    const { app, sessions } = newApp(seeded);
    const auth = grant(sessions, ["accounting.journal.post"]);
    const res = await app.fetch(
      req("/post", { method: "POST", json: { date: "2026-08-31" }, headers: auth.headers }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });
});
