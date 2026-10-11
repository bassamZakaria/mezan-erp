import { describe, expect, it } from "vitest";
import { createLoginThrottle, createSourceThrottle, throttleKey } from "./login-throttle.js";

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
  /**
   * guards N-12: the per-source ladder, alone, SELLS attempts.
   *
   * Counting per (account, source) is what stops one phone on the wifi holding
   * the owner's account locked all day — and on a flat LAN it also means a
   * fresh five attempts per source address. A laptop can hold a hundred
   * addresses on that subnet: 1,270 free guesses before anything locks, every
   * hour, which walks a six-digit PIN in weeks.
   */
  it("caps one account across EVERY source address, not just per address", () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";

    // Four failures each from twenty different addresses: never enough to trip
    // any single source's own five-attempt ladder.
    let lastLock = 0;
    for (let host = 1; host <= 20; host += 1) {
      const key = throttleKey(account, `192.168.1.${host}`);
      for (let i = 0; i < 4; i += 1) lastLock = throttle.fail(key);
    }

    expect(lastLock).toBeGreaterThan(0);
    // A twenty-first address, which has failed nothing at all, is refused too:
    // the ceiling belongs to the ACCOUNT.
    expect(throttle.retryAfter(throttleKey(account, "192.168.1.99"))).toBeGreaterThan(0);
    // And a different account on the same subnet is untouched.
    expect(throttle.retryAfter(throttleKey("clerk@shop.test", "192.168.1.99"))).toBe(0);
  });

  /**
   * guards N-12: THE HOST'S OWN CONSOLE STAYS OPEN.
   *
   * Without this exemption the ceiling becomes an attack of its own — lock the
   * owner out of the machine standing in their own shop, from the car park.
   * Physical access already means the SQLite file, so refusing them protects
   * nothing.
   */
  it("never lets a remote flood lock the machine's own console", () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";

    for (let host = 1; host <= 40; host += 1) {
      const key = throttleKey(account, `192.168.1.${host}`);
      for (let i = 0; i < 4; i += 1) throttle.fail(key);
    }

    expect(throttle.retryAfter(throttleKey(account, "192.168.1.7"))).toBeGreaterThan(0);
    // `throttleKey(account, null)` is the host's in-process mount.
    expect(throttle.retryAfter(throttleKey(account, null))).toBe(0);
  });

  // guards N-12: «فكّ القفل» has to mean "this person can sign in now" — and
  // that includes clearing the per-account total, or the very next attempt from
  // any address locks them straight back out.
  it("clears the account ceiling on an unlock, not just the source streaks", () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";
    for (let host = 1; host <= 20; host += 1) {
      const key = throttleKey(account, `192.168.1.${host}`);
      for (let i = 0; i < 4; i += 1) throttle.fail(key);
    }
    expect(throttle.retryAfter(throttleKey(account, "192.168.1.7"))).toBeGreaterThan(0);

    // What `POST /users/:id/unlock` calls: the bare account.
    throttle.unlock(account);

    expect(throttle.retryAfter(throttleKey(account, "192.168.1.7"))).toBe(0);
    expect(throttle.retryAfter(throttleKey(account, "192.168.1.99"))).toBe(0);
  });

  it("never locks an account whose till mistypes once every twenty-five minutes, all week", () => {
    const { throttle, advance } = throttleAt();
    const till = throttleKey("owner@shop.test", "41.33.10.10");

    for (let typo = 1; typo <= 400; typo += 1) {
      advance(25 * MINUTE);
      expect(throttle.fail(till), `typo ${typo}`).toBe(0);
      expect(throttle.retryAfter(till), `after typo ${typo}`).toBe(0);
    }
  });

  it("still locks six failures inside one hour, however they are spaced", () => {
    const { throttle, advance } = throttleAt();
    const till = throttleKey("owner@shop.test", "41.33.10.10");

    for (let typo = 1; typo <= 5; typo += 1) {
      advance(11 * MINUTE);
      expect(throttle.fail(till), `typo ${typo}`).toBe(0);
    }
    advance(4 * MINUTE);
    expect(throttle.fail(till)).toBe(60);
  });

  it("clears only the address a verified credential came from", () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";
    const attacker = throttleKey(account, "41.33.10.10");
    const owner = throttleKey(account, "196.221.5.5");
    for (let i = 0; i < 7; i += 1) throttle.fail(attacker);
    for (let i = 0; i < 4; i += 1) throttle.fail(owner);

    throttle.succeed(owner);

    expect(throttle.retryAfter(attacker)).toBe(120);
    for (let i = 1; i <= 5; i += 1) expect(throttle.fail(owner), `failure ${i}`).toBe(0);
    expect(throttle.fail(owner)).toBe(60);
  });

  it("keeps the account ceiling counting through a successful sign-in from one address", () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";
    for (let host = 1; host <= 14; host += 1) {
      for (let i = 0; i < 4; i += 1) throttle.fail(throttleKey(account, `192.168.1.${host}`));
    }

    throttle.succeed(throttleKey(account, "192.168.1.1"));
    for (let i = 0; i < 4; i += 1) throttle.fail(throttleKey(account, "192.168.1.200"));

    expect(throttle.retryAfter(throttleKey(account, "192.168.1.77"))).toBe(15 * 60);
  });

  // The key carries an email, which contains "@" — so the separator between the
  // account half and the source half cannot be "@" or the account is not
  // recoverable from the key, and the ceiling above cannot be counted at all.
  it("keeps the account recoverable from a key even though an account is an email", () => {
    const { throttle } = throttleAt();
    for (let i = 0; i < 60; i += 1) throttle.fail(throttleKey("owner@shop.test", "10.0.0.5"));

    // The ceiling landed on "owner@shop.test", not on "owner" or on
    // "owner@shop.test@10.0.0.5".
    expect(throttle.retryAfter(throttleKey("owner@shop.test", "10.0.0.9"))).toBeGreaterThan(0);
    expect(throttle.retryAfter(throttleKey("owner", "10.0.0.9"))).toBe(0);
  });
});

