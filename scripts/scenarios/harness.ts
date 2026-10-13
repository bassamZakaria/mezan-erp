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
  const dbPath = join(dir, "s.db");
  // The demo seed creates more accounts than the platform default's 10 seats
  // allow (A3's SEAT_LIMIT_REACHED); this stand-in resolver keeps every cap off.
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null });
  const { app, sessions } = await createBackend({ dbPath, seedDemoData: true, resolveEntitlements });

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

  /** A decimal amount as integer micro-units, so two figures compare exactly rather than within a float's noise. */
  function scaled(v: unknown): bigint | null {
    if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.round(v * 1e6)) : null;
    const text = String(v ?? "").trim();
    const m = /^(-)?(\d+)(?:\.(\d{0,6}))?$/.exec(text);
    if (!m) return null;
    const units = BigInt(m[2]!) * 1_000_000n + BigInt((m[3] ?? "").padEnd(6, "0"));
    return m[1] ? -units : units;
  }

  async function goodsReceivedNotInvoicedGap(): Promise<bigint | null> {
    const receipts = await req("GET", "/purchases/receipts?status=confirmed&pageSize=10000");
    const ledger = await req("GET", "/gl/accounts/2120/ledger");
    const list = rows(receipts.body);
    const credit = scaled(ledger.body?.balance?.credit);
    const debit = scaled(ledger.body?.balance?.debit);
    if (receipts.status !== 200 || credit === null || debit === null) return null;
    let accrued = 0n;
    for (const receipt of list) {
      if (receipt.status !== "confirmed") continue;
      for (const line of receipt.lines ?? []) {
        const qty = scaled(line.remainingQty);
        const unitCost = scaled(line.unitCost);
        if (qty === null || unitCost === null) return null;
        accrued += (qty * unitCost) / 1_000_000n;
      }
    }
    return accrued - (credit - debit);
  }

  async function invariants() {
    const tb = await req("GET", "/financial-reports/trial-balance");
    const g = tb.body?.grandTotals ?? {};
    const recon = await req("GET", "/reconciliation");
    const list = rows(recon.body).length ? rows(recon.body) : (recon.body?.controls ?? []);
    const diff = (k: string): bigint | null => {
      const r = list.find((x: any) => x.key === k);
      const sub = r ? scaled(r.subLedgerBalance) : null;
      const gl = r ? scaled(r.glBalance) : null;
      return sub === null || gl === null ? null : sub - gl;
    };
    const debit = scaled(g.debit);
    const credit = scaled(g.credit);
    const exact = {
      tb: debit === null || credit === null ? null : debit - credit,
      inventory: diff("inventory"),
      ap: diff("ap"),
      ar: diff("ar"),
      grni: await goodsReceivedNotInvoicedGap(),
      fxResidue: scaled(recon.body?.foreignResidue?.total),
      stockLedgerDates: typeof recon.body?.stockLedgerDates?.count === "number" ? BigInt(recon.body.stockLedgerDates.count) : null,
    };
    const asNumber = (x: bigint | null) => (x === null ? NaN : Number(x) / 1e6);
    return { tb: asNumber(exact.tb), inventory: asNumber(exact.inventory), ap: asNumber(exact.ap), ar: asNumber(exact.ar), grni: asNumber(exact.grni), fxResidue: asNumber(exact.fxResidue), stockLedgerDates: exact.stockLedgerDates === null ? NaN : Number(exact.stockLedgerDates), exact };
  }

  /**
   * Runs one scenario and asserts the books afterwards: the trial balance
   * balances and every sub-ledger — stock, AP and AR — sits exactly where it
   * sat before, to the micro-unit. A tolerance here once hid a 0.000002 stock
   * residue (D206), and leaving AR out hid a 2,280.00 one (D205).
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
    const same = (k: "inventory" | "ap" | "ar") => after.exact[k] !== null && after.exact[k] === before.exact[k];
    const moved = (k: "inventory" | "ap" | "ar") => `${before[k].toFixed(6)} → ${after[k].toFixed(6)}`;
    check("trial balance still balances", after.exact.tb === 0n, `debit − credit = ${after.tb.toFixed(6)}`);
    check("inventory still reconciles to GL 1200", same("inventory"), moved("inventory"));
    check("AP still reconciles", same("ap"), moved("ap"));
    check("AR still reconciles", same("ar"), moved("ar"));
    check("GL 2120 still equals the goods received and not yet invoiced", after.exact.grni !== null && after.exact.grni === before.exact.grni, `${before.grni.toFixed(6)} → ${after.grni.toFixed(6)}`);
    check("nothing holds base with none of its foreign currency", after.exact.fxResidue === 0n, `${before.fxResidue.toFixed(6)} → ${after.fxResidue.toFixed(6)}`);
    check("no stock movement sits in a different month from its document's entry", after.exact.stockLedgerDates === 0n, `${before.stockLedgerDates} → ${after.stockLedgerDates}`);
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

  const today = String((await req("GET", "/financial-reports/trial-balance")).body?.params?.asOfDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`the server named no today: "${today}"`);

  // The month-end scenarios are written in August 2026 and need today after
  // it; on an earlier clock their dates move back to the month before today.
  const monthsBack = today > "2026-08-31" ? 0 : 2026 * 12 + 8 - (Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7))) + 1;
  function onCalendar(date: string): string {
    if (monthsBack === 0) return date;
    const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 - monthsBack;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(Math.min(Number(date.slice(8, 10)), lastDay))}`;
  }

  return {
    app,
    sessions,
    today,
    onCalendar,
    req,
    rows,
    allRows,
    n,
    scaled,
    check,
    checkEq,
    scenario,
    invariants,
    report,
    passes,
    failures,
    /**
     * The live database file, so a scenario can reach a store directly (D226:
     * a draft saved before D205 existed, inserted straight through the
     * SQLite {@link LedgerRepository} the way an old books file already holds
     * one — there is no HTTP route that can create that shape, on purpose).
     */
    dbPath,
  };
}
