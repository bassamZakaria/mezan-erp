import { describe, it, expect, afterEach } from "vitest";
import { createSqlitePosStore, openSqliteConnection, withSqliteTransaction } from "@mezan/persistence";
import type {
  AuditSink,
  BranchRepository,
  PosPaymentMethod,
  PosPaymentMethodRepository,
  TreasuryAccountRepository,
  WarehouseRepository,
} from "@mezan/domain";
import { createPosTerminalsRoutes, type PosTerminalsRoutesDeps } from "./terminals-routes.js";
import { insecureHeaderAuthContextResolver } from "../permission-gate.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

const BRANCH = "br-1";
const WAREHOUSE = "wh-1";
const DRAWER = "tr-1";
const METHOD = "pm-cash";

const CASH_METHOD: PosPaymentMethod = {
  id: METHOD,
  code: "CASH",
  nameAr: "نقدي",
  nameEn: "Cash",
  kind: "cash",
  accountType: "cash",
  defaultTreasuryAccountId: null,
  builtIn: true,
  active: true,
};

const FAILING_AUDIT: AuditSink = {
  async append() {
    throw new Error("audit sink is down");
  },
  async query() {
    return [];
  },
};

function newApp(audit: AuditSink, withTransactor: boolean) {
  const { sqlite } = openSqliteConnection(":memory:");
  const store = createSqlitePosStore(sqlite);
  closers.push(store, { close: () => sqlite.close() });
  const deps: PosTerminalsRoutesDeps = {
    terminals: store.terminals,
    paymentMethods: { list: async () => [CASH_METHOD] } as unknown as PosPaymentMethodRepository,
    branches: { findById: async (id: string) => (id === BRANCH ? { id: BRANCH } : null) } as unknown as BranchRepository,
    warehouses: {
      findById: async (id: string) => (id === WAREHOUSE ? { id: WAREHOUSE, branchId: BRANCH, active: true } : null),
    } as unknown as WarehouseRepository,
    treasuryAccounts: {
      list: async () => [{ id: DRAWER, type: "cash", branchId: BRANCH, status: "active" }],
    } as unknown as TreasuryAccountRepository,
    branchEtaDevices: async () => new Map(),
    audit,
    ...(withTransactor ? { transactor: { run: <T,>(fn: () => Promise<T>) => withSqliteTransaction(sqlite, fn) } } : {}),
  };
  return { app: createPosTerminalsRoutes(deps, insecureHeaderAuthContextResolver), terminals: store.terminals };
}

function createRequest() {
  return new Request("http://local/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-permissions": "pos.terminal.manage" },
    body: JSON.stringify({
      code: "T1",
      name: "كاشير ١",
      branchId: BRANCH,
      warehouseId: WAREHOUSE,
      drawerTreasuryAccountId: DRAWER,
      methods: [{ methodId: METHOD, treasuryAccountId: null }],
      defaultMethodId: METHOD,
      etaDeviceSerial: "SER-123",
      etaPosClientSecret: "s3cret",
    }),
  });
}

describe("POS terminals — the audit row rides in the config write's transaction (D298)", () => {
  it("without a transactor the till and its ETA secret persist even though the audit append failed", async () => {
    const { app, terminals } = newApp(FAILING_AUDIT, false);
    const res = await app.fetch(createRequest());
    expect(res.status).toBe(500);
    expect(await terminals.findByCode("T1")).not.toBeNull();
  });

  it("with a transactor the till rolls back with the audit row", async () => {
    const { app, terminals } = newApp(FAILING_AUDIT, true);
    const res = await app.fetch(createRequest());
    expect(res.status).toBe(500);
    expect(await terminals.findByCode("T1")).toBeNull();
  });

  it("a healthy audit still commits the till", async () => {
    const events: unknown[] = [];
    const audit: AuditSink = {
      async append(event) {
        events.push(event);
      },
      async query() {
        return [];
      },
    };
    const { app, terminals } = newApp(audit, true);
    const res = await app.fetch(createRequest());
    expect(res.status).toBe(201);
    expect(await terminals.findByCode("T1")).not.toBeNull();
    expect(events).toHaveLength(1);
  });
});
