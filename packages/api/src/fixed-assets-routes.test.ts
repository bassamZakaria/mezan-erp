import { describe, it, expect, afterEach } from "vitest";
import type { Account, JournalPostingDeps } from "@mezan/domain";
import { createSqliteLedgerStore, createSqliteAccountRepository, createSqliteFiscalPeriodRepository } from "@mezan/persistence";
// NOTE: the three fixed-assets stores aren't re-exported from the `@mezan/persistence`
// barrel yet (packages/persistence/src/index.ts is intentionally left untouched here
// to avoid a concurrent-edit conflict with another agent wiring it centrally — see
// this file's containing task notes), so this test imports the module directly.
import {
  createSqliteAssetCategoryRepository,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
} from "../../persistence/src/fixed-assets-store.js";
import { createFixedAssetsRoutes, type FixedAssetsRoutesDeps } from "./fixed-assets-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

let idSeq = 0;

async function newApp() {
  const categories = createSqliteAssetCategoryRepository();
  const assets = createSqliteAssetRepository();
  const runs = createSqliteDepreciationRunRepository();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(categories, assets, runs, ledger, accounts, periods);

  await accounts.create(account("5400", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1590", { type: "asset", naturalBalance: "credit" }));
  await accounts.create(account("5499", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1599", { type: "asset", naturalBalance: "credit" }));
  await periods.create({ id: "fp-2026-03", year: 2026, periodNumber: 3, startDate: "2026-03-01", endDate: "2026-03-31", status: "open" });

  const gl: JournalPostingDeps = {
    ledger,
    accounts,
    periods,
    numbering: ledger.numbering,
    now: () => "2026-03-31T12:00:00.000Z",
    actor: "tester",
  };

  idSeq = 0;
  const deps: FixedAssetsRoutesDeps = {
    categories,
    assets,
    runs,
    gl,
    defaultAccounts: { depreciationExpenseAccountId: "5499", accumulatedDepreciationAccountId: "1599" },
    idGen: () => `run-${++idSeq}`,
  };

  return { app: createFixedAssetsRoutes(deps, insecureHeaderAuthContextResolver), categories, assets, runs, ledger };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const categoryPayload = {
  id: "cat-1",
  code: "VEHICLES",
  nameAr: "سيارات",
  defaultDepreciationMethod: "straight_line",
  defaultUsefulLifeMonths: 12,
  defaultSalvagePercent: 0,
  depreciationExpenseAccountId: "5400",
  accumulatedDepreciationAccountId: "1590",
};

describe("fixed-assets router — permission gate", () => {
  it("rejects GET /categories with no permissions", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/categories"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("assets.view");
  });

  it("rejects POST /depreciation/runs/:id/post without assets.depreciation.run", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/depreciation/runs/run-x/post", { method: "POST", permissions: "assets.depreciation.view" }));
    expect(res.status).toBe(403);
  });
});

describe("fixed-assets router — categories", () => {
  it("creates a category and 409s a duplicate code", async () => {
    const { app } = await newApp();
    const created = await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    expect(created.status).toBe(201);

    const dup = await app.fetch(
      req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify({ ...categoryPayload, id: "cat-2" }) }),
    );
    expect(dup.status).toBe(409);
  });

  it("GET /categories/:id 404s an unknown category", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/categories/nope", { permissions: "assets.view" }));
    expect(res.status).toBe(404);
  });
});

describe("fixed-assets router — assets", () => {
  it("creates an asset inheriting category defaults, and 404s an unknown category", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));

    const created = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { usefulLifeMonths: number; status: string };
    expect(body.usefulLifeMonths).toBe(12);
    expect(body.status).toBe("active");

    const notFound = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a2", code: "A-002", nameAr: "سيارة", categoryId: "nope", acquisitionDate: "2025-01-01", acquisitionCost: "1000.00" }),
      }),
    );
    expect(notFound.status).toBe(404);
  });
});

describe("fixed-assets router — depreciation run full flow", () => {
  it("creates a draft run, posts it (200, status posted + journalEntryId), and reflects on the asset's accumulatedDepreciation", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-001",
          nameAr: "سيارة نقل",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "12000.00",
          depreciationStartDate: "2025-01-01",
          usefulLifeMonths: 12,
          salvageValue: "0",
        }),
      }),
    );

    const createRunRes = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    expect(createRunRes.status).toBe(201);
    const draftRun = (await createRunRes.json()) as { id: string; status: string };
    expect(draftRun.status).toBe("draft");

    const postRes = await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));
    expect(postRes.status).toBe(200);
    const postedRun = (await postRes.json()) as { status: string; journalEntryId: string | null };
    expect(postedRun.status).toBe("posted");
    expect(postedRun.journalEntryId).toBeTruthy();

    const assetRes = await app.fetch(req("/a1", { permissions: "assets.view" }));
    expect(assetRes.status).toBe(200);
    const assetBody = (await assetRes.json()) as { accumulatedDepreciation: string };
    expect(Number(assetBody.accumulatedDepreciation)).toBeGreaterThan(0);
  });

  it("409s posting an already-posted run, and 409s creating a duplicate-period run", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const createRunRes = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    const draftRun = (await createRunRes.json()) as { id: string };
    await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));

    const rePost = await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));
    expect(rePost.status).toBe(409);

    const dupPeriod = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    expect(dupPeriod.status).toBe(409);
  });

  it("422s creating a run with nothing left to depreciate", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-001",
          nameAr: "جهاز",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "1200.00",
          usefulLifeMonths: 1,
          salvageValue: "0",
        }),
      }),
    );
    const createRunRes = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    const draftRun = (await createRunRes.json()) as { id: string };
    const postRes = await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));
    expect((await postRes.json()) as { status: string }).toMatchObject({ status: "posted" });

    const nextRun = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-04" }) }),
    );
    expect(nextRun.status).toBe(422);
  });

  it("GET /depreciation/runs/:id 404s an unknown run", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/depreciation/runs/nope", { permissions: "assets.depreciation.view" }));
    expect(res.status).toBe(404);
  });
});
