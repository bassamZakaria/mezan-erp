import { describe, it, expect } from "vitest";
import { Money, type Account, type PostedLine, type TreasuryAccount } from "@mezan/domain";
import { createSessionRegistry, createSessionAuthContextResolver } from "./session-auth.js";
import { createCockpitRoutes, type CockpitRoutesDeps } from "./cockpit-routes.js";

const TODAY = "2026-08-31";
const SHARED_GL = "1310";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function treasury(id: string, branchId: string, glAccountId: string): TreasuryAccount {
  return {
    id,
    code: id,
    name: id,
    nameEn: null,
    type: "bank",
    currency: "EGP",
    bankAccountNumber: null,
    branchId,
    glAccountId,
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: null,
    status: "active",
  };
}

function postedLine(branchId: string | null, debit: string): PostedLine {
  return {
    entryId: `je-${branchId ?? "none"}-${debit}`,
    entryNo: null,
    date: "2026-08-10",
    source: "manual",
    accountId: SHARED_GL,
    costCenterId: null,
    projectId: null,
    costCategory: null,
    branchId,
    currency: null,
    fxRate: null,
    memo: null,
    debit: Money.fromMajor(debit),
    credit: Money.zero(),
  };
}

/** Two branches, one shared bank GL account: 300 booked to المعادي, 200 to الإسكندرية. */
const POSTED: readonly PostedLine[] = [postedLine("BR-MAIN", "300"), postedLine("BR-ALEX", "200")];

function deps(): CockpitRoutesDeps {
  return {
    ledger: {
      async listLines(filter) {
        return POSTED.filter((line) => !filter?.accountIds || filter.accountIds.includes(line.accountId));
      },
      async accountBalance(accountId) {
        const lines = POSTED.filter((line) => line.accountId === accountId);
        const balance = Money.sum(lines.map((l) => l.debit.add(l.credit.negate())));
        return { accountId, debit: balance, credit: Money.zero(), balance };
      },
    },
    accounts: { async list() { return [account(SHARED_GL)]; } },
    accountRouting: { async get() { return { overrides: {} } as never; } },
    items: { async list() { return []; } },
    salesInvoices: { async list() { return []; } },
    salesReturns: { async list() { return []; } },
    treasuryAccounts: { async list() { return [treasury("TA-MAIN", "BR-MAIN", SHARED_GL), treasury("TA-ALEX", "BR-ALEX", SHARED_GL)]; } },
    cheques: { async list() { return []; } },
    wacSnapshots: { async list() { return []; } },
    warehouses: { async findAll() { return []; } },
    bookVersion: () => "7.3",
    today: () => TODAY,
    now: () => "2026-08-31T10:00:00.000Z",
  };
}

function app() {
  const sessions = createSessionRegistry();
  const routes = createCockpitRoutes(deps(), createSessionAuthContextResolver(sessions));
  return { routes, sessions };
}

function token(sessions: ReturnType<typeof createSessionRegistry>, permissions: string[], branchScope: string[] | "*" = "*") {
  return sessions.issue({ userId: "u1", permissions, roleCode: null, branchScope, warehouseScope: "*" });
}

async function cockpit(path: string, permissions: string[], branchScope: string[] | "*" = "*") {
  const { routes, sessions } = app();
  const res = await routes.fetch(
    new Request(`http://local${path}`, { headers: { authorization: `Bearer ${token(sessions, permissions, branchScope)}` } }),
  );
  return { status: res.status, body: (await res.json()) as any };
}

describe("cockpit cash · a GL account shared by two branches", () => {
  const READ = ["accounting.cockpit.view", "treasury.account.view"];

  it("reports the company-wide balance only when nothing is narrowed", async () => {
    const { body } = await cockpit("/cockpit", READ);
    expect(body.branchNarrowed).toBe(false);
    expect(body.cash.total).toBe(Money.fromMajor("500").toString());
    expect(body.cash.accounts[0].sharedAcrossBranches).toBe(true);
  });

  it("reports the branch's own movement — not the company-wide figure — under a branch filter", async () => {
    const { body } = await cockpit("/cockpit?branchId=BR-MAIN", READ);
    expect(body.branchNarrowed).toBe(true);
    expect(body.cash.accounts).toHaveLength(1);
    expect(body.cash.accounts[0].treasuryAccountId).toBe("TA-MAIN");
    expect(body.cash.accounts[0].balance).toBe(Money.fromMajor("300").toString());
    expect(body.cash.total).toBe(Money.fromMajor("300").toString());
  });

  it("does the same for a caller whose own grant is one branch, with no filter asked for", async () => {
    const { body } = await cockpit("/cockpit", READ, ["BR-ALEX"]);
    expect(body.branchNarrowed).toBe(true);
    expect(body.cash.accounts.map((a: any) => a.treasuryAccountId)).toEqual(["TA-ALEX"]);
    expect(body.cash.total).toBe(Money.fromMajor("200").toString());
  });

  it("marks the row so the screen can say the account is shared", async () => {
    const { body } = await cockpit("/cockpit?branchId=BR-ALEX", READ);
    expect(body.cash.accounts[0].sharedAcrossBranches).toBe(true);
  });
});

describe("GET /dashboard/version", () => {
  it("answers any signed-in caller, because a frozen dashboard is what gating it on the cockpit caused", async () => {
    const { status, body } = await cockpit("/version", ["accounting.journal.view"]);
    expect(status).toBe(200);
    expect(body.bookVersion).toBe("7.3");
  });

  it("still refuses a caller the server cannot identify", async () => {
    const { routes } = app();
    const res = await routes.fetch(new Request("http://local/version"));
    expect(res.status).toBe(401);
  });

  it("carries no business figure — only the opaque counter", async () => {
    const { body } = await cockpit("/version", ["accounting.journal.view"]);
    expect(Object.keys(body)).toEqual(["bookVersion"]);
  });
});
