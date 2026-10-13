import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN } from "@mezan/backend";
import { TenantBooksStanding } from "@mezan/contracts";
import { createTenant, tenantDbFile } from "@mezan/domain";
import { bindTenantDatabase, openSqliteConnection, readTenantBooksIdentity } from "@mezan/persistence";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { harnessEnv, HARNESS_OWNER_EMAIL, HARNESS_OWNER_PASSWORD, proxiedRequest, type SendInit } from "./cloud-harness.js";
import type { CloudEnv } from "./env.js";
import { createTenantRouter } from "./tenant-router.js";

const harnessDirs: string[] = [];
const apps: CloudApp[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
  for (const dir of harnessDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Answer = { status: number; json: Record<string, unknown> | null };

async function boot(env: CloudEnv) {
  const app = await createCloudApp(env);
  apps.push(app);
  const send = async (pathname: string, init: SendInit = {}): Promise<Answer> => {
    const res = await app.root.fetch(proxiedRequest(pathname, init));
    return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  const login = await send("/api/platform/auth/login", { method: "POST", body: JSON.stringify({ email: HARNESS_OWNER_EMAIL, password: HARNESS_OWNER_PASSWORD }) });
  const platformToken = String(login.json?.["token"]);
  const console_ = (method: string, route: string, body?: unknown, token = platformToken) =>
    send(`/api/platform${route}`, { method, token, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, send, platformToken, console: console_ };
}

type Booted = Awaited<ReturnType<typeof boot>>;

interface Company {
  readonly code: string;
  readonly tenantId: string;
  readonly email: string;
  readonly pin: string;
}

const NOT_IN_PLACE = {
  message: "ملف بيانات المنشأة ليس في مكانه المتوقع. تواصل مع الدعم.",
  messageEn: "The company's data file is not where it is expected. Contact support.",
};

const ADDED_BY_THIS_LANE = ["owner_user_id", "owner_contact_verified", "owner_needed", "pending_owner", "owner_record_due", "books_review"] as const;

function inDatabase<T>(file: string, work: (sqlite: ReturnType<typeof openSqliteConnection>["sqlite"]) => T): T {
  const { sqlite } = openSqliteConnection(file);
  try {
    return work(sqlite);
  } finally {
    sqlite.close();
  }
}

const platformDb = (env: CloudEnv): string => path.join(env.platformDir, "platform.db");
const idFile = (env: CloudEnv, company: Company): string => path.join(env.platformDir, tenantDbFile(company.tenantId));
const codeFile = (env: CloudEnv, company: Company): string => path.join(env.platformDir, "tenants", `${company.code}.db`);

function fileOf(env: CloudEnv, company: Company): string {
  const stored = inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT db_file FROM tenant WHERE id = ?").get(company.tenantId)) as { db_file: string };
  return path.join(env.platformDir, stored.db_file);
}

async function provisioned(on: Booted, code: string, ownerEmail = `owner@${code}.example`): Promise<Company> {
  const created = await on.console("POST", "/tenants", { code, nameAr: `شركة ${code}`, ownerEmail, ownerNameAr: "المالك", planId: "PLAN-CORE", billingCycle: "monthly", trial: true });
  expect(created.status).toBe(201);
  const company = { code, tenantId: String((created.json?.["tenant"] as Record<string, unknown>)["id"]), email: ownerEmail, pin: String(created.json?.["adminPin"]) };
  expect((await signIn(on, company)).status).toBe(200);
  return company;
}

const signIn = (on: Booted, company: Company, as: { email?: string; under?: string } = {}) =>
  on.send("/api/auth/login", { method: "POST", tenant: as.under ?? company.code, body: JSON.stringify({ username: as.email ?? company.email, pin: company.pin }) });

// The shape `main` left behind: the books under the company's code with no
// tenant binding in them, and a platform row with none of this lane's columns.
function asWrittenBeforeBinding(env: CloudEnv, companies: readonly Company[], booksChange: (company: Company) => string = () => ""): void {
  for (const company of companies) {
    for (const suffix of ["-wal", "-shm"]) rmSync(`${idFile(env, company)}${suffix}`, { force: true });
    renameSync(idFile(env, company), codeFile(env, company));
    inDatabase(codeFile(env, company), (sqlite) => {
      sqlite.exec(`DROP TABLE tenant_binding; ${booksChange(company)}`);
      sqlite.pragma("journal_mode = DELETE");
    });
  }
  inDatabase(platformDb(env), (sqlite) => {
    for (const company of companies) sqlite.prepare("UPDATE tenant SET db_file = ? WHERE id = ?").run(`tenants/${company.code}.db`, company.tenantId);
    const columns = new Set((sqlite.pragma("table_info(tenant)") as { name: string }[]).map((column) => column.name));
    for (const column of ADDED_BY_THIS_LANE) if (columns.has(column)) sqlite.exec(`ALTER TABLE tenant DROP COLUMN ${column}`);
  });
}

async function legacy(env: CloudEnv, codes: readonly (readonly [code: string, ownerEmail?: string])[], booksChange?: (company: Company) => string): Promise<Company[]> {
  const first = await boot(env);
  const companies: Company[] = [];
  for (const [code, ownerEmail] of codes) companies.push(await provisioned(first, code, ownerEmail));
  await first.app.close();
  asWrittenBeforeBinding(env, companies, booksChange);
  return companies;
}

const boundTo = (env: CloudEnv, company: Company): string | null => readTenantBooksIdentity(fileOf(env, company)).boundTenantId;

async function standingOf(on: Booted, company: Company): Promise<unknown> {
  const list = (await on.send("/api/platform/tenants", { token: on.platformToken })).json as unknown as { tenant: { id: string }; books: unknown }[];
  return list.find((summary) => summary.tenant.id === company.tenantId)?.books;
}

interface PlatformRow {
  owner_user_id: string | null;
  owner_email: string;
  books_review: string | null;
}

const rowOf = (env: CloudEnv, company: Company): PlatformRow =>
  inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT owner_user_id, owner_email, books_review FROM tenant WHERE id = ?").get(company.tenantId)) as PlatformRow;

const auditedOn = (env: CloudEnv, company: Company, action: string): { actor: string; severity: string }[] =>
  inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT actor, severity FROM audit_event WHERE entity_id = ? AND action = ?").all(company.tenantId, action)) as { actor: string; severity: string }[];

const adminsIn = (env: CloudEnv, company: Company): { id: string; email: string }[] =>
  inDatabase(fileOf(env, company), (sqlite) => sqlite.prepare("SELECT id, email FROM user WHERE is_company_admin = 1 AND status = 'active' ORDER BY email").all()) as { id: string; email: string }[];

const SECOND_ADMIN = "second@nile.example";
const WITH_A_SECOND_ADMIN = (company: Company): string => `
  CREATE TEMP TABLE second AS SELECT * FROM user WHERE email = '${company.email}';
  UPDATE second SET id = 'USER-SECOND', email = '${SECOND_ADMIN}', name_ar = 'مدير ثانٍ';
  INSERT INTO user SELECT * FROM second;
  DROP TABLE second;
  UPDATE user SET status = 'inactive' WHERE email = '${company.email}';
`;

describe("the companies a deploy finds, written before databases were bound", () => {
  it("binds a company whose recorded owner is its one active admin, and serves it as before", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]]);

    const second = await boot(env);
    const seen = await standingOf(second, nile!);
    const login = await signIn(second, nile!);
    await second.app.close();

    expect(seen).toBe(TenantBooksStanding.WillBind);
    expect(login.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(rowOf(env, nile!).books_review).toBeNull();
    const third = await boot(env);
    expect(await standingOf(third, nile!)).toBe(TenantBooksStanding.Bound);
  });

  it("serves a company whose owner changed their login e-mail, leaves its books unbound and marks them for confirmation; the console then binds them to the admin it is shown", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET email = 'moved@nile.example' WHERE email = '${company.email}';`);

    const second = await boot(env);
    const oldAddress = await signIn(second, nile!);
    const newAddress = await signIn(second, nile!, { email: "moved@nile.example" });
    const seen = await standingOf(second, nile!);
    await second.app.close();
    expect([oldAddress.status, newAddress.status]).toEqual([401, 200]);
    expect(seen).toBe(TenantBooksStanding.Unconfirmed);
    expect(boundTo(env, nile!)).toBeNull();
    expect(rowOf(env, nile!)).toEqual({ owner_user_id: null, owner_email: nile!.email, books_review: "unconfirmed" });
    expect(auditedOn(env, nile!, "TENANT_BOOKS_UNCONFIRMED")).toEqual([{ actor: "platform:books-check", severity: "WARNING" }]);

    const third = await boot(env);
    expect((await signIn(third, nile!, { email: "moved@nile.example" })).status).toBe(200);
    const shown = await third.console("GET", `/tenants/${nile!.tenantId}/books`);
    const [admin] = adminsIn(env, nile!);
    expect(shown).toEqual({ status: 200, json: { standing: TenantBooksStanding.Unconfirmed, companyName: "شركة nile", admins: [{ id: admin!.id, nameAr: "المالك", email: "moved@nile.example" }] } });
    const confirmed = await third.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: admin!.id });
    const after = await signIn(third, nile!, { email: "moved@nile.example" });
    await third.app.close();

    expect(confirmed.status).toBe(200);
    expect(confirmed.json?.["books"]).toBe(TenantBooksStanding.Bound);
    expect(after.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(rowOf(env, nile!)).toEqual({ owner_user_id: admin!.id, owner_email: "moved@nile.example", books_review: null });
    expect(auditedOn(env, nile!, "TENANT_BOOKS_CONFIRMED")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);
    expect(auditedOn(env, nile!, "TENANT_BOOKS_UNCONFIRMED")).toHaveLength(1);
  });

  it("keeps books marked for confirmation unbound even after they come to hold the owner the platform recorded: only the console binds them", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET email = 'moved@nile.example' WHERE email = '${company.email}';`);
    const second = await boot(env);
    expect((await signIn(second, nile!, { email: "moved@nile.example" })).status).toBe(200);
    await second.app.close();
    inDatabase(fileOf(env, nile!), (sqlite) => sqlite.prepare("UPDATE user SET email = ? WHERE email = 'moved@nile.example'").run(nile!.email));

    const third = await boot(env);
    const login = await signIn(third, nile!);
    const seen = await standingOf(third, nile!);
    await third.app.close();

    expect(login.status).toBe(200);
    expect(seen).toBe(TenantBooksStanding.Unconfirmed);
    expect(boundTo(env, nile!)).toBeNull();
  });

  it("serves a company whose only owner was deactivated: nobody signs in, nobody is offered the setup, and the console has no admin to confirm", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET status = 'inactive' WHERE email = '${company.email}';`);

    const second = await boot(env);
    const login = await signIn(second, nile!);
    const status = await second.send("/api/bootstrap/status", { tenant: "nile" });
    const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
    const confirm = await second.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: "USER-ADMIN" });
    await second.app.close();

    expect(login.status).toBe(401);
    expect(status.status).toBe(200);
    expect(status.json?.["claimed"]).toBe(true);
    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Unconfirmed, admins: [] });
    expect(confirm.status).toBe(409);
    expect(confirm.json?.["error"]).toBe("TENANT_OWNER_CANDIDATE_NOT_FOUND");
    expect(boundTo(env, nile!)).toBeNull();
  });

  it("serves a company whose owner was deactivated and is run by another admin, and binds it to that admin once the console confirms them", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    const login = await signIn(second, nile!, { email: SECOND_ADMIN });
    const seen = await standingOf(second, nile!);
    const unboundWhileServed = boundTo(env, nile!);
    const confirmed = await second.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: "USER-SECOND" });
    await second.app.close();

    expect(login.status).toBe(200);
    expect(seen).toBe(TenantBooksStanding.Unconfirmed);
    expect(unboundWhileServed).toBeNull();
    expect(confirmed.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(rowOf(env, nile!)).toEqual({ owner_user_id: "USER-SECOND", owner_email: SECOND_ADMIN, books_review: null });
    expect(inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT owner_record_due FROM tenant WHERE id = ?").get(nile!.tenantId))).toEqual({ owner_record_due: null });
    expect(inDatabase(fileOf(env, nile!), (sqlite) => sqlite.prepare("SELECT entity_id, severity FROM audit_event WHERE action = 'COMPANY_OWNER_ASSIGNED'").all())).toEqual([
      { entity_id: "USER-SECOND", severity: "CRITICAL" },
    ]);
  });

  it("does not take an erased account for the owner the platform recorded by e-mail", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET erased_at = '2026-01-01T00:00:00.000Z' WHERE email = '${company.email}';`);

    const second = await boot(env);
    const seen = await standingOf(second, nile!);
    await second.send("/api/bootstrap/status", { tenant: "nile" });
    await second.app.close();

    expect(seen).toBe(TenantBooksStanding.Unconfirmed);
    expect(boundTo(env, nile!)).toBeNull();
  });

  it("binds a suspended company's books on the console's first open of them", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    expect((await first.console("POST", `/tenants/${nile.tenantId}/suspend`)).status).toBe(200);
    await first.app.close();
    asWrittenBeforeBinding(env, [nile]);

    const second = await boot(env);
    const seen = await standingOf(second, nile);
    const candidates = await second.console("GET", `/tenants/${nile.tenantId}/owner/candidates`);
    await second.app.close();

    expect(seen).toBe(TenantBooksStanding.WillBind);
    expect(candidates.status).toBe(200);
    expect(boundTo(env, nile)).toBe(nile.tenantId);
  });

  describe("still being provisioned when the deploy arrived", () => {
    async function midProvisioning(env: CloudEnv, books: (file: string) => Promise<void> | void): Promise<{ on: Booted; company: Company; retry: Answer }> {
      const first = await boot(env);
      await first.app.close();
      const platform = await createPlatform({ dbPath: platformDb(env) });
      const tenant = await createTenant({ id: "t-new", code: "newco", nameAr: "شركة جديدة", ownerEmail: "owner@newco.example", now: new Date().toISOString() }, platform.stores.tenants);
      platform.close();
      const company = { code: "newco", tenantId: tenant.id, email: "owner@newco.example", pin: "" };
      mkdirSync(path.dirname(idFile(env, company)), { recursive: true });
      await books(idFile(env, company));
      const on = await boot(env);
      const retry = await on.console("POST", `/tenants/${tenant.id}/provision`, { planId: "PLAN-CORE", billingCycle: "monthly", trial: true, ownerNameAr: "المالك" });
      return { on, company, retry };
    }

    it("creates and binds the books of a company that had none yet", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const { on, company, retry } = await midProvisioning(env, () => undefined);
      await on.app.close();

      expect(retry.status).toBe(200);
      expect(boundTo(env, company)).toBe(company.tenantId);
    });

    it("binds books that were seeded and never bound", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const { on, company, retry } = await midProvisioning(env, async (file) => {
        const seeded = await createBackend({ dbPath: file });
        await seeded.drain();
        seeded.close();
      });
      const seen = await standingOf(on, company);
      await on.app.close();

      expect(retry.status).toBe(200);
      expect(seen).toBe(TenantBooksStanding.Bound);
      expect(boundTo(env, company)).toBe(company.tenantId);
    });

    it("refuses books bound to another tenant, and tells the console why", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const { on, company, retry } = await midProvisioning(env, (file) => inDatabase(file, (sqlite) => bindTenantDatabase(sqlite, "t-other")));
      const seen = await standingOf(on, company);
      await on.app.close();

      expect(retry).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
      expect(seen).toBe(TenantBooksStanding.Foreign);
      expect(boundTo(env, company)).toBe("t-other");
    });
  });

  describe("two companies registered under one owner e-mail", () => {
    const SHARED = "boss@group.example";

    it("are both served and neither is bound by that e-mail; the console binds each to its own admin", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile, delta] = await legacy(env, [["nile", SHARED], ["delta", SHARED]]);

      const second = await boot(env);
      const logins = [await signIn(second, nile!), await signIn(second, delta!)];
      const seen = [await standingOf(second, nile!), await standingOf(second, delta!)];
      const unbound = [boundTo(env, nile!), boundTo(env, delta!)];
      const confirmed = await second.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: adminsIn(env, nile!)[0]!.id });
      await second.app.close();

      expect(logins.map((login) => login.status)).toEqual([200, 200]);
      expect(seen).toEqual([TenantBooksStanding.Unconfirmed, TenantBooksStanding.Unconfirmed]);
      expect(unbound).toEqual([null, null]);
      expect(confirmed.status).toBe(200);
      expect([boundTo(env, nile!), boundTo(env, delta!)]).toEqual([nile!.tenantId, null]);
    });

    it("are never bound to each other's books when the files were swapped, however often they are opened; the console refuses the wrong books and binds the right ones", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile, delta] = await legacy(env, [["nile", SHARED], ["delta", SHARED]]);
      const swap = (): void => {
        const aside = `${fileOf(env, nile!)}.aside`;
        renameSync(fileOf(env, nile!), aside);
        renameSync(fileOf(env, delta!), fileOf(env, nile!));
        renameSync(aside, fileOf(env, delta!));
      };
      swap();

      const second = await boot(env);
      const deltaUnderNile = await second.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: SHARED, pin: delta!.pin }) });
      await second.app.close();
      const third = await boot(env);
      await third.send("/api/bootstrap/status", { tenant: "nile" });
      const seen = await standingOf(third, nile!);
      const shown = await third.console("GET", `/tenants/${nile!.tenantId}/books`);
      const pinReset = await third.console("POST", `/tenants/${nile!.tenantId}/owner-pin/reset`);
      const disowned = await third.console("POST", `/tenants/${nile!.tenantId}/books/disown`);
      const refused = await third.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: SHARED, pin: delta!.pin }) });
      const stillShown = await third.console("GET", `/tenants/${nile!.tenantId}/books`);
      await third.app.close();

      expect(deltaUnderNile.status).toBe(200);
      expect(seen).toBe(TenantBooksStanding.Unconfirmed);
      expect(shown.json?.["companyName"]).toBe("شركة delta");
      expect(rowOf(env, nile!)).toEqual({ owner_user_id: null, owner_email: SHARED, books_review: "disowned" });
      expect(pinReset.status).toBe(409);
      expect(pinReset.json?.["error"]).toBe("TENANT_BOOKS_UNCONFIRMED");
      expect(disowned.status).toBe(200);
      expect(disowned.json?.["books"]).toBe(TenantBooksStanding.Disowned);
      expect(refused).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_DISOWNED", ...NOT_IN_PLACE } });
      expect(stillShown.json).toMatchObject({ standing: TenantBooksStanding.Disowned, companyName: "شركة delta" });
      expect([boundTo(env, nile!), boundTo(env, delta!)]).toEqual([null, null]);
      expect(auditedOn(env, nile!, "TENANT_BOOKS_DISOWNED")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);

      swap();
      const fourth = await boot(env);
      const stillRefused = await signIn(fourth, nile!);
      const confirmed = await fourth.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: adminsIn(env, nile!)[0]!.id });
      const served = await signIn(fourth, nile!);
      await fourth.app.close();

      expect(stillRefused.status).toBe(503);
      expect(confirmed.status).toBe(200);
      expect(served.status).toBe(200);
      expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    });
  });

  it("serves the demo company and binds it by the seed admin its row names", async () => {
    const env = harnessEnv({ MEZAN_SEED_DEMO: "1" }, {}, harnessDirs);
    const first = await boot(env);
    const list = (await first.send("/api/platform/tenants", { token: first.platformToken })).json as unknown as { tenant: { id: string; code: string } }[];
    const demo: Company = { code: "demo", tenantId: list.find((summary) => summary.tenant.code === "demo")!.tenant.id, email: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN };
    await first.app.close();
    const boundWhenSeeded = boundTo(env, demo);
    asWrittenBeforeBinding(env, [demo]);

    const second = await boot(env);
    const login = await signIn(second, demo);
    await second.app.close();

    expect(boundWhenSeeded).toBe(demo.tenantId);
    expect(login.status).toBe(200);
    expect(boundTo(env, demo)).toBe(demo.tenantId);
  }, 120_000);
});

