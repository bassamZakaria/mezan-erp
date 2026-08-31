import { describe, it, expect, afterEach } from "vitest";
import type { Account } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteChequeRepository,
} from "@mezan/persistence";
import { createChequesRoutes, type ChequeRoutesDeps } from "./cheques-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

const NOW = "2026-08-22T10:00:00.000Z";

async function newApp(opts: { now?: string; periodStatus?: "open" | "closed" | "locked" } = {}) {
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  const cheques = createSqliteChequeRepository();
  closers.push(ledger, accounts, periods, cheques);

  await accounts.create(account("1100"));
  await accounts.create(account("1310"));
  await accounts.create(account("1320"));
  await accounts.create(account("1360"));
  await accounts.create(account("2100", { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account("2150", { type: "liability", naturalBalance: "credit" }));
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: opts.periodStatus ?? "open",
  });
  await periods.create({
    id: "fp-2026-09",
    year: 2026,
    periodNumber: 9,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    status: "open",
  });

  const now = opts.now ?? NOW;
  let idSeq = 0;
  const deps: ChequeRoutesDeps = {
    cheques,
    gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => now },
    now: () => now,
    idGen: () => `gen-${++idSeq}`,
  };
  return { app: createChequesRoutes(deps), ledger, cheques };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

function req(path: string, init: RequestInit & { permissions?: string; branchScope?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  headers.set("x-user-id", "tester");
  if (init.branchScope !== undefined) headers.set("x-branch-scope", init.branchScope);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

type ReqInit = Parameters<typeof req>[1];

async function post(app: App, path: string, payload?: unknown, init: ReqInit = {}) {
  return app.fetch(
    req(path, { method: "POST", ...init, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, init: ReqInit = {}) {
  return app.fetch(req(path, init));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function incoming(overrides: Record<string, unknown> = {}) {
  return {
    id: "chq-1",
    direction: "incoming",
    chequeNumber: "CHQ-5001",
    bankName: "بنك مصر",
    amount: "1000.00",
    issueDate: "2026-08-01",
    dueDate: "2026-08-30",
    branchId: "b1",
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    ...overrides,
  };
}

describe("cheques-routes — the register the screen filters, counts and sums", () => {
  async function seeded(app: App) {
    // pending: due well beyond the 3-day collection window
    await post(app, "/", incoming({ id: "chq-pending", chequeNumber: "CHQ-1", dueDate: "2026-09-30" }));
    // under_collection: inside the window
    await post(app, "/", incoming({ id: "chq-soon", chequeNumber: "CHQ-2", dueDate: "2026-08-24" }));
    // due_today: due date already reached and still not deposited
    await post(app, "/", incoming({ id: "chq-due", chequeNumber: "CHQ-3", dueDate: "2026-08-20" }));
    // deposited: a stored status, so no date derivation applies
    await post(
      app,
      "/",
      incoming({
        id: "chq-dep",
        chequeNumber: "CHQ-4",
        dueDate: "2026-08-28",
        bankName: "البنك الأهلي",
        partyId: "cust-2",
        branchId: "b2",
      }),
    );
    await post(app, "/chq-dep/deposit", { bankTreasuryAccountId: "1310" });
  }

  async function idsOf(app: App, query: string, init: ReqInit = {}) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`, init));
    return rows.map((r) => r.id);
  }

  it("400s a list, counts or stats query whose direction or status is not a real one", async () => {
    const { app } = await newApp();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await get(app, `${path}?direction=sideways`);
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toBe("VALIDATION_ERROR");
    }
    expect((await get(app, "/?status=vanished")).status).toBe(400);
  });

  it("searches the cheque number, the bank name and the party alike", async () => {
    const { app } = await newApp();
    await seeded(app);

    expect(await idsOf(app, "?search=chq-2")).toEqual(["chq-soon"]);
    expect(await idsOf(app, "?search=الأهلي")).toEqual(["chq-dep"]);
    expect(await idsOf(app, "?search=cust-2")).toEqual(["chq-dep"]);
    expect(await idsOf(app, "?search=%20%20")).toHaveLength(4);
    expect(await idsOf(app, "?search=nothing-matches-this")).toEqual([]);
  });

  it("narrows by direction, stored status and date, and never past the caller's branch scope", async () => {
    const { app } = await newApp();
    await seeded(app);

    expect(await idsOf(app, "?direction=incoming")).toHaveLength(4);
    expect(await idsOf(app, "?direction=outgoing")).toEqual([]);
    expect(await idsOf(app, "?status=deposited")).toEqual(["chq-dep"]);
    expect(await idsOf(app, "?status=due_today")).toEqual(["chq-due"]);
    expect(await idsOf(app, "?status=under_collection")).toEqual(["chq-soon"]);
    expect(await idsOf(app, "?status=pending")).toEqual(["chq-pending"]);

    expect(await idsOf(app, "", { branchScope: "b2" })).toEqual(["chq-dep"]);
    expect(await idsOf(app, "?search=chq-2", { branchScope: "b2" })).toEqual([]);
  });

  it("counts every one of the seven chips from the derived status, ignoring only the status axis", async () => {
    const { app } = await newApp();
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=collected"));
    expect(counts).toEqual({
      all: 4,
      pending: 1,
      under_collection: 1,
      due_today: 1,
      deposited: 1,
      collected: 0,
      bounced: 0,
      replaced: 0,
    });

    const scoped = await json<Record<string, number>>(await get(app, "/counts", { branchScope: "b2" }));
    expect(scoped.all).toBe(1);
  });

  it("sums the strip in Money, splitting what is still in hand from what is with the bank", async () => {
    const { app } = await newApp();
    await seeded(app);

    const stats = await json<{ count: number; value: string; pending: string; deposited: string }>(
      await get(app, "/stats"),
    );
    expect(stats).toEqual({
      count: 4,
      value: "4000.000000",
      pending: "3000.000000",
      deposited: "1000.000000",
    });

    // Unlike /counts, the strip honours its own status filter.
    const depositedOnly = await json<{ count: number; value: string }>(await get(app, "/stats?status=deposited"));
    expect(depositedOnly).toMatchObject({ count: 1, value: "1000.000000" });
  });
});

describe("cheques-routes — what the register refuses", () => {
  it("404s every action naming a cheque that is not in the register", async () => {
    const { app } = await newApp();
    expect((await get(app, "/nope")).status).toBe(404);
    expect((await post(app, "/nope/deposit", { bankTreasuryAccountId: "1310" })).status).toBe(404);
    expect((await post(app, "/nope/collect", { bankGlAccountId: "1310" })).status).toBe(404);
    expect((await post(app, "/nope/bounce", {})).status).toBe(404);
    expect(
      (
        await post(app, "/nope/replace", {
          newCheque: {
            chequeNumber: "CHQ-9",
            bankName: "بنك مصر",
            issueDate: "2026-08-22",
            dueDate: "2026-09-22",
            branchId: "b1",
          },
        })
      ).status,
    ).toBe(404);
  });

  it("400s a body every one of the five write endpoints cannot parse", async () => {
    const { app } = await newApp();
    await post(app, "/", incoming());

    expect((await post(app, "/", { direction: "incoming" })).status).toBe(400);
    expect((await post(app, "/chq-1/deposit", {})).status).toBe(400);
    expect((await post(app, "/chq-1/collect", {})).status).toBe(400);
    expect((await post(app, "/chq-1/replace", { newCheque: { chequeNumber: "" } })).status).toBe(400);
  });

  it("treats a bounce with no body at all as a bounce dated today", async () => {
    const { app } = await newApp();
    await post(app, "/", incoming());
    await post(app, "/chq-1/deposit", { bankTreasuryAccountId: "1310" });

    const res = await app.fetch(req("/chq-1/bounce", { method: "POST" }));
    expect(res.status).toBe(200);
    expect((await json<{ status: string }>(res)).status).toBe("bounced");
  });

  it("409s a second cheque reusing a number the register already holds", async () => {
    const { app } = await newApp();
    await post(app, "/", incoming());
    const again = await post(app, "/", incoming({ id: "chq-2" }));
    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toBe("DUPLICATE_CHEQUE_NUMBER");
  });

  it("422s a cheque posting against an account the chart does not hold", async () => {
    const { app } = await newApp();
    const res = await post(app, "/", incoming({ counterpartyGlAccountId: "9999" }));
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("ACCOUNT_NOT_FOUND");
  });

  it("422s — never 500s — a cheque recorded into a closed period", async () => {
    const { app } = await newApp({ periodStatus: "closed" });
    const res = await post(app, "/", incoming());
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
  });

  it("422s bouncing an incoming cheque that was recorded with no bounced-cheques account", async () => {
    const { app } = await newApp();
    await post(app, "/", incoming({ controlAccounts: { underCollectionAccountId: "1320" } }));
    await post(app, "/chq-1/deposit", { bankTreasuryAccountId: "1310" });
    const res = await post(app, "/chq-1/bounce", {});
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("MISSING_BOUNCED_ACCOUNT");
  });

  it("403s a caller holding cheques.view alone on every write endpoint", async () => {
    const { app } = await newApp();
    await post(app, "/", incoming());
    expect((await post(app, "/", incoming({ id: "chq-2" }), { permissions: "cheques.view" })).status).toBe(403);
    expect(
      (await post(app, "/chq-1/deposit", { bankTreasuryAccountId: "1310" }, { permissions: "cheques.view" })).status,
    ).toBe(403);
    expect((await post(app, "/chq-1/collect", { bankGlAccountId: "1310" }, { permissions: "cheques.view" })).status).toBe(
      403,
    );
    expect((await post(app, "/chq-1/bounce", {}, { permissions: "cheques.view" })).status).toBe(403);
  });
});

describe("cheques-routes — the fields the caller may leave out", () => {
  it("generates the id and stores every optional field as an explicit null", async () => {
    const { app } = await newApp();
    const res = await post(app, "/", {
      direction: "incoming",
      chequeNumber: "CHQ-7001",
      bankName: "بنك مصر",
      amount: "500.00",
      issueDate: "2026-08-01",
      dueDate: "2026-08-30",
      branchId: "b1",
      partyId: "cust-1",
      counterpartyGlAccountId: "1100",
      controlAccounts: { underCollectionAccountId: "1320" },
    });
    expect(res.status).toBe(201);
    const cheque = await json<{
      id: string;
      bankBranchName: string | null;
      bankAccountNumber: string | null;
      notes: string | null;
      controlAccounts: { bouncedAccountId: string | null };
    }>(res);
    expect(cheque.id).toBe("gen-1");
    expect(cheque.bankBranchName).toBeNull();
    expect(cheque.bankAccountNumber).toBeNull();
    expect(cheque.notes).toBeNull();
    expect(cheque.controlAccounts.bouncedAccountId).toBeNull();
  });

  it("carries the optional fields through when they are supplied, replacement included", async () => {
    const { app } = await newApp();
    await post(
      app,
      "/",
      incoming({
        bankBranchName: "فرع وسط البلد",
        bankAccountNumber: "123-456",
        notes: "شيك العميل الأول",
        currency: "EGP",
      }),
    );
    const created = await json<{ bankBranchName: string; bankAccountNumber: string; notes: string }>(
      await get(app, "/chq-1"),
    );
    expect(created).toMatchObject({
      bankBranchName: "فرع وسط البلد",
      bankAccountNumber: "123-456",
      notes: "شيك العميل الأول",
    });

    await post(app, "/chq-1/deposit", { bankTreasuryAccountId: "1310" });
    await post(app, "/chq-1/bounce", { date: "2026-08-22" });

    const res = await post(app, "/chq-1/replace", {
      newCheque: {
        id: "chq-replacement",
        chequeNumber: "CHQ-5002",
        bankName: "بنك مصر",
        bankBranchName: "فرع مدينة نصر",
        bankAccountNumber: "999-111",
        issueDate: "2026-08-22",
        dueDate: "2026-09-22",
        branchId: "b1",
        notes: "بديل الشيك المرتد",
      },
      date: "2026-08-22",
    });
    expect(res.status).toBe(201);
    const { original, replacement } = await json<{
      original: { status: string; replacedByChequeId: string };
      replacement: { id: string; amount: string; bankBranchName: string; replacesChequeId: string };
    }>(res);
    expect(original.status).toBe("replaced");
    expect(original.replacedByChequeId).toBe("chq-replacement");
    expect(replacement).toMatchObject({
      id: "chq-replacement",
      amount: "1000.000000",
      bankBranchName: "فرع مدينة نصر",
      replacesChequeId: "chq-1",
    });
  });
});
