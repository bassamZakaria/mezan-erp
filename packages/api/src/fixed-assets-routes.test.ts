import { describe, it, expect, afterEach } from "vitest";
import type { Account, AuditEvent, AuditSink, JournalPostingDeps } from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
  createSqliteAssetCategoryRepository,
  createSqliteAssetInternalRateHistoryRepository,
  createSqliteAssetRepository,
  createSqliteDepreciationRunRepository,
} from "@mezan/persistence";
import { createFixedAssetsRoutes, type FixedAssetsRoutesDeps } from "./fixed-assets-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
import { MasterDataKind, type MasterDataChecks, type MasterRecordCheck } from "./master-data-check.js";
const closers: { close(): void }[] = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

let idSeq = 0;

async function newApp(masterData?: MasterDataChecks) {
  const categories = createSqliteAssetCategoryRepository();
  const assets = createSqliteAssetRepository();
  const rateHistory = createSqliteAssetInternalRateHistoryRepository();
  const runs = createSqliteDepreciationRunRepository();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  closers.push(categories, assets, runs, ledger, accounts, periods);

  await accounts.create(account("5400", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1590", { type: "asset", naturalBalance: "credit" }));
  await accounts.create(account("5499", { type: "expense", naturalBalance: "debit" }));
  await accounts.create(account("1599", { type: "asset", naturalBalance: "credit" }));
  await accounts.create(account("1500", { type: "asset", naturalBalance: "debit" }));
  await accounts.create(account("4500", { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account("5450", { type: "expense", naturalBalance: "debit" }));
  await periods.create({ id: "fp-2026-01", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "open" });
  await periods.create({ id: "fp-2026-02", year: 2026, periodNumber: 2, startDate: "2026-02-01", endDate: "2026-02-28", status: "open" });
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
  const auditEvents: AuditEvent[] = [];
  const audit: AuditSink = {
    async append(event) {
      auditEvents.push(event);
    },
    async query() {
      return auditEvents;
    },
  };
  const deps: FixedAssetsRoutesDeps = {
    categories,
    assets,
    rateHistory,
    runs,
    gl,
    defaultAccounts: { depreciationExpenseAccountId: "5499", accumulatedDepreciationAccountId: "1599" },
    idGen: () => `run-${++idSeq}`,
    audit,
    ...(masterData ? { masterData } : {}),
  };

  return {
    app: createFixedAssetsRoutes(deps, insecureHeaderAuthContextResolver),
    categories,
    assets,
    rateHistory,
    runs,
    ledger,
    periods,
    auditEvents,
  };
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
    // D280: the refusal the screen shows verbatim is Arabic, with the English beside it.
    const body = (await dup.json()) as { error: string; message: string; messageEn: string };
    expect(body).toEqual({
      error: "DUPLICATE_ASSET_CATEGORY_CODE",
      message: `كود فئة الأصول "${categoryPayload.code}" مستخدم من قبل.`,
      messageEn: `Asset category code "${categoryPayload.code}" already exists.`,
    });
  });

  it("GET /categories/:id 404s an unknown category", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/categories/nope", { permissions: "assets.view" }));
    expect(res.status).toBe(404);
  });

  it("GET /categories lists what was created, and GET /categories/:id finds it", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    const listRes = await app.fetch(req("/categories", { permissions: "assets.view" }));
    const list = (await listRes.json()) as { id: string }[];
    expect(list.map((c) => c.id)).toEqual(["cat-1"]);

    const getRes = await app.fetch(req("/categories/cat-1", { permissions: "assets.view" }));
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { id: string; code: string };
    expect(got.code).toBe("VEHICLES");
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

describe("fixed-assets router — سعر الساعة الداخلي as a dated series", () => {
  async function plant() {
    const h = await newApp();
    await h.app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await h.app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "plant-1",
          code: "AST-0101",
          nameAr: "خلاطة خرسانة",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "900000.00",
        }),
      }),
    );
    return h;
  }

  it("appends a row at its effective date, reports the whole history, and audits the change", async () => {
    const h = await plant();
    const first = await h.app.fetch(
      req("/plant-1/internal-hourly-rate", {
        method: "PATCH",
        permissions: "assets.manage",
        body: JSON.stringify({ hourlyRate: "450.00", effectiveFrom: "2026-01-01", reason: "سعر ٢٠٢٦" }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await h.app.fetch(
      req("/plant-1/internal-hourly-rate", {
        method: "PATCH",
        permissions: "assets.manage",
        body: JSON.stringify({ hourlyRate: "520.00", effectiveFrom: "2026-08-01" }),
      }),
    );
    const body = (await second.json()) as {
      internalHourlyRate: string;
      rateHistory: { effectiveFrom: string; hourlyRate: string }[];
    };
    expect(body.internalHourlyRate).toBe("520.000000");
    expect(body.rateHistory.map((r) => [r.effectiveFrom, r.hourlyRate])).toEqual([
      ["2026-01-01", "450.000000"],
      ["2026-08-01", "520.000000"],
    ]);

    // The earlier row is NOT overwritten — that is the whole point of the series.
    expect(await h.rateHistory.list("plant-1")).toHaveLength(2);

    const audited = h.auditEvents.filter((e) => e.action === "SET_INTERNAL_HOURLY_RATE");
    expect(audited).toHaveLength(2);
    expect(audited[1]?.details).toMatchObject({
      before: "450.000000",
      after: "520.000000",
      effectiveFrom: "2026-08-01",
    });
  });

  it("422s a negative rate and leaves the series untouched", async () => {
    const h = await plant();
    const res = await h.app.fetch(
      req("/plant-1/internal-hourly-rate", {
        method: "PATCH",
        permissions: "assets.manage",
        body: JSON.stringify({ hourlyRate: "-5.00" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(await h.rateHistory.list("plant-1")).toHaveLength(0);
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
    expect(((await rePost.json()) as { message: string }).message).toContain("«مُرحَّل» وليست مسودة");

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

  /**
   * guards B-9 — a posted run had no reverse at all, so a wrong month stayed
   * in the books and the asset register could never be corrected.
   */
  it("reverses a posted run: mirror entry, accumulated depreciation restored, run cancelled", async () => {
    const { app, ledger } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-001",
          nameAr: "سيارة",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "12000.00",
          depreciationStartDate: "2025-01-01",
          usefulLifeMonths: 12,
          salvageValue: "0",
        }),
      }),
    );
    const draftRun = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };
    const posted = (await (
      await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }))
    ).json()) as { journalEntryId: string };

    const reverseRes = await app.fetch(
      req(`/depreciation/runs/${draftRun.id}/reverse`, { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({}) }),
    );
    expect(reverseRes.status).toBe(200);
    expect((await reverseRes.json()) as { status: string }).toMatchObject({ status: "cancelled" });

    expect((await ledger.findById(posted.journalEntryId))!.status).toBe("reversed");
    const assetBody = (await (await app.fetch(req("/a1", { permissions: "assets.view" }))).json()) as {
      accumulatedDepreciation: string;
    };
    expect(assetBody.accumulatedDepreciation).toBe("0.000000");

    // Not twice.
    const again = await app.fetch(
      req(`/depreciation/runs/${draftRun.id}/reverse`, { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({}) }),
    );
    expect(again.status).toBe(409);
  });

  /**
   * The closed period is AFTER the run's own day (2026-03-31) so this is
   * purely the fiscal-period gate — D275's own "dated before the run"
   * refusal (below) is a separate check with a separate error code.
   */
  it("refuses a reversal dated into a closed period with 422, not a 500", async () => {
    const { app, periods } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const draftRun = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };
    await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));

    await periods.create({ id: "fp-2026-04", year: 2026, periodNumber: 4, startDate: "2026-04-01", endDate: "2026-04-30", status: "closed" });

    const res = await app.fetch(
      req(`/depreciation/runs/${draftRun.id}/reverse`, {
        method: "POST",
        permissions: "assets.depreciation.run",
        body: JSON.stringify({ date: "2026-04-15" }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "PERIOD_NOT_OPEN_FOR_POSTING" });
  });

  /**
   * guards D275 — `/depreciation/runs/:id/reverse` used to pass `body.date`
   * straight through with no default at all, so an omitted date fell back to
   * `reverseJournalEntry`'s own default (the run's own day), the same fault
   * D270 fixed for vouchers.
   */
  it("D275: no date sent defaults the reversal to today, not the run's own period-end day", async () => {
    const { app, ledger } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const draftRun = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };
    const posted = (await (
      await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }))
    ).json()) as { journalEntryId: string };
    expect((await ledger.findById(posted.journalEntryId))!.date).toBe("2026-03-31");

    // The test harness's clock (`gl.now`) reads "2026-03-31T12:00:00.000Z" —
    // the same calendar day the run itself posted on, so a genuinely later
    // "today" is asserted against the harness's own clock value, not a
    // hardcoded date that would rot.
    const reverseRes = await app.fetch(
      req(`/depreciation/runs/${draftRun.id}/reverse`, { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({}) }),
    );
    expect(reverseRes.status).toBe(200);
    const original = await ledger.findById(posted.journalEntryId);
    expect(original!.status).toBe("reversed");
    const reversal = await ledger.findById(original!.reversedByEntryId as string);
    expect(reversal!.date).toBe("2026-03-31");
  });

  /**
   * guards D275 — a user-chosen date may never be before the run's own
   * posting day, the same rule D270 gave voucher reversals.
   */
  it("D275: a reversal dated before the run's own day is refused, bilingually, and posts nothing", async () => {
    const { app, ledger, runs } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const draftRun = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };
    const posted = (await (
      await app.fetch(req(`/depreciation/runs/${draftRun.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }))
    ).json()) as { journalEntryId: string };

    const res = await app.fetch(
      req(`/depreciation/runs/${draftRun.id}/reverse`, {
        method: "POST",
        permissions: "assets.depreciation.run",
        body: JSON.stringify({ date: "2026-01-15" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; messageEn: string };
    expect(body.error).toBe("REVERSAL_DATE_BEFORE_ORIGINAL");
    expect(body.messageEn.length).toBeGreaterThan(0);

    expect((await ledger.findById(posted.journalEntryId))!.status).toBe("posted");
    expect((await runs.findById(draftRun.id))!.status).toBe("posted");
  });

  /**
   * guards D275's second rule — the QuickBooks/Odoo norm that only the
   * LATEST posted run touching an asset may be reversed.
   */
  it("D275: reversing a run is refused while a later posted run shares its asset, bilingually", async () => {
    const { app, periods, runs } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-001", nameAr: "سيارة", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const run1 = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };
    await app.fetch(req(`/depreciation/runs/${run1.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));

    await periods.create({ id: "fp-2026-04", year: 2026, periodNumber: 4, startDate: "2026-04-01", endDate: "2026-04-30", status: "open" });
    const run2 = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-04" }) }))
    ).json()) as { id: string };
    await app.fetch(req(`/depreciation/runs/${run2.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));

    const blocked = await app.fetch(
      req(`/depreciation/runs/${run1.id}/reverse`, { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({}) }),
    );
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as { error: string; messageEn: string };
    expect(body.error).toBe("LATER_DEPRECIATION_RUN_EXISTS");
    expect(body.messageEn.length).toBeGreaterThan(0);
    expect((await runs.findById(run1.id))!.status).toBe("posted");

    // Reverse newest-first: the later run first, then the earlier one, both
    // succeed. Dated explicitly at run2's own day (2026-04-30) — the
    // harness's fixed clock reads 2026-03-31, which is legitimately BEFORE
    // run2's own posting day and would otherwise trip the D275 date-before
    // check this test is not exercising.
    const reverse2 = await app.fetch(
      req(`/depreciation/runs/${run2.id}/reverse`, {
        method: "POST",
        permissions: "assets.depreciation.run",
        body: JSON.stringify({ date: "2026-04-30" }),
      }),
    );
    expect(reverse2.status).toBe(200);
    const reverse1 = await app.fetch(
      req(`/depreciation/runs/${run1.id}/reverse`, {
        method: "POST",
        permissions: "assets.depreciation.run",
        body: JSON.stringify({ date: "2026-04-30" }),
      }),
    );
    expect(reverse1.status).toBe(200);
  });

  it("rejects POST /depreciation/runs/:id/reverse without assets.depreciation.run", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/depreciation/runs/run-x/reverse", { method: "POST", permissions: "assets.depreciation.view", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(403);
  });

  it("GET /depreciation/runs/:id 404s an unknown run", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/depreciation/runs/nope", { permissions: "assets.depreciation.view" }));
    expect(res.status).toBe(404);
  });
});

describe("fixed-assets router — the depreciation schedule ties exactly to cost minus salvage", () => {
  it("three equal monthly amounts that sum EXACTLY to the depreciable base, and the asset flips fully_depreciated on the last", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-SCHED",
          nameAr: "معدة",
          categoryId: "cat-1",
          acquisitionDate: "2026-01-01",
          acquisitionCost: "12000.00",
          depreciationStartDate: "2026-01-01",
          usefulLifeMonths: 3,
          salvageValue: "0",
        }),
      }),
    );

    const amounts: string[] = [];
    for (const period of ["2026-01", "2026-02", "2026-03"]) {
      const runRes = await app.fetch(
        req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period }) }),
      );
      expect(runRes.status).toBe(201);
      const run = (await runRes.json()) as { id: string; lines: Array<{ amount: string }>; totalAmount: string };
      expect(run.lines).toHaveLength(1);
      amounts.push(run.lines[0]!.amount);
      expect(run.totalAmount).toBe(run.lines[0]!.amount);
      const postRes = await app.fetch(req(`/depreciation/runs/${run.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));
      expect(postRes.status).toBe(200);
    }

    // Each period's own amount, asserted exactly: 12000/3 = 4000.00 per month.
    expect(amounts).toEqual(["4000.000000", "4000.000000", "4000.000000"]);
    const sum = amounts.reduce((s, a) => s + Number(a), 0);
    expect(sum).toBe(12000); // exactly cost (12000) minus salvage (0)

    const assetRes = await app.fetch(req("/a1", { permissions: "assets.view" }));
    const asset = (await assetRes.json()) as { accumulatedDepreciation: string; status: string };
    expect(asset.accumulatedDepreciation).toBe("12000.000000");
    expect(asset.status).toBe("fully_depreciated");

    // A fourth run finds nothing left to depreciate — the asset is excluded
    // once fully depreciated, not merely charged a zero amount.
    const fourth = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-04" }) }),
    );
    expect(fourth.status).toBe(422);
    expect(((await fourth.json()) as { error: string }).error).toBe("NO_DEPRECIABLE_ASSETS");
  });

  it("each posted run's journal entry debits depreciation expense and credits accumulated depreciation by the SAME exact amount", async () => {
    const { app, ledger } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-JE",
          nameAr: "معدة",
          categoryId: "cat-1",
          acquisitionDate: "2026-01-01",
          acquisitionCost: "12000.00",
          depreciationStartDate: "2026-01-01",
          usefulLifeMonths: 12,
          salvageValue: "0",
        }),
      }),
    );
    const runRes = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    const run = (await runRes.json()) as { id: string };
    const postRes = await app.fetch(req(`/depreciation/runs/${run.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));
    const posted = (await postRes.json()) as { journalEntryId: string };
    const entry = await ledger.findById(posted.journalEntryId);
    expect(entry).not.toBeNull();
    // The asset inherits its category's configured accounts (5400/1590), not
    // the router's fallback defaultAccounts (5499/1599).
    const debitLine = entry!.lines.find((l) => l.accountId === "5400");
    const creditLine = entry!.lines.find((l) => l.accountId === "1590");
    expect(debitLine?.debit.toString()).toBe("1000.000000");
    expect(creditLine?.credit.toString()).toBe("1000.000000");
    expect(debitLine?.debit.toString()).toBe(creditLine?.credit.toString());
  });
});

describe("fixed-assets router — disposal", () => {
  async function assetAt(app: Awaited<ReturnType<typeof newApp>>["app"], id: string, code: string, cost: string) {
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id,
          code,
          nameAr: "أصل",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: cost,
          depreciationStartDate: "2025-01-01",
          usefulLifeMonths: 12,
          salvageValue: "0",
        }),
      }),
    );
  }

  it("computes an exact GAIN when proceeds exceed book value, and posts the balancing GL entry", async () => {
    const { app, ledger } = await newApp();
    await assetAt(app, "a1", "A-GAIN", "12000.00");
    // No depreciation posted: book value = full cost = 12000.00. Sell for 15000.
    const res = await app.fetch(
      req("/a1/dispose", {
        method: "POST",
        permissions: "assets.dispose",
        body: JSON.stringify({ date: "2026-03-15", proceeds: "15000.00", proceedsAccountId: "5400" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; bookValueAtDisposal: string; gainOrLoss: string };
    expect(body.status).toBe("disposed");
    expect(body.bookValueAtDisposal).toBe("12000.000000");
    expect(body.gainOrLoss).toBe("3000.000000");

    // Cannot depreciate a disposed asset.
    const nextRun = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-04" }) }),
    );
    expect(nextRun.status).toBe(422);

    // Cannot dispose it a second time.
    const redispose = await app.fetch(
      req("/a1/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2026-03-20" }) }),
    );
    expect(redispose.status).toBe(409);
    expect(((await redispose.json()) as { error: string }).error).toBe("ASSET_ALREADY_DISPOSED");
  });

  it("computes an exact LOSS when proceeds are below book value", async () => {
    const { app } = await newApp();
    await assetAt(app, "a2", "A-LOSS", "12000.00");
    const res = await app.fetch(
      req("/a2/dispose", {
        method: "POST",
        permissions: "assets.dispose",
        body: JSON.stringify({ date: "2026-03-15", proceeds: "4000.00", proceedsAccountId: "5400" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookValueAtDisposal: string; gainOrLoss: string };
    expect(body.bookValueAtDisposal).toBe("12000.000000");
    expect(body.gainOrLoss).toBe("-8000.000000");
  });

  it("scrapping (no proceeds) is a full loss of the remaining book value", async () => {
    const { app } = await newApp();
    await assetAt(app, "a3", "A-SCRAP", "5000.00");
    const res = await app.fetch(
      req("/a3/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2026-03-15" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookValueAtDisposal: string; gainOrLoss: string };
    expect(body.bookValueAtDisposal).toBe("5000.000000");
    expect(body.gainOrLoss).toBe("-5000.000000");
  });

  it("422s a disposal with negative proceeds", async () => {
    const { app } = await newApp();
    await assetAt(app, "a4", "A-NEG", "1000.00");
    const res = await app.fetch(
      req("/a4/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2026-03-15", proceeds: "-1" }) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_ASSET_DISPOSAL");
  });

  it("422s a disposal with proceeds but no receiving account", async () => {
    const { app } = await newApp();
    await assetAt(app, "a5", "A-NOACC", "1000.00");
    const res = await app.fetch(
      req("/a5/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2026-03-15", proceeds: "500" }) }),
    );
    expect(res.status).toBe(422);
  });

  it("422s a disposal dated before the asset's acquisition", async () => {
    const { app } = await newApp();
    await assetAt(app, "a6", "A-EARLY", "1000.00");
    const res = await app.fetch(
      req("/a6/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2024-01-01" }) }),
    );
    expect(res.status).toBe(422);
  });

  it("404s disposing an asset that does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(
      req("/nope/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({ date: "2026-03-15" }) }),
    );
    expect(res.status).toBe(404);
  });

  it("400s a malformed dispose body", async () => {
    const { app } = await newApp();
    await assetAt(app, "a7", "A-BAD", "1000.00");
    const res = await app.fetch(
      req("/a7/dispose", { method: "POST", permissions: "assets.dispose", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("fixed-assets router — GET /:id", () => {
  it("404s an unknown asset", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/nope", { permissions: "assets.view" }));
    expect(res.status).toBe(404);
  });
});

describe("fixed-assets router — validation errors", () => {
  it("400s a malformed category body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify({ id: "x" }) }));
    expect(res.status).toBe(400);
  });

  it("400s a malformed asset body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: "assets.create", body: JSON.stringify({ id: "x" }) }));
    expect(res.status).toBe(400);
  });

  it("422s an asset scoped to a branch with no branchId named", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a-branch",
          code: "A-BR",
          nameAr: "أصل فرع",
          categoryId: "cat-1",
          scope: "branch",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "1000.00",
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_ASSET");
  });

  it("400s a malformed depreciation-run body", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
});

describe("fixed-assets router — the register's filters, counts and stats narrow together, and branch scope narrows what a scoped user sees", () => {
  async function seeded() {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a-main",
          code: "MAIN-01",
          nameAr: "معدة الفرع الرئيسي",
          categoryId: "cat-1",
          scope: "branch",
          branchId: "BR-MAIN",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "1000.00",
        }),
      }),
    );
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a-north",
          code: "NORTH-01",
          nameAr: "معدة الفرع الشمالي",
          categoryId: "cat-1",
          scope: "branch",
          branchId: "BR-NORTH",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "2000.00",
        }),
      }),
    );
    return app;
  }

  it("status/categoryId/search narrow GET /, and /counts drops its own status axis", async () => {
    const app = await seeded();
    const byCategory = await app.fetch(req("/?categoryId=cat-1", { permissions: "assets.view" }));
    expect(((await byCategory.json()) as unknown[]).length).toBe(2);

    const byCategoryMiss = await app.fetch(req("/?categoryId=nope", { permissions: "assets.view" }));
    expect((await byCategoryMiss.json()) as unknown[]).toEqual([]);

    const bySearch = await app.fetch(req("/?search=NORTH-01", { permissions: "assets.view" }));
    const searched = (await bySearch.json()) as { id: string }[];
    expect(searched.map((a) => a.id)).toEqual(["a-north"]);

    const countsFilteredByStatus = await app.fetch(req("/counts?status=active", { permissions: "assets.view" }));
    const counts = (await countsFilteredByStatus.json()) as Record<string, number>;
    // Both assets are active; the chip endpoint ignores its own status query,
    // so filtering to status=active does not zero out the other chips.
    expect(counts).toEqual({ all: 2, active: 2, under_maintenance: 0, fully_depreciated: 0, disposed: 0 });
  });

  it("/stats counts only active and fully_depreciated over the filtered set", async () => {
    const app = await seeded();
    const res = await app.fetch(req("/stats", { permissions: "assets.view" }));
    const stats = (await res.json()) as { count: number; active: number; fully_depreciated: number };
    expect(stats).toEqual({ count: 2, active: 2, fully_depreciated: 0 });
  });

  it("branch scope narrows GET / to only that branch's assets, and the other branch's asset is absent", async () => {
    const app = await seeded();
    const res = await app.fetch(req("/", { permissions: "assets.view", headers: { "x-branch-scope": "BR-MAIN" } }));
    const rows = (await res.json()) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["a-main"]);
    expect(rows.some((r) => r.id === "a-north")).toBe(false);
  });
});

describe("fixed-assets router — depreciation runs list, counts and stats", () => {
  it("lists runs, drops its own status axis on /counts, and honours it on /stats", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a1",
          code: "A-RUNS",
          nameAr: "أصل",
          categoryId: "cat-1",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "12000.00",
          depreciationStartDate: "2025-01-01",
          usefulLifeMonths: 12,
          salvageValue: "0",
        }),
      }),
    );
    const draft = (await (
      await app.fetch(req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }))
    ).json()) as { id: string };

    const listRes = await app.fetch(req("/depreciation/runs", { permissions: "assets.depreciation.view" }));
    expect(((await listRes.json()) as unknown[]).length).toBe(1);

    const countsRes = await app.fetch(req("/depreciation/runs/counts?status=posted", { permissions: "assets.depreciation.view" }));
    const counts = (await countsRes.json()) as Record<string, number>;
    // Only one draft run exists; filtering /counts by status=posted must still
    // report the true draft count, not zero.
    expect(counts).toEqual({ all: 1, draft: 1, posted: 0, cancelled: 0 });

    await app.fetch(req(`/depreciation/runs/${draft.id}/post`, { method: "POST", permissions: "assets.depreciation.run" }));

    const statsRes = await app.fetch(req("/depreciation/runs/stats?status=posted", { permissions: "assets.depreciation.view" }));
    const stats = (await statsRes.json()) as { count: number; draft: number; posted: number };
    expect(stats).toEqual({ count: 1, draft: 0, posted: 1 });
  });

  it("409s posting a run that does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/depreciation/runs/nope/post", { method: "POST", permissions: "assets.depreciation.run" }));
    expect(res.status).toBe(404);
  });

  it("GET /depreciation/runs/:id finds an existing run", async () => {
    const { app } = await newApp();
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({ id: "a1", code: "A-GET-RUN", nameAr: "أصل", categoryId: "cat-1", acquisitionDate: "2025-01-01", acquisitionCost: "12000.00" }),
      }),
    );
    const createRes = await app.fetch(
      req("/depreciation/runs", { method: "POST", permissions: "assets.depreciation.run", body: JSON.stringify({ period: "2026-03" }) }),
    );
    const created = (await createRes.json()) as { id: string };
    const res = await app.fetch(req(`/depreciation/runs/${created.id}`, { permissions: "assets.depreciation.view" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(created.id);
  });
});

function roster(...ids: readonly string[]): MasterRecordCheck {
  const held = new Set(ids);
  return { findById: async (id) => (held.has(id) ? { id } : null) };
}

describe("D310 — an asset and a depreciation run may not name a branch that does not exist", () => {
  const MASTER_DATA: MasterDataChecks = {
    [MasterDataKind.Branch]: roster("BR-MAIN"),
    [MasterDataKind.Warehouse]: roster("WH-MAIN"),
  };

  it("refuses an asset registered into a branch with no master record", async () => {
    const { app } = await newApp(MASTER_DATA);
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a-phantom",
          code: "PH-01",
          nameAr: "أصل وهمي",
          categoryId: "cat-1",
          scope: "branch",
          branchId: "BR-PHANTOM",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "1000.00",
        }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; branchIds: string[]; messageEn: string };
    expect(body.error).toBe("BRANCH_NOT_FOUND");
    expect(body.branchIds).toEqual(["BR-PHANTOM"]);
    expect(body.messageEn).toContain("BR-PHANTOM");
  });

  it("refuses a depreciation run scoped to a branch with no master record", async () => {
    const { app } = await newApp(MASTER_DATA);
    const res = await app.fetch(
      req("/depreciation/runs", {
        method: "POST",
        permissions: "assets.depreciation.run",
        body: JSON.stringify({ period: "2026-03", branchId: "BR-PHANTOM" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("BRANCH_NOT_FOUND");
  });

  it("still registers an asset whose branch is real", async () => {
    const { app } = await newApp(MASTER_DATA);
    await app.fetch(req("/categories", { method: "POST", permissions: "assets.manage", body: JSON.stringify(categoryPayload) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "assets.create",
        body: JSON.stringify({
          id: "a-real",
          code: "RE-01",
          nameAr: "أصل حقيقي",
          categoryId: "cat-1",
          scope: "branch",
          branchId: "BR-MAIN",
          acquisitionDate: "2025-01-01",
          acquisitionCost: "1000.00",
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
});
