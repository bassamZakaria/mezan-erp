import { describe, it, expect, afterEach } from "vitest";
import { Money, type Account, type AuditEvent, type AuditSink, type AuditStream } from "@mezan/domain";
import { createSqliteLedgerStore, createSqliteAccountRepository, createSqliteFiscalPeriodRepository, createSqliteChequeRepository } from "@mezan/persistence";
import { createChequesRoutes, type ChequeRoutesDeps } from "./cheques-routes.js";
import { MasterDataKind, type MasterDataChecks, type MasterRecordCheck } from "./master-data-check.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

let idSeq = 0;

class MemAudit implements AuditSink {
  events: AuditEvent[] = [];
  async append(event: AuditEvent) { this.events.push(event); }
  async query(stream: AuditStream) { return this.events.filter((e) => e.stream === stream); }
}

async function newApp(masterData?: MasterDataChecks, clock: () => string = () => "2026-08-22T10:00:00.000Z") {
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
  await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  idSeq = 0;
  const audit = new MemAudit();
  const bankAccounts: Record<string, string> = { "ta-bank1": "1310", "tr-1": "1310" };
  const deps: ChequeRoutesDeps = {
    treasuryAccounts: {
      findById: async (id) =>
        bankAccounts[id]
          ? { id, code: id, name: id, nameEn: null, type: "bank", currency: "EGP", bankAccountNumber: null, branchId: null, glAccountId: bankAccounts[id]!, openingBalance: Money.zero(), openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" }
          : null,
    },
    cheques,
    gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
    now: clock,
    idGen: () => `gen-${++idSeq}`,
    audit,
    ...(masterData ? { masterData } : {}),
  };
  return { app: createChequesRoutes(deps, insecureHeaderAuthContextResolver), ledger, audit };
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? "*");
  headers.set("x-user-id", init.userId ?? "tester");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const INCOMING = {
  id: "chq-1",
  direction: "incoming",
  chequeNumber: "CHQ-5001",
  bankName: "بنك مصر",
  amount: "1000.00",
  issueDate: "2026-08-01",
  dueDate: "2026-08-20",
  branchId: "b1",
  partyId: "cust-1",
  counterpartyGlAccountId: "1100",
  controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
};

describe("cheques routes — today is the tenant's day, not the UTC one", () => {
  it("at 01:30 Cairo a cheque due today reads as due, though UTC is still on yesterday", async () => {
    let instant = "2026-08-22T10:00:00.000Z";
    const { app } = await newApp(undefined, () => instant);
    const created = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ ...INCOMING, dueDate: "2026-10-14" }) }));
    expect(created.status).toBe(201);

    instant = "2026-10-13T22:30:00.000Z";
    const listed = (await (await app.fetch(req("/"))).json()) as { id: string; effectiveStatus: string }[];
    expect(listed.map((row) => [row.id, row.effectiveStatus])).toEqual([["chq-1", "due_today"]]);
    const one = (await (await app.fetch(req("/chq-1"))).json()) as { effectiveStatus: string };
    expect(one.effectiveStatus).toBe("due_today");
    const counts = (await (await app.fetch(req("/counts"))).json()) as Record<string, number>;
    expect(counts.due_today).toBe(1);
  });
});

