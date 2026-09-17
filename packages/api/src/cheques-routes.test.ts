import { describe, it, expect, afterEach } from "vitest";
import type { Account, AuditEvent, AuditSink, AuditStream } from "@mezan/domain";
import { createSqliteLedgerStore, createSqliteAccountRepository, createSqliteFiscalPeriodRepository, createSqliteChequeRepository } from "@mezan/persistence";
import { createChequesRoutes, type ChequeRoutesDeps } from "./cheques-routes.js";

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

async function newApp() {
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
  const deps: ChequeRoutesDeps = {
    cheques,
    gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
    now: () => "2026-08-22T10:00:00.000Z",
    idGen: () => `gen-${++idSeq}`,
    audit,
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
