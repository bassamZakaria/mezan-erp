import { describe, it, expect, afterEach } from "vitest";
import type { Account, JournalPostingDeps, StockMovement, WacSnapshot } from "@mezan/domain";
import { Money, Qty } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteWritedownRunRepository,
  createSqliteStockLedgerStore,
} from "@mezan/persistence";
import { createInventoryWritedownRoutes, type InventoryWritedownRoutesDeps } from "./inventory-writedown-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function movement(overrides: Partial<StockMovement> & Pick<StockMovement, "id" | "itemId" | "warehouseId" | "occurredAt">): StockMovement {
  return {
    direction: "IN",
    qty: Qty.fromMajor("20"),
    unitCost: Money.fromMajor("100.00"),
    sourceDocType: "ADJUSTMENT",
    sourceDocId: "adj-1",
    sourceDocNumber: "ADJ-000001",
    reason: "INITIAL_STOCK",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WacSnapshot> & Pick<WacSnapshot, "itemId" | "warehouseId">): WacSnapshot {
  return { onHand: Qty.fromMajor("20"), totalValue: Money.fromMajor("2000.00"), averageCost: Money.fromMajor("100.00"), ...overrides };
}

async function newApp() {
  const runs = createSqliteWritedownRunRepository();
  const stockLedger = createSqliteStockLedgerStore();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(runs, stockLedger, ledger, accounts, periods);

  await accounts.create(account("5060", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1190", { type: "asset", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-03", year: 2026, periodNumber: 3, startDate: "2026-03-01", endDate: "2026-03-31", status: "open" });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-03-31T12:00:00.000Z",
    actor: "tester",
  };

  const deps: InventoryWritedownRoutesDeps = {
    runs,
    wacSnapshots: stockLedger.snapshots,
    stockLedger: stockLedger.ledger,
    gl,
    accounts: { writedownExpenseAccountId: "5060", provisionAccountId: "1190" },
    idGen: (() => {
      let n = 0;
      return () => `run-${++n}`;
    })(),
  };

  return { app: createInventoryWritedownRoutes(deps, insecureHeaderAuthContextResolver), runs, stockLedger, ledger };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function seedSlowMovingPosition(h: Awaited<ReturnType<typeof newApp>>) {
  // > 365 days before the 2026-03 period end (2026-03-31) -> the 50% aging band.
  await h.stockLedger.ledger.append(movement({ id: "m1", itemId: "item-slow", warehouseId: "wh-1", occurredAt: "2024-01-01T00:00:00.000Z" }));
  await h.stockLedger.snapshots.save(snapshot({ itemId: "item-slow", warehouseId: "wh-1" }));
}

describe("inventory-writedown router — permission gate", () => {
  it("rejects GET / with no permissions", async () => {
    const h = await newApp();
    const res = await h.app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("inventory.writedown.view");
  });

  it("rejects POST / with only view permission", async () => {
    const h = await newApp();
    const res = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.writedown.view", body: JSON.stringify({ period: "2026-03" }) }));
    expect(res.status).toBe(403);
  });
});

describe("inventory-writedown router — full flow", () => {
  it("creates a draft run for slow-moving stock, posts it (200, journalEntryId set), and 409s a duplicate-period create", async () => {
    const h = await newApp();
    await seedSlowMovingPosition(h);

    const createRes = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.writedown.run", body: JSON.stringify({ period: "2026-03" }) }));
    expect(createRes.status).toBe(201);
    const draft = (await createRes.json()) as { id: string; status: string; lines: unknown[]; totalAmount: string };
    expect(draft.status).toBe("draft");
    expect(draft.lines).toHaveLength(1);
    expect(draft.totalAmount).toBe("1000.000000"); // 2000 * 50% (365+ day band)

    const postRes = await h.app.fetch(req(`/${draft.id}/post`, { method: "POST", permissions: "inventory.writedown.run" }));
    expect(postRes.status).toBe(200);
    const posted = (await postRes.json()) as { status: string; journalEntryId: string | null };
    expect(posted.status).toBe("posted");
    expect(posted.journalEntryId).toBeTruthy();

    const entry = await h.ledger.findById(posted.journalEntryId!);
    expect(entry?.status).toBe("posted");
    const totalDebit = entry!.lines.reduce((acc, l) => acc.add(l.debit), Money.zero());
    expect(totalDebit.toString()).toBe("1000.000000");

    const dup = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.writedown.run", body: JSON.stringify({ period: "2026-03" }) }));
    expect(dup.status).toBe(409);
  });

  it("422s creating a run with no slow-moving stock", async () => {
    const h = await newApp();
    await h.stockLedger.ledger.append(movement({ id: "m1", itemId: "item-fresh", warehouseId: "wh-1", occurredAt: "2026-03-25T00:00:00.000Z" }));
    await h.stockLedger.snapshots.save(snapshot({ itemId: "item-fresh", warehouseId: "wh-1" }));

    const res = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.writedown.run", body: JSON.stringify({ period: "2026-03" }) }));
    expect(res.status).toBe(422);
  });

  it("GET /:id 404s an unknown run, and posting an unknown run 404s", async () => {
    const h = await newApp();
    const res = await h.app.fetch(req("/nope", { permissions: "inventory.writedown.view" }));
    expect(res.status).toBe(404);
    const postRes = await h.app.fetch(req("/nope/post", { method: "POST", permissions: "inventory.writedown.run" }));
    expect(postRes.status).toBe(404);
  });

  it("409s posting an already-posted run", async () => {
    const h = await newApp();
    await seedSlowMovingPosition(h);
    const createRes = await h.app.fetch(req("/", { method: "POST", permissions: "inventory.writedown.run", body: JSON.stringify({ period: "2026-03" }) }));
    const draft = (await createRes.json()) as { id: string };
    await h.app.fetch(req(`/${draft.id}/post`, { method: "POST", permissions: "inventory.writedown.run" }));

    const rePost = await h.app.fetch(req(`/${draft.id}/post`, { method: "POST", permissions: "inventory.writedown.run" }));
    expect(rePost.status).toBe(409);
  });
});
