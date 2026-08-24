import { createBackend } from "../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Phase 0 gate of `docs/testing-plan.md`: every list surface must return rows.
 *
 * A screen with no rows cannot have its buttons, filters or CRUD proven — there
 * is nothing for them to act on. So an empty surface is reported as a failure
 * here rather than being discovered as an untestable screen three phases later.
 */

const HEADERS = {
  "content-type": "application/json",
  // A real seeded user: /profile returns the CALLER's record, so a made-up id
  // 404s and looks like a broken route.
  "x-user-id": "USER-ADMIN",
  "x-permissions": "*",
  "x-role-codes": "*",
  "x-branch-scope": "*",
  "x-warehouse-scope": "*",
};

/** Surfaces that need query parameters, so a bare GET is correctly rejected. */
const NEEDS_PARAMS = new Set(["/inventory/drift"]);

/** Surfaces that are legitimately empty on a fresh tenant, with the reason. */
const ALLOWED_EMPTY: Record<string, string> = {
  "/hr/leave-requests/me": "the seed admin is not an employee, so their own queue is correctly empty",
  "/notifications": "per-user inbox; the seed admin has received none",
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

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-coverage-"));
  const { app } = await createBackend({ dbPath: join(dir, "coverage.db"), seedDemoData: true });

  const source = await (await import("node:fs/promises")).readFile(new URL("./smoke.ts", import.meta.url), "utf8");
  const paths = [...new Set([...source.matchAll(/"(\/[a-z0-9/_-]+)"/g)].map((m) => m[1]!))].sort();

  const empty: string[] = [];
  const populated: [string, number][] = [];
  const notLists: string[] = [];
  const failed: [string, number][] = [];

  for (const path of paths) {
    if (NEEDS_PARAMS.has(path)) { notLists.push(path); continue; }
    const res = await app.fetch(new Request(`http://coverage${path}`, { headers: HEADERS }));
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
