import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createEntitlements, getPermission, isModuleLicensed, type Entitlements } from "@mezan/domain";
import { createBackend, type BackendHandle } from "./create-backend.js";

const CORE = createEntitlements({ plan: "core", activeModules: ["sales", "purchases", "inventory", "accounting", "treasury"], features: {}, seats: 5, expiresAt: null });
const OWNER = { nameAr: "صاحب المنشأة", nameEn: null, email: "owner@shop.example", password: "pw-246810", companyName: "متجر الاختبار" };

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "mezan-standard-roles-"));
  dirs.push(dir);
  return join(dir, "mezan.db");
}

const open = (dbPath: string, licence: () => Entitlements | null): Promise<BackendHandle> =>
  createBackend({ dbPath, resolveEntitlements: () => licence() ?? CORE, standardRoles: { resolveEntitlements: licence } });

async function call(backend: BackendHandle, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await backend.app.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function claim(backend: BackendHandle): Promise<string> {
  const claimed = await call(backend, "POST", "/bootstrap/admin", undefined, OWNER);
  expect(claimed.status).toBe(201);
  return claimed.body.token as string;
}

describe("a fresh on-premises install is given the standard roles, and nothing else", () => {
  it("before the owner exists there is only the system role", async () => {
    const backend = await open(":memory:", () => null);
    expect((await call(backend, "GET", "/bootstrap/status")).body).toMatchObject({ claimed: false, roles: 1 });
    backend.close();
  });

  it("claiming the install adds the roles a shop separates, each holding only what the licence carries", async () => {
    const backend = await open(":memory:", () => CORE);
    const token = await claim(backend);

    const roles = (await call(backend, "GET", "/roles", token)).body as { id: string; code: string; name: string; permissions: string[]; isSystem: boolean }[];
    const standard = roles.filter((role) => !role.isSystem);
    expect(standard.map((role) => role.code)).toEqual(expect.arrayContaining(["ACCOUNTANT", "TREASURY_CASHIER", "WAREHOUSE_KEEPER", "SALES_REP", "PURCHASING_OFFICER"]));
    expect(standard.map((role) => role.code)).not.toEqual(expect.arrayContaining(["HR_OFFICER"]));
    for (const role of standard) {
      expect(role.name).toMatch(/[؀-ۿ]/);
      expect(role.permissions.length).toBeGreaterThan(1);
      const unlicensed = role.permissions.filter((code) => {
        const moduleId = getPermission(code)?.module;
        return moduleId !== undefined && !isModuleLicensed(moduleId, CORE);
      });
      expect(unlicensed).toEqual([]);
    }
    expect((await call(backend, "GET", "/bootstrap/status", token)).body.roles).toBe(roles.length);

    for (const path of ["/customers?page=1&pageSize=5", "/sales-invoices?page=1&pageSize=5", "/items?page=1&pageSize=5"]) {
      const listed = (await call(backend, "GET", path, token)).body;
      expect(Array.isArray(listed) ? listed : (listed.items ?? listed.rows)).toEqual([]);
    }
    backend.close();
  });

  it("so the first cashier can be added without authoring a role first", async () => {
    const backend = await open(":memory:", () => CORE);
    const token = await claim(backend);
    const roles = (await call(backend, "GET", "/roles", token)).body as { id: string; code: string }[];
    const cashier = roles.find((role) => role.code === "TREASURY_CASHIER");

    const created = await call(backend, "POST", "/users", token, {
      nameAr: "أمين الخزنة",
      nameEn: null,
      email: "cashier@shop.example",
      phone: null,
      roleId: cashier?.id,
      isCompanyAdmin: false,
      employeeId: null,
      branchScope: "*",
      warehouseScope: "*",
      status: "active",
      password: "Mezan-cashier-1",
    });

    expect(created.body?.error).toBeUndefined();
    expect(created.status).toBe(201);
    backend.close();
  });

  it("an install claimed before its licence arrived gets them on the next start, once — roles the owner then deletes stay deleted", async () => {
    const dbPath = freshFile();
    let licence: Entitlements | null = null;
    const first = await open(dbPath, () => licence);
    const token = await claim(first);
    expect(((await call(first, "GET", "/roles", token)).body as unknown[]).length).toBe(1);
    first.close();

    licence = CORE;
    const second = await open(dbPath, () => licence);
    const signedIn = (await call(second, "POST", "/auth/login", undefined, { username: OWNER.email, password: OWNER.password })).body.token as string;
    const offered = (await call(second, "GET", "/roles", signedIn)).body as { id: string; isSystem: boolean }[];
    expect(offered.length).toBeGreaterThan(5);
    for (const role of offered.filter((entry) => !entry.isSystem)) expect((await call(second, "DELETE", `/roles/${role.id}`, signedIn)).status).toBeLessThan(300);
    second.close();

    const third = await open(dbPath, () => licence);
    const again = (await call(third, "POST", "/auth/login", undefined, { username: OWNER.email, password: OWNER.password })).body.token as string;
    expect(((await call(third, "GET", "/roles", again)).body as unknown[]).length).toBe(1);
    third.close();
  }, 120_000);

  it("an edition that does not ask for them — the cloud, the demo — is given none", async () => {
    const backend = await createBackend({ dbPath: ":memory:", resolveEntitlements: () => CORE });
    const token = await claim(backend);
    expect(((await call(backend, "GET", "/roles", token)).body as unknown[]).length).toBe(1);
    backend.close();
  });
});
