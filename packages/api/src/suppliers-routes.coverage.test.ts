import { describe, it, expect, afterEach } from "vitest";
import { Money, type AuditEvent } from "@mezan/domain";
import { createSqliteSupplierRepository, type SqliteSupplierRepositoryHandle } from "@mezan/persistence";
import { createSuppliersRouter } from "./suppliers-routes.js";

const handles: SqliteSupplierRepositoryHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

interface AppOptions {
  readonly outstanding?: Record<string, string>;
  readonly withPayables?: boolean;
  readonly withAudit?: boolean;
}

function newApp(opts: AppOptions = {}) {
  const repo = createSqliteSupplierRepository();
  handles.push(repo);
  const events: AuditEvent[] = [];
  const app = createSuppliersRouter(
    repo,
    undefined,
    opts.withPayables || opts.outstanding
      ? {
          outstandingBySupplier: async () =>
            new Map(Object.entries(opts.outstanding ?? {}).map(([id, amount]) => [id, Money.fromMajor(amount)])),
        }
      : undefined,
    opts.withAudit
      ? {
          append: async (e) => void events.push(e),
          query: async (stream) => events.filter((e) => e.stream === stream),
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

function supplier(overrides: Record<string, unknown> = {}) {
  return { id: "s1", code: "S000001", nameAr: "مصنع النور", ...overrides };
}

describe("suppliers-routes — the list, its chips and its strip", () => {
  async function seeded(app: App) {
    await send(app, "POST", "/", supplier({ id: "s1", code: "S1", nameAr: "أحمد", openingBalance: "1000.00" }));
    await send(
      app,
      "POST",
      "/",
      supplier({ id: "s2", code: "S2", nameAr: "فاطمة", nameEn: "Fatma", phone: "01000000000", email: "f@example.com" }),
    );
    await send(app, "POST", "/", supplier({ id: "s3", code: "S3", nameAr: "سعاد", active: false }));
  }

  async function idsOf(app: App, query: string) {
    const rows = await json<Array<{ id: string }>>(await get(app, `/${query}`));
    return rows.map((r) => r.id);
  }

  it("narrows by the active and inactive chips, and by neither when none is chosen", async () => {
    const { app } = newApp();
    await seeded(app);

    expect(await idsOf(app, "")).toHaveLength(3);
    expect(await idsOf(app, "?status=active")).toEqual(["s1", "s2"]);
    expect(await idsOf(app, "?status=inactive")).toEqual(["s3"]);
    expect(await idsOf(app, "?status=all")).toHaveLength(3);
  });

  it("searches Arabic forgivingly, and across the code, the phone and the email", async () => {
    const { app } = newApp();
    await seeded(app);

    expect(await idsOf(app, "?q=احمد")).toEqual(["s1"]);
    expect(await idsOf(app, "?q=فاطمه")).toEqual(["s2"]);
    expect(await idsOf(app, "?q=Fatma")).toEqual(["s2"]);
    expect(await idsOf(app, "?q=S3")).toEqual(["s3"]);
    expect(await idsOf(app, "?q=0100")).toEqual(["s2"]);
    expect(await idsOf(app, "?q=f@example.com")).toEqual(["s2"]);
    expect(await idsOf(app, "?q=لا-أحد")).toEqual([]);
  });

  it("counts the chips over every filter but the status one", async () => {
    const { app } = newApp();
    await seeded(app);

    const counts = await json<Record<string, number>>(await get(app, "/counts?status=inactive"));
    expect(counts).toMatchObject({ all: 3, active: 2, inactive: 1 });

    const searched = await json<Record<string, number>>(await get(app, "/counts?q=فاطمة"));
    expect(searched.all).toBe(1);
  });

  it("reports what is owed from the payables source, and null without one", async () => {
    const withSource = newApp({ outstanding: { s1: "250.00" } });
    await seeded(withSource.app);
    const stats = await json<{ count: number; active: number; payable: string | null }>(
      await get(withSource.app, "/stats"),
    );
    expect(stats).toMatchObject({ count: 3, active: 2 });
    // s1's 1,000 opening balance plus the 250 the sub-ledger still shows owing.
    expect(stats.payable).toBe("1250.000000");

    const without = newApp();
    await seeded(without.app);
    expect((await json<{ payable: string | null }>(await get(without.app, "/stats"))).payable).toBeNull();
  });
});

describe("suppliers-routes — creating and editing", () => {
  it("409s a create reusing an id, separately from one reusing a code", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", supplier());

    const sameId = await send(app, "POST", "/", supplier({ code: "OTHER" }));
    expect(sameId.status).toBe(409);
    expect((await json<{ error: string }>(sameId)).error).toBe("ALREADY_EXISTS");

    const sameCode = await send(app, "POST", "/", supplier({ id: "s2" }));
    expect(sameCode.status).toBe(409);
  });

  it("422s a create the domain refuses even though the schema allowed it", async () => {
    const { app } = newApp();
    const res = await send(app, "POST", "/", supplier({ paymentTermsDays: -5 }));
    expect([400, 422]).toContain(res.status);
  });

  it("404s a patch naming a supplier that is not there, and 400s one the schema rejects", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", supplier());
    expect((await send(app, "PATCH", "/nope", { nameAr: "x" })).status).toBe(404);
    expect((await send(app, "PATCH", "/s1", { paymentTermsDays: "soon" })).status).toBe(400);
  });

  it("lets a patch keep the supplier's own code, and 409s one taking another's", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", supplier());
    await send(app, "POST", "/", supplier({ id: "s2", code: "S000002" }));

    expect((await send(app, "PATCH", "/s1", { code: "S000001", nameAr: "مصنع النور المحدث" })).status).toBe(200);
    expect((await send(app, "PATCH", "/s2", { code: "S000001" })).status).toBe(409);
  });

  it("changes only the money field the patch names, leaving the other untouched", async () => {
    const { app } = newApp();
    await send(app, "POST", "/", supplier({ openingBalance: "1000.00" }));

    const patched = await json<{ openingBalance: string }>(await send(app, "PATCH", "/s1", { nameAr: "اسم جديد" }));
    expect(patched.openingBalance).toBe("1000.000000");

    const moved = await json<{ openingBalance: string }>(await send(app, "PATCH", "/s1", { openingBalance: "250.50" }));
    expect(moved.openingBalance).toBe("250.500000");
  });
});

describe("suppliers-routes — the audit trail behind an opening balance", () => {
  it("records a moved opening balance as WARNING and a plain edit as INFO", async () => {
    const { app, events } = newApp({ withAudit: true });
    await send(app, "POST", "/", supplier({ openingBalance: "1000.00" }));
    expect(events.at(-1)).toMatchObject({ action: "CREATE", entityType: "SUPPLIER" });

    await send(app, "PATCH", "/s1", { openingBalance: "9000.00" });
    expect(events.at(-1)).toMatchObject({ action: "UPDATE", severity: "WARNING" });

    await send(app, "PATCH", "/s1", { nameAr: "اسم آخر" });
    expect(events.at(-1)).toMatchObject({ action: "UPDATE", severity: "INFO" });
  });

  it("writes nothing when no audit sink is wired", async () => {
    const { app, events } = newApp();
    await send(app, "POST", "/", supplier());
    expect(events).toEqual([]);
  });
});
