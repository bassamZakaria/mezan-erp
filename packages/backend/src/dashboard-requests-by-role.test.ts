import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, DASHBOARD_REQUESTS, DashboardRequest, MODULE_CATALOG, can, createAuthContext, createEntitlements, mayAskDashboard, type Entitlements } from "@mezan/domain";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

interface SeededRole {
  readonly code: string;
  readonly permissions: string[];
}

const PROBE_QUERY: Partial<Record<DashboardRequest, string>> = {
  [DashboardRequest.IncomeStatement]: "?periodFrom=2026-01-01&periodTo=2026-12-31",
  [DashboardRequest.VatReturn]: "?periodFrom=2026-01-01&periodTo=2026-12-31",
  [DashboardRequest.TopProducts]: "?dateFrom=2026-01-01&dateTo=2026-12-31&limit=5",
};

const EVERY_MODULE = createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });

let plan: Entitlements = EVERY_MODULE;
let world: SeededWorld;
let roles: SeededRole[];

beforeAll(async () => {
  world = await seededWorld({ resolveEntitlements: () => plan });
  roles = (await world.request("GET", "/roles")).body as unknown as SeededRole[];
}, 900_000);

afterAll(() => world?.close());

async function statusAs(role: SeededRole, request: DashboardRequest): Promise<number> {
  const token = world.backend.sessions.issue({ userId: `dash-${role.code}`, permissions: role.permissions, roleCode: role.code, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const url = `http://local${DASHBOARD_REQUESTS[request].path}${PROBE_QUERY[request] ?? ""}`;
  return (await world.backend.app.fetch(new Request(url, { headers: { authorization: `Bearer ${token}` } }))).status;
}

function planned(role: SeededRole, request: DashboardRequest, entitlements: Entitlements): boolean {
  const auth = createAuthContext({ userId: role.code, permissions: role.permissions, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  return mayAskDashboard(request, (permission) => can(auth, permission), entitlements);
}

describe("what the dashboard asks for is what the session's role may read", () => {
  it("the demo tenant seeds the roles this walks, restricted ones among them", () => {
    expect(roles.length).toBeGreaterThanOrEqual(15);
    expect(roles.some((role) => !role.permissions.includes("*"))).toBe(true);
  });

  it("for every seeded role, every request the dashboard would send answers 200, and every one it withholds would have been refused", async () => {
    const notServed: string[] = [];
    const withheldNeedlessly: string[] = [];
    for (const role of roles) {
      for (const request of Object.values(DashboardRequest)) {
        const status = await statusAs(role, request);
        if (planned(role, request, EVERY_MODULE) && status !== 200) notServed.push(`${role.code} ${request} ${status}`);
        if (!planned(role, request, EVERY_MODULE) && status !== 403) withheldNeedlessly.push(`${role.code} ${request} ${status}`);
      }
    }
    expect(notServed).toEqual([]);
    expect(withheldNeedlessly).toEqual([]);
  }, 900_000);

  it("every seeded role is left with at least one dashboard request, so no role opens an empty home screen", () => {
    const empty = roles.filter((role) => !Object.values(DashboardRequest).some((request) => planned(role, request, EVERY_MODULE))).map((role) => role.code);
    expect(empty).toEqual([]);
  });

  it("a plan without a module withholds that module's requests, and the routes refuse them", async () => {
    const without = (module: string) => createEntitlements({ plan: "NARROW", activeModules: MODULE_CATALOG.filter((id) => id !== module), features: {}, seats: 50, expiresAt: null });
    const owner: SeededRole = { code: "OWNER", permissions: ["*"] };
    const cases: readonly (readonly [string, DashboardRequest])[] = [
      ["treasury", DashboardRequest.TreasuryBalances],
      ["treasury", DashboardRequest.VoucherCounts],
      ["sales", DashboardRequest.CustomerAging],
      ["sales", DashboardRequest.SalesInvoices],
      ["purchases", DashboardRequest.SupplierAging],
      ["inventory", DashboardRequest.StockLevels],
      ["accounting", DashboardRequest.Summary],
      ["accounting", DashboardRequest.IncomeStatement],
    ];
    try {
      for (const [module, request] of cases) {
        plan = without(module);
        expect(planned(owner, request, plan), `${request} without ${module}`).toBe(false);
        expect(await statusAs(owner, request), `${request} without ${module}`).toBe(403);
      }
    } finally {
      plan = EVERY_MODULE;
    }
  });

  it("a module the tenant once held still answers its dashboard reads, and the dashboard still asks", async () => {
    const owner: SeededRole = { code: "OWNER", permissions: ["*"] };
    try {
      plan = createEntitlements({ plan: "LAPSED", activeModules: MODULE_CATALOG.filter((id) => id !== "treasury"), readOnlyModules: ["treasury"], features: {}, seats: 50, expiresAt: null });
      expect(planned(owner, DashboardRequest.TreasuryBalances, plan)).toBe(true);
      expect(await statusAs(owner, DashboardRequest.TreasuryBalances)).toBe(200);
    } finally {
      plan = EVERY_MODULE;
    }
  });
});
