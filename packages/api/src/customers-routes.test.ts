import { describe, it, expect, afterEach } from "vitest";
import { Money, NoFiscalPeriodForDateError } from "@mezan/domain";
import { createSqliteCustomerRepository, type SqliteCustomerRepositoryHandle } from "@mezan/persistence";
import { createCustomersRouter, type CustomerOpeningBalancePoster } from "./customers-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteCustomerRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteCustomerRepository();
  handles.push(repo);
  const app = createCustomersRouter(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const VALID_PAYLOAD = { id: "c1", code: "C000001", nameAr: "شركة الأمل للتجارة" };

describe("customers router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("sales.customer.view");
  });

  it("allows GET / with sales.customer.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "sales.customer.view" }));
    expect(res.status).toBe(200);
  });

  it("rejects POST / (create) with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VALID_PAYLOAD),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects PATCH with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.view",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("the '*' wildcard bypasses the gate entirely", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { permissions: "*" }));
    expect(res.status).toBe(200);
  });
});

describe("customers router — CRUD", () => {
  it("creates a customer and retrieves it by id, with Money serialized as decimal strings", async () => {
    const { app } = newApp();
    const createRes = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "5000.50", openingBalance: "-100.25" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { creditLimit: string; openingBalance: string };
    expect(created.creditLimit).toBe("5000.500000");
    expect(created.openingBalance).toBe("-100.250000");

    const getRes = await app.fetch(req("/c1", { permissions: "sales.customer.view" }));
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { id: string; code: string; etaBuyerType: string };
    expect(body).toMatchObject({ id: "c1", code: "C000001", etaBuyerType: "auto" });
  });

  it("404s for an unknown customer", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "sales.customer.view" }));
    expect(res.status).toBe(404);
  });

  it("400s a malformed create payload", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "C1" }), // missing required id/nameAr
      }),
    );
    expect(res.status).toBe(400);
  });

  it("422s a negative credit limit", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "-1.00" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("409s a duplicate customer code", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.customer.create", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_PAYLOAD) }));
    const res = await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, id: "c2" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("PATCH edits a customer (e.g. deactivate) without clobbering unrelated Money fields", async () => {
    const { app } = newApp();
    await app.fetch(
      req("/", {
        method: "POST",
        permissions: "sales.customer.create",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VALID_PAYLOAD, creditLimit: "3000.00" }),
      }),
    );
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: boolean; creditLimit: string };
    expect(body.active).toBe(false);
    expect(body.creditLimit).toBe("3000.000000");
  });

  it("PATCH can update the credit limit itself", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "sales.customer.create", headers: { "content-type": "application/json" }, body: JSON.stringify(VALID_PAYLOAD) }));
    const res = await app.fetch(
      req("/c1", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creditLimit: "8000.00" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { creditLimit: string }).creditLimit).toBe("8000.000000");
  });

  it("PATCH 404s an unknown customer", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/nope", {
        method: "PATCH",
        permissions: "sales.customer.edit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(res.status).toBe(404);
  });
});

/**
 * D142 — a customer's opening balance is how every migration starts, and it
 * has to reach the AR control account or the sub-ledger exceeds GL 1105 from
 * day one by the sum of the debtors typed in at go-live.
 */
