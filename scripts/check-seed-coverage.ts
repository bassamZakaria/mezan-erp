import { createBackend } from "../packages/backend/src/create-backend.js";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PIN } from "../packages/backend/src/seed.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 0 gate of `docs/TESTING.md §2`: every list surface must return rows.
 *
 * A screen with no rows cannot have its buttons, filters or CRUD proven — there
 * is nothing for them to act on. So an empty surface is reported as a failure
 * here rather than being discovered as an untestable screen three phases later.
 */

/**
 * Coverage signs in as the seeded admin, the way a user does — declaring
 * `x-permissions: "*"` stopped being believed once the server started
 * resolving callers from its own sessions. `/profile` returns the CALLER's
 * record, so the session has to belong to a real seeded user.
 */
const SCOPE_HEADERS = {
  "content-type": "application/json",
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

async function signIn(app: { fetch: (r: Request) => Promise<Response> }): Promise<Record<string, string>> {
  const res = await app.fetch(
    new Request("http://coverage/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: SEED_ADMIN_EMAIL, pin: SEED_ADMIN_PIN }),
    }),
  );
  if (!res.ok) throw new Error(`coverage could not sign in: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const session = (await res.json()) as { token: string };
  return { ...SCOPE_HEADERS, authorization: `Bearer ${session.token}` };
}

/** Surfaces that need query parameters, so a bare GET is correctly rejected. */
const NEEDS_PARAMS = new Set(["/inventory/drift"]);

/** Surfaces that are legitimately empty on a fresh tenant, with the reason. */
const ALLOWED_EMPTY: Record<string, string> = {
  "/hr/leave-requests/me": "the seed admin is not an employee, so their own queue is correctly empty",
  "/notifications": "per-user inbox; the seed admin has received none",
  "/contracting/reports/boq-overrun":
    "an EXCEPTIONS report: certifying beyond the contracted quantity is refused at measure, so a healthy " +
    "tenant has no row; it exists to prove that refusal and to catch imported history",
  "/contracting/reports/late-variation-approvals":
    "an EXCEPTIONS report: a certificate line that leans on a variation approved after execution is " +
    "refused, so an empty table is the clean control; the rule is printed on the screen",
  "/reports/inventory/drift":
    "an EXCEPTIONS report: it lists only positions whose cache disagrees with a replay of the ledger. " +
    "It was populated while landed costs bypassed the ledger (D36); now that they do not, an empty " +
    "drift report is the correct reading of a healthy tenant, and a populated one is the finding",
};

function countOf(body: unknown): number | null {
  if (Array.isArray(body)) return body.length;
  if (body && typeof body === "object") {
    for (const k of ["items", "rows", "data", "entries", "requests", "results", "records", "list"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.length;
    }
  }
  return null;
}

/**
 * THIS CHECK MUST NOT DEPEND ON TODAY'S DATE.
 *
 * A period-scoped report defaults to `firstOfMonth(today) … today`
 * (packages/api/src/reports-routes.ts). The demo seed writes its history as
 * fixed date literals — roughly 180 of them, spread across
 * packages/backend/src/demo-seed/, most of them in August 2026. So a bare GET
 * asks "did this tenant trade during the current CALENDAR month", which is a
 * fact about the clock, not about the seed.
 *
 * That is exactly what went wrong: eight report surfaces reported empty and the
 * job went red the moment the month rolled over, with nothing about the seed or
 * the reports having changed. The reports are healthy — the same request over
 * an August window returns rows.
 *
 * So period reports are asked over a window that spans the seeded history. What
 * this file is for is "the seed populates every surface"; leaving the window at
 * the default tested the date instead, and would go red again every 1st.
 *
 * NOT A FIX FOR THE UNDERLYING WART: a demo tenant whose newest document is
 * weeks old still opens with blank sales reports for anyone who runs it after
 * the month turns. Making the seed relative to the clock is the real answer and
 * is a change to ~180 literals plus every scenario expectation built on them.
 */
const FROM = "2020-01-01";
const TO = "2099-12-31";

function windowFor(path: string): string {
  // The two families spell the same idea differently: `/reports/*` takes
  // dateFrom/dateTo, `/financial-reports/*` takes periodFrom/periodTo. Sending
  // the wrong pair is silently ignored and leaves the default window in place,
  // which is how /financial-reports/vat-return stayed empty after the rest were
  // fixed.
  if (path.startsWith("/financial-reports/")) return `?periodFrom=${FROM}&periodTo=${TO}`;
  if (path.startsWith("/reports/")) return `?dateFrom=${FROM}&dateTo=${TO}`;
  return "";
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-coverage-"));
  const { app } = await createBackend({ dbPath: join(dir, "coverage.db"), seedDemoData: true });
  const HEADERS = await signIn(app);

  const source = await (await import("node:fs/promises")).readFile(new URL("./smoke.ts", import.meta.url), "utf8");
  const paths = [...new Set([...source.matchAll(/"(\/[a-z0-9/_-]+)"/g)].map((m) => m[1]!))].sort();

  const empty: string[] = [];
  const populated: [string, number][] = [];
  const notLists: string[] = [];
  const failed: [string, number][] = [];

  for (const path of paths) {
    if (NEEDS_PARAMS.has(path)) { notLists.push(path); continue; }
    const res = await app.fetch(new Request(`http://coverage${path}${windowFor(path)}`, { headers: HEADERS }));
    if (!res.ok) { failed.push([path, res.status]); continue; }
    const n = countOf(await res.json().catch(() => null));
    if (n === null) notLists.push(path);
    else if (n === 0) empty.push(path);
    else populated.push([path, n]);
  }

  const unexplained = empty.filter((p) => !(p in ALLOWED_EMPTY));

  console.log(`populated: ${populated.length}   empty: ${empty.length}   non-list: ${notLists.length}   failed: ${failed.length}`);
  if (failed.length) {
    console.log("\nrequests that did not succeed:");
    for (const [p, s] of failed) console.log(`  ${s}  ${p}`);
  }
  if (empty.length) {
    console.log("\nempty surfaces:");
    for (const p of empty) console.log(`  ${p}${p in ALLOWED_EMPTY ? `   — allowed: ${ALLOWED_EMPTY[p]}` : ""}`);
  }

  if (unexplained.length || failed.length) {
    console.error(`\n✖ ${unexplained.length} surface(s) return no rows and ${failed.length} did not succeed.`);
    console.error("  Seed them in packages/backend/src/demo-seed/ — testing a screen with no rows proves nothing.");
    process.exit(1);
  }
  console.log("\n✔ every list surface returns rows; the app is testable");
}

await main();
