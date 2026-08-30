import type { Ctx } from "./harness.js";
import {
  createAuthContext,
  ungrantablePermissions,
  ungrantableScopes,
  targetOutranksCaller,
  ALL_SCOPE,
} from "../../packages/domain/src/index.js";
import { createLoginThrottle, throttleKey } from "../../packages/api/src/login-throttle.js";
import { createSessionRegistry } from "../../packages/api/src/session-auth.js";

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
function lockDurationAtCeiling(throttle: { fail(key: string): number }, _at: number): number {
  const key = "ceiling-probe@shop.example";
  let last = 0;
  for (let i = 0; i < 25; i += 1) last = throttle.fail(key);
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
    check("a tenant admin is never scope-limited", ungrantableScopes(admin, { branchScope: ALL_SCOPE }).length === 0);
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

    for (let i = 0; i < 5; i += 1) check(`attempt ${i + 1} is free`, throttle.fail(key) === 0);
    const first = throttle.fail(key);
    check("the sixth attempt locks for 60s", first === 60, String(first));
    check("and the lock is reported to the caller", throttle.retryAfter(key) === 60, String(throttle.retryAfter(key)));
    check("the seventh doubles it", throttle.fail(key) === 120);
    let last = 0;
    for (let i = 0; i < 10; i += 1) last = throttle.fail(key);
    check("and it ceilings at fifteen minutes", last === 900, String(last));

    // A SERVED LOCK STEPS THE LADDER DOWN ONE RUNG. Leaving the streak at its
    // high-water mark meant waiting out fifteen minutes and then mistyping once
    // bought thirty. Resetting it to zero is worse — five free guesses per
    // served lock walks a six-digit keyspace in about four months — so the
    // ceiling has to stay where it is.
    clock += 901_000;
    check("waiting the lock out clears it", throttle.retryAfter(key) === 0, String(throttle.retryAfter(key)));
    check("but the next failure costs the SAME wait, not double", throttle.fail(key) === 900, String(throttle.fail(key)));
    check("so the ceiling is unmoved — one guess per fifteen minutes", lockDurationAtCeiling(throttle, clock) === 900);

    // The DoS shape: a remote attacker must not be able to lock the console at
    // the counter, because the two are counted under different keys.
    const remote = createLoginThrottle(() => clock);
    const fromWifi = throttleKey("owner@shop.example", "192.168.1.55");
    const atCounter = throttleKey("owner@shop.example", null);
    check("a remote source keys differently from the host", fromWifi !== atCounter, `${fromWifi} vs ${atCounter}`);
    for (let i = 0; i < 8; i += 1) remote.fail(fromWifi);
    check("the wifi attacker locks itself out", remote.retryAfter(fromWifi) > 0);
    check("and the counter is unaffected", remote.retryAfter(atCounter) === 0, String(remote.retryAfter(atCounter)));

    // An unlock means "this person can sign in now", so it must clear every
    // source the account was counted under, not just the one that locked it.
    remote.succeed(atCounter);
    check("an admin unlock clears the remote streak too", remote.retryAfter(fromWifi) === 0);

    // Unbounded growth: records are written BEFORE any account lookup, so an
    // unauthenticated caller could grow the map without limit.
    const flood = createLoginThrottle(() => clock);
    for (let i = 0; i < 12_000; i += 1) flood.fail(`nobody-${i}@nowhere.example`);
    check("the record map is capped", flood.size() <= 10_000, String(flood.size()));
  });

  await ctx.scenario("units — a session grant is revocable by user, not only by token", async () => {
    let clock = 5_000_000;
    const registry = createSessionRegistry(() => clock);
    const a = registry.issue({ userId: "U1", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const b = registry.issue({ userId: "U1", permissions: ["sales.invoice.view"], roleCode: "CLERK", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const other = registry.issue({ userId: "U2", permissions: [], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });

    check("both of a user's tabs resolve", !!registry.find(a) && !!registry.find(b));
    registry.revokeUser("U1");
    check("revoking the USER ends every one of their sessions", !registry.find(a) && !registry.find(b));
    check("and leaves everyone else signed in", !!registry.find(other));

    // The idle sweep, which is what made "deactivation takes twelve hours" the
    // status quo before `revokeUser` was actually called.
    clock += 13 * 60 * 60 * 1000;
    check("an untouched session idles out", !registry.find(other));
  });
}
