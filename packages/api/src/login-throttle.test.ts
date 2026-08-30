import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "./login-throttle.js";

/**
 * S6. A Mezan credential is a six-digit PIN — one million combinations. With
 * no throttle, 20 attempts took 0.557s on one connection (~36/s), which
 * exhausts the keyspace in under eight hours sequentially and over a lunch
 * break in parallel; the LAN mount puts that attacker on the shop wifi.
 * scrypt makes each guess cost something, and only a lockout makes the
 * SEQUENCE cost something.
 *
 * The clock is injected, so every boundary below is asserted at the exact
 * millisecond rather than by sleeping and hoping.
 */
function throttleAt(start = 1_000_000) {
  let now = start;
  return {
    throttle: createLoginThrottle(() => now),
    advance: (ms: number) => {
      now += ms;
    },
    at: () => now,
  };
}

const MINUTE = 60_000;

describe("createLoginThrottle — the sequence has to cost something", () => {
  it("lets a fresh account straight through", () => {
    const { throttle } = throttleAt();
    expect(throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("tolerates exactly five failures and locks on the sixth — the boundary, both sides", () => {
    // Off by one here is the whole control: five means five, not four and not
    // six. Asserted at 5 (still open) and at 6 (locked), not merely "locks
    // eventually".
    const { throttle } = throttleAt();
    for (let i = 1; i <= 5; i++) {
      expect(throttle.fail("owner@shop.test"), `failure ${i} must not lock`).toBe(0);
      expect(throttle.retryAfter("owner@shop.test"), `still open after ${i}`).toBe(0);
    }
    expect(throttle.fail("owner@shop.test")).toBe(60);
    expect(throttle.retryAfter("owner@shop.test")).toBe(60);
  });

  it("doubles the lock with each further failure, up to the fifteen-minute ceiling", () => {
    // A shop locked out for a whole shift is its own outage, so the ceiling
    // is asserted as a ceiling: it stops growing and stays stopped.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) throttle.fail("owner@shop.test");

    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      seen.push(throttle.fail("owner@shop.test"));
      advance(1); // the clock has to move, or every failure lands on one instant
    }

    expect(seen).toEqual([60, 120, 240, 480, 900, 900, 900, 900, 900]);
    expect(Math.max(...seen)).toBe(15 * 60);
  });

  it("counts the wait down as the clock moves, and opens again exactly when it expires", () => {
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 6; i++) throttle.fail("owner@shop.test");
    expect(throttle.retryAfter("owner@shop.test")).toBe(60);

    advance(30_000);
    expect(throttle.retryAfter("owner@shop.test")).toBe(30);

    advance(29_999);
    // One millisecond short: still locked, and it must round UP rather than
    // report 0 while the lock is technically still in force.
    expect(throttle.retryAfter("owner@shop.test")).toBe(1);

    advance(1);
    expect(throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("clears the streak on a verified credential, so a typo before a correct PIN costs nothing", () => {
    const { throttle } = throttleAt();
    for (let i = 0; i < 4; i++) throttle.fail("owner@shop.test");
    throttle.succeed("owner@shop.test");

    // Back to the full five, not one away from a lock.
    for (let i = 1; i <= 5; i++) expect(throttle.fail("owner@shop.test"), `failure ${i}`).toBe(0);
    expect(throttle.fail("owner@shop.test")).toBe(60);
  });

  it("forgets a streak after a quiet hour — yesterday's typos are not an attack", () => {
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) throttle.fail("owner@shop.test");

    advance(60 * MINUTE + 1);

    // The next failure starts a new streak rather than tipping the old one
    // over, so a shop that mistypes twice a week is never locked out.
    expect(throttle.fail("owner@shop.test")).toBe(0);
    expect(throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("does NOT forget one millisecond early — the decay boundary is exact", () => {
    // Without this, the test above passes against a decay of any length,
    // including one so short it never protects anything.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) throttle.fail("owner@shop.test");

    advance(60 * MINUTE);
    expect(throttle.fail("owner@shop.test")).toBe(60);
  });

  it("locks the attacked account and no other — one account cannot lock the shop out", () => {
    // The negative control for the whole feature. A throttle that locks
    // globally hands an attacker a denial of service against the till.
    const { throttle } = throttleAt();
    for (let i = 0; i < 10; i++) throttle.fail("owner@shop.test");

    expect(throttle.retryAfter("owner@shop.test")).toBeGreaterThan(0);
    expect(throttle.retryAfter("cashier@shop.test")).toBe(0);
    expect(throttle.fail("cashier@shop.test")).toBe(0);
  });

  it("steps the ladder down one rung when a lock is served, rather than up or to zero", () => {
    // Two failure modes, one rung apart.
    //
    // Leaving the streak at its high-water mark (what this shipped with) meant
    // waiting out fifteen minutes and then mistyping once bought THIRTY — the
    // ratchet only ever went up, so serving a lock left you worse off than
    // before it. Resetting the streak to zero (the obvious fix) is worse
    // still: five free attempts per served lock is 7,200 guesses a day, which
    // walks the six-digit keyspace in about four months.
    //
    // One rung down: a post-lock typo costs the SAME wait again, and the
    // ceiling — one guess per fifteen minutes — is untouched.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 6; i++) throttle.fail("owner@shop.test");
    expect(throttle.retryAfter("owner@shop.test")).toBe(60);

    advance(60_000);
    expect(throttle.retryAfter("owner@shop.test")).toBe(0);
    expect(throttle.fail("owner@shop.test")).toBe(60);

    // And it still climbs while the failures keep coming.
    expect(throttle.fail("owner@shop.test")).toBe(120);
  });

  it("makes a full six-digit sweep take longer than a human lifetime", () => {
    // The arithmetic the control exists for, stated rather than assumed. At
    // the ceiling, every further guess costs 15 minutes, so the remaining
    // 999,994 candidates cost ~28.5 years of continuous attack.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) throttle.fail("owner@shop.test");

    let lockedSeconds = 0;
    for (let i = 0; i < 200; i++) {
      lockedSeconds += throttle.fail("owner@shop.test");
      advance(1);
    }
    const ceilingSeconds = 15 * 60;
    const remaining = 1_000_000 - 205;
    const years = (lockedSeconds + remaining * ceilingSeconds) / (365 * 24 * 3600);

    expect(years).toBeGreaterThan(25);
  });

  it("treats the key as opaque, so the caller decides what an account is", () => {
    // The route passes the lower-cased email. If the throttle ever
    // canonicalised on its own, "Owner@Shop.test" and "owner@shop.test" would
    // silently become two budgets of five.
    const { throttle } = throttleAt();
    for (let i = 0; i < 6; i++) throttle.fail("owner@shop.test");

    expect(throttle.retryAfter("owner@shop.test")).toBe(60);
    expect(throttle.retryAfter("Owner@Shop.test")).toBe(0);
  });
});