describe("cheques routes", () => {
  it("rejects without the cheques.view permission", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/", { permissions: "" }));
    expect(res.status).toBe(403);
  });

  it("creates an incoming cheque and posts its GL entry", async () => {
    const { app, ledger } = await newApp();
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("pending");
    // as-of 2026-08-22 is past the 2026-08-20 due date → derived "due_today"
    expect(body.effectiveStatus).toBe("due_today");
    expect(body.creationJournalEntryId).toBe("gen-1");

    const entry = await ledger.findById("gen-1");
    expect(entry?.lines.map((l: any) => l.accountId)).toEqual(["1320", "1100"]);
  });

  it("refuses, in Arabic, a cheque sent under an id another cheque already holds, and leaves that cheque as it was", async () => {
    const { app, ledger } = await newApp();
    expect((await app.fetch(req("/", { method: "POST", userId: "cashier-a", body: JSON.stringify(INCOMING) }))).status).toBe(201);

    const second = await app.fetch(req("/", { method: "POST", userId: "cashier-b", body: JSON.stringify({ ...INCOMING, chequeNumber: "CHQ-7777" }) }));

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "DUPLICATE_ID", message: expect.stringMatching(/[\u0600-\u06FF]/) });
    const kept = (await (await app.fetch(req("/chq-1"))).json()) as { chequeNumber: string };
    expect(kept.chequeNumber).toBe("CHQ-5001");
  });

  it("runs the full incoming lifecycle: create → deposit → collect", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));

    const deposited = await app.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }) }));
    expect(deposited.status).toBe(200);
    expect(((await deposited.json()) as any).status).toBe("deposited");

    const collected = await app.fetch(
      req("/chq-1/collect", { method: "POST", body: JSON.stringify({ bankGlAccountId: "1310", date: "2026-08-20" }) }),
    );
    expect(collected.status).toBe(200);
    const body = (await collected.json()) as any;
    expect(body.status).toBe("collected");
    expect(body.collectionJournalEntryId).toBeTruthy();
  });

  it("bounces a deposited cheque and rejects an illegal transition with 409", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));

    const illegal = await app.fetch(req("/chq-1/collect", { method: "POST", body: JSON.stringify({ bankGlAccountId: "1310" }) }));
    expect(illegal.status).toBe(409);

    await app.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }) }));
    const bounced = await app.fetch(req("/chq-1/bounce", { method: "POST", body: JSON.stringify({}) }));
    expect(bounced.status).toBe(200);
    expect(((await bounced.json()) as any).status).toBe("bounced");
  });

  it("replaces a bounced cheque, gated on cheques.create", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));
    await app.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }) }));
    await app.fetch(req("/chq-1/bounce", { method: "POST", body: JSON.stringify({}) }));

    const deniedRes = await app.fetch(
      req("/chq-1/replace", {
        method: "POST",
        permissions: "cheques.view",
        body: JSON.stringify({ newCheque: { chequeNumber: "CHQ-5002", bankName: "بنك مصر", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "b1" } }),
      }),
    );
    expect(deniedRes.status).toBe(403);

    const res = await app.fetch(
      req("/chq-1/replace", {
        method: "POST",
        body: JSON.stringify({ newCheque: { chequeNumber: "CHQ-5002", bankName: "بنك مصر", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "b1" } }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.original.status).toBe("replaced");
    expect(body.replacement.status).toBe("pending");
  });

  it("returns 404 for an unknown cheque and 400 for an invalid create body", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/nope"))).status).toBe(404);
    const bad = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ direction: "incoming" }) }));
    expect(bad.status).toBe(400);
  });

  /**
   * Guards D80: the seven-state lifecycle recorded WHEN each transition
   * happened and never WHO did it, so a bounced cheque could not be traced to
   * the clerk who took it to the bank.
   */
  it("records the acting user on every transition, off the session and not the request", async () => {
    const { app, audit } = await newApp();
    const created = await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING), userId: "nadia" }));
    expect(((await created.json()) as any).createdBy).toBe("nadia");

    const deposited = await app.fetch(
      req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }), userId: "hossam" }),
    );
    expect(((await deposited.json()) as any).depositedBy).toBe("hossam");

    const bounced = await app.fetch(req("/chq-1/bounce", { method: "POST", body: JSON.stringify({}), userId: "mona" }));
    const body = (await bounced.json()) as any;
    expect(body.bouncedBy).toBe("mona");
    expect(body.collectedBy).toBeNull();

    // The same three names on the audit stream, which is where the attribution
    // outlives the process until the register's own columns land.
    const trail = audit.events.filter((e) => e.entityType === "CHEQUE");
    expect(trail.map((e) => [e.action, e.actor])).toEqual([
      ["CREATE", "nadia"],
      ["DEPOSIT", "hossam"],
      ["BOUNCE", "mona"],
    ]);
  });

  /**
   * OPEN — the persistence half of D80, asserting the CORRECT behaviour and
   * expected to fail. `ChequeService` stamps every actor onto the cheque, but
   * `packages/persistence/src/cheque-repository.ts` has no `created_by` /
   * `deposited_by` / `collected_by` / `bounced_by` / `replaced_by` columns, so
   * a row that goes through SQLite comes back with the attribution gone. The
   * audit stream above is the working answer meanwhile. Delete the `.fails`
   * once the columns and their migration land.
   */
  it.fails("keeps the attribution when the cheque is read back", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING), userId: "nadia" }));
    const reread = await app.fetch(req("/chq-1", { userId: "someone-else" }));
    expect(((await reread.json()) as any).createdBy).toBe("nadia");
  });

  it("attributes a collection and a replacement to the person who made it", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING), userId: "nadia" }));
    await app.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }), userId: "hossam" }));

    const collected = await app.fetch(
      req("/chq-1/collect", { method: "POST", body: JSON.stringify({ bankGlAccountId: "1310", date: "2026-08-20" }), userId: "samir" }),
    );
    expect(((await collected.json()) as any).collectedBy).toBe("samir");

    const { app: app2 } = await newApp();
    await app2.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING), userId: "nadia" }));
    await app2.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ bankTreasuryAccountId: "ta-bank1" }), userId: "hossam" }));
    await app2.fetch(req("/chq-1/bounce", { method: "POST", body: JSON.stringify({}), userId: "mona" }));
    const replaced = await app2.fetch(
      req("/chq-1/replace", {
        method: "POST",
        userId: "yara",
        body: JSON.stringify({ newCheque: { chequeNumber: "CHQ-5002", bankName: "بنك مصر", issueDate: "2026-08-21", dueDate: "2026-09-05", branchId: "b1" } }),
      }),
    );
    const body = (await replaced.json()) as any;
    expect(body.original.replacedBy).toBe("yara");
    expect(body.replacement.createdBy).toBe("yara");
  });

  it("filters list results by direction and status", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));
    await app.fetch(
      req("/", {
        method: "POST",
        body: JSON.stringify({ ...INCOMING, id: "chq-2", chequeNumber: "CHQ-5002", direction: "outgoing", partyId: "sup-1", counterpartyGlAccountId: "2100", controlAccounts: { underCollectionAccountId: "2150" } }),
      }),
    );
    const res = await app.fetch(req("/?direction=outgoing"));
    const body = (await res.json()) as any[];
    expect(body.map((c) => c.id)).toEqual(["chq-2"]);
  });
});

