import type { Ctx } from "./harness.js";
import {
  createAuthContext,
  ungrantablePermissions,
  ungrantableScopes,
  targetOutranksCaller,
  ALL_SCOPE,
} from "../../packages/domain/src/index.js";
import { createLoginThrottle, throttleKey } from "../../packages/api/src/login-throttle.js";
import { canonicalOrigin, createSessionRegistry } from "../../packages/api/src/session-auth.js";

/**
 * The UNIT layer of the security suite.
 *
 * `security.ts` drives the same HTTP routes the UI calls, which is the right
 * place to prove that a guard is WIRED. It is the wrong place to prove that a
 * guard is CORRECT: the arithmetic of a lockout's backoff, the sixteen bytes
 * of an IPv6 literal and the subset rule for a branch scope all have edge cases
 * that no reachable request shape exercises, and reaching them through HTTP
 * would need a scenario per case.
 *
 * So these call the domain and adapter functions directly. They live here
 * rather than in a `.test.ts` because `docs/TESTING.md` §1 disables vitest
 * execution repo-wide; `pnpm scenarios` is the sanctioned executable suite and
 * runs in CI, so this is the layer that actually guards these functions.
 */

/**
 * The wait a further failure costs once the ladder is at its ceiling. Proves
 * the step-down did not lower the top of the ladder, which is where a sweeping
 * attacker actually lives.
 */
async function lockDurationAtCeiling(throttle: { fail(key: string): Promise<number> }, _at: number): Promise<number> {
  const key = "ceiling-probe@shop.example";
  let last = 0;
  for (let i = 0; i < 25; i += 1) last = await throttle.fail(key);
  return last;
}

function ctxWith(permissions: string[], branch: typeof ALL_SCOPE | string[] = ALL_SCOPE, warehouse: typeof ALL_SCOPE | string[] = ALL_SCOPE) {
  return createAuthContext({ userId: "U", permissions, branchScope: branch, warehouseScope: warehouse });
}

