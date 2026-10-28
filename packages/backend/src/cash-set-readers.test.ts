import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG, Money } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const TODAY = new Date().toISOString().slice(0, 10);
const NEW_BANK_LEDGER = "1311";
const CASH_HEADER = "1300";

interface Res {
  readonly status: number;
  readonly body: any;
}

let handle: BackendHandle;
let admin: (method: string, path: string, body?: unknown) => Promise<Res>;

const scaled = (amount: string | null | undefined): bigint => Money.fromMajor(amount ?? "0").scaled;

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-cash-readers-")), "books.db");
  const resolveEntitlements = () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  const token = await handle.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  admin = async (method, path, body) => {
    const res = await handle.app.fetch(new Request(`http://local${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}, 240_000);

afterAll(() => handle?.close());

describe("a bank ledger account opened under the cash header, before any treasury account is tied to it", () => {
  let openingBefore: bigint;
  let commitmentBefore: bigint;

  it("is opened and funded", async () => {
    const before = await admin("GET", "/cash-forecast?horizon=90&overdue=today");
    expect(before.status, JSON.stringify(before.body).slice(0, 200)).toBe(200);
    openingBefore = scaled(before.body.openingCash);
    commitmentBefore = scaled(before.body.byKind?.commitment);
    const opened = await admin("POST", "/accounts", { id: NEW_BANK_LEDGER, code: NEW_BANK_LEDGER, nameAr: "حساب بنكي جديد", type: "asset", naturalBalance: "debit", parentId: CASH_HEADER, isHeader: false });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const funded = await admin("POST", "/gl/journal-entries", {
      id: "CASH-READERS-JE-1",
      date: TODAY,
      memo: "تمويل الحساب البنكي الجديد",
      source: "manual",
      lines: [
        { accountId: NEW_BANK_LEDGER, debit: "1000.00", credit: "0" },
        { accountId: "2190", debit: "0", credit: "1000.00" },
      ],
    });
    expect(funded.status, JSON.stringify(funded.body)).toBe(201);
    expect(funded.body.status).toBe("posted");
  });

  it("is in the cash forecast's opening balance, named as its own line", async () => {
    const forecast = await admin("GET", "/cash-forecast?horizon=90&overdue=today");
    expect(scaled(forecast.body.openingCash) - openingBefore).toBe(Money.fromMajor("1000").scaled);
    const line = (forecast.body.openingAccounts as { glAccountId: string | null; treasuryAccountId: string | null; balance: string | null; name: string }[]).find((row) => row.glAccountId === NEW_BANK_LEDGER);
    expect(line).toMatchObject({ treasuryAccountId: null, name: "حساب بنكي جديد" });
    expect(scaled(line?.balance)).toBe(Money.fromMajor("1000").scaled);
  });

  it("a recurring entry that pays out of it is a commitment in the forecast", async () => {
    const template = await admin("POST", "/gl/recurring/templates", {
      id: "CASH-READERS-RJT",
      nameAr: "إيجار شهري من الحساب البنكي الجديد",
      memo: "إيجار شهري",
      frequency: "monthly",
      dayOfPeriod: 1,
      yearlyMonth: null,
      startDate: TODAY,
      endDate: null,
      autoReverseNextPeriod: false,
      lines: [
        { accountId: "5200", debit: "250.00", credit: "0" },
        { accountId: NEW_BANK_LEDGER, debit: "0", credit: "250.00" },
      ],
    });
    expect(template.status, JSON.stringify(template.body)).toBe(201);
    const forecast = await admin("GET", "/cash-forecast?horizon=90&overdue=today");
    expect(scaled(forecast.body.byKind?.commitment) - commitmentBefore).toBeGreaterThanOrEqual(Money.fromMajor("250").scaled);
  });

  it("is offered as where an asset's sale proceeds land; advances, bounced cheques, restricted cash and party control accounts are not", async () => {
    const offered = await admin("GET", "/assets/disposal-proceeds-accounts");
    expect(offered.status, JSON.stringify(offered.body).slice(0, 200)).toBe(200);
    const ids = (offered.body as { id: string; kind: string }[]).map((row) => row.id);
    expect(ids).toContain(NEW_BANK_LEDGER);
    expect(ids).toContain("1300-1");
    for (const notProceeds of ["1350", "1360", "1340", "1105", "1190", CASH_HEADER]) expect(ids, notProceeds).not.toContain(notProceeds);
    expect((offered.body as { id: string; kind: string }[]).find((row) => row.id === NEW_BANK_LEDGER)?.kind).toBe("cash");
  });

  it("a disposal that names an account outside that list is refused in Arabic and nothing is posted", async () => {
    const asset = ((await admin("GET", "/assets")).body as { id: string; status: string }[]).find((row) => row.status === "active");
    expect(asset).toBeDefined();
    const refused = await admin("POST", `/assets/${asset!.id}/dispose`, { date: TODAY, proceeds: "100.00", proceedsAccountId: "1350" });
    expect(refused.status, JSON.stringify(refused.body).slice(0, 200)).toBe(422);
    expect(refused.body.message).toMatch(/[؀-ۿ]/);
    expect(((await admin("GET", `/assets/${asset!.id}`)).body as { status: string }).status).toBe("active");
  });
});