describe("customers router — the opening balance reaches the AR control account (D142)", () => {
  interface Posted {
    entryId: string;
    customerId: string;
    date: string;
    amount: string;
  }

  function newPostingApp(poster?: CustomerOpeningBalancePoster) {
    const repo = createSqliteCustomerRepository();
    handles.push(repo);
    const posted: Posted[] = [];
    const recording: CustomerOpeningBalancePoster = async (p) => {
      posted.push({ entryId: p.entryId, customerId: p.customerId, date: p.date, amount: p.amount.toString() });
      await (poster?.(p) ?? Promise.resolve());
    };
    const app = createCustomersRouter(repo, insecureHeaderAuthContextResolver, undefined, undefined, undefined, recording);
    return { app, repo, posted };
  }

  function create(body: Record<string, unknown>) {
    return req("/", {
      method: "POST",
      permissions: "sales.customer.create",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function patch(id: string, body: Record<string, unknown>) {
    return req(`/${id}`, {
      method: "PATCH",
      permissions: "sales.customer.edit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("posts the whole opening balance on create, dated at the date the caller gave", async () => {
    const { app, posted } = newPostingApp();
    const res = await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2026-01-01" }));
    expect(res.status).toBe(201);
    expect(posted).toEqual([
      { entryId: expect.stringContaining("CUST-OPEN-JE:c1:"), customerId: "c1", date: "2026-01-01", amount: "4250.000000" },
    ]);
  });

  it("posts nothing when there is no opening balance to post", async () => {
    const { app, posted } = newPostingApp();
    expect((await app.fetch(create(VALID_PAYLOAD))).status).toBe(201);
    expect(posted).toEqual([]);
  });

  it("a customer in credit posts a NEGATIVE movement, so the control account is credited rather than debited", async () => {
    const { app, posted } = newPostingApp();
    expect((await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "-500.50", openingBalanceDate: "2026-01-01" }))).status).toBe(201);
    expect(posted[0]?.amount).toBe("-500.500000");
  });

  it("an opening balance corrected after it was posted moves the control account by the DELTA, not by the new figure", async () => {
    const { app, posted } = newPostingApp();
    await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2026-01-01" }));
    const res = await app.fetch(patch("c1", { openingBalance: "4520.00", openingBalanceDate: "2026-01-01" }));
    expect(res.status).toBe(200);
    expect(posted.map((p) => p.amount)).toEqual(["4250.000000", "270.000000"]);
  });

  it("clearing an opening balance back to zero posts the reversing movement", async () => {
    const { app, posted } = newPostingApp();
    await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2026-01-01" }));
    await app.fetch(patch("c1", { openingBalance: "0.00", openingBalanceDate: "2026-01-01" }));
    expect(posted.map((p) => p.amount)).toEqual(["4250.000000", "-4250.000000"]);
  });

  it("an edit that leaves the opening balance alone posts nothing", async () => {
    const { app, posted } = newPostingApp();
    await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2026-01-01" }));
    await app.fetch(patch("c1", { creditLimit: "9000.00" }));
    expect(posted).toHaveLength(1);
  });

  it("a refused period refuses the customer too — no debtor is left carrying a balance the ledger never heard about", async () => {
    const { app, repo } = newPostingApp(async () => {
      throw new NoFiscalPeriodForDateError("2020-01-01");
    });
    const res = await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2020-01-01" }));
    expect(res.status).toBe(422);
    expect(await repo.findById("c1")).toBeNull();
  });

  it("a refused period leaves an existing opening balance exactly where it was", async () => {
    let refuse = false;
    const { app, repo } = newPostingApp(async () => {
      if (refuse) throw new NoFiscalPeriodForDateError("2020-01-01");
    });
    await app.fetch(create({ ...VALID_PAYLOAD, openingBalance: "4250.00", openingBalanceDate: "2026-01-01" }));
    refuse = true;
    const res = await app.fetch(patch("c1", { openingBalance: "9999.00", openingBalanceDate: "2020-01-01" }));
    expect(res.status).toBe(422);
    expect((await repo.findById("c1"))?.openingBalance.toString()).toBe(Money.fromMajor("4250.00").toString());
  });
});

describe("the customer book is scoped to the caller's branch (D71)", () => {
  function scoped(path: string, permissions: string, branchScope?: string, init: RequestInit = {}) {
    const headers = new Headers({ "x-permissions": permissions, "x-user-id": "u1" });
    if (branchScope !== undefined) headers.set("x-branch-scope", branchScope);
    if (init.body) headers.set("content-type", "application/json");
    return new Request(`http://local${path}`, { ...init, headers });
  }

  async function seeded() {
    const { app, repo } = newApp();
    for (const [id, code, branchId] of [
      ["c-cairo", "C1", "BR-CAIRO"],
      ["c-alex", "C2", "BR-ALEX"],
      ["c-shared", "C3", null],
    ] as const) {
      const res = await app.fetch(
        scoped("/", "sales.customer.create", "*", {
          method: "POST",
          body: JSON.stringify({ id, code, nameAr: `عميل ${code}`, branchId }),
        }),
      );
      expect(res.status, `seed ${id}`).toBe(201);
    }
    return { app, repo };
  }

  it("shows a branch-scoped caller their own branch, and never another branch's customers", async () => {
    const { app } = await seeded();
    const rows = (await (
      await app.fetch(scoped("/", "sales.customer.view", "BR-CAIRO"))
    ).json()) as { id: string }[];
    const ids = rows.map((r) => r.id).sort();
    // The unbranched record stays visible: every customer written before the
    // column existed has no branch, and hiding them would empty the screen.
    expect(ids).toEqual(["c-cairo", "c-shared"]);
  });

  it("shows a tenant-wide caller every branch", async () => {
    const { app } = await seeded();
    const rows = (await (await app.fetch(scoped("/", "sales.customer.view", "*"))).json()) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["c-alex", "c-cairo", "c-shared"]);
  });

  it("404s a customer outside the caller's scope rather than confirming it exists", async () => {
    const { app } = await seeded();
    const res = await app.fetch(scoped("/c-alex", "sales.customer.view", "BR-CAIRO"));
    expect(res.status).toBe(404);
    // And the same id is readable by someone whose scope covers it.
    expect((await app.fetch(scoped("/c-alex", "sales.customer.view", "BR-ALEX"))).status).toBe(200);
  });

  it("stamps a new customer with the creating caller's branch when they have exactly one", async () => {
    const { app } = newApp();
    const created = await app.fetch(
      scoped("/", "sales.customer.create", "BR-CAIRO", {
        method: "POST",
        body: JSON.stringify({ id: "c-new", code: "C9", nameAr: "عميل جديد" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { branchId: string | null }).branchId).toBe("BR-CAIRO");
  });

  it("leaves a customer created by a tenant-wide caller shared, which is what the all-branch sentinel means", async () => {
    const { app } = newApp();
    const created = await app.fetch(
      scoped("/", "sales.customer.create", "*", {
        method: "POST",
        body: JSON.stringify({ id: "c-any", code: "C8", nameAr: "عميل" }),
      }),
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { branchId: string | null }).branchId).toBeNull();
  });

  it("counts and totals the same set the rows show, so the header cannot disagree with the list", async () => {
    const { app } = await seeded();
    const counts = (await (
      await app.fetch(scoped("/counts", "sales.customer.view", "BR-CAIRO"))
    ).json()) as Record<string, number>;
    const rows = (await (
      await app.fetch(scoped("/", "sales.customer.view", "BR-CAIRO"))
    ).json()) as unknown[];
    expect(counts.all).toBe(rows.length);
  });
});