function roster(...ids: readonly string[]): MasterRecordCheck {
  const held = new Set(ids);
  return { findById: async (id) => (held.has(id) ? { id } : null) };
}

describe("D310 — a cheque may not name a branch that does not exist", () => {
  const MASTER_DATA: MasterDataChecks = { [MasterDataKind.Branch]: roster("b1") };

  it("refuses a cheque recorded into a branch with no master record", async () => {
    const { app } = await newApp(MASTER_DATA);
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify({ ...INCOMING, branchId: "BR-PHANTOM" }) }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; branchIds: string[]; message: string; messageEn: string };
    expect(body.error).toBe("BRANCH_NOT_FOUND");
    expect(body.branchIds).toEqual(["BR-PHANTOM"]);
    expect(body.message).toContain("BR-PHANTOM");
    expect(body.messageEn).toContain("BR-PHANTOM");
  });

  it("refuses a replacement cheque recorded into a branch with no master record", async () => {
    const { app } = await newApp(MASTER_DATA);
    await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));
    await app.fetch(req("/chq-1/deposit", { method: "POST", body: JSON.stringify({ date: "2026-08-10", bankTreasuryAccountId: "tr-1" }) }));
    await app.fetch(req("/chq-1/bounce", { method: "POST", body: JSON.stringify({ date: "2026-08-21", reason: "رصيد غير كاف" }) }));
    const res = await app.fetch(
      req("/chq-1/replace", {
        method: "POST",
        body: JSON.stringify({
          date: "2026-08-22",
          newCheque: { chequeNumber: "CHQ-5002", bankName: "بنك مصر", issueDate: "2026-08-22", dueDate: "2026-09-22", branchId: "BR-PHANTOM" },
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("BRANCH_NOT_FOUND");
  });

  it("still records a cheque whose branch is real", async () => {
    const { app } = await newApp(MASTER_DATA);
    const res = await app.fetch(req("/", { method: "POST", body: JSON.stringify(INCOMING) }));
    expect(res.status).toBe(201);
  });
});
