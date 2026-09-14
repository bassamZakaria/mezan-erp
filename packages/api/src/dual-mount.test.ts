import { describe, it, expect, afterEach } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  type SqliteUnitOfWorkHandle,
} from "@mezan/persistence";

/**
 * The proof of the spike: the SAME Hono app, mounted two ways.
 *   Path A (cloud):   over HTTP via @hono/node-server, hit with real fetch().
 *   Path B (desktop): in-process via app.fetch(new Request(...)) — no socket.
 * A given entry must yield byte-identical responses on both paths.
 *
 * It proves this over `/gl`, the route the product actually posts through. It
 * used to prove it over a bare `POST /journal-entries` — the spike's original
 * poster, which checked no fiscal period, validated no account, stamped no
 * number and wrote no audit row. Being one of its last two callers is what kept
 * that second way into the books alive (D99), so the proof moved and the route
 * went.
 */

const balancedEntry = {
  id: "JE-000100",
  date: "2026-08-22",
  memo: "Cash sale — proof entry",
  lines: [
    { accountId: "1300-1", debit: "1150.750000", credit: "0.000000" },
    { accountId: "4000", debit: "0.000000", credit: "1009.430000" },
    { accountId: "2200", debit: "0.000000", credit: "141.320000" },
  ],
};

const unbalancedEntry = {
  id: "JE-000101",
  date: "2026-08-22",
  memo: "Broken entry",
  lines: [
    { accountId: "1300-1", debit: "100.000000", credit: "0.000000" },
    { accountId: "4000", debit: "0.000000", credit: "90.000000" },
  ],
};

const handles: Array<SqliteUnitOfWorkHandle | { close(): void }> = [];
const servers: { close: (cb?: () => void) => void }[] = [];

const POSTABLE = {
  nameEn: null,
  parentId: null,
  isHeader: false,
  status: "active" as const,
};

/**
 * The same seeded books behind both mounts: `/gl` validates every account and
 * refuses a date outside an open period, so the two paths can only be compared
 * against identical master data.
 */
async function seededApp() {
  const uow = createSqliteUnitOfWork(":memory:");
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  handles.push(uow, ledger, accounts, periods);

  await accounts.create({ id: "1300-1", code: "1300-1", nameAr: "النقدية", type: "asset", naturalBalance: "debit", ...POSTABLE });
  await accounts.create({ id: "4000", code: "4000", nameAr: "الإيرادات", type: "revenue", naturalBalance: "credit", ...POSTABLE });
  await accounts.create({ id: "2200", code: "2200", nameAr: "ضريبة القيمة المضافة", type: "liability", naturalBalance: "credit", ...POSTABLE });
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  return createApp(uow, {
    // A fixed clock on both mounts: proof test #2 compares raw response TEXT,
    // and a real clock would differ between the two apps by milliseconds.
    gl: { ledger, accounts, periods, numbering: ledger.numbering, now: () => "2026-08-22T10:00:00.000Z" },
  });
}

async function newInProcessApp() {
  return seededApp();
}

async function newHttpApp(): Promise<{ baseUrl: string }> {
  const app = await seededApp();
  const server = serve({ fetch: app.fetch, port: 0 });
  servers.push(server as unknown as { close: (cb?: () => void) => void });
  // @hono/node-server exposes the underlying node server synchronously.
  const address = (server as unknown as { address(): AddressInfo }).address();
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
  for (const h of handles.splice(0)) h.close();
});

describe("dual-mount journal posting", () => {
  // Proof test #1
  it("posts a balanced entry and persists it as 'posted' (retrievable via GET)", async () => {
    const app = await newInProcessApp();

    const postRes = await app.fetch(
      new Request("http://local/gl/journal-entries", {
        method: "POST",
        headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
        body: JSON.stringify(balancedEntry),
      }),
    );
    expect(postRes.status).toBe(201);

    const getRes = await app.fetch(
      new Request(`http://local/gl/journal-entries/${balancedEntry.id}`, {
        headers: { "x-permissions": "accounting.journal.view" },
      }),
    );
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as {
      id: string;
      status: string;
      lines: Array<{ accountId: string; debit: string; credit: string }>;
    };
    expect(fetched.status).toBe("posted");
    expect(fetched.id).toBe(balancedEntry.id);
    expect(fetched.lines).toHaveLength(3);
    expect(fetched.lines[0]).toMatchObject({
      accountId: "1300-1",
      debit: "1150.750000",
      credit: "0.000000",
    });
  });

  // Proof test #2
  it("returns byte-identical responses over HTTP and via app.fetch()", async () => {
    const inProcApp = await newInProcessApp();
    const { baseUrl } = await newHttpApp();

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
      body: JSON.stringify(balancedEntry),
    };

    const httpRes = await fetch(`${baseUrl}/gl/journal-entries`, requestInit);
    const inProcRes = await inProcApp.fetch(
      new Request("http://local/gl/journal-entries", requestInit),
    );

    expect(httpRes.status).toBe(inProcRes.status);

    // Compare raw response text — byte-identical, not merely structurally equal.
    const httpText = await httpRes.text();
    const inProcText = await inProcRes.text();
    expect(inProcText).toBe(httpText);

    // And it's the real posted entry, not an error payload.
    expect(JSON.parse(httpText).status).toBe("posted");
  });

  // Proof test #3
  it("rejects an unbalanced entry with 422 on BOTH mount points", async () => {
    const inProcApp = await newInProcessApp();
    const { baseUrl } = await newHttpApp();

    const requestInit: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
      body: JSON.stringify(unbalancedEntry),
    };

    const httpRes = await fetch(`${baseUrl}/gl/journal-entries`, requestInit);
    const inProcRes = await inProcApp.fetch(
      new Request("http://local/gl/journal-entries", requestInit),
    );

    expect(httpRes.status).toBe(422);
    expect(inProcRes.status).toBe(422);

    const httpText = await httpRes.text();
    const inProcText = await inProcRes.text();
    expect(inProcText).toBe(httpText);

    const body = JSON.parse(httpText);
    expect(body.error).toBe("UNBALANCED_ENTRY");
    expect(body.totalDebit).toBe("100.000000");
    expect(body.totalCredit).toBe("90.000000");
  });
});
