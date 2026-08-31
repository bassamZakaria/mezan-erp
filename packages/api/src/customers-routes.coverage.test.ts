import { describe, it, expect, afterEach } from "vitest";
import { Money, type AuditEvent } from "@mezan/domain";
import { createSqliteCustomerRepository, type SqliteCustomerRepositoryHandle } from "@mezan/persistence";
import { createCustomersRouter } from "./customers-routes.js";

const handles: SqliteCustomerRepositoryHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

interface AppOptions {
  readonly knownPriceLists?: readonly string[];
  readonly outstanding?: Record<string, string>;
  readonly withReceivables?: boolean;
  readonly withAudit?: boolean;
}

function newApp(opts: AppOptions = {}) {
  const repo = createSqliteCustomerRepository();
  handles.push(repo);
  const events: AuditEvent[] = [];
  const app = createCustomersRouter(
    repo,
    undefined,
    opts.withAudit
      ? {
          append: async (e) => void events.push(e),
          query: async (stream) => events.filter((e) => e.stream === stream),
        }
      : undefined,
    opts.knownPriceLists
      ? { findById: async (id: string) => (opts.knownPriceLists!.includes(id) ? { id } : null) }
      : undefined,
    opts.withReceivables || opts.outstanding
      ? {
          outstandingByCustomer: async () =>
            new Map(Object.entries(opts.outstanding ?? {}).map(([id, amount]) => [id, Money.fromMajor(amount)])),
        }
      : undefined,
  );
  return { app, repo, events };
}

type App = ReturnType<typeof newApp>["app"];

const ADMIN = "*";

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-permissions", init.permissions ?? ADMIN);
  headers.set("x-user-id", "u1");
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

async function send(app: App, method: string, path: string, payload?: unknown, permissions?: string) {
  return app.fetch(
    req(path, { method, permissions, body: payload === undefined ? undefined : JSON.stringify(payload) }),
  );
}

