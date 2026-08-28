import { createBackend } from "../../packages/backend/src/create-backend.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Executable scenarios — `docs/scenarios/*.md` as code.
 *
 * Runs in-process against a freshly seeded backend, through the SAME HTTP
 * routes the UI calls. This exists because driving the browser proved
 * unreliable (background tabs clamp timers to once a minute) while this path
 * found and proved five real defects in an evening.
 *
 * It does NOT replace UI testing — it cannot see layout, focus or contrast.
 * It replaces the part a click-through is worst at: asserting that a document
 * left the books correct.
 */

export type Ctx = Awaited<ReturnType<typeof boot>>;

export interface Res {
  readonly status: number;
  readonly ok: boolean;
  readonly body: any;
}

export async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "mezan-scn-"));
  const { app } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true });

  const passes: string[] = [];
  const failures: string[] = [];
  let current = "";

  function headers(over: Record<string, string> = {}) {
    return {
      "content-type": "application/json",
      "x-user-id": "USER-ADMIN",
      "x-permissions": "*",
      "x-role-codes": "*",
      "x-branch-scope": "*",
      "x-warehouse-scope": "*",
      ...over,
    };
  }

  async function req(method: string, path: string, body?: unknown, over?: Record<string, string>): Promise<Res> {
    const res = await app.fetch(
      new Request(`http://scenario${path}`, {
        method,
        headers: headers(over),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, ok: res.ok, body: parsed };
  }

  /** Rows out of whatever envelope a route happens to use. */
  function rows(body: any): any[] {
    if (Array.isArray(body)) return body;
    for (const k of ["items", "rows", "data", "entries", "requests", "results", "records", "list"]) {
      if (Array.isArray(body?.[k])) return body[k];
    }
    return [];
  }

  const n = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? 0)));

  function check(label: string, condition: boolean, detail = "") {
    if (condition) passes.push(`${current} · ${label}`);
    else failures.push(`${current} · ${label}${detail ? ` — ${detail}` : ""}`);
  }

  /** Asserts two independently-computed figures agree. The highest-yield check there is. */
  function checkEq(label: string, a: number, b: number, tolerance = 0.005) {
    check(label, Math.abs(a - b) <= tolerance, `${a} vs ${b} (differ by ${(a - b).toFixed(6)})`);
  }

  async function invariants() {
    const tb = await req("GET", "/financial-reports/trial-balance");
    const g = tb.body?.grandTotals ?? {};
    const recon = await req("GET", "/reconciliation");
    const list = rows(recon.body).length ? rows(recon.body) : (recon.body?.controls ?? []);
    const diff = (k: string) => {
      const r = list.find((x: any) => x.key === k);
      return r ? n(r.subLedgerBalance) - n(r.glBalance) : NaN;
    };
    return { tb: n(g.debit) - n(g.credit), inventory: diff("inventory"), ap: diff("ap"), ar: diff("ar") };
  }

  /**
   * Runs one scenario and asserts the books afterwards. AR is excluded from the
   * automatic check because D1 keeps it legitimately adrift; a scenario that
   * cares about AR asserts it explicitly.
   */
  async function scenario(name: string, fn: () => Promise<void>) {
    current = name;
    const before = await invariants();
    try {
      await fn();
    } catch (e) {
      failures.push(`${current} · threw — ${String((e as Error).message).slice(0, 160)}`);
    }
    const after = await invariants();
    check("trial balance still balances", Math.abs(after.tb) < 0.005, `debit − credit = ${after.tb}`);
    checkEq("inventory still reconciles to GL 1200", after.inventory, before.inventory);
    checkEq("AP still reconciles", after.ap, before.ap);
  }

  function report(): number {
    console.log(`\n${passes.length} passed, ${failures.length} failed`);
    if (failures.length) {
      console.log("\nfailures:");
      for (const f of failures) console.log("  ✖ " + f);
      console.log("\nEach failure is either a product defect or a wrong assertion. Work out which");
      console.log("before changing anything — and never weaken an assertion to get green.");
      return 1;
    }
    console.log("✔ every assertion held");
    return 0;
  }

  return { app, req, rows, n, check, checkEq, scenario, invariants, report, passes, failures };
}
