import type { App } from "@mezan/api";

/**
 * Shared plumbing for the seed modules.
 *
 * SEED PROFILE FOR TESTS AND LOCAL DEVELOPMENT ONLY — see `../demo-seed.ts`.
 *
 * Every module enters data through the SAME HTTP routes a user's clicks hit,
 * so what it produces is real: documents are confirmed through their services,
 * stock moves at the real weighted-average cost, and the ledger receives
 * balanced postings. Nothing here is a fixture the UI reads directly.
 */

export const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-user-id": "SEED-ADMIN",
  "x-permissions": "*",
  "x-role-codes": "*",
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

export const BRANCH_ID = "BR-MAIN";
export const WAREHOUSE_ID = "WH-MAIN";
export const VAT_PERCENT = 14;

/** Standard chart-of-accounts ids from `packages/domain/src/accounts/coa-template.ts`. */
export const ACCOUNTS = {
  receivable: "1105",
  inventory: "1200",
  cash: "1300-1",
  bank: "1310",
  inputVat: "1400",
  payable: "2100",
  outputVat: "2200",
  revenue: "4100",
  cogs: "5100",
} as const;

/** Ids the core profile creates, so a module can reference them without re-deriving. */
export const CORE = {
  customers: ["CUST-DEMO-1", "CUST-DEMO-2", "CUST-DEMO-3"],
  suppliers: ["SUPP-DEMO-1", "SUPP-DEMO-2"],
  /** Plain stock items. */
  items: ["ITEM-DEMO-1", "ITEM-DEMO-2", "ITEM-DEMO-3", "ITEM-DEMO-4"],
  /** Manufacturable, each with a BOM. */
  manufacturedItems: ["ITEM-DEMO-5", "ITEM-DEMO-6"],
  /** Batch- and expiry-tracked. */
  perishableItems: ["ITEM-DEMO-7", "ITEM-DEMO-8"],
  boms: ["BOM-DEMO-1", "BOM-DEMO-2"],
  employees: ["EMP-DEMO-1", "EMP-DEMO-2"],
  costCenters: ["CC-DEMO-1", "CC-DEMO-2"],
  treasuryAccounts: ["TR-DEMO-CASH", "TR-DEMO-BANK"],
  salesInvoices: ["INV-DEMO-1", "INV-DEMO-2", "INV-DEMO-3", "INV-DEMO-4", "INV-DEMO-5"],
  purchaseInvoices: ["PI-DEMO-1", "PI-DEMO-2", "PI-DEMO-3", "PI-DEMO-4", "PI-DEMO-5"],
} as const;

export async function call(app: App, method: string, path: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers: ADMIN_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/**
 * A seeded step must not fail silently: a route that changed shape would
 * otherwise leave a half-populated tenant that looks like a product bug.
 */
export async function step(app: App, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await call(app, method, path, body);
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

/**
 * For routes that only mount under an optional dependency. A module may skip
 * such a surface, but must never swallow a real failure — only a 404 from an
 * unmounted route counts as "not available here".
 */
export async function stepIfMounted(app: App, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await call(app, method, path, body);
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

/**
 * Refuses to seed anywhere that is not a local or test environment.
 *
 * `createBackend` already gates on an explicit `seedDemoData` flag that only
 * apps/server sets, and only from `MEZAN_SEED_DEMO=1`. This is the second lock:
 * the seeder checks its own preconditions rather than trusting its caller, so a
 * flag flipped by mistake in a shipped edition still cannot invent rows in
 * someone's books.
 *
 * Throwing is deliberate. Returning quietly would let a misconfigured
 * deployment look like it had seeded when it had not.
 */
export function assertLocalOrTest(): void {
  const env = process.env.NODE_ENV;
  if (env === "production") {
    throw new Error(
      "[demo-seed] refusing to seed: NODE_ENV=production. This profile is for local development and tests only.",
    );
  }
  // A packaged desktop build never sets MEZAN_SEED_DEMO and never passes
  // seedDemoData, but if some future caller does, it must be running a test
  // runner or have opted in explicitly by environment.
  const optedIn = process.env.MEZAN_SEED_DEMO === "1";
  const underTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test" || env === undefined;
  if (!optedIn && !underTest) {
    throw new Error(
      `[demo-seed] refusing to seed: NODE_ENV=${env} with MEZAN_SEED_DEMO unset. Set MEZAN_SEED_DEMO=1 to seed a local database.`,
    );
  }
}