async function get(app: App, path: string, permissions?: string) {
  return app.fetch(req(path, { permissions }));
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function customer(overrides: Record<string, unknown> = {}) {
  return { id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة", ...overrides };
}

describe("customers-routes — the list, its chips and its money strip", () => {
  async function seeded(app: App) {
    await send(app, "POST", "/", customer({ id: "c1", code: "C1", nameAr: "أحمد", creditLimit: "1000.00" }));
    await send(
      app,
      "POST",
      "/",
      customer({
        id: "c2",
        code: "C2",
        nameAr: "فاطمة",
        nameEn: "Fatma",
        phone: "01000000000",
        priceListId: "pl-1",
        creditLimit: "500.00",
        openingBalance: "600.00",
      }),
    );
    await send(app, "POST", "/", customer({ id: "c3", code: "C3", nameAr: "سعاد", active: false }));
  }

  async function idsOf(app: App, query: string) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`));
    return rows.map((r) => r.id);
  }

  it("filters by status and price list", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    await seeded(app);

    expect(await idsOf(app, "")).toHaveLength(3);
    expect(await idsOf(app, "?status=active")).toEqual(["c1", "c2"]);
    expect(await idsOf(app, "?status=inactive")).toEqual(["c3"]);
    expect(await idsOf(app, "?priceListId=pl-1")).toEqual(["c2"]);
  });

  it("searches Arabic forgivingly — احمد finds أحمد, and فاطمه finds فاطمة (D32)", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    await seeded(app);

    expect(await idsOf(app, "?q=احمد")).toEqual(["c1"]);
    expect(await idsOf(app, "?q=فاطمه")).toEqual(["c2"]);
    expect(await idsOf(app, "?q=Fatma")).toEqual(["c2"]);
    expect(await idsOf(app, "?q=C3")).toEqual(["c3"]);
    expect(await idsOf(app, "?q=0100")).toEqual(["c2"]);
    expect(await idsOf(app, "?q=لا-أحد")).toEqual([]);
  });

  it("counts the chips over every filter but the status one", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    await seeded(app);

    expect(await json<Record<string, number>>(await get(app, "/counts?status=inactive"))).toEqual({
      all: 3,
      active: 2,
      inactive: 1,
    });
    expect(await json<Record<string, number>>(await get(app, "/counts?q=فاطمة"))).toEqual({
      all: 1,
      active: 1,
      inactive: 0,
    });
  });

  it("sums the credit limits in Money and reports what is owed from the receivables source", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"], outstanding: { c1: "250.00" } });
    await seeded(app);

    const stats = await json<{ count: number; active: number; creditLimits: string; toCollect: string | null }>(
      await get(app, "/stats"),
    );
    expect(stats).toMatchObject({ count: 3, active: 2, creditLimits: "1500.000000" });
    // c1's 250 outstanding plus c2's 600 opening balance.
    expect(stats.toCollect).toBe("850.000000");
  });

  it("reports toCollect as null — never as the opening balance — with no receivables source (D39)", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", customer({ openingBalance: "600.00" }));
    const stats = await json<{ toCollect: string | null }>(await get(app, "/stats"));
    expect(stats.toCollect).toBeNull();
  });

  it("filters the customers over their credit limit from opening balance plus live invoices", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"], outstanding: { c1: "1200.00" } });
    await seeded(app);

    // c1: limit 1000, owed 1200 → over. c2: limit 500, owed 600 → over.
    // c3: no limit at all → never over, however much is owed.
    expect(await idsOf(app, "?overLimit=true")).toEqual(["c1", "c2"]);
    expect(await json<Record<string, number>>(await get(app, "/counts?overLimit=true"))).toMatchObject({ all: 2 });
  });

  it("501s an over-limit filter this server cannot evaluate, on all three routes", async () => {
    const { app } = newApp();
    for (const path of ["/", "/counts", "/stats"]) {
      const res = await get(app, `${path}?overLimit=true`);
      expect(res.status).toBe(501);
      expect((await json<{ error: string }>(res)).error).toBe("RECEIVABLES_NOT_CONFIGURED");
    }
  });
});

describe("customers-routes — the entity a price list has to resolve to", () => {
  it("422s a create naming a price list that does not exist", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    const res = await send(app, "POST", "/", customer({ priceListId: "pl-ghost" }));
    expect(res.status).toBe(422);
    expect((await json<{ error: string }>(res)).error).toBe("PRICE_LIST_NOT_FOUND");
  });

  it("422s a patch naming a price list that does not exist", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    await send(app, "POST", "/", customer());
    const res = await send(app, "PATCH", "/c1", { priceListId: "pl-ghost" });
    expect(res.status).toBe(422);
  });

  it("accepts a price list that resolves, on both routes", async () => {
    const { app } = newApp({ knownPriceLists: ["pl-1"] });
    expect((await send(app, "POST", "/", customer({ priceListId: "pl-1" }))).status).toBe(201);
    expect((await send(app, "PATCH", "/c1", { priceListId: "pl-1" })).status).toBe(200);
  });

  it("checks nothing when the server wires no price-list lookup at all", async () => {
    const { app } = newApp();
    expect((await send(app, "POST", "/", customer({ priceListId: "anything" }))).status).toBe(201);
  });
});

describe("customers-routes — the audit trail behind a credit limit", () => {
  it("records a create as INFO", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", customer({ creditLimit: "1000.00" }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      module: "sales",
      entityType: "CUSTOMER",
      entityId: "c1",
      action: "CREATE",
      severity: "INFO",
      actor: "u1",
    });
  });

  it("records a raised credit limit as WARNING, with the previous value beside the new one", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", customer({ creditLimit: "1000.00" }));
    await send(app, "PATCH", "/c1", { creditLimit: "50000.00" });

    const update = events.at(-1)!;
    expect(update).toMatchObject({ action: "UPDATE", severity: "WARNING" });
    expect(update.details).toMatchObject({
      creditLimit: "50000.000000",
      previousCreditLimit: "1000.000000",
      previousCode: "C000001",
    });
  });

  it("records an edit that leaves the credit limit alone as INFO", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", customer({ creditLimit: "1000.00" }));
    await send(app, "PATCH", "/c1", { nameAr: "شركة الأمل" });

    expect(events.at(-1)).toMatchObject({ action: "UPDATE", severity: "INFO" });
  });

  it("writes nothing when no audit sink is wired", async () => {
    const { app, events } = newApp();
    await send(app, "POST", "/", customer());
    expect(events).toEqual([]);
  });
});

describe("customers-routes — creating and editing", () => {
  it("409s a create reusing an id, separately from one reusing a code", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", customer());

    const sameId = await send(app, "POST", "/", customer({ code: "OTHER" }));
    expect(sameId.status).toBe(409);
    expect((await json<{ error: string }>(sameId)).error).toBe("ALREADY_EXISTS");

    const sameCode = await send(app, "POST", "/", customer({ id: "c2" }));
    expect(sameCode.status).toBe(409);
    expect((await json<{ error: string }>(sameCode)).error).toBe("DUPLICATE_CUSTOMER_CODE");
  });

  it("lets a patch keep the customer's own code without tripping the duplicate check", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", customer());
    const res = await send(app, "PATCH", "/c1", { code: "C000001", nameAr: "شركة الأمل" });
    expect(res.status).toBe(200);
    expect((await json<{ nameAr: string }>(res)).nameAr).toBe("شركة الأمل");
  });

  it("409s a patch that would take a code another customer already holds", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", customer());
    await send(app, "POST", "/", customer({ id: "c2", code: "C000002" }));

    const res = await send(app, "PATCH", "/c2", { code: "C000001" });
    expect(res.status).toBe(409);
  });

  it("400s a patch body the schema rejects", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", customer());
    expect((await send(app, "PATCH", "/c1", { paymentTermsDays: "soon" })).status).toBe(400);
  });

  it("carries every optional field through, and defaults the rest honestly", async () => {
    const { app } = newApp();
    const res = await send(
      app,
      "POST",
      "/",
      customer({
        nameEn: "Al-Amal",
        phone: "0100",
        email: "a@example.com",
        contactPerson: "أحمد",
        taxNumber: "100-200-300",
        category: "تجزئة",
        notes: "عميل قديم",
        paymentTermsDays: 45,
        currency: "USD",
        openingBalance: "250.50",
        creditLimit: "10000",
        taxExempt: true,
      }),
    );
    expect(res.status).toBe(201);
    expect(await json<Record<string, unknown>>(res)).toMatchObject({
      nameEn: "Al-Amal",
      paymentTermsDays: 45,
      currency: "USD",
      openingBalance: "250.500000",
      creditLimit: "10000.000000",
      taxExempt: true,
      active: true,
    });
  });
});
