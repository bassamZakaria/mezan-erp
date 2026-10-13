import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, SEED_ADMIN_EMAIL, SEED_ADMIN_PIN, SEED_ADMIN_USER_ID } from "@mezan/backend";
import { PlatformRefusalCode, REFUSED_TENANT_BOOKS, TenantBooksStanding } from "@mezan/contracts";
import { createTenant, tenantDbFile, TenantBooksReview, TenantDbFileRefusal, TenantStatusCode, UserStatusCode, type Tenant } from "@mezan/domain";
import { bindTenantDatabase, openSqliteConnection, type SqliteDriver, type TenantBooksIdentity, type TenantBooksUser } from "@mezan/persistence";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { harnessEnv, HARNESS_OWNER_EMAIL, HARNESS_OWNER_PASSWORD, proxiedRequest, type SendInit } from "./cloud-harness.js";
import type { CloudEnv } from "./env.js";
import { hashHandOverToken } from "./owner-contact.js";
import { BooksFileState, classifyTenantBooks, type BooksFile } from "./tenant-books.js";
import { booksScratchDir, createTenantRouter } from "./tenant-router.js";

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

function boundIn(file: string): string | null {
  return inDatabase(file, (sqlite) => {
    if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tenant_binding'").get()) return null;
    return (sqlite.prepare("SELECT tenant_id FROM tenant_binding").get() as { tenant_id: string } | undefined)?.tenant_id ?? null;
  });
}

const boundTo = (env: CloudEnv, company: Company): string | null => boundIn(fileOf(env, company));

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

const booksAudits = (env: CloudEnv): unknown[] => inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT action FROM audit_event WHERE action LIKE 'TENANT_BOOKS_%'").all());

const adminsIn = (env: CloudEnv, company: Company): { id: string; email: string }[] =>
  inDatabase(fileOf(env, company), (sqlite) => sqlite.prepare("SELECT id, email FROM user WHERE is_company_admin = 1 AND status = 'active' ORDER BY email").all()) as { id: string; email: string }[];

const scratchLeftIn = (env: CloudEnv): string[] => readdirSync(booksScratchDir(env.platformDir));

const SECOND_ADMIN = "second@nile.example";
const WITH_A_SECOND_ADMIN = (company: Company): string => `
  CREATE TEMP TABLE second AS SELECT * FROM user WHERE email = '${company.email}';
  UPDATE second SET id = 'USER-SECOND', email = '${SECOND_ADMIN}', name_ar = 'مدير ثانٍ';
  INSERT INTO user SELECT * FROM second;
  DROP TABLE second;
  UPDATE user SET status = 'inactive' WHERE email = '${company.email}';
`;

const confirmBooks = (on: Booted, company: Company, userId: string, companyName: string | null = `شركة ${company.code}`) =>
  on.console("POST", `/tenants/${company.tenantId}/books/confirm`, { userId, companyName });

describe("whose books a database holds", () => {
  const T = "2026-10-13T00:00:00.000Z";
  const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
    id: "t-nile", code: "nile", nameAr: "شركة النيل", nameEn: null, ownerEmail: "owner@nile.example", ownerUserId: null, ownerContactVerified: true,
    status: TenantStatusCode.Active, dbFile: "tenants/t-nile.db", createdAt: T, updatedAt: T, ...overrides,
  });
  const user = (overrides: Partial<TenantBooksUser> = {}): TenantBooksUser => ({ id: "USER-1", nameAr: "المالك", email: "owner@nile.example", isCompanyAdmin: true, status: UserStatusCode.Active, erased: false, ...overrides });
  const books = (overrides: Partial<TenantBooksIdentity> = {}): BooksFile => ({
    state: BooksFileState.Read,
    identity: { boundTenantId: null, claimedAt: null, companyName: "شركة النيل", users: [user({ id: SEED_ADMIN_USER_ID }), user()], ...overrides },
  });
  const ABSENT: BooksFile = { state: BooksFileState.Absent };
  const TORN: BooksFile = { state: BooksFileState.Unreadable, cause: new Error("torn") };
  const provisioning = { status: TenantStatusCode.Provisioning };
  const disowned = { booksReview: TenantBooksReview.Disowned };

  it.each<[string, Partial<Tenant>, BooksFile, TenantBooksStanding, TenantDbFileRefusal | null]>([
    ["bound to this tenant are served", {}, books({ boundTenantId: "t-nile" }), TenantBooksStanding.Bound, null],
    ["bound to another tenant are refused", {}, books({ boundTenantId: "t-other" }), TenantBooksStanding.Foreign, TenantDbFileRefusal.Foreign],
    ["that are not there are refused", {}, ABSENT, TenantBooksStanding.Missing, TenantDbFileRefusal.Missing],
    ["that cannot be read are refused", {}, TORN, TenantBooksStanding.Unreadable, TenantDbFileRefusal.Unreadable],
    ["nobody bound, with an account somebody created, are served unbound", {}, books(), TenantBooksStanding.Unbound, null],
    ["nobody bound, of a suspended company, are served unbound", { status: TenantStatusCode.Suspended }, books(), TenantBooksStanding.Unbound, null],
    ["nobody bound, with a recorded claim and only the seed admin, are served unbound", {}, books({ claimedAt: T, users: [user({ id: SEED_ADMIN_USER_ID })] }), TenantBooksStanding.Unbound, null],
    ["nobody bound, whose every created account is inactive, are served unbound", {}, books({ users: [user({ id: SEED_ADMIN_USER_ID }), user({ status: UserStatusCode.Inactive })] }), TenantBooksStanding.Unbound, null],
    ["nobody bound, whose only created account was erased, are served unbound", {}, books({ users: [user({ erased: true, status: UserStatusCode.Inactive })] }), TenantBooksStanding.Unbound, null],
    ["nobody bound, holding the seed admin alone, are refused", {}, books({ users: [user({ id: SEED_ADMIN_USER_ID })] }), TenantBooksStanding.Foreign, TenantDbFileRefusal.Foreign],
    ["nobody bound, holding nothing, are refused", {}, books({ companyName: null, users: [] }), TenantBooksStanding.Foreign, TenantDbFileRefusal.Foreign],
    ["not created yet, of a company being provisioned, are accepted", provisioning, ABSENT, TenantBooksStanding.Provisioning, null],
    ["seeded and unbound, of a company being provisioned, are accepted", provisioning, books({ users: [user({ id: SEED_ADMIN_USER_ID })] }), TenantBooksStanding.Provisioning, null],
    ["bound to another tenant, of a company being provisioned, are refused", provisioning, books({ boundTenantId: "t-other" }), TenantBooksStanding.Foreign, TenantDbFileRefusal.Foreign],
    ["an operator disowned are refused though they are bound to this tenant", disowned, books({ boundTenantId: "t-nile" }), TenantBooksStanding.Disowned, TenantDbFileRefusal.Disowned],
    ["an operator disowned are refused though somebody claimed them", disowned, books(), TenantBooksStanding.Disowned, TenantDbFileRefusal.Disowned],
  ])("books %s", (_label, row, file, standing, refusal) => {
    const verdict = classifyTenantBooks(tenant(row), file);

    expect(verdict.standing).toBe(standing);
    expect(verdict.refusal?.code ?? null).toBe(refusal);
  });
});