describe("what the server says about every company's books when it starts", () => {
  it("counts them in one line and names each company that needs somebody, without opening one for use", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile, delta, sudd] = await legacy(env, [["nile"], ["delta"], ["sudd"]], (company) =>
      company.code === "delta" ? `UPDATE user SET email = 'moved@delta.example' WHERE email = '${company.email}';` : "",
    );
    rmSync(fileOf(env, sudd!));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => void lines.push(String(line)));

    const second = await boot(env);
    const seen = [await standingOf(second, nile!), await standingOf(second, delta!), await standingOf(second, sudd!)];
    await second.app.close();
    const books = lines.filter((line) => line.includes("books"));

    expect(books).toEqual([
      "[cloud] tenant books at start: 3 checked: will-bind 1, unconfirmed 1, missing 1",
      `[cloud] tenant books: "delta" (${delta!.tenantId}) is unconfirmed`,
      `[cloud] tenant books: "sudd" (${sudd!.tenantId}) is missing`,
    ]);
    expect(seen).toEqual([TenantBooksStanding.WillBind, TenantBooksStanding.Unconfirmed, TenantBooksStanding.Missing]);
    expect([existsSync(idFile(env, nile!)), boundTo(env, nile!)]).toEqual([false, null]);
  });
});

describe("books the console is asked about while the company is being served on a network filesystem", () => {
  it("are shown and confirmed while the served backend holds the file to itself", async () => {
    const env = harnessEnv({ MEZAN_SQLITE_EXCLUSIVE: "1" }, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    expect((await signIn(second, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
    const confirmed = await second.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: "USER-SECOND" });
    const served = await signIn(second, nile!, { email: SECOND_ADMIN });
    await second.app.close();

    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Unconfirmed, admins: [{ id: "USER-SECOND", email: SECOND_ADMIN }] });
    expect(confirmed.status).toBe(200);
    expect(served.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
  });

  it("are shown at once while the served backend holds a bound file to itself and has written nothing yet", async () => {
    const env = harnessEnv({ MEZAN_SQLITE_EXCLUSIVE: "1" }, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();

    const second = await boot(env);
    expect((await second.send("/api/bootstrap/status", { tenant: "nile" })).status).toBe(200);
    const started = Date.now();
    const shown = await second.console("GET", `/tenants/${nile.tenantId}/books`);
    const list = await standingOf(second, nile);
    const waited = Date.now() - started;
    await second.app.close();

    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Bound, companyName: "شركة nile" });
    expect(list).toBe(TenantBooksStanding.Bound);
    expect(waited).toBeLessThan(2000);
  });
});