describe("createSourceThrottle — failures from one address, whichever accounts they name", () => {
  function sourcesAt(start = 1_000_000) {
    let now = start;
    return {
      sources: createSourceThrottle(() => now),
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it("lets a shop's worth of typos through and holds the thirty-first failure", () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 30; i += 1) expect(sources.fail("192.168.1.66")).toBe(0);
    expect(sources.retryAfter("192.168.1.66")).toBe(0);

    expect(sources.fail("192.168.1.66")).toBe(60);
    expect(sources.retryAfter("192.168.1.66")).toBe(60);
  });

  it("holds only the address that failed", () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 31; i += 1) sources.fail("192.168.1.66");

    expect(sources.retryAfter("192.168.1.40")).toBe(0);
  });

  it("doubles the wait with each further failure, up to fifteen minutes", () => {
    const { sources, advance } = sourcesAt();
    for (let i = 0; i < 31; i += 1) sources.fail("192.168.1.66");
    advance(60_000);
    expect(sources.retryAfter("192.168.1.66")).toBe(0);

    expect(sources.fail("192.168.1.66")).toBe(120);
    for (let i = 0; i < 10; i += 1) sources.fail("192.168.1.66");
    expect(sources.retryAfter("192.168.1.66")).toBe(15 * 60);
  });

  it("forgets an address that has been quiet for an hour", () => {
    const { sources, advance } = sourcesAt();
    for (let i = 0; i < 30; i += 1) sources.fail("192.168.1.66");
    advance(60 * 60_000 + 1);

    expect(sources.fail("192.168.1.66")).toBe(0);
  });

  it("never holds an office that mistypes once every twenty-five minutes, all week", () => {
    const { sources, advance } = sourcesAt();

    for (let typo = 1; typo <= 400; typo += 1) {
      advance(25 * 60_000);
      expect(sources.fail("41.33.10.10"), `typo ${typo}`).toBe(0);
    }
    expect(sources.retryAfter("41.33.10.10")).toBe(0);
  });

  it("keeps no more than ten thousand addresses, however many are sent", () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 10_050; i += 1) sources.fail(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);

    expect(sources.size()).toBe(10_000);
  });
});