describe("the companies a deploy finds, written before databases were bound", () => {
  async function servedAsBefore(env: CloudEnv, companies: readonly Company[]): Promise<void> {
    for (const company of companies) expect(boundTo(env, company)).toBeNull();
    for (const company of companies) expect(rowOf(env, company).books_review).toBeNull();
    expect(booksAudits(env)).toEqual([]);
    expect(scratchLeftIn(env)).toEqual([]);
  }

  it("serves a company whose recorded owner is its one active admin, on every start, and binds nothing", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]]);

    const second = await boot(env);
    const seen = await standingOf(second, nile!);
    const login = await signIn(second, nile!);
    await second.app.close();
    const third = await boot(env);
    const again = await signIn(third, nile!);
    const seenAgain = await standingOf(third, nile!);
    await third.app.close();

    expect([login.status, again.status]).toEqual([200, 200]);
    expect([seen, seenAgain]).toEqual([TenantBooksStanding.Unbound, TenantBooksStanding.Unbound]);
    expect(rowOf(env, nile!)).toMatchObject({ owner_user_id: adminsIn(env, nile!)[0]!.id, owner_email: nile!.email });
    await servedAsBefore(env, [nile!]);
  });

  it("serves a company whose owner changed their login e-mail, and the console assigns its owner and resets the PIN without the books being confirmed", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET email = 'moved@nile.example' WHERE email = '${company.email}';`);

    const second = await boot(env);
    const oldAddress = await signIn(second, nile!);
    const newAddress = await signIn(second, nile!, { email: "moved@nile.example" });
    const [admin] = adminsIn(env, nile!);
    const assigned = await second.console("POST", `/tenants/${nile!.tenantId}/owner`, { userId: admin!.id });
    const reset = await second.console("POST", `/tenants/${nile!.tenantId}/owner-pin/reset`);
    const withNewPin = await second.send("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: "moved@nile.example", pin: reset.json?.["adminPin"] }) });
    await second.app.close();

    expect([oldAddress.status, newAddress.status]).toEqual([401, 200]);
    expect(assigned.status).toBe(200);
    expect(reset.status).toBe(200);
    expect(withNewPin.status).toBe(200);
    expect(rowOf(env, nile!)).toMatchObject({ owner_user_id: admin!.id, owner_email: "moved@nile.example" });
    await servedAsBefore(env, [nile!]);
  });

  it("notices on the console's next look at a served company that its owner's address was changed by somebody else, and stops calling the recorded address verified", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]]);

    const second = await boot(env);
    expect((await signIn(second, nile!)).status).toBe(200);
    const before = (await second.console("GET", `/tenants/${nile!.tenantId}`)).json?.["tenant"] as Record<string, unknown>;
    inDatabase(fileOf(env, nile!), (sqlite) => sqlite.prepare("UPDATE user SET email = 'moved@nile.example' WHERE email = ?").run(nile!.email));
    const after = (await second.console("GET", `/tenants/${nile!.tenantId}`)).json?.["tenant"] as Record<string, unknown>;
    await second.app.close();

    expect(before).toMatchObject({ ownerEmail: nile!.email, ownerContactVerified: true });
    expect(after).toMatchObject({ ownerEmail: nile!.email, ownerContactVerified: false });
    await servedAsBefore(env, [nile!]);
  });

  it("assigns an owner and resets the owner's PIN on a company nobody has opened since the deploy", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile, delta] = await legacy(env, [["nile"], ["delta"]]);

    const second = await boot(env);
    const assigned = await second.console("POST", `/tenants/${nile!.tenantId}/owner`, { userId: adminsIn(env, nile!)[0]!.id });
    const reset = await second.console("POST", `/tenants/${delta!.tenantId}/owner-pin/reset`);
    const withNewPin = await second.send("/api/auth/login", { method: "POST", tenant: "delta", body: JSON.stringify({ username: delta!.email, pin: reset.json?.["adminPin"] }) });
    await second.app.close();

    expect([assigned.status, reset.status, withNewPin.status]).toEqual([200, 200, 200]);
    await servedAsBefore(env, [nile!, delta!]);
  });

  it("serves a company whose only owner was deactivated: nobody signs in, nobody is offered the setup, and the console has no admin to confirm", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => `UPDATE user SET status = 'inactive' WHERE email = '${company.email}';`);

    const second = await boot(env);
    const login = await signIn(second, nile!);
    const status = await second.send("/api/bootstrap/status", { tenant: "nile" });
    const seen = await standingOf(second, nile!);
    const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
    const confirm = await confirmBooks(second, nile!, "USER-ADMIN");
    await second.app.close();

    expect(login.status).toBe(401);
    expect(status.status).toBe(200);
    expect(status.json?.["claimed"]).toBe(true);
    expect(seen).toBe(TenantBooksStanding.Unbound);
    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Unbound, admins: [] });
    expect(confirm.status).toBe(409);
    expect(confirm.json?.["error"]).toBe(PlatformRefusalCode.OwnerCandidateNotFound);
    await servedAsBefore(env, [nile!]);
  });

  it("serves a company whose every created account is inactive, as it was served before", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], () => `UPDATE user SET status = 'inactive'; UPDATE tenant_settings SET data = json_remove(data, '$.tenantClaimedAt');`);

    const second = await boot(env);
    const status = await second.send("/api/bootstrap/status", { tenant: "nile" });
    const login = await signIn(second, nile!);
    const seen = await standingOf(second, nile!);
    await second.app.close();

    expect(status.status).toBe(200);
    expect(status.json?.["claimed"]).toBe(true);
    expect(login.status).toBe(401);
    expect(seen).toBe(TenantBooksStanding.Unbound);
    await servedAsBefore(env, [nile!]);
  });

  it("serves a company whose owner was deactivated and is run by another admin, and the console makes that admin its owner", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    const login = await signIn(second, nile!, { email: SECOND_ADMIN });
    const assigned = await second.console("POST", `/tenants/${nile!.tenantId}/owner`, { userId: "USER-SECOND" });
    await second.app.close();

    expect(login.status).toBe(200);
    expect(assigned.status).toBe(200);
    expect(rowOf(env, nile!)).toMatchObject({ owner_user_id: "USER-SECOND", owner_email: SECOND_ADMIN });
    await servedAsBefore(env, [nile!]);
  });

  it("opens a suspended company's books for the console, unbound", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    expect((await first.console("POST", `/tenants/${nile.tenantId}/suspend`)).status).toBe(200);
    await first.app.close();
    asWrittenBeforeBinding(env, [nile]);

    const second = await boot(env);
    const candidates = await second.console("GET", `/tenants/${nile.tenantId}/owner/candidates`);
    const seen = await standingOf(second, nile);
    await second.app.close();

    expect(candidates.status).toBe(200);
    expect(seen).toBe(TenantBooksStanding.Unbound);
    await servedAsBefore(env, [nile]);
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
      const seen = await standingOf(on, company);
      await on.app.close();

      expect(retry.status).toBe(200);
      expect(seen).toBe(TenantBooksStanding.Bound);
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

    function swapped(env: CloudEnv, nile: Company, delta: Company): void {
      const aside = `${fileOf(env, nile)}.aside`;
      renameSync(fileOf(env, nile), aside);
      renameSync(fileOf(env, delta), fileOf(env, nile));
      renameSync(aside, fileOf(env, delta));
    }

    it("are both served, each from the file in its own place, and neither is bound", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile, delta] = await legacy(env, [["nile", SHARED], ["delta", SHARED]]);

      const second = await boot(env);
      const logins = [await signIn(second, nile!), await signIn(second, delta!)];
      const crossed = [await signIn(second, nile!, { under: "delta" }), await signIn(second, delta!, { under: "nile" })];
      const seen = [await standingOf(second, nile!), await standingOf(second, delta!)];
      await second.app.close();

      expect(logins.map((login) => login.status)).toEqual([200, 200]);
      expect(crossed.map((login) => login.status)).toEqual([401, 401]);
      expect(seen).toEqual([TenantBooksStanding.Unbound, TenantBooksStanding.Unbound]);
      await servedAsBefore(env, [nile!, delta!]);
    });

    it("are never bound when their files changed places and the platform audit cannot be written: sign-in after sign-in and start after start, each code serves the file in its place as it did before binding existed", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile, delta] = await legacy(env, [["nile", SHARED], ["delta", SHARED]]);
      swapped(env, nile!, delta!);
      const once = await boot(env);
      await once.app.close();
      inDatabase(platformDb(env), (sqlite) => sqlite.exec("CREATE TRIGGER audit_down BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT, 'audit down'); END"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const served: number[][] = [];
      for (let start = 0; start < 3; start += 1) {
        const on = await boot(env);
        served.push([
          (await signIn(on, delta!, { under: "nile" })).status,
          (await signIn(on, nile!, { under: "delta" })).status,
          (await signIn(on, nile!)).status,
          (await signIn(on, delta!)).status,
        ]);
        await on.app.close();
      }

      expect(served).toEqual([[200, 200, 401, 401], [200, 200, 401, 401], [200, 200, 401, 401]]);
      expect([boundTo(env, nile!), boundTo(env, delta!)]).toEqual([null, null]);
      expect([rowOf(env, nile!).books_review, rowOf(env, delta!).books_review]).toEqual([null, null]);
      expect(booksAudits(env)).toEqual([]);
    });

    it("are told apart on the console by the company name each file holds: the wrong books are disowned and refused, and the right ones, back in place, are confirmed and served", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile, delta] = await legacy(env, [["nile", SHARED], ["delta", SHARED]]);
      swapped(env, nile!, delta!);

      const second = await boot(env);
      const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
      const disowned = await second.console("POST", `/tenants/${nile!.tenantId}/books/disown`);
      const refused = await signIn(second, delta!, { under: "nile" });
      const stillShown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
      await second.app.close();

      expect(shown.json?.["companyName"]).toBe("شركة delta");
      expect(disowned.status).toBe(200);
      expect(disowned.json?.["books"]).toBe(TenantBooksStanding.Disowned);
      expect(refused).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_DISOWNED", ...NOT_IN_PLACE } });
      expect(stillShown.json).toMatchObject({ standing: TenantBooksStanding.Disowned, companyName: "شركة delta" });
      expect(rowOf(env, nile!).books_review).toBe("disowned");
      expect([boundTo(env, nile!), boundTo(env, delta!)]).toEqual([null, null]);
      expect(auditedOn(env, nile!, "TENANT_BOOKS_DISOWNED")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);

      swapped(env, nile!, delta!);
      const third = await boot(env);
      const stillRefused = await signIn(third, nile!);
      const confirmed = await confirmBooks(third, nile!, adminsIn(env, nile!)[0]!.id);
      const served = await signIn(third, nile!);
      await third.app.close();

      expect(stillRefused.status).toBe(503);
      expect(confirmed.status).toBe(200);
      expect(served.status).toBe(200);
      expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    });
  });

  it("serves the demo company and a reviewer company that share the seed admin's address, each from its own books, unbound", async () => {
    const REVIEW_PIN = "654321";
    const env = harnessEnv({ MEZAN_SEED_DEMO: "1" }, { reviewTenant: { code: "review", pin: REVIEW_PIN } }, harnessDirs);
    const first = await boot(env);
    const list = (await first.send("/api/platform/tenants", { token: first.platformToken })).json as unknown as { tenant: { id: string; code: string } }[];
    const seeded = (code: string, pin: string): Company => ({ code, tenantId: list.find((summary) => summary.tenant.code === code)!.tenant.id, email: SEED_ADMIN_EMAIL, pin });
    const demo = seeded("demo", SEED_ADMIN_PIN);
    const review = seeded("review", REVIEW_PIN);
    await first.app.close();
    const boundWhenSeeded = boundTo(env, demo);
    asWrittenBeforeBinding(env, [demo, review]);

    const second = await boot(env);
    const logins = [await signIn(second, demo), await signIn(second, review)];
    const crossed = [await signIn(second, demo, { under: "review" }), await signIn(second, review, { under: "demo" })];
    const seen = [await standingOf(second, demo), await standingOf(second, review)];
    await second.app.close();

    expect(boundWhenSeeded).toBe(demo.tenantId);
    expect(logins.map((login) => login.status)).toEqual([200, 200]);
    expect(crossed.map((login) => login.status)).toEqual([401, 401]);
    expect(seen).toEqual([TenantBooksStanding.Unbound, TenantBooksStanding.Unbound]);
    await servedAsBefore(env, [demo, review]);
  }, 300_000);

  it("refuses a company registered under the seed admin's own address, whose books hold that account alone and no claim: nobody ever made them theirs", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile", SEED_ADMIN_EMAIL]]);

    const second = await boot(env);
    const login = await signIn(second, nile!);
    const seen = await standingOf(second, nile!);
    await second.app.close();

    expect(login).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
    expect(seen).toBe(TenantBooksStanding.Foreign);
    expect(boundTo(env, nile!)).toBeNull();
  });
});

describe("confirming a company's books from the platform console", () => {
  it("shows the company name and the admins the file holds, binds the books in one audited write, and from then on they are served bound", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    expect((await signIn(second, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
    const confirmed = await confirmBooks(second, nile!, "USER-SECOND");
    const after = await signIn(second, nile!, { email: SECOND_ADMIN });
    await second.app.close();

    expect(shown).toEqual({ status: 200, json: { standing: TenantBooksStanding.Unbound, companyName: "شركة nile", admins: [{ id: "USER-SECOND", nameAr: "مدير ثانٍ", email: SECOND_ADMIN }] } });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json?.["books"]).toBe(TenantBooksStanding.Bound);
    expect(after.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(auditedOn(env, nile!, "TENANT_BOOKS_CONFIRMED")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);
    const third = await boot(env);
    expect(await standingOf(third, nile!)).toBe(TenantBooksStanding.Bound);
    expect((await signIn(third, nile!, { email: SECOND_ADMIN })).status).toBe(200);
  });

  it("records the chosen admin as the owner of a company whose row names none, in the platform's audit and the company's", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    const before = rowOf(env, nile!);
    const confirmed = await confirmBooks(second, nile!, "USER-SECOND");
    await second.app.close();

    expect(before.owner_user_id).toBeNull();
    expect(confirmed.status).toBe(200);
    expect(rowOf(env, nile!)).toEqual({ owner_user_id: "USER-SECOND", owner_email: SECOND_ADMIN, books_review: null });
    expect(inDatabase(platformDb(env), (sqlite) => sqlite.prepare("SELECT owner_record_due FROM tenant WHERE id = ?").get(nile!.tenantId))).toEqual({ owner_record_due: null });
    expect(inDatabase(fileOf(env, nile!), (sqlite) => sqlite.prepare("SELECT entity_id, severity FROM audit_event WHERE action = 'COMPANY_OWNER_ASSIGNED'").all())).toEqual([
      { entity_id: "USER-SECOND", severity: "CRITICAL" },
    ]);
  });

  it("does not change the owner a company's row already names, whichever admin is chosen", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], (company) => WITH_A_SECOND_ADMIN(company).replace(/UPDATE user SET status = 'inactive'[^;]*;/, ""));

    const second = await boot(env);
    expect((await signIn(second, nile!)).status).toBe(200);
    const recorded = rowOf(env, nile!);
    const confirmed = await confirmBooks(second, nile!, "USER-SECOND");
    await second.app.close();

    expect(recorded.owner_user_id).not.toBeNull();
    expect(recorded.owner_user_id).not.toBe("USER-SECOND");
    expect(confirmed.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(rowOf(env, nile!)).toEqual({ ...recorded, books_review: null });
    expect(inDatabase(fileOf(env, nile!), (sqlite) => sqlite.prepare("SELECT entity_id FROM audit_event WHERE action = 'COMPANY_OWNER_ASSIGNED'").all())).toEqual([]);
  });

  it.each([
    ["another company name than the file holds", "USER-SECOND", "شركة أخرى", PlatformRefusalCode.BooksChanged],
    ["no company name where the file holds one", "USER-SECOND", null, PlatformRefusalCode.BooksChanged],
    ["an account that is not an active admin in the file", "USER-ADMIN", "شركة nile", PlatformRefusalCode.OwnerCandidateNotFound],
  ])("refuses a confirmation that names %s, and binds nothing", async (_label, userId, companyName, code) => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    const refused = await confirmBooks(second, nile!, userId, companyName);
    await second.app.close();

    expect(refused.status).toBe(409);
    expect(refused.json?.["error"]).toBe(code);
    expect(boundTo(env, nile!)).toBeNull();
    expect(booksAudits(env)).toEqual([]);
  });

  it("reads the books again inside the write that binds them: books that changed after the console judged them are not bound, and the platform row is left as it was", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    const platform = await createPlatform({ dbPath: platformDb(env) });
    const router = createTenantRouter({ platform, dataDir: env.platformDir, sweepEveryMs: 0 });
    const write = platform.stores.tenants.compareAndSetOwner.bind(platform.stores.tenants);
    vi.spyOn(platform.stores.tenants, "compareAndSetOwner").mockImplementation(async (before, after, sideEffect) => {
      inDatabase(fileOf(env, nile!), (sqlite) => sqlite.exec(`UPDATE tenant_settings SET data = json_set(data, '$.companyName', 'شركة أخرى')`));
      return write(before, after, sideEffect);
    });

    let refused: unknown;
    try {
      refused = await router.confirmBooks({ tenantId: nile!.tenantId, userId: "USER-SECOND", companyName: "شركة nile", actor: "platform:test" }).catch((err: unknown) => err);
    } finally {
      await router.close();
      platform.close();
    }

    expect(refused).toMatchObject({ code: PlatformRefusalCode.BooksChanged });
    expect(boundTo(env, nile!)).toBeNull();
    expect(rowOf(env, nile!)).toMatchObject({ owner_user_id: null, books_review: null });
    expect(booksAudits(env)).toEqual([]);
  });

  it("answers 503 and binds nothing when the audit log cannot record it", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    inDatabase(platformDb(env), (sqlite) =>
      sqlite.exec("CREATE TRIGGER refuse_confirmed BEFORE INSERT ON audit_event WHEN NEW.action = 'TENANT_BOOKS_CONFIRMED' BEGIN SELECT RAISE(ABORT, 'audit down'); END"),
    );

    const second = await boot(env);
    await signIn(second, nile!, { email: SECOND_ADMIN });
    const confirmed = await confirmBooks(second, nile!, "USER-SECOND");
    const served = await signIn(second, nile!, { email: SECOND_ADMIN });
    await second.app.close();

    expect(confirmed.status).toBe(503);
    expect(confirmed.json?.["error"]).toBe("AUDIT_UNAVAILABLE");
    expect(served.status).toBe(200);
    expect(boundTo(env, nile!)).toBeNull();
    expect(rowOf(env, nile!)).toMatchObject({ owner_user_id: null, books_review: null });
  });
});

describe("disowning a company's books from the platform console", () => {
  it("is refused on books bound to the company, which stay served, until they are unbound", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");

    const refused = await first.console("POST", `/tenants/${nile.tenantId}/books/disown`);
    const served = await signIn(first, nile);
    await first.app.close();

    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ error: PlatformRefusalCode.BooksBound, message: "هذه الدفاتر مربوطة بهذه المنشأة. استخدم فك الربط.", messageEn: expect.any(String) });
    expect(served.status).toBe(200);
    expect(rowOf(env, nile).books_review).toBeNull();
    expect(booksAudits(env)).toEqual([]);
  });
});

describe("a mark on a company's books that this build does not know", () => {
  async function marked(env: CloudEnv): Promise<Company> {
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'quarantined' WHERE id = ?").run(nile.tenantId));
    return nile;
  }

  it("is read as disowned: the company is refused in Arabic and the console shows its books disowned", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const nile = await marked(env);

    const second = await boot(env);
    const login = await signIn(second, nile);
    const seen = await standingOf(second, nile);
    await second.app.close();

    expect(login).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_DISOWNED", ...NOT_IN_PLACE } });
    expect(seen).toBe(TenantBooksStanding.Disowned);
  });

  it("is cleared by the console's confirmation, and the company is served again", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const nile = await marked(env);

    const second = await boot(env);
    const confirmed = await confirmBooks(second, nile, adminsIn(env, nile)[0]!.id);
    const login = await signIn(second, nile);
    await second.app.close();

    expect(confirmed.status).toBe(200);
    expect(confirmed.json?.["books"]).toBe(TenantBooksStanding.Bound);
    expect(login.status).toBe(200);
    expect(rowOf(env, nile).books_review).toBeNull();
  });

  it("does not stop the console unbinding the books, which leaves the mark the console writes", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const nile = await marked(env);

    const second = await boot(env);
    const unbound = await second.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" });
    await second.app.close();

    expect(unbound.status).toBe(200);
    expect(boundTo(env, nile)).toBeNull();
    expect(rowOf(env, nile).books_review).toBe("disowned");
    expect(auditedOn(env, nile, "TENANT_BOOKS_UNBOUND")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);
  });
});

describe("unbinding books the console already disowned, after a file bound to the company was put in their place", () => {
  it("takes the binding out and records it, as every unbinding is recorded", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'disowned' WHERE id = ?").run(nile.tenantId));

    const second = await boot(env);
    const unbound = await second.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" });
    await second.app.close();

    expect(unbound.status).toBe(200);
    expect(boundTo(env, nile)).toBeNull();
    expect(auditedOn(env, nile, "TENANT_BOOKS_UNBOUND")).toEqual([{ actor: expect.stringMatching(/^platform:/), severity: "CRITICAL" }]);
  });
});

describe("what the server says about every company's books when it starts", () => {
  it("counts them in one line and names each company whose books are refused, without opening or moving one", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile, delta, sudd] = await legacy(env, [["nile"], ["delta"], ["sudd"]]);
    rmSync(fileOf(env, sudd!));
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => void lines.push(String(line)));

    const second = await boot(env);
    await second.app.booksScanned;
    const seen = [await standingOf(second, nile!), await standingOf(second, delta!), await standingOf(second, sudd!)];
    await second.app.close();
    const books = lines.filter((line) => line.includes("books"));

    expect(books).toEqual(["[cloud] tenant books at start: 3 checked: unbound 2, missing 1", `[cloud] tenant books: "sudd" (${sudd!.tenantId}) is missing`]);
    expect(seen).toEqual([TenantBooksStanding.Unbound, TenantBooksStanding.Unbound, TenantBooksStanding.Missing]);
    expect([existsSync(idFile(env, nile!)), existsSync(codeFile(env, nile!)), boundTo(env, nile!)]).toEqual([false, true, null]);
  });

  it("answers the health check and a tenant's sign-in before it has finished reading the books", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"], ["delta"]]);

    const app = await createCloudApp(env);
    apps.push(app);
    let scanned = false;
    void app.booksScanned.then(() => {
      scanned = true;
    });
    const health = await app.root.fetch(new Request("http://cloud.internal/healthz"));
    const scannedAtHealth = scanned;
    const login = await app.root.fetch(proxiedRequest("/api/auth/login", { method: "POST", tenant: "nile", body: JSON.stringify({ username: nile!.email, pin: nile!.pin }) }));
    await app.booksScanned;

    expect(health.status).toBe(200);
    expect(scannedAtHealth).toBe(false);
    expect(login.status).toBe(200);
    expect(scanned).toBe(true);
  });
});

describe("the standing the console shows for a company's books", () => {
  it("follows the file: books that go missing after the start-up read, and come back, show on the next look at the company", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();

    const second = await boot(env);
    await second.app.booksScanned;
    const atStart = await standingOf(second, nile);
    renameSync(idFile(env, nile), `${idFile(env, nile)}.aside`);
    const detail = await second.console("GET", `/tenants/${nile.tenantId}`);
    const listed = await standingOf(second, nile);
    renameSync(`${idFile(env, nile)}.aside`, idFile(env, nile));
    const back = await second.console("GET", `/tenants/${nile.tenantId}`);
    await second.app.close();

    expect(atStart).toBe(TenantBooksStanding.Bound);
    expect(detail.json?.["books"]).toBe(TenantBooksStanding.Missing);
    expect(listed).toBe(TenantBooksStanding.Missing);
    expect(back.json?.["books"]).toBe(TenantBooksStanding.Bound);
  });

  it("is answered from the last read while the file has not changed, and read again once it has", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]]);
    const platform = await createPlatform({ dbPath: platformDb(env) });
    const reads: string[] = [];
    const driver = createRequire(import.meta.url)("better-sqlite3") as SqliteDriver;
    const counting = function (...args: ConstructorParameters<SqliteDriver>) {
      reads.push(String(args[0]));
      return new driver(...args);
    } as unknown as SqliteDriver;
    const router = createTenantRouter({ platform, dataDir: env.platformDir, sweepEveryMs: 0, connection: { driver: counting } });

    try {
      const tenant = (await platform.stores.tenants.findById(nile!.tenantId))!;
      const first = await router.booksStandingOf(tenant);
      const again = await router.booksStandingOf(tenant);
      const readsWhileUnchanged = reads.length;
      inDatabase(codeFile(env, nile!), (sqlite) => bindTenantDatabase(sqlite, "t-other"));
      const afterChange = await router.booksStandingOf(tenant);

      expect([first, again, afterChange]).toEqual([TenantBooksStanding.Unbound, TenantBooksStanding.Unbound, TenantBooksStanding.Foreign]);
      expect(readsWhileUnchanged).toBe(1);
      expect(reads).toHaveLength(2);
    } finally {
      await router.close();
      platform.close();
    }
  });
});

describe("books the console is asked about while the company is being served on a network filesystem", () => {
  it("are shown and confirmed while the served backend holds the file to itself", async () => {
    const env = harnessEnv({ MEZAN_SQLITE_EXCLUSIVE: "1" }, {}, harnessDirs);
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);

    const second = await boot(env);
    expect((await signIn(second, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
    const confirmed = await confirmBooks(second, nile!, "USER-SECOND");
    const served = await signIn(second, nile!, { email: SECOND_ADMIN });
    await second.app.close();

    expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Unbound, admins: [{ id: "USER-SECOND", email: SECOND_ADMIN }] });
    expect(confirmed.status).toBe(200);
    expect(served.status).toBe(200);
    expect(boundTo(env, nile!)).toBe(nile!.tenantId);
    expect(scratchLeftIn(env)).toEqual([]);
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
    expect(mistyped.json?.["error"]).toBe(PlatformRefusalCode.TenantCodeMismatch);
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
      await on.console("POST", `/tenants/${nile.tenantId}/books/confirm`, { userId: "anyone", companyName: null }, support),
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

const REFUSED: readonly (readonly [string, string, (env: CloudEnv, company: Company) => void])[] = [
  ["missing", "TENANT_DB_FILE_MISSING", (env, company) => rmSync(idFile(env, company))],
  ["bound to another tenant", "TENANT_DB_FILE_FOREIGN", (env, company) => inDatabase(idFile(env, company), (sqlite) => sqlite.exec("UPDATE tenant_binding SET tenant_id = 't-other'"))],
  [
    "unbound and never claimed",
    "TENANT_DB_FILE_FOREIGN",
    (env, company) =>
      inDatabase(idFile(env, company), (sqlite) =>
        sqlite.exec(`DROP TABLE tenant_binding; DELETE FROM user WHERE id <> '${SEED_ADMIN_USER_ID}'; UPDATE tenant_settings SET data = json_remove(data, '$.tenantClaimedAt');`),
      ),
  ],
  ["torn", "TENANT_DB_FILE_UNREADABLE", (env, company) => writeFileSync(idFile(env, company), Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(4080)]))],
  ["disowned", "TENANT_DB_FILE_DISOWNED", (env, company) => inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET books_review = 'disowned' WHERE id = ?").run(company.tenantId))],
];

describe("every door to a company whose books are refused", () => {
  const HAND_OVER_TOKEN = "hand-over-token-for-the-refused-books-table";

  function withAPendingHandOver(env: CloudEnv, company: Company): void {
    const pending = { userId: "USER-SECOND", email: SECOND_ADMIN, requestedBy: "tenant:nile:USER-SECOND", requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), tokenHash: hashHandOverToken(HAND_OVER_TOKEN) };
    inDatabase(platformDb(env), (sqlite) => sqlite.prepare("UPDATE tenant SET pending_owner = ? WHERE id = ?").run(JSON.stringify(pending), company.tenantId));
  }

  it.each(REFUSED)("answers 503 with the reason, in Arabic and English, and never a 500, when they are %s", async (_label, code, damage) => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    for (const suffix of ["-wal", "-shm"]) rmSync(`${idFile(env, nile)}${suffix}`, { force: true });
    withAPendingHandOver(env, nile);
    damage(env, nile);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const second = await boot(env);
    const opening = {
      tenantSignIn: await signIn(second, nile),
      tenantStatus: await second.send("/api/bootstrap/status", { tenant: "nile" }),
      tenantRoute: await second.send("/api/accounts", { tenant: "nile", token: "any-token" }),
      billingSubscription: await second.send("/api/billing/subscription", { tenant: "nile", token: "any-token" }),
      billingCheckout: await second.send("/api/billing/checkout", { method: "POST", tenant: "nile", token: "any-token", body: "{}" }),
      handOverLink: await second.send("/api/signup/owner-handover", { method: "POST", body: JSON.stringify({ token: HAND_OVER_TOKEN }) }),
      ownerCandidates: await second.console("GET", `/tenants/${nile.tenantId}/owner/candidates`),
      ownerAssign: await second.console("POST", `/tenants/${nile.tenantId}/owner`, { userId: "anyone" }),
      ownerConfirmPending: await second.console("POST", `/tenants/${nile.tenantId}/owner/confirm`),
      ownerPinReset: await second.console("POST", `/tenants/${nile.tenantId}/owner-pin/reset`),
    };
    const reading = {
      detail: await second.console("GET", `/tenants/${nile.tenantId}`),
      list: await second.send("/api/platform/tenants", { token: second.platformToken }),
      books: await second.console("GET", `/tenants/${nile.tenantId}/books`),
      health: await second.send("/healthz"),
    };
    const books = {
      confirm: await second.console("POST", `/tenants/${nile.tenantId}/books/confirm`, { userId: "anyone", companyName: null }),
      disown: await second.console("POST", `/tenants/${nile.tenantId}/books/disown`),
      unbind: await second.console("POST", `/tenants/${nile.tenantId}/books/unbind`, { code: "nile" }),
    };
    await second.app.close();

    for (const [door, answer] of Object.entries(opening)) expect({ door, ...answer }).toEqual({ door, status: 503, json: { error: code, ...NOT_IN_PLACE } });
    expect(Object.values(reading).map((answer) => answer.status)).toEqual([200, 200, 200, 200]);
    if (code === "TENANT_DB_FILE_DISOWNED") {
      expect([books.confirm.status, books.disown.status, books.unbind.status]).toEqual([409, 200, 200]);
    } else {
      for (const answer of Object.values(books)) expect(answer).toEqual({ status: 503, json: { error: code, ...NOT_IN_PLACE } });
    }
  });
});

describe("a company whose books are refused", () => {
  const WHEN = [
    ["they were refused when the server started", true],
    ["they went wrong after the server had read them", false],
  ] as const;

  it.each(REFUSED.flatMap(([label, , damage]) => WHEN.map(([when, beforeStart]) => [label, when, damage, beforeStart] as const)))(
    "is shown on its detail page without its books being opened, so nothing is logged as failing, when they are %s and %s",
    async (_label, _when, damage, beforeStart) => {
      const env = harnessEnv({}, {}, harnessDirs);
      const first = await boot(env);
      const nile = await provisioned(first, "nile");
      await first.app.close();
      for (const suffix of ["-wal", "-shm"]) rmSync(`${idFile(env, nile)}${suffix}`, { force: true });
      if (beforeStart) damage(env, nile);
      const second = await boot(env);
      await second.app.booksScanned;
      if (!beforeStart) damage(env, nile);
      const failures = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const detail = await second.console("GET", `/tenants/${nile.tenantId}`);
      await second.app.close();

      expect(detail.status).toBe(200);
      expect(REFUSED_TENANT_BOOKS).toContain(detail.json?.["books"]);
      expect(failures).not.toHaveBeenCalled();
    },
  );
});

describe("a tenant request that arrives while the console is acting on the company's books", () => {
  async function servedUnbound(env: CloudEnv): Promise<{ on: Booted; nile: Company }> {
    const [nile] = await legacy(env, [["nile"]], WITH_A_SECOND_ADMIN);
    const on = await boot(env);
    expect((await signIn(on, nile!, { email: SECOND_ADMIN })).status).toBe(200);
    return { on, nile: nile! };
  }

  const racing = (on: Booted, nile: Company, act: Promise<Answer>) =>
    Promise.all([act, ...Array.from({ length: 8 }, () => on.send("/api/bootstrap/status", { tenant: nile.code }))]);

  it("does not keep disowned books served", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const { on, nile } = await servedUnbound(env);

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
    const { on, nile } = await servedUnbound(env);

    const [confirmed] = await racing(on, nile, confirmBooks(on, nile, "USER-SECOND"));
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

describe("a backend opened on unbound books at the very moment the console confirms them", () => {
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
      openBackend: async (_code, dbPath, _resolvers, _hooks, connection, _mail, books) => {
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
      await router.confirmBooks({ tenantId: nile!.tenantId, userId: "USER-SECOND", companyName: "شركة nile", actor: "platform:test" });
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

function killedWhileWriting(env: CloudEnv, file: string, sql: string): void {
  const script = path.join(env.platformDir, "killed-writer.cjs");
  writeFileSync(script, KILLED_WRITER);
  spawnSync(process.execPath, [script, createRequire(import.meta.url).resolve("better-sqlite3"), file, sql]);
}

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
    killedWhileWriting(env, idFile(env, nile), "UPDATE tenant_binding SET tenant_id = 't-other'");
    const before = fingerprintOf(idFile(env, nile));

    const second = await boot(env);
    const login = await signIn(second, nile);
    await second.app.close();

    expect(Object.keys(before)).toHaveLength(3);
    expect(login).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
    expect(fingerprintOf(idFile(env, nile))).toEqual(before);
    expect(scratchLeftIn(env)).toEqual([]);
  });

  describe("still under the company's code, where an earlier build kept them", () => {
    const BOUND_TO_ANOTHER = "CREATE TABLE tenant_binding (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bound_at TEXT NOT NULL); INSERT INTO tenant_binding VALUES (1, 't-other', '2026-10-12T10:00:00.000Z');";

    it("are refused where they lie: not renamed to the tenant's id, not held, not replayed, and every byte of the three files is as it was", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile] = await legacy(env, [["nile"]]);
      killedWhileWriting(env, codeFile(env, nile!), BOUND_TO_ANOTHER);
      const before = fingerprintOf(codeFile(env, nile!));

      const second = await boot(env);
      await second.app.booksScanned;
      const login = await signIn(second, nile!);
      const reset = await second.console("POST", `/tenants/${nile!.tenantId}/owner-pin/reset`);
      await second.app.close();

      expect(Object.keys(before)).toEqual(["nile.db", "nile.db-shm", "nile.db-wal"]);
      expect(login).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
      expect(reset).toEqual({ status: 503, json: { error: "TENANT_DB_FILE_FOREIGN", ...NOT_IN_PLACE } });
      expect(fingerprintOf(codeFile(env, nile!))).toEqual(before);
      expect(existsSync(idFile(env, nile!))).toBe(false);
      expect(fileOf(env, nile!)).toBe(codeFile(env, nile!));
      expect(scratchLeftIn(env)).toEqual([]);
    });

    it("are moved under the tenant's id and served, the killed writer's last write with them, when they are the company's own", async () => {
      const env = harnessEnv({}, {}, harnessDirs);
      const [nile] = await legacy(env, [["nile"]]);
      killedWhileWriting(env, codeFile(env, nile!), "UPDATE tenant_settings SET data = json_set(data, '$.companyName', 'شركة النيل الجديدة')");

      const second = await boot(env);
      const login = await signIn(second, nile!);
      const shown = await second.console("GET", `/tenants/${nile!.tenantId}/books`);
      await second.app.close();

      expect(login.status).toBe(200);
      expect(shown.json).toMatchObject({ standing: TenantBooksStanding.Unbound, companyName: "شركة النيل الجديدة" });
      expect([existsSync(codeFile(env, nile!)), existsSync(idFile(env, nile!))]).toEqual([false, true]);
      expect(fileOf(env, nile!)).toBe(idFile(env, nile!));
      expect(boundTo(env, nile!)).toBeNull();
    });
  });
});

describe("the private copies a company's books are read from", () => {
  it("are removed, whatever a killed server left of them, before anything else is started", async () => {
    const env = harnessEnv({}, {}, harnessDirs);
    const first = await boot(env);
    const nile = await provisioned(first, "nile");
    await first.app.close();
    const left = path.join(booksScratchDir(env.platformDir), "identity-killed");
    mkdirSync(left, { recursive: true });
    writeFileSync(path.join(left, "books.db"), readFileSync(idFile(env, nile)));

    const second = await boot(env);
    const leftAfterStart = scratchLeftIn(env);
    await second.app.close();

    expect(leftAfterStart).toEqual([]);
  });
});
