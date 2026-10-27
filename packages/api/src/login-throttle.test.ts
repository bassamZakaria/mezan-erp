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
  it("lets a fresh account straight through", async () => {
    const { throttle } = throttleAt();
    expect(await throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("tolerates exactly five failures and locks on the sixth — the boundary, both sides", async () => {
    // Off by one here is the whole control: five means five, not four and not
    // six. Asserted at 5 (still open) and at 6 (locked), not merely "locks
    // eventually".
    const { throttle } = throttleAt();
    for (let i = 1; i <= 5; i++) {
      expect(await throttle.fail("owner@shop.test"), `failure ${i} must not lock`).toBe(0);
      expect(await throttle.retryAfter("owner@shop.test"), `still open after ${i}`).toBe(0);
    }
    expect(await throttle.fail("owner@shop.test")).toBe(60);
    expect(await throttle.retryAfter("owner@shop.test")).toBe(60);
  });

  it("doubles the lock with each further failure, up to the fifteen-minute ceiling", async () => {
    // A shop locked out for a whole shift is its own outage, so the ceiling
    // is asserted as a ceiling: it stops growing and stays stopped.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) await throttle.fail("owner@shop.test");

    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      seen.push(await throttle.fail("owner@shop.test"));
      advance(1); // the clock has to move, or every failure lands on one instant
    }

    expect(seen).toEqual([60, 120, 240, 480, 900, 900, 900, 900, 900]);
    expect(Math.max(...seen)).toBe(15 * 60);
  });

  it("counts the wait down as the clock moves, and opens again exactly when it expires", async () => {
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 6; i++) await throttle.fail("owner@shop.test");
    expect(await throttle.retryAfter("owner@shop.test")).toBe(60);

    advance(30_000);
    expect(await throttle.retryAfter("owner@shop.test")).toBe(30);

    advance(29_999);
    // One millisecond short: still locked, and it must round UP rather than
    // report 0 while the lock is technically still in force.
    expect(await throttle.retryAfter("owner@shop.test")).toBe(1);

    advance(1);
    expect(await throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("clears the streak on a verified credential, so a typo before a correct PIN costs nothing", async () => {
    const { throttle } = throttleAt();
    for (let i = 0; i < 4; i++) await throttle.fail("owner@shop.test");
    await throttle.succeed("owner@shop.test");

    // Back to the full five, not one away from a lock.
    for (let i = 1; i <= 5; i++) expect(await throttle.fail("owner@shop.test"), `failure ${i}`).toBe(0);
    expect(await throttle.fail("owner@shop.test")).toBe(60);
  });

  it("forgets a streak after a quiet hour — yesterday's typos are not an attack", async () => {
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) await throttle.fail("owner@shop.test");

    advance(60 * MINUTE + 1);

    // The next failure starts a new streak rather than tipping the old one
    // over, so a shop that mistypes twice a week is never locked out.
    expect(await throttle.fail("owner@shop.test")).toBe(0);
    expect(await throttle.retryAfter("owner@shop.test")).toBe(0);
  });

  it("does NOT forget one millisecond early — the decay boundary is exact", async () => {
    // Without this, the test above passes against a decay of any length,
    // including one so short it never protects anything.
    const { throttle, advance } = throttleAt();
    for (let i = 0; i < 5; i++) await throttle.fail("owner@shop.test");

    advance(60 * MINUTE);
    expect(await throttle.fail("owner@shop.test")).toBe(60);
  });

  it("locks the attacked account and no other — one account cannot lock the shop out", async () => {
    // The negative control for the whole feature. A throttle that locks
    // globally hands an attacker a denial of service against the till.
    const { throttle } = throttleAt();
    for (let i = 0; i < 10; i++) await throttle.fail("owner@shop.test");

    expect(await throttle.retryAfter("owner@shop.test")).toBeGreaterThan(0);
    expect(await throttle.retryAfter("cashier@shop.test")).toBe(0);
    expect(await throttle.fail("cashier@shop.test")).toBe(0);
  });

  it("steps the ladder down one rung when a lock is served, rather than up or to zero", async () => {
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
    for (let i = 0; i < 6; i++) await throttle.fail("owner@shop.test");
    expect(await throttle.retryAfter("owner@shop.test")).toBe(60);

    advance(60_000);
    expect(await throttle.retryAfter("owner@shop.test")).toBe(0);
    expect(await throttle.fail("owner@shop.test")).toBe(60);

    // And it still climbs while the failures keep coming.
    expect(await throttle.fail("owner@shop.test")).toBe(120);
  });

  it("treats the key as opaque, so the caller decides what an account is", async () => {
    // The route passes the lower-cased email. If the throttle ever
    // canonicalised on its own, "Owner@Shop.test" and "owner@shop.test" would
    // silently become two budgets of five.
    const { throttle } = throttleAt();
    for (let i = 0; i < 6; i++) await throttle.fail("owner@shop.test");

    expect(await throttle.retryAfter("owner@shop.test")).toBe(60);
    expect(await throttle.retryAfter("Owner@Shop.test")).toBe(0);
  });
  it("clears an account on every address it was counted from when an administrator unlocks it", async () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";
    for (let host = 1; host <= 3; host += 1) {
      for (let i = 0; i < 7; i += 1) await throttle.fail(throttleKey(account, `192.168.1.${host}`));
    }
    for (let i = 0; i < 7; i += 1) await throttle.fail(throttleKey("clerk@shop.test", "192.168.1.1"));

    await throttle.unlock(account);

    for (let host = 1; host <= 3; host += 1) expect(await throttle.retryAfter(throttleKey(account, `192.168.1.${host}`))).toBe(0);
    expect(await throttle.retryAfter(throttleKey("clerk@shop.test", "192.168.1.1"))).toBeGreaterThan(0);
  });

  it("never locks an account whose till mistypes once every twenty-five minutes, all week", async () => {
    const { throttle, advance } = throttleAt();
    const till = throttleKey("owner@shop.test", "41.33.10.10");

    for (let typo = 1; typo <= 400; typo += 1) {
      advance(25 * MINUTE);
      expect(await throttle.fail(till), `typo ${typo}`).toBe(0);
      expect(await throttle.retryAfter(till), `after typo ${typo}`).toBe(0);
    }
  });

  it("still locks six failures inside one hour, however they are spaced", async () => {
    const { throttle, advance } = throttleAt();
    const till = throttleKey("owner@shop.test", "41.33.10.10");

    for (let typo = 1; typo <= 5; typo += 1) {
      advance(11 * MINUTE);
      expect(await throttle.fail(till), `typo ${typo}`).toBe(0);
    }
    advance(4 * MINUTE);
    expect(await throttle.fail(till)).toBe(60);
  });

  it("clears only the address a verified credential came from", async () => {
    const { throttle } = throttleAt();
    const account = "owner@shop.test";
    const attacker = throttleKey(account, "41.33.10.10");
    const owner = throttleKey(account, "196.221.5.5");
    for (let i = 0; i < 7; i += 1) await throttle.fail(attacker);
    for (let i = 0; i < 4; i += 1) await throttle.fail(owner);

    await throttle.succeed(owner);

    expect(await throttle.retryAfter(attacker)).toBe(120);
    for (let i = 1; i <= 5; i += 1) expect(await throttle.fail(owner), `failure ${i}`).toBe(0);
    expect(await throttle.fail(owner)).toBe(60);
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

  it("lets a shop's worth of typos through and holds the thirty-first failure", async () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 30; i += 1) expect(await sources.fail("192.168.1.66")).toBe(0);
    expect(await sources.retryAfter("192.168.1.66")).toBe(0);

    expect(await sources.fail("192.168.1.66")).toBe(60);
    expect(await sources.retryAfter("192.168.1.66")).toBe(60);
  });

  it("holds only the address that failed", async () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 31; i += 1) await sources.fail("192.168.1.66");

    expect(await sources.retryAfter("192.168.1.40")).toBe(0);
  });

  it("doubles the wait with each further failure, up to fifteen minutes", async () => {
    const { sources, advance } = sourcesAt();
    for (let i = 0; i < 31; i += 1) await sources.fail("192.168.1.66");
    advance(60_000);
    expect(await sources.retryAfter("192.168.1.66")).toBe(0);

    expect(await sources.fail("192.168.1.66")).toBe(120);
    for (let i = 0; i < 10; i += 1) await sources.fail("192.168.1.66");
    expect(await sources.retryAfter("192.168.1.66")).toBe(15 * 60);
  });

  it("forgets an address that has been quiet for an hour", async () => {
    const { sources, advance } = sourcesAt();
    for (let i = 0; i < 30; i += 1) await sources.fail("192.168.1.66");
    advance(60 * 60_000 + 1);

    expect(await sources.fail("192.168.1.66")).toBe(0);
  });

  it("never holds an office that mistypes once every twenty-five minutes, all week", async () => {
    const { sources, advance } = sourcesAt();

    for (let typo = 1; typo <= 400; typo += 1) {
      advance(25 * 60_000);
      expect(await sources.fail("41.33.10.10"), `typo ${typo}`).toBe(0);
    }
    expect(await sources.retryAfter("41.33.10.10")).toBe(0);
  });

  it("keeps no more than ten thousand addresses, however many are sent", async () => {
    const { sources } = sourcesAt();
    for (let i = 0; i < 10_050; i += 1) await sources.fail(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);

    expect(await sources.size()).toBe(10_000);
  });
});