describe("a database bound to the wrong company by mistake", () => {
  async function wronglyBound(env: CloudEnv): Promise<{ on: Booted; nile: Company; delta: Company }> {
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    const delta = await provisioned(first, "delta");
    await first.app.close();
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${idFile(env, nile)}${suffix}`, { force: true });
    renameSync(idFile(env, delta), idFile(env, nile));
    inDatabase(idFile(env, nile), (sqlite) => {
      sqlite.exec("DROP TABLE tenant_binding");
      bindTenantDatabase(sqlite, nile.tenantId);
    });
    return { on: await boot(env), nile, delta };
  }

  it("is unbound by the platform owner who types the company's code, is not served afterwards, and the act is on the record", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const { on, nile, delta } = await wronglyBound(env);
    const servedWrongly = await on.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: delta.email, pin: delta.pin }) });

    const mistyped = await on.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "delta" });
    const stillBound = boundTo(env, nile);
    const unbound = await on.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" });
    const refused = await on.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: delta.email, pin: delta.pin }) });
    await on.app.close();

    expect(servedWrongly.status).toBe(200);
    expect(mistyped.status).toBe(422);
    expect(mistyped.json?.["error"]).toBe("TENANT_CODE_MISMATCH");
    expect(stillBound).toBe(nile.tenantId);
    expect(unbound.status).toBe(200);
    expect(unbound.json?.["books"]).toBe(TenantBooksStanding.Disowned);
    expect(refused).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_DISOWNED", ...NOT_IN_PLACE } });
    expect(boundTo(env, nile)).toBeNull();
    expect(auditedOn(env, nile, "TENANT_BOOKS_UNBOUND")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);
    const again = await boot(env);
    expect((await again.send("/api/bootstrap/status", { tenant: "nile" })).status).toBe(503);
    expect(boundTo(env, nile)).toBeNull();
  });

  it("is not unbound, confirmed or disowned by an operator who is not the platform owner", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const { on, nile } = await wronglyBound(env);
    const SUPPORT = { email: "support@mezan.example", password: "support-password-1" };
    expect((await on.console("POST", "/users", { ...SUPPORT, role: "support" })).status).toBe(201);
    const support = String((await on.send("/api/platform/auth/login", { method: "POST", body: JSON.stringify(SUPPORT) })).json?.["token"]);

    const answers = [
      await on.console("GET", `/tenants/${nile.tenantId}/books`, undefined, support),
      await on.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" }, support),
      await on.console("POST", `/tenants/${nile.tenantId}/books/disown`, undefined, support),
      await on.console("POST", `/tenants/${nile.tenantId}/books/confirm`, { userId: "anyone" }, support),
    ];
    await on.app.close();

    expect(answers.map((answer) => answer.status)).toEqual([403, 403, 403, 403]);
    expect(boundTo(env, nile)).toBe(nile.tenantId);
  });

  it("refuses to unbind when the audit log cannot record it, and leaves the binding in the file", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const { on, nile } = await wronglyBound(env);
    await on.app.close();
    inDatabase(platformDb(env), (sqlite) =>
      sqlite.exec("CREATE TRIGGER refuse_unbound BEFORE INSERT ON audit_event WHEN NEW.action = 'TENANT_BOOKS_UNBOUND' BEGIN SELECT RAISE(ABORT, 'audit down'); END"),
    );

    const second = await boot(env);
    const unbound = await second.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" });
    await second.app.close();

    expect(unbound.status).toBe(503);
    expect(unbound.json?.["error"]).toBe("AUDIT_UNAVAILABLE");
    expect(boundTo(env, nile)).toBe(nile.tenantId);
    expect(rowOf(env, nile).books_review).toBeNull();
  });
});

describe("confirming a company's books when the audit log cannot record it", () => {
  it("answers 503 and binds nothing", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    inDatabase(platformDb(env), (sqlite) =>
      sqlite.exec("CREATE TRIGGER refuse_confirmed BEFORE INSERT ON audit_event WHEN NEW.action = 'TENANT_BOOKS_CONFIRMED' BEGIN SELECT RAISE(ABORT, 'audit down'); END"),
    );

    const second = await boot(env);
    await signIn(second, nile!, { email: SECOND_ADMIN });
    const confirmed = await second.console("POST", `/tenants/${nile!.tenantId}/books/confirm`, { userId: "USER-SECOND" });
    const served = await signIn(second, nile!, { email: SECOND_ADMIN });
    await second.app.close();

    expect(confirmed.status).toBe(503);
    expect(confirmed.json?.["error"]).toBe("AUDIT_UNAVAILABLE");
    expect(served.status).toBe(200);
    expect(boundTo(env, nile!)).toBeNull();
    expect(rowOf(env, nile!).books_review).toBe("unconfirmed");
  });
});

describe("every console route that opens a company's books, when the books cannot be opened", () => {
  const DAMAGE: readonly (readonly [string, string, (env: CloudEnv, company: Company) => void])[] = [
    ["missing", "TENANT_DB_FILE_MISSING", (env, company) => rmSync(idFile(env, company))],
    ["bound to another tenant", "TENANT_DB_FILE_FOREIGN", (env, company) => inDatabase(idFile(env, company), (sqlite) => sqlite.exec("UPDATE tenant_binding SET tenant_id = 't-other'"))],
    ["torn", "TENANT_DB_FILE_UNREADABLE", (env, company) => writeFileSync(idFile(env, company), Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)]))],
    ["disowned", "TENANT_DB_FILE_DISOWNED", (env, company) => inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'disowned' WHERE id = ?").run(company.tenantId))],
  ];

  it.each(DAMAGE)("answers 503 with the reason, in Arabic and English, when they are %s", async (_label, code, damage) => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    for (const suffix of ["-wal", "-shm"]) rmSync(`${idFile(env, nile)}${suffix}`, { force: true });
    damage(env, nile);

    const second = await boot(env);
    const answers = {
      candidates: await second.console("GET", `/tenants/${nile.tenantId}/owner/candidates`),
      assign: await second.console("POST", `/tenants/${nile.tenantId}/owner`, { userId: "anyone" }),
      confirmPending: await second.console("POST", `/tenants/${nile.tenantId}/owner/confirm`),
      pinReset: await second.console("POST", `/tenants/${nile.tenantId}/owner-pin/reset`),
    };
    const detail = await second.console("GET", `/tenants/${nile.tenantId}`);
    const list = await second.send("/api/platform/tenants", { token: second.platformToken });
    const decline = await second.console("POST", `/tenants/${nile.tenantId}/owner/decline`);
    const resend = await second.console("POST", `/tenants/${nile.tenantId}/owner/resend`);
    const books = {
      confirm: await second.console("POST", `/tenants/${nile.tenantId}/books/confirm`, { userId: "anyone" }),
      disown: await second.console("POST", `/tenants/${nile.tenantId}/books/disown`),
      unbind: await second.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" }),
    };
    await second.app.close();

    for (const answer of Object.values(answers)) expect(answer).toEqual({ status: 503, json: { error: code, ...NOT_IN_PLACE } });
    expect([detail.status, list.status, decline.status, resend.status]).toEqual([200, 200, 409, 409]);
    if (code === "TENANT_DB_FILE_DISOWNED") {
      expect([books.confirm.status, books.disown.status, books.unbind.status]).toEqual([409, 200, 200]);
    } else {
      for (const answer of Object.values(books)) expect(answer).toEqual({ status: 503, json: { error: code, ...NOT_IN_PLACE } });
    }
  });
});

describe("a company whose books the console disowned", () => {
  it("is shown on its detail page without its books being opened, so nothing is logged as failing", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'disowned' WHERE id = ?").run(nile.tenantId));
    const second = await boot(env);
    const failures = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const detail = await second.console("GET", `/tenants/${nile.tenantId}`);
    await second.app.close();

    expect(detail.status).toBe(200);
    expect(detail.json?.["books"]).toBe(TenantBooksStanding.Disowned);
    expect(failures).not.toHaveBeenCalled();
  });
});

describe("books found bound to the company while its row still says they await confirmation", () => {
  it("lose the mark on their next open, with a record of it, and the console's owner actions work again", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'unconfirmed' WHERE id = ?").run(nile.tenantId));

    const second = await boot(env);
    const blocked = await second.console("POST", `/tenants/${nile.tenantId}/owner-pin/reset`);
    const login = await signIn(second, nile);
    const reset = await second.console("POST", `/tenants/${nile.tenantId}/owner-pin/reset`);
    await second.app.close();

    expect(blocked.status).toBe(409);
    expect(login.status).toBe(200);
    expect(reset.status).toBe(200);
    expect(rowOf(env, nile).books_review).toBeNull();
    expect(auditedOn(env, nile, "TENANT_BOOKS_CONFIRMED")).toEqual([{ actor: "platform:books-check", severity: "WARNING" }]);
  });
});

describe("a tenant request that arrives while the console is acting on the company's books", () => {
  async function servedUnconfirmed(env: CloudEnv): Promise<{ on: Booted; nile: Company }> {
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    const on = await boot(env);
    expect((await signIn(on, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    return { on, nile: nile! };
  }

  const racing = (on: Booted, nile: Company, act: Promise<Answer>) =>
    Promise.all([act, ...Array.from({ length: 8 }, () => on.send("/api/bootstrap/status", { tenant: nile.code }))]);

  it("does not keep disowned books served", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const { on, nile } = await servedUnconfirmed(env);

    const [disowned] = await racing(on, nile, on.console("POST", `/tenants/${nile.tenantId}/books/disown`));
    const after = await on.send("/api/bootstrap/status", { tenant: "nile" });
    await on.app.close();

    expect(disowned.status).toBe(200);
    expect(after.status).toBe(503);
  });

  it("does not keep unbound books served, and the binding still leaves the file", async () => {
    const env = harnessEnv({ MEZAN_SQLITE_EXCLUSIVE: "1" }, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");

    const [unbound] = await racing(first, nile, first.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" }));
    const after = await first.send("/api/bootstrap/status", { tenant: "nile" });
    await first.app.close();

    expect(unbound.status).toBe(200);
    expect(after.status).toBe(503);
    expect(boundTo(env, nile)).toBeNull();
  });

  it("serves confirmed books bound from the next request on", async () => {
    const env = harnessEnv({ MEZAN_SQLITE_EXCLUSIVE: "1" }, {}, harnessDirs);
    const { on, nile } = await servedUnconfirmed(env);

    const [confirmed] = await racing(on, nile, on.console("POST", `/tenants/${nile.tenantId}/books/confirm`, { userId: "USER-SECOND" }));
    const after = await signIn(on, nile, { email: SECOND_ADMIN });
    const started = Date.now();
    const shown = await on.console("GET", `/tenants/${nile.tenantId}/books`);
    const waited = Date.now() - started;
    await on.app.close();

    expect(confirmed.status).toBe(200);
    expect(after.status).toBe(200);
    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Bound, admins: [{ id: "USER-SECOND" }] });
    expect(waited).toBeLessThan(2000);
    expect(boundTo(env, nile)).toBe(nile.tenantId);
  });
});

describe("a backend opened on unconfirmed books at the very moment the console confirms them", () => {
  it("is closed again once the books are bound, so the company is served from an open that knows they are its own", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    const settledFirst = await boot(env);
    expect((await signIn(settledFirst, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    await settledFirst.app.close();
    const platform = await createPlatform({ dbPath: platformDb(env) });
    const opens: boolean[] = [];
    const router = createTenantRouter({
      platform,
      dataDir: env.platformDir,
      sweepEveryMs: 0,
      openBackend: async (_code, dbPath, _resolvers, _hooks, connection, books) => {
        opens.push(books.bind);
        return createBackend({ dbPath, connection, tenantBinding: books.bind ? books.tenantId : undefined, seedWhenEmpty: false });
      },
    });
    const write = platform.stores.tenants.compareAndSetOwner.bind(platform.stores.tenants);
    let openedMeanwhile: Promise<unknown> | undefined;
    vi.spyOn(platform.stores.tenants, "compareAndSetOwner").mockImplementation(async (before, after, sideEffect) => {
      openedMeanwhile ??= router.backendOf(nile!.tenantId);
      await openedMeanwhile;
      return write(before, after, sideEffect);
    });

    try {
      await router.confirmBooks({ tenantId: nile!.tenantId, userId: "USER-SECOND", actor: "platform:test" });
      await router.backendOf(nile!.tenantId);
    } finally {
      await router.close();
      platform.close();
    }

    expect(opens).toEqual([false, true]);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
  });
});

const KILLED_WRITER = `
const Database = require(process.argv[2]);
const sqlite = new Database(process.argv[3]);
sqlite.pragma("journal_mode = WAL");
sqlite.exec(process.argv[4]);
process.kill(process.pid, "SIGKILL");
`;

function fingerprintOf(file: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(path.dirname(file))
      .filter((name) => name.startsWith(path.basename(file)))
      .sort()
      .map((name) => [name, createHash("sha256").update(readFileSync(path.join(path.dirname(file), name))).digest("hex")]),
  );
}

describe("a company's books a writer was killed over, its log still beside them", () => {
  it("are refused without a byte of the database, its log or its index being changed when the log binds them to another tenant", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    const script = path.join(env.platformDir, "killed-writer.cjs");
    writeFileSync(script, KILLED_WRITER);
    spawnSync(process.execPath, [script, createRequire(import.meta.url).resolve("better-sqlite3"), idFile(env, nile), "UPDATE tenant_binding SET tenant_id = 't-other'"]);
    const before = fingerprintOf(idFile(env, nile));

    const second = await boot(env);
    const login = await signIn(second, nile);
    await second.app.close();

    expect(Object.keys(before)).toHaveLength(3);
    expect(login).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
    expect(fingerprintOf(idFile(env, nile))).toEqual(before);
  });
});
