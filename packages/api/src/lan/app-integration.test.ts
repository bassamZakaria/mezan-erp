import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import {
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteLedgerStore,
  createSqliteUnitOfWork,
} from "@mezan/persistence";
import { createApp } from "../app.js";

/**
 * Proves the LAN routes mount onto the SAME shared app `createApp` returns
 * (docs/archive/plan.md §2.2's "one HTTP app, two mount points") — not a separately
 * wired instance — and that /gl/journal-entries keeps working unchanged when
 * `/lan` is mounted alongside it.
 */
describe("createApp({ lan }) — same shared app, /lan mounted alongside /gl", () => {
  it("omits /lan entirely when no lan option is passed (existing callers unaffected)", async () => {
    const uow = createSqliteUnitOfWork(":memory:");
    const app = createApp(uow);
    const res = await app.fetch(new Request("http://local/lan/status"));
    expect(res.status).toBe(404);
    uow.close();
  });

  it("serves both /gl/journal-entries and /lan on the one app instance when lan is configured", async () => {
    const uow = createSqliteUnitOfWork(":memory:");
    const ledger = createSqliteLedgerStore();
    const accounts = createSqliteAccountRepository();
    const periods = createSqliteFiscalPeriodRepository();
    for (const [id, type, naturalBalance] of [
      ["1300-1", "asset", "debit"],
      ["4000", "revenue", "credit"],
    ] as const) {
      await accounts.create({ id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" });
    }
    await periods.create({ id: "fp-2026-08", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
    const entitlements = createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });
    const registry = new SeatSessionRegistry(entitlements.seats);
    const app = createApp(uow, {
      lan: { resolveEntitlements: () => entitlements, registry },
      gl: { ledger, accounts, periods, numbering: ledger.numbering },
    });

    const statusRes = await app.fetch(new Request("http://local/lan/status"));
    expect(await statusRes.json()).toEqual({ licensed: true, seats: 2, connected: 0 });

    const connectRes = await app.fetch(
      new Request("http://local/lan/sessions", {
        method: "POST",
        // The seat's identity is the SERVER's now — derived from the resolved
        // caller plus the device — so a connect has to be made BY somebody.
        // A caller-chosen `sessionId` let any signed-in cashier loop fresh ids
        // and burn every seat.
        headers: { "content-type": "application/json", "x-user-id": "u1", "x-permissions": "sales.invoice.view" },
        body: JSON.stringify({ deviceId: "till-1" }),
      }),
    );
    expect(connectRes.status).toBe(201);

    const entry = {
      id: "JE-LAN-0001",
      date: "2026-08-22",
      memo: "still works alongside /lan",
      lines: [
        { accountId: "1300-1", debit: "10.000000", credit: "0.000000" },
        { accountId: "4000", debit: "0.000000", credit: "10.000000" },
      ],
    };
    const journalRes = await app.fetch(
      new Request("http://local/gl/journal-entries", {
        method: "POST",
        headers: { "content-type": "application/json", "x-permissions": "accounting.journal.post" },
        body: JSON.stringify(entry),
      }),
    );
    expect(journalRes.status).toBe(201);

    ledger.close();
    accounts.close();
    periods.close();
    uow.close();
  });
});
