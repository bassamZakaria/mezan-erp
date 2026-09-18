import { createBackend } from "../../packages/backend/src/create-backend.js";
import { ALL_SCOPE, createEntitlements, MODULE_CATALOG } from "../../packages/domain/src/index.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Executable scenarios — `docs/TESTING.md *.md` as code.
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
  // The demo seed creates more accounts than the platform default's 10 seats
  // allow (A3's SEAT_LIMIT_REACHED); this stand-in resolver keeps every cap off.
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
  const { app, sessions } = await createBackend({ dbPath: join(dir, "s.db"), seedDemoData: true, resolveEntitlements });

  /**
   * A scenario acts as an identity by minting a session for it, not by writing
   * `x-user-id` — that header stopped being believed when the server started
   * resolving callers from its own registry, which is the whole point of the
   * change. The `over` shape stays the same so every existing scenario reads
   * unchanged: the auth-ish keys are translated here into a real token.
   */
  const tokens = new Map<string, string>();
  /**
   * The scope a minted session GRANTS.
   *
   * Every identity used to be minted with `ALL_SCOPE` on both dimensions, and
   * that is why this suite could not have found the scope-escalation defect: a
   * caller who already holds every branch cannot widen to every branch, so the
   * guard was never asked the question. A scenario that needs a genuinely
   * narrow principal passes `x-branch-grant` / `x-warehouse-grant`.
   *
   * Note the difference from `x-branch-scope`, which the shell's branch
   * selector sends: that NARROWS a request within an existing grant and may
   * never widen it. This one is the grant itself.
   */
  function scopeOf(raw: string | undefined): typeof ALL_SCOPE | string[] {
    if (!raw || raw === "*") return ALL_SCOPE;
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  function tokenFor(
    userId: string,
    permissions: string,
    roleCodes: string,
    branchGrant?: string,
    warehouseGrant?: string,
  ): string {
    const key = `${userId}|${permissions}|${roleCodes}|${branchGrant ?? "*"}|${warehouseGrant ?? "*"}`;
    let token = tokens.get(key);
    if (!token) {
      token = sessions.issue({
        userId,
        permissions: permissions.split(",").map((s) => s.trim()).filter(Boolean),
        roleCode: roleCodes.split(",").map((s) => s.trim()).filter(Boolean)[0] ?? null,
        branchScope: scopeOf(branchGrant),
        warehouseScope: scopeOf(warehouseGrant),
      });
      tokens.set(key, token);
    }
    return token;
  }

  const passes: string[] = [];
  const failures: string[] = [];
  let current = "";

  function headers(over: Record<string, string> = {}) {
    const {
      "x-user-id": userId = "USER-ADMIN",
      "x-permissions": permissions = "*",
      "x-role-codes": roleCodes = permissions === "*" ? "*" : "",
      "x-role-code": legacyRole,
      "x-branch-grant": branchGrant,
      "x-warehouse-grant": warehouseGrant,
      ...rest
    } = over;
    return {
      "content-type": "application/json",
      authorization: `Bearer ${tokenFor(userId, permissions, roleCodes || legacyRole || "", branchGrant, warehouseGrant)}`,
      "x-branch-scope": branchGrant ?? "*",
      "x-warehouse-scope": warehouseGrant ?? "*",
      ...rest,
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
    for (const k of ["items", "rows", "data", "entries", "events", "requests", "results", "records", "list"]) {
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

  /**
   * READS A WHOLE LIST, not the first page of one.
   *
   * Every list query carries `pageSize` with a compiled-in default of 25
   * (packages/contracts/src/paging.ts, Q-8) — omitting it used to mean "every
   * row ever", which is what `GET /gl/journal-entries` answered with. So a bare
   * GET is one page now, and a scenario that compares a whole-set count against
   * "the rows the list returned" has to walk the pages or it is asking a
   * different question than the one it reads.
   *
   * A route with no paging simply answers the same body each time and the walk
   * stops after the first page.
   */
  async function allRows(path: string, over?: Record<string, string>): Promise<any[]> {
    const sep = path.includes("?") ? "&" : "?";
    const out: any[] = [];
    let previous = "";
    for (let page = 1; page <= 200; page += 1) {
      const res = await req("GET", `${path}${sep}page=${page}&pageSize=200`, undefined, over);
      if (!res.ok) return out;
      const batch = rows(res.body);
      // An unpaged route ignores the query and repeats itself; taking that as a
      // second page would count every row twice.
      const fingerprint = JSON.stringify(batch.map((r: any) => r?.id ?? r));
      if (page > 1 && fingerprint === previous) break;
      previous = fingerprint;
      out.push(...batch);
      if (batch.length < 200) break;
    }
    return out;
  }

  return { app, sessions, req, rows, allRows, n, check, checkEq, scenario, invariants, report, passes, failures };
}