export async function run(ctx: Ctx): Promise<void> {
  const { check } = ctx;

  await ctx.scenario("units — a caller may not grant permissions they do not hold", async () => {
    const admin = ctxWith(["*"]);
    const clerk = ctxWith(["admin.users.view", "admin.users.create"]);

    check("a tenant admin can grant anything", ungrantablePermissions(admin, ["accounting.gl.post", "*"]).length === 0);
    check(
      "a clerk cannot grant the wildcard",
      ungrantablePermissions(clerk, ["*"]).includes("*"),
      JSON.stringify(ungrantablePermissions(clerk, ["*"])),
    );
    check(
      "a clerk cannot grant an unheld permission",
      ungrantablePermissions(clerk, ["accounting.gl.post"]).includes("accounting.gl.post"),
    );
    check(
      "a clerk CAN grant what it holds",
      ungrantablePermissions(clerk, ["admin.users.view"]).length === 0,
    );
    // Resolution runs on BOTH sides, so an implied dependency cannot be
    // smuggled past the comparison by asking only for the parent code.
    check(
      "granting a dependent code implies its prerequisites",
      ungrantablePermissions(clerk, ["admin.users.deactivate"]).includes("admin.users.deactivate"),
    );
  });

  await ctx.scenario("units — scope is authority, and cannot be widened", async () => {
    const branchManager = ctxWith(["admin.users.edit"], ["BR-1"], ["WH-1"]);
    const admin = ctxWith(["*"], ["BR-1"]);

    // The refusal is encoded as `"<dimension>:<id>"`, so the dimension travels
    // with the id and one list carries both.
    check(
      "a scoped caller cannot grant ALL branches",
      ungrantableScopes(branchManager, { branchScope: ALL_SCOPE }).includes("branch:*"),
      JSON.stringify(ungrantableScopes(branchManager, { branchScope: ALL_SCOPE })),
    );
    check(
      "a scoped caller cannot grant a branch outside its own",
      ungrantableScopes(branchManager, { branchScope: ["BR-2"] }).includes("branch:BR-2"),
    );
    check(
      "a scoped caller CAN grant its own branch",
      ungrantableScopes(branchManager, { branchScope: ["BR-1"] }).length === 0,
    );
    check(
      "warehouses are compared too, not only branches",
      ungrantableScopes(branchManager, { warehouseScope: ["WH-9"] }).includes("warehouse:WH-9"),
    );
    check(
      "an unnamed dimension is not a widening",
      ungrantableScopes(branchManager, {}).length === 0,
    );
    // D111 round 3: `"*"` is every permission, not every branch. The bypass
    // this line used to assert let an administrator granted one branch write
    // `branchScope: "*"` onto any account, its own first.
    check(
      "a tenant admin granted one branch cannot hand out every branch",
      ungrantableScopes(admin, { branchScope: ALL_SCOPE }).includes("branch:*"),
      JSON.stringify(ungrantableScopes(admin, { branchScope: ALL_SCOPE })),
    );
    check("a tenant admin granted one branch can hand out that branch", ungrantableScopes(admin, { branchScope: ["BR-1"] }).length === 0);
    check("a tenant admin granted every branch is not scope-limited", ungrantableScopes(ctxWith(["*"]), { branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }).length === 0);
  });

  await ctx.scenario("units — outranking accounts for both dimensions and fails CLOSED", async () => {
    const clerk = ctxWith(["admin.users.edit"], ["BR-1"]);

    check(
      "a company admin outranks a non-admin",
      targetOutranksCaller(clerk, { isCompanyAdmin: true, permissions: [] }),
    );
    check(
      "a role carrying an unheld permission outranks",
      targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: ["accounting.gl.post"] }),
    );
    check(
      "a WIDER BRANCH REACH outranks, even with an identical role",
      targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: ["admin.users.edit"], branchScope: ALL_SCOPE }),
    );
    // The fail-open case: an account naming a role the store cannot resolve
    // used to read as "carries nothing", so the predicate was most permissive
    // about exactly the account whose authority was unknown.
    check(
      "an unresolvable role outranks rather than reading as harmless",
      targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: [], roleUnresolved: true }),
    );
    check(
      "a genuine peer does NOT outrank — the job the permission exists for",
      !targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: ["admin.users.edit"], branchScope: ["BR-1"] }),
    );
  });

  await ctx.scenario("units — the lockout backs off, is spent when served, and is bounded", async () => {
    let clock = 1_000_000;
    const throttle = createLoginThrottle(() => clock);
    const key = throttleKey("owner@shop.example", null);

    for (let i = 0; i < 5; i += 1) check(`attempt ${i + 1} is free`, (await throttle.fail(key)) === 0);
    const first = (await throttle.fail(key));
    check("the sixth attempt locks for 60s", first === 60, String(first));
    check("and the lock is reported to the caller", (await throttle.retryAfter(key)) === 60, String((await throttle.retryAfter(key))));
    check("the seventh doubles it", (await throttle.fail(key)) === 120);
    let last = 0;
    for (let i = 0; i < 10; i += 1) last = (await throttle.fail(key));
    check("and it ceilings at fifteen minutes", last === 900, String(last));

    // A SERVED LOCK STEPS THE LADDER DOWN ONE RUNG. Leaving the streak at its
    // high-water mark meant waiting out fifteen minutes and then mistyping once
    // bought thirty. Resetting it to zero is worse — five free guesses per
    // served lock walks a six-digit keyspace in about four months — so the
    // ceiling has to stay where it is.
    clock += 901_000;
    check("waiting the lock out clears it", (await throttle.retryAfter(key)) === 0, String((await throttle.retryAfter(key))));
    check("but the next failure costs the SAME wait, not double", (await throttle.fail(key)) === 900, String((await throttle.fail(key))));
    check("so the ceiling is unmoved — one guess per fifteen minutes", (await lockDurationAtCeiling(throttle, clock)) === 900);

    // The DoS shape: a remote attacker must not be able to lock the console at
    // the counter, because the two are counted under different keys.
    const remote = createLoginThrottle(() => clock);
    const fromWifi = throttleKey("owner@shop.example", "192.168.1.55");
    const atCounter = throttleKey("owner@shop.example", null);
    check("a remote source keys differently from the host", fromWifi !== atCounter, `${fromWifi} vs ${atCounter}`);
    for (let i = 0; i < 8; i += 1) (await remote.fail(fromWifi));
    check("the wifi attacker locks itself out", (await remote.retryAfter(fromWifi)) > 0);
    check("and the counter is unaffected", (await remote.retryAfter(atCounter)) === 0, String((await remote.retryAfter(atCounter))));

    // An unlock means "this person can sign in now", so it must clear every
    // source the account was counted under, not just the one that locked it.
    (await remote.unlock("owner@shop.example"));
    check("an admin unlock clears the remote streak too", (await remote.retryAfter(fromWifi)) === 0);

    // Unbounded growth: records are written BEFORE any account lookup, so an
    // unauthenticated caller could grow the map without limit.
    const flood = createLoginThrottle(() => clock);
    for (let i = 0; i < 12_000; i += 1) (await flood.fail(`nobody-${i}@nowhere.example`));
    check("the record map is capped", (await flood.size()) <= 10_000, String((await flood.size())));
  });

  await ctx.scenario("units — a session grant is revocable by user, not only by token", async () => {
    let clock = 5_000_000;
    const registry = createSessionRegistry(() => clock);
    const a = (await registry.issue({ userId: "U1", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));
    const b = (await registry.issue({ userId: "U1", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));
    const other = (await registry.issue({ userId: "U2", permissions: [], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));

    check("both of a user's tabs resolve", !!(await registry.find(a)) && !!(await registry.find(b)));
    (await registry.revokeUser("U1"));
    check("revoking the USER ends every one of their sessions", !(await registry.find(a)) && !(await registry.find(b)));
    check("and leaves everyone else signed in", !!(await registry.find(other)));

    // The idle sweep, which is what made "deactivation takes twelve hours" the
    // status quo before `revokeUser` was actually called.
    clock += 13 * 60 * 60 * 1000;
    check("an untouched session idles out", !(await registry.find(other)));
  });

  await ctx.scenario("units — one machine's many spellings are one origin, and null is not a wildcard", async () => {
    // A till binds the address the socket reported at login and presents the
    // address the socket reports on every request afterwards. Those are the
    // same machine and often not the same string: Node hands back
    // `::ffff:192.168.1.5` on a dual-stack listener and `192.168.1.5` on an
    // IPv4 one, a link-local address arrives carrying a `%en0` zone the peer
    // never chose, and `fe80::1` has eight legal spellings. Compared raw, the
    // till binds at login and is signed out on its next request — which is how
    // a binding check gets softened to a warning and then to nothing.
    //
    // No reachable request shape exercises these, which is why they live at the
    // unit layer; `security.ts` proves the binding is WIRED.
    for (const [a, b] of [
      ["::ffff:192.168.1.5", "192.168.1.5"],
      ["::FFFF:192.168.1.5", "192.168.1.5"],
      ["::ffff:c0a8:105", "192.168.1.5"],
      ["0:0:0:0:0:ffff:c0a8:105", "192.168.1.5"],
      ["[::ffff:192.168.1.5]", "192.168.1.5"],
      ["fe80::1%en0", "fe80::1"],
      ["fe80:0:0:0:0:0:0:1", "FE80::1"],
      ["[fe80::1%eth0]", "fe80::1"],
    ] as const) {
      check(`${a} is ${b}`, canonicalOrigin(a) === canonicalOrigin(b), `${canonicalOrigin(a)} vs ${canonicalOrigin(b)}`);
    }

    // NULL IS THE IN-PROCESS MOUNT AND NOTHING ELSE. If any address the wire
    // could produce collapsed to it, everything that reaches the socket could
    // present a host-issued token — the binding would be bypassable by the one
    // caller it most needs to stop.
    for (const raw of ["", "   ", "%", "[]", "0.0.0.0", "::", "not-an-address"]) {
      check(`"${raw}" is not the host`, canonicalOrigin(raw) !== null, String(canonicalOrigin(raw)));
    }
    check("only the host is the host", canonicalOrigin(null) === null);
    check(
      "and an unparseable origin is compared verbatim, never normalised together",
      canonicalOrigin("socket-a") !== canonicalOrigin("socket-b"),
    );
  });

  await ctx.scenario("units — a session that is in constant use still ends", async () => {
    // `lastSeenAt` is refreshed on every find(), so the twelve-hour idle
    // timeout only ever fired on a session nobody was using — which is exactly
    // the session that needed no bounding. A token lifted from a till and
    // polled once an hour never expired at any point in its life.
    let clock = 9_000_000;
    const registry = createSessionRegistry(() => clock);
    const grant = { userId: "U9", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE };
    const busy = (await registry.issue(grant, "192.168.7.21"));

    let aliveAt = 0;
    for (let hour = 1; hour <= 24; hour += 1) {
      clock += 60 * 60 * 1000;
      if ((await registry.find(busy, "192.168.7.21"))) aliveAt = hour;
    }
    check("a polled session dies at the absolute cap, not never", aliveAt === 16, `alive through hour ${aliveAt}`);

    // And the shorter idle timeout still governs the laptop nobody touched.
    const idle = (await registry.issue(grant, "192.168.7.21"));
    clock += 12 * 60 * 60 * 1000 + 1;
    const refusal = (await registry.inspect(idle, "192.168.7.21")).refusal;
    check("while an untouched one still goes idle first", refusal?.reason === "idle", String(refusal?.reason));
  });

  await ctx.scenario("units — a moved token is revoked, never re-bound", async () => {
    // Re-binding to whatever address turns up is arithmetically the same as not
    // binding: the first request from the thief re-binds the session to the
    // thief. So a mismatch ENDS the session — including for the legitimate till
    // it was issued to, which signs in again.
    const registry = createSessionRegistry();
    const grant = { userId: "U7", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE };

    const till = (await registry.issue(grant, "192.168.7.21"));
    check("the till's own token resolves", !!(await registry.find(till, "192.168.7.21")));
    const moved = (await registry.inspect(till, "192.168.7.99")).refusal;
    check("a second address is refused as a MOVE", moved?.reason === "moved", String(moved?.reason));
    check("naming where it was issued", moved?.issuedFrom === "192.168.7.21", String(moved?.issuedFrom));
    check("and where it turned up", moved?.presentedFrom === "192.168.7.99", String(moved?.presentedFrom));
    check("the token is dead at home too", !(await registry.find(till, "192.168.7.21")));

    // The desktop shell's own session: no origin is ONE origin, not any origin.
    const host = (await registry.issue(grant));
    check("a host session works on the host", !!(await registry.find(host)));
    check("and nowhere on the wire", !(await registry.find(host, "192.168.7.21")));
    const fromTill = (await registry.issue(grant, "192.168.7.21"));
    check("a till session does not work over the in-process mount", !(await registry.find(fromTill)));
  });
}
